// Liga o pipeline puro ao banco, à IA, ao conector hbook e ao agente externo.
import type { AgentConfig, Product } from "./agent-core.ts";
import type { PipelineDeps } from "./agent-pipeline.ts";
import { type AiProvider, aiProviderFromEnv, base64FromBytes } from "./ai.ts";
import type { InstanceRow } from "./channel.ts";
import { callExternalAgent, resolveExternalSecret } from "./external-agent.ts";
import { buildBookingLink, type HbookConfig } from "./hbook.ts";
import { bookingLinkFrom, loadAvailabilityProvider, loadConnectors } from "./availability.ts";
import { RuntimeError } from "./http.ts";
import { cleanMime, loadMediaBytes, looksLikePaymentProof, mediaNote, mergeMessageMetadata } from "./inbox-media.ts";
import { searchKnowledge } from "./knowledge.ts";
import { type Entitlements, hasFeature } from "./entitlements.ts";
import { photoGroups } from "./media.ts";
import { pdfToText } from "./pdf.ts";
import { isOpenNight, priceTableSchema, priceTableSummary, quoteStay, withDeposit } from "./pricing.ts";
import type { PaymentInfo } from "./agent-core.ts";
import type { Db } from "./supabase.ts";

export function aiFromEnv(): AiProvider | null {
  return aiProviderFromEnv((name) => Deno.env.get(name) || undefined);
}

export async function loadAgentConfig(db: Db, workspaceId: string): Promise<AgentConfig> {
  const { data, error } = await db.from("agent_configs").select("*").eq("workspace_id", workspaceId).maybeSingle();
  if (error) throw new RuntimeError("internal_error", "Falha ao carregar configuração do agente.");
  if (!data) throw new RuntimeError("not_found", "Workspace sem configuração de agente.");
  return {
    ...data,
    temperature: Number(data.temperature),
    business_hours: data.business_hours ?? {},
    payment_links: Array.isArray(data.payment_links) ? data.payment_links : [],
    handoff_keywords: data.handoff_keywords ?? [],
  } as AgentConfig;
}

export async function loadBusinessName(db: Db, workspaceId: string): Promise<string> {
  const { data } = await db
    .from("workspaces")
    .select("name, workspace_branding(display_name)")
    .eq("id", workspaceId)
    .maybeSingle();
  // deno-lint-ignore no-explicit-any
  const branding = (data as any)?.workspace_branding;
  return (Array.isArray(branding) ? branding[0]?.display_name : branding?.display_name) || data?.name || "nossa empresa";
}

export async function loadProducts(db: Db, workspaceId: string): Promise<Product[]> {
  const { data } = await db
    .from("products")
    .select("name, description, price, currency, url")
    .eq("workspace_id", workspaceId)
    .eq("active", true)
    .order("name")
    .limit(40);
  return (data ?? []).map((p: Product & { price: string | number | null }) => ({ ...p, price: p.price === null ? null : Number(p.price) }));
}

export async function loadHbookConfig(db: Db, workspaceId: string): Promise<HbookConfig | null> {
  const { data } = await db
    .from("workspace_connectors")
    .select("enabled, config")
    .eq("workspace_id", workspaceId)
    .eq("kind", "hbook")
    .maybeSingle();
  if (!data?.enabled || !data.config?.base_url || !data.config?.company_id) return null;
  return data.config as HbookConfig;
}

export async function buildPipelineDeps(
  db: Db,
  args: {
    workspaceId: string;
    config: AgentConfig;
    ai: AiProvider | null;
    entitlements: Entitlements | null;
    correlationId: string;
    log: (m: string, e?: Record<string, unknown>) => void;
  },
): Promise<PipelineDeps> {
  // O plano pode desligar conectores e agente externo; a IA já chega nula se o plano não a inclui.
  const allows = (feature: "connectors_enabled" | "external_agent_enabled") => !args.entitlements || hasFeature(args.entitlements, feature);
  const availability = allows("connectors_enabled") ? await loadAvailabilityProvider(db, args.workspaceId) : null;
  const config = allows("external_agent_enabled") ? args.config : { ...args.config, external_agent_enabled: false };
  return {
    config,
    ai: args.ai,
    now: () => new Date(),
    correlationId: args.correlationId,
    log: args.log,
    searchKnowledge: async (query, limit) => (await searchKnowledge(db, args.ai, args.workspaceId, query, limit)).results,
    checkAvailability: availability?.fn,
    photos: await loadPhotos(db, args.workspaceId),
    pinnedKnowledge: await loadPinnedKnowledge(db, args.workspaceId),
    policies: await loadPolicies(db, args.workspaceId),
    ...(await (async () => {
      const paymentInfo = await loadPaymentInfo(db, args.workspaceId);
      return { paymentInfo, priceTable: await loadPriceTable(db, args.workspaceId, paymentInfo?.deposit_percent ?? null) };
    })()),
    callExternal: config.external_agent_enabled && config.external_agent_url
      ? (payload) =>
        callExternalAgent({
          url: config.external_agent_url!,
          secret: resolveExternalSecret(config.external_agent_secret_ref, (n) => Deno.env.get(n) || undefined),
          payload,
          timeoutMs: config.external_agent_timeout_ms,
          correlationId: args.correlationId,
        })
      : undefined,
  };
}

/** Tabela de preços estruturada ativa (cálculo exato do valor). */
/**
 * Dados de pagamento, só quando o dono habilitou o compartilhamento. Com link de pré-reserva,
 * a chave PIX e os dados bancários nem chegam ao prompt (a equipe os envia após confirmar a vaga).
 */
async function loadPaymentInfo(db: Db, workspaceId: string): Promise<PaymentInfo | null> {
  const { data } = await db.from("workspace_business_info").select("*").eq("workspace_id", workspaceId).maybeSingle();
  if (!data?.share_payment_info) return null;
  const info = { ...data, deposit_percent: data.deposit_percent === null ? null : Number(data.deposit_percent) } as PaymentInfo;
  if (!info.pre_reservation_url) return info;
  return { ...info, pix_key: null, pix_key_type: null, bank_name: null, bank_code: null, agency: null, account: null, account_type: null };
}

async function loadPriceTable(db: Db, workspaceId: string, depositPercent: number | null = null): Promise<PipelineDeps["priceTable"]> {
  const { data } = await db.from("price_tables").select("data, currency").eq("workspace_id", workspaceId).eq("active", true).maybeSingle();
  if (!data) return undefined;
  const parsed = priceTableSchema.safeParse(data.data);
  if (!parsed.success) return undefined;
  // O valor da tabela sai junto com o link de reserva já preenchido (datas e hóspedes).
  const base = bookingLinkFrom(await loadConnectors(db, workspaceId));
  return {
    quote: (q) => {
      const result = withDeposit(quoteStay(parsed.data, q, data.currency ?? "BRL"), depositPercent, data.currency ?? "BRL");
      const link = base && /hbook/i.test(base)
        ? buildBookingLink({ base_url: "", company_id: "", booking_link: base }, { checkin: q.checkin, checkout: q.checkout, adults: q.adults, children: q.childrenAges.length })
        : base;
      return link ? { ...result, link_reserva: link } : result;
    },
    isOpen: (night) => isOpenNight(parsed.data, night),
    summary: priceTableSummary(parsed.data, data.currency ?? "BRL"),
  };
}

/** Políticas e informações oficiais da empresa (ativas, na ordem da tela). */
async function loadPolicies(db: Db, workspaceId: string): Promise<Array<{ topic: string; title: string; content: string }>> {
  const { data } = await db.from("workspace_policies").select("topic, title, content").eq("workspace_id", workspaceId)
    .eq("active", true).order("position").order("created_at").limit(60);
  return (data ?? []) as Array<{ topic: string; title: string; content: string }>;
}

/** Fontes marcadas como fixas no agente (metadata.pinned): tabela de preços, políticas. */
async function loadPinnedKnowledge(db: Db, workspaceId: string): Promise<Array<{ title: string; content: string }>> {
  const { data } = await db.from("knowledge_sources").select("title, content").eq("workspace_id", workspaceId)
    .eq("status", "indexed").eq("metadata->>pinned", "true").order("created_at").limit(10);
  return (data ?? []).filter((s: { content: string | null }) => s.content?.trim()) as Array<{ title: string; content: string }>;
}

/** Galeria de fotos para a ferramenta enviar_fotos (undefined quando o workspace não tem fotos). */
async function loadPhotos(db: Db, workspaceId: string): Promise<PipelineDeps["photos"]> {
  const { data } = await db.from("media_assets").select("album, product_id, products(name)").eq("workspace_id", workspaceId).limit(2000);
  if (!data?.length) return undefined;
  // deno-lint-ignore no-explicit-any
  const rows = (data as any[]).map((r) => ({ album: r.album, product_id: r.product_id, product_name: (Array.isArray(r.products) ? r.products[0] : r.products)?.name ?? null }));
  const groups = photoGroups(rows);
  return {
    albums: groups.map((g) => ({ name: g.name, count: g.count })),
    pick: async (name, count) => {
      const g = groups.find((x) => x.name === name);
      if (!g) return [];
      let q = db.from("media_assets").select("public_url, caption, mime_type").eq("workspace_id", workspaceId);
      q = g.product_id ? q.eq("product_id", g.product_id) : q.eq("album", [...g.albums][0]).is("product_id", null);
      const { data: picked } = await q.order("position").order("created_at").limit(count);
      return (picked ?? []).map((r: { public_url: string; caption: string | null; mime_type: string }) => ({ url: r.public_url, caption: r.caption, mimetype: r.mime_type }));
    },
  };
}

interface MediaMessage {
  id: string;
  type: string;
  content: string | null;
  media_mime: string | null;
  metadata: Record<string, unknown>;
}

const DOC_TEXT_LIMIT = 3000;
const VISION_PROMPT =
  "Descreva objetivamente esta imagem enviada por um cliente no WhatsApp, em português, em até 3 frases. Transcreva textos visíveis (ex.: códigos, preços). " +
  "Se for comprovante de pagamento (PIX, transferência, depósito, boleto pago), comece com \"Comprovante de pagamento:\" e transcreva valor, data, pagador e favorecido.";

/**
 * Converte mídia em texto para o agente: áudio → transcrição (STT), imagem → descrição (visão), PDF → texto.
 * O resultado fica em messages.metadata para não repetir o custo e para aparecer na inbox;
 * comprovante de pagamento reconhecido ganha metadata.payment_proof (a conversa vai para a equipe conferir).
 */
export async function preprocessMedia(
  db: Db,
  ai: AiProvider | null,
  instance: Pick<InstanceRow, "instance_name" | "provider_secret_ref"> | null,
  msg: MediaMessage,
  language: string,
): Promise<string | null> {
  const meta = msg.metadata ?? {};
  const cached = mediaNote(msg);
  const done = typeof meta.transcript === "string" || typeof meta.image_description === "string" || typeof meta.document_text === "string";
  if (cached !== null && (done || msg.type !== "document")) return cached;
  if (msg.type === "location" || msg.type === "contact") return msg.content ? `[${msg.type}] ${msg.content}` : `[${msg.type}]`;
  if (msg.type !== "audio" && msg.type !== "image" && msg.type !== "document") return msg.content;

  const mime = cleanMime(msg.media_mime);
  const isPdf = mime === "application/pdf" || /\.pdf$/i.test(String(meta.file_name ?? ""));
  const isPicture = msg.type === "image" || mime.startsWith("image/");
  const noted = (patch: Record<string, unknown>) => mediaNote({ ...msg, metadata: { ...meta, ...patch } });
  // Documento que não dá para ler (DOCX, planilha...): o agente sabe que chegou, a equipe abre na inbox.
  if (msg.type === "document" && !isPdf && !isPicture) return noted({});
  if (!instance && typeof meta.media_path !== "string") return cached ?? msg.content ?? `[${msg.type} recebido]`;
  if (!ai && !isPdf) return cached ?? msg.content ?? `[${msg.type} recebido]`;

  try {
    const media = await loadMediaBytes(db, instance, msg);
    let patch: Record<string, unknown>;
    if (msg.type === "audio") {
      const transcript = await ai!.transcribe(media.bytes, media.mime.startsWith("audio/") ? media.mime : "audio/ogg", language);
      await mergeMessageMetadata(db, msg.id, { transcript });
      return transcript || "[áudio sem fala reconhecível]";
    }
    if (isPicture) {
      const pictureMime = media.mime.startsWith("image/") ? media.mime : "image/jpeg";
      const description = await ai!.describeImage(`data:${pictureMime};base64,${base64FromBytes(media.bytes)}`, VISION_PROMPT);
      patch = { image_description: description };
    } else {
      const text = (await pdfToText(media.bytes)).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
      patch = { document_text: text.slice(0, DOC_TEXT_LIMIT) };
    }
    const read = String(patch.image_description ?? patch.document_text ?? "");
    if (looksLikePaymentProof(read)) patch.payment_proof = true;
    await mergeMessageMetadata(db, msg.id, patch);
    return noted(patch);
  } catch (err) {
    console.warn(JSON.stringify({ level: "warn", msg: "media_preprocess_failed", type: msg.type, error: String(err) }));
    return msg.type === "document" ? noted({}) : msg.content ?? `[${msg.type} recebido — não foi possível processar]`;
  }
}

export async function synthesizeVoice(ai: AiProvider, text: string, voice: string | null): Promise<string> {
  return base64FromBytes(await ai.speech(text, voice ?? undefined));
}
