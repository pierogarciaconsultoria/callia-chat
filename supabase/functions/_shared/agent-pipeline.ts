// Orquestração da resposta do agente. Sem I/O direto: tudo entra por PipelineDeps (testável).
import type { AiProvider, ChatMessage, ToolDefinition } from "./ai.ts";
import {
  type AgentConfig,
  buildSystemPrompt,
  composeHandoffMessage,
  deterministicReply,
  type HistoryItem,
  historyToChat,
  isWithinBusinessHours,
  type KnowledgeHit,
  matchHandoffKeyword,
  PIX_AVAILABILITY_WARNING,
  type Product,
  sanitizeReply,
} from "./agent-core.ts";
import { ExternalAgentError, type ExternalAgentPayload, type ExternalAgentReply } from "./external-agent.ts";
import type { AvailabilityQuery, HbookAvailability } from "./hbook.ts";
import { matchAlbum, mentionedAlbums } from "./media.ts";
import { fitToGroup, mergeAvailability, stripPmsIds } from "./pricing.ts";

export interface PipelineInput {
  workspaceId: string;
  businessName: string;
  conversation: { id: string; contact_name: string | null; contact_phone: string };
  trigger: { id: string; type: string; text: string | null; media_url: string | null; created_at: string };
  /** Mensagens do cliente ainda sem resposta, consolidadas (já com transcrição/descrição de mídia). */
  pendingText: string;
  /** Últimas mensagens da conversa, em ordem cronológica, incluindo as pendentes. */
  history: HistoryItem[];
  products: Product[];
  /** Entre as pendentes há foto ou PDF com cara de comprovante de pagamento. */
  paymentProof?: boolean;
  /** Só áudio(s) sem fala aproveitável desde a última resposta: pede para repetir, sem chamar a IA. */
  unintelligibleAudio?: boolean;
}

/** A IA não confere pagamento: agradece e passa para a equipe confirmar. */
export const UNINTELLIGIBLE_AUDIO_REPLY = "Não consegui entender bem o seu áudio 😕 Pode mandar de novo ou escrever por aqui?";
export const PAYMENT_PROOF_REPLY ="Recebi o seu comprovante, obrigado! Já passei para a equipe conferir o pagamento, e eles confirmam com você por aqui.";

export interface PipelineDeps {
  config: AgentConfig;
  ai: AiProvider | null;
  now: () => Date;
  correlationId: string;
  searchKnowledge: (query: string, limit: number) => Promise<KnowledgeHit[]>;
  checkAvailability?: (query: AvailabilityQuery) => Promise<HbookAvailability>;
  callExternal?: (payload: ExternalAgentPayload) => Promise<ExternalAgentReply>;
  /** Fotos do workspace (galeria); ausente = ferramenta enviar_fotos não é oferecida. */
  photos?: {
    albums: Array<{ name: string; count: number }>;
    pick: (album: string, count: number) => Promise<Array<{ url: string; caption: string | null; mimetype: string }>>;
  };
  /** Fontes "fixas no agente" (sempre no prompt). */
  pinnedKnowledge?: Array<{ title: string; content: string }>;
  /** Políticas e informações oficiais da empresa (sempre no prompt). */
  policies?: Array<{ topic: string; title: string; content: string }>;
  /** Dados de pagamento da empresa (seção de pagamento no prompt). */
  paymentInfo?: import("./agent-core.ts").PaymentInfo | null;
  /** Tabela de preços estruturada: cálculo exato do valor (a IA não faz conta). */
  priceTable?: {
    quote: (q: { checkin: string; checkout: string; adults: number; childrenAges: number[]; unit?: string | null }) => unknown;
    /** Noite (AAAA-MM-DD) em que o hotel funciona: fora de fechamentos e da temporada cadastrada. */
    isOpen?: (night: string) => boolean;
    /** Texto da tabela para o prompt (gerado da estrutura). */
    summary?: string;
  };
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

export type ExternalMedia = ExternalAgentReply["media"][number];

export interface ToolCallTrace {
  name: string;
  arguments: Record<string, unknown>;
  result: unknown;
}

export interface PipelineOutcome {
  action: "reply" | "handoff";
  engine: "internal" | "external" | "fallback";
  reply: string | null;
  media: ExternalMedia[];
  handoffReason: string | null;
  knowledge: KnowledgeHit[];
  toolCalls: ToolCallTrace[];
  usage: Record<string, number>;
  externalError: string | null;
  aiError: string | null;
}

const MAX_TOOL_ROUNDS = 4;
const MAX_PHOTOS_PER_CALL = 5;
const MAX_PHOTOS_PER_REPLY = 10;

/** Frases em que a IA promete fotos ("seguem as fotos 👇", "vou enviar as fotos"). */
const PHOTO_PROMISE = /(seguem|segue|aqui est[aã]o|vou (te )?(enviar|mandar)|estou (te )?(enviando|mandando)|enviando|enviei|mandei|confira)[^.!?\n]{0,50}fotos?|fotos?[^.!?\n]{0,40}👇/i;

/** "Vou consultar…", "um momento" sem chamar ferramenta: o hóspede ficaria esperando para sempre. */
const ACTION_PROMISE = /\b(vou|irei|deixa eu|deixe-me|vou te|vou já|já vou)\b[^.!?\n]{0,40}\b(consultar|verificar|checar|calcular|buscar|olhar|confirmar)|\b(um momento|só um instante|um instante|aguarde)\b/i;

export function promisesAction(text: string): boolean {
  return ACTION_PROMISE.test(text);
}

/** Resultado como a IA vê: sem a contagem de unidades livres (dado interno que ela repetia ao hóspede). */
export function forAi(result: unknown): unknown {
  const opcoes = (result as { opcoes?: unknown[] } | null)?.opcoes;
  if (!Array.isArray(opcoes)) return result;
  return { ...(result as object), opcoes: opcoes.map((o) => {
    const { unidades_disponiveis: _n, ...rest } = o as { unidades_disponiveis?: unknown };
    return rest;
  }) };
}

const WANTS_LINK = /\blink\b|\breservar\b|\bfechar\b|\bfecho\b|\bquero (esse|essa|este|esta|o |a |reservar|fechar)|\bpode (reservar|marcar|fechar)|\bvamos fechar|\bgarantir\b|\bconfirmar a reserva/i;
const SHORT_YES = /^\s*(sim|pode|pode ser|ok|okay|claro|quero|isso|por favor|manda|envia|pode mandar|pode enviar)\b[\s!.]*$/i;

/** O hóspede pediu o link ou quer reservar, ou disse "sim" logo depois de a IA oferecer o link. */
export function wantsBookingLink(history: Array<Pick<HistoryItem, "direction" | "content">>, pendingText: string): boolean {
  if (WANTS_LINK.test(pendingText)) return true;
  const lastOut = [...history].reverse().find((h) => h.direction === "outbound")?.content ?? "";
  return SHORT_YES.test(pendingText) && /\blink\b|reservar/i.test(lastOut);
}

/**
 * Primeira apresentação de valores: o link de reserva sai da resposta (a IA o mandava junto do orçamento,
 * o que o hotel achou agressivo). Volta quando o hóspede quiser reservar ou pedir o link.
 */
export function trimEarlyLink(text: string, urls: string[]): string {
  if (!urls.length) return text;
  const lines = text.split("\n").filter((line) => !urls.some((u) => line.includes(u)));
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** A resposta traz um valor em reais (R$ 600,00 / 600 reais). */
export function quotesPrice(text: string): boolean {
  return /R\$\s?\d|\b\d{1,3}(\.\d{3})+,\d{2}\b|\b\d+\s*reais\b/i.test(text);
}

const MONTHS = "janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro";
const DAY_MONTH = /\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g;
const DAY_RANGE = new RegExp(`\\b\\d{1,2}(º|°)?\\s*(a|até|ao|-)\\s*\\d{1,2}(º|°)?\\s*de\\s*(${MONTHS})`, "i");

/** O hóspede informou entrada e saída ("27/12 a 01/01", "de 27 a 31 de dezembro"). */
export function mentionsStayDates(text: string): boolean {
  return (text.match(DAY_MONTH)?.length ?? 0) >= 2 || DAY_RANGE.test(text);
}

const GUESTS = /\b(\d{1,2}|uma?|dois|duas|tr[eê]s|quatro|cinco|seis|sete)\s*(pessoas?|adultos?|h[oó]spedes?|crian[cç]as?)\b|\bsomos\s*(\d{1,2}|dois|duas|tr[eê]s|quatro|cinco|seis|sete)\b|\bcasal\b|\bsozinh[oa]\b/i;

/** O hóspede já disse quantas pessoas são. */
export function mentionsGuests(text: string): boolean {
  return GUESTS.test(text);
}

const CHILDREN_INFO = /crian[cç]as?|filh[oa]s?|beb[eê]s?|nen[eê]m?|adultos?|casal|sozinh[oa]|\b\d{1,2}\s*anos\b|maiores de idade/i;
const NO_CHILDREN = /^\s*(n[aã]o|nenhuma?|sem|nada|negativo|s[oó]\s+(n[oó]s|eu))\b/i;

/**
 * O hóspede já disse se vêm crianças: citou crianças/adultos/casal/idades, ou respondeu "não" logo depois de
 * perguntarmos. "3" sozinho não diz: a tarifa e a acomodação dependem das idades.
 */
export function childrenAddressed(history: Array<Pick<HistoryItem, "direction" | "content">>, pendingText = ""): boolean {
  let askedKids = false;
  for (const h of history) {
    const text = h.content ?? "";
    if (h.direction === "outbound") {
      askedKids = /crian[cç]a/i.test(text);
      continue;
    }
    if (CHILDREN_INFO.test(text) || (askedKids && NO_CHILDREN.test(text))) return true;
  }
  // A mensagem pendente pode ou não estar no histórico (produção inclui; simulador e ensaios, não).
  return CHILDREN_INFO.test(pendingText) || (askedKids && NO_CHILDREN.test(pendingText));
}

/** "Está disponível", "temos o 205 disponível", "há vaga", "disponibilidade confirmada". */
const AVAILABILITY_CLAIM = /\b(est[aá]|est[aã]o|fica|ficam|segue|seguem)\s+(dispon[ií]ve(l|is)|livres?)\b|\btemos\b[^.!?\n]{0,60}\bdispon[ií]ve(l|is)\b|\b(h[aá]|tem|temos)\s+(vagas?|disponibilidade)\b|\bdisponibilidade\b[^.!?\n]{0,30}\b(est[aá]|foi)\s+confirmad|\bvaga\s+(garantida|confirmada)\b/i;
const NEGATED = /\b(n[aã]o|sem|ainda n[aã]o)\b[^.!?\n]{0,25}(est[aá]|h[aá]|tem|temos|dispon|vaga|confirm)/i;
const SENTENCES = /(?<=[.!?…])\s+|\n/;

/** A resposta afirma que há vaga (frase não negada). */
export function claimsAvailability(text: string): boolean {
  return text.split(SENTENCES).some((s) => AVAILABILITY_CLAIM.test(s) && !NEGATED.test(s));
}

/** Remove as frases que afirmam vaga, mantendo quebras de linha do restante. */
export function stripAvailabilityClaims(text: string): string {
  return text
    .split("\n")
    .map((line) => line.split(/(?<=[.!?…])\s+/).filter((s) => !(AVAILABILITY_CLAIM.test(s) && !NEGATED.test(s))).join(" "))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function promisesPhotos(text: string): boolean {
  return PHOTO_PROMISE.test(text);
}

/** Remove as frases que prometem fotos (quando nenhuma pôde ser enviada). */
export function stripPhotoPromise(text: string): string {
  return text
    .split(/(?<=[.!?…])\s+|\n/)
    .filter((sentence) => !PHOTO_PROMISE.test(sentence))
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function buildExternalPayload(input: PipelineInput, now: Date): ExternalAgentPayload {
  return {
    workspace_id: input.workspaceId,
    conversation_id: input.conversation.id,
    message_id: input.trigger.id,
    contact: { name: input.conversation.contact_name, phone: input.conversation.contact_phone },
    message: { type: input.trigger.type, text: input.pendingText || input.trigger.text, media_url: input.trigger.media_url },
    history: input.history.slice(-20).map((h) => ({ role: h.sender, type: h.type, text: h.content, at: h.created_at })),
    timestamp: now.toISOString(),
  };
}

function agentTools(hasAvailability: boolean, photoAlbums: string[] = [], hasPriceTable = false): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    {
      type: "function",
      function: {
        name: "transferir_para_atendente",
        description:
          "Transfere a conversa para a equipe humana. Use quando o cliente pedir uma pessoa, estiver insatisfeito, ou quando a resposta não estiver no contexto.",
        parameters: {
          type: "object",
          properties: { motivo: { type: "string", description: "Motivo curto da transferência." } },
          required: ["motivo"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "buscar_conhecimento",
        description: "Busca mais trechos na base de conhecimento do negócio quando o contexto fornecido não for suficiente.",
        parameters: {
          type: "object",
          properties: { consulta: { type: "string", description: "O que procurar, em poucas palavras." } },
          required: ["consulta"],
        },
      },
    },
  ];
  if (hasPriceTable) {
    tools.push({
      type: "function",
      function: {
        name: "calcular_valor",
        description: "Calcula o valor exato da estadia pela tabela de preços oficial (noite a noite, por período e número de pessoas). Use sempre para informar valores.",
        parameters: {
          type: "object",
          properties: {
            checkin: { type: "string", description: "Data de entrada DD/MM/AAAA." },
            checkout: { type: "string", description: "Data de saída DD/MM/AAAA." },
            adultos: { type: "integer", minimum: 1 },
            idades_criancas: { type: "array", items: { type: "integer", minimum: 0, maximum: 17 } },
            acomodacao: { type: "string", description: "Opcional: acomodação desejada (ex.: kitnet, 205)." },
          },
          required: ["checkin", "checkout", "adultos"],
        },
      },
    });
  }
  if (photoAlbums.length) {
    tools.push({
      type: "function",
      function: {
        name: "enviar_fotos",
        description: "Envia fotos de uma acomodação ou área para o cliente no WhatsApp.",
        parameters: {
          type: "object",
          properties: {
            album: { type: "string", description: `Álbum: ${photoAlbums.join(", ")}.` },
            quantidade: { type: "integer", minimum: 1, maximum: MAX_PHOTOS_PER_CALL, description: "Quantas fotos (padrão 4)." },
          },
          required: ["album"],
        },
      },
    });
  }
  if (hasAvailability) {
    tools.push({
      type: "function",
      function: {
        name: "consultar_disponibilidade",
        description: "Consulta acomodações disponíveis e preços reais no motor de reservas.",
        parameters: {
          type: "object",
          properties: {
            checkin: { type: "string", description: "Data de entrada DD/MM/AAAA." },
            checkout: { type: "string", description: "Data de saída DD/MM/AAAA." },
            adultos: { type: "integer", minimum: 1 },
            idades_criancas: {
              type: "array",
              items: { type: "integer", minimum: 0, maximum: 17 },
              description: "Idade de cada criança (0 a 17 anos). Se houver crianças, pergunte as idades antes de consultar. Vazio se não houver.",
            },
            ...(hasPriceTable ? { acomodacao: { type: "string", description: "Opcional: acomodação pedida pelo hóspede (ex.: kitnet, Verdes Mares)." } } : {}),
          },
          required: ["checkin", "checkout"],
        },
      },
    });
  }
  return tools;
}

function addUsage(total: Record<string, number>, usage: Record<string, number | undefined>) {
  for (const [k, v] of Object.entries(usage)) if (typeof v === "number") total[k] = (total[k] ?? 0) + v;
}

export async function runAgentPipeline(input: PipelineInput, deps: PipelineDeps): Promise<PipelineOutcome> {
  const { config } = deps;
  const now = deps.now();
  const withinHours = isWithinBusinessHours(config.business_hours, config.timezone, now);
  const outcome: PipelineOutcome = {
    action: "reply",
    engine: "internal",
    reply: null,
    media: [],
    handoffReason: null,
    knowledge: [],
    toolCalls: [],
    usage: {},
    externalError: null,
    aiError: null,
  };
  const handoff = (engine: PipelineOutcome["engine"], reason: string, reply?: string | null): PipelineOutcome => ({
    ...outcome,
    action: "handoff",
    engine,
    handoffReason: reason,
    reply: reply?.trim() ? reply.trim() : composeHandoffMessage(config, withinHours),
  });

  // 1. Pedido explícito de humano vence tudo.
  const keyword = matchHandoffKeyword(input.pendingText, config.handoff_keywords);
  if (keyword) return handoff("internal", `keyword:${keyword}`);
  if (input.paymentProof) {
    const later = withinHours === false && config.out_of_hours_message?.trim() ? `\n\n${config.out_of_hours_message.trim()}` : "";
    return handoff("internal", "payment_proof", PAYMENT_PROOF_REPLY + later);
  }
  // Áudio que o reconhecimento de voz não entendeu: a IA respondia qualquer coisa (orçamento, link) a partir do histórico.
  if (input.unintelligibleAudio) return { ...outcome, reply: UNINTELLIGIBLE_AUDIO_REPLY };

  // 2. Agente externo (opcional). Qualquer falha cai no pipeline interno.
  if (config.external_agent_enabled && deps.callExternal) {
    try {
      const ext = await deps.callExternal(buildExternalPayload(input, now));
      if (ext.handoff) return { ...handoff("external", "external_agent", ext.reply), media: ext.media };
      return { ...outcome, engine: "external", reply: ext.reply?.trim() || null, media: ext.media };
    } catch (err) {
      outcome.externalError = err instanceof ExternalAgentError ? `${err.reason}: ${err.message}` : String(err);
      deps.log?.("external_agent_failed", { error: outcome.externalError });
    }
  }

  // 3. Contexto da base de conhecimento.
  try {
    outcome.knowledge = await deps.searchKnowledge(input.pendingText, 5);
  } catch (err) {
    deps.log?.("knowledge_search_failed", { error: String(err) });
  }

  const fallback = (): PipelineOutcome => {
    const det = deterministicReply(outcome.knowledge, { handoff_message: composeHandoffMessage(config, withinHours) });
    return det.kind === "reply"
      ? { ...outcome, engine: "fallback", reply: det.text }
      : { ...outcome, action: "handoff", engine: "fallback", reply: det.text, handoffReason: "no_answer" };
  };

  // 4. Sem provedor de IA: resposta determinística.
  if (!deps.ai) return fallback();

  // 5. IA interna com ferramentas.
  const hasAvailability = Boolean(deps.checkAvailability);
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt({
        config,
        businessName: input.businessName,
        now,
        withinHours,
        knowledge: outcome.knowledge,
        products: input.products,
        contactName: input.conversation.contact_name,
        hasAvailabilityTool: hasAvailability,
        photoAlbums: deps.photos?.albums,
        pinnedKnowledge: deps.pinnedKnowledge,
        policies: deps.policies,
        hasPriceTable: Boolean(deps.priceTable),
        priceTableText: deps.priceTable?.summary ?? null,
        paymentInfo: deps.paymentInfo ?? null,
      }),
    },
    ...historyToChat(input.history),
  ];
  if (messages[messages.length - 1]?.role !== "user") messages.push({ role: "user", content: input.pendingText });
  const tools = agentTools(hasAvailability, deps.photos?.albums.map((a) => a.name) ?? [], Boolean(deps.priceTable));
  // Com acomodação pedida pelo hóspede, mostra mesmo que seja maior que o grupo.
  const sized = <T>(args: Record<string, unknown>, result: T): T => typeof args.acomodacao === "string" && args.acomodacao.trim() ? result : fitToGroup(result);
  const quoteFrom = (args: Record<string, unknown>) =>
    deps.priceTable!.quote({
      checkin: String(args.checkin ?? ""),
      checkout: String(args.checkout ?? ""),
      adults: Number(args.adultos ?? 2),
      childrenAges: Array.isArray(args.idades_criancas) ? args.idades_criancas.map(Number) : [],
      unit: typeof args.acomodacao === "string" ? args.acomodacao : null,
    });
  // Acomodação pedida que não comporta o grupo (ex.: 101 para 4 pessoas): cota as que comportam, e a pedida
  // vai em nao_comportam. Sem isso a consulta caía no PMS sem a tabela e a IA dizia "sem vaga".
  const fitArgs = (args: Record<string, unknown>): { args: Record<string, unknown>; note?: string } => {
    if (!deps.priceTable || typeof args.acomodacao !== "string" || !args.acomodacao.trim()) return { args };
    const asked = quoteFrom(args) as { opcoes?: unknown[]; nao_comportam?: string[]; hospedes?: number };
    if (asked.opcoes?.length || !asked.nao_comportam?.length) return { args };
    const { acomodacao: _unit, ...rest } = args;
    return {
      args: rest,
      note: `${asked.nao_comportam.join(", ")}: não comporta(m) ${asked.hospedes ?? "esse número de"} pessoas. Não é falta de vaga: diga ao hóspede que essa acomodação é para menos pessoas e ofereça as opcoes abaixo, com o nome de cada uma exatamente como está em "acomodacao". Nunca diga que ela está indisponível ou sem vaga.`,
    };
  };
  // Trava: sem saber se vêm crianças (ex.: o hóspede respondeu só "3"), pergunta antes de cotar.
  const kidsKnown = (args: Record<string, unknown>) =>
    (Array.isArray(args.idades_criancas) && args.idades_criancas.length > 0) || childrenAddressed(input.history, input.pendingText);
  const sentAlbums = new Set<string>();
  const sendAlbum = async (album: string, wanted: number) => {
    const room = MAX_PHOTOS_PER_REPLY - outcome.media.length;
    if (!deps.photos || room <= 0 || sentAlbums.has(album)) return 0;
    const photos = await deps.photos.pick(album, Math.min(wanted, MAX_PHOTOS_PER_CALL, room)).catch(() => []);
    if (photos.length) sentAlbums.add(album);
    for (const p of photos) outcome.media.push({ type: "image", url: p.url, caption: p.caption ?? undefined, mimetype: p.mimetype });
    return photos.length;
  };
  /** Envia os álbuns citados no texto que ainda não foram enviados (no máximo 2). */
  const sendMentioned = async (text: string) => {
    const names = deps.photos?.albums.map((a) => a.name) ?? [];
    const pending = mentionedAlbums(text, names).filter((a) => !sentAlbums.has(a)).slice(0, Math.max(0, 2 - sentAlbums.size));
    for (const album of pending) await sendAlbum(album, pending.length > 1 ? 4 : 5);
  };
  // Trava: se a IA prometer fotos sem chamar a ferramenta, força a chamada antes de responder.
  let promisedReply: string | null = null;
  // Trava: "vou consultar, um momento" sem chamar ferramenta → obriga a chamar antes de responder.
  let forceTool = false;
  let actionNudged = false;
  let priceNudged = false;
  const actionTools = tools.map((t) => t.function.name).filter((n) => n === "consultar_disponibilidade" || n === "calcular_valor");
  // Trava: com datas de entrada e saída, a resposta sai da ferramenta — a IA erra a conta de noites e o mínimo de diárias.
  const customerText = input.history.filter((h) => h.direction === "inbound").map((h) => h.content ?? "").join("\n") + "\n" + input.pendingText;
  let forcedFirst: string | null = actionTools.length && mentionsStayDates(input.pendingText) && mentionsGuests(customerText)
    ? (actionTools.includes("consultar_disponibilidade") ? "consultar_disponibilidade" : actionTools[0])
    : null;

  // Trava: sem confirmação do sistema de reservas, a resposta não afirma vaga e o PIX vem com o aviso.
  const availabilityConfirmed = () =>
    outcome.toolCalls.some((t) => {
      const r = t.result as { rooms?: unknown[]; sold_out?: boolean; disponibilidade_confirmada?: boolean } | null;
      return t.name === "consultar_disponibilidade" &&
        (r?.disponibilidade_confirmada === true || (Array.isArray(r?.rooms) && r.rooms.length > 0 && !r.sold_out));
    });
  const stayContext = () => mentionsStayDates(customerText) || outcome.toolCalls.some((t) => (actionTools as string[]).includes(t.name));
  const claimsUnconfirmed = (text: string) => stayContext() && !availabilityConfirmed() && claimsAvailability(text);
  let claimNudged = false;
  // Links de reserva devolvidos pelas ferramentas nesta rodada (link_reserva / booking_link).
  const bookingUrls = () =>
    outcome.toolCalls.flatMap((t) => {
      const r = t.result as { link_reserva?: unknown; booking_link?: unknown; valores_tabela?: { link_reserva?: unknown } } | null;
      return [r?.link_reserva, r?.booking_link, r?.valores_tabela?.link_reserva].filter((u): u is string => typeof u === "string" && u.length > 0);
    });
  const quotedThisRound = () => outcome.toolCalls.some((t) => (actionTools as string[]).includes(t.name));
  const withoutEarlyLink = (text: string) =>
    quotedThisRound() && !wantsBookingLink(input.history, input.pendingText) ? trimEarlyLink(text, bookingUrls()) || text : text;
  const finalize = (text: string) => {
    if (availabilityConfirmed()) return withoutEarlyLink(text);
    let out = claimsUnconfirmed(text) ? stripAvailabilityClaims(text) : text;
    // PIX com pré-reserva: o endereço da pré-reserva sempre aparece (a IA às vezes manda "pelo mesmo link" do cartão).
    const pre = deps.paymentInfo?.pre_reservation_url?.trim();
    if (pre && /\bpix\b|pr[ée]-reserva/i.test(out) && !out.includes(pre)) {
      out = `${out.replace(/\b(pelo|no|neste|nesse)\s+mesmo\s+link(\s+acima)?/gi, "pelo link de pré-reserva abaixo")}\n\nPré-reserva para pagamento por PIX: ${pre}`;
    }
    const pix = deps.paymentInfo?.pix_key?.trim();
    if (pix && out.includes(pix) && !out.includes(PIX_AVAILABILITY_WARNING)) out = `${out}\n\n${PIX_AVAILABILITY_WARNING}`;
    return withoutEarlyLink(out);
  };

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const result = await deps.ai.chat({
        messages,
        tools,
        model: config.ai_model ?? undefined,
        temperature: Number(config.temperature),
        ...(promisedReply
          ? { toolChoice: { type: "function" as const, function: { name: "enviar_fotos" } } }
          : forcedFirst ? { toolChoice: { type: "function" as const, function: { name: forcedFirst } } }
          : forceTool ? { toolChoice: "required" as const } : {}),
      });
      addUsage(outcome.usage, result.usage);
      forcedFirst = null;

      if (!result.toolCalls.length) {
        const text = sanitizeReply(result.content ?? "");
        if (promisedReply) return { ...outcome, reply: stripPhotoPromise(promisedReply) || null };
        if (text && !actionNudged && actionTools.length && promisesAction(text)) {
          actionNudged = true;
          forceTool = true;
          messages.push({ role: "assistant", content: text });
          messages.push({ role: "user", content: `(instrução interna) Você disse que ia consultar, mas não chamou a ferramenta. Chame agora ${actionTools.join(" ou ")} com os dados da conversa e responda com o resultado.` });
          continue;
        }
        // Trava: valor em reais sem consulta nesta rodada → a IA copiou um valor antigo do histórico (outro grupo, outra acomodação).
        if (text && !priceNudged && actionTools.length && quotesPrice(text) && !outcome.toolCalls.some((t) => (actionTools as string[]).includes(t.name))) {
          priceNudged = true;
          forceTool = true;
          messages.push({ role: "assistant", content: text });
          messages.push({ role: "user", content: `(instrução interna) Você informou valores sem consultar a ferramenta nesta resposta; valores ditos antes na conversa podem estar errados para este grupo ou acomodação. Chame agora ${actionTools.join(" ou ")} com as datas, o número de adultos, as idades das crianças e a acomodação pedida, e responda só com o resultado.` });
          continue;
        }
        if (text && !claimNudged && claimsUnconfirmed(text) && round < MAX_TOOL_ROUNDS - 1) {
          claimNudged = true;
          messages.push({ role: "assistant", content: text });
          messages.push({ role: "user", content: "(instrução interna) A disponibilidade NÃO foi confirmada pelo sistema de reservas. Reescreva a mesma resposta sem dizer que há vaga ou que está disponível; mantenha os valores e o link exatamente iguais." });
          continue;
        }
        if (text && deps.photos && outcome.media.length === 0 && promisesPhotos(text)) {
          // 1º: álbuns citados no próprio texto, sem nova chamada à IA.
          await sendMentioned(text);
          if (outcome.media.length) return { ...outcome, reply: finalize(text) };
          // 2º: obriga a IA a escolher o álbum.
          promisedReply = text;
          messages.push({ role: "assistant", content: text });
          messages.push({ role: "user", content: "(instrução interna) Você disse que enviaria fotos, mas não chamou a ferramenta. Chame enviar_fotos agora para o(s) álbum(ns) citado(s)." });
          continue;
        }
        return text ? { ...outcome, reply: finalize(text) } : fallback();
      }

      forceTool = false;
      messages.push({ role: "assistant", content: result.content, tool_calls: result.toolCalls });
      for (const call of result.toolCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          args = {};
        }
        let tooSmall: string | undefined;
        if (call.function.name === "calcular_valor" || call.function.name === "consultar_disponibilidade") ({ args, note: tooSmall } = fitArgs(args));
        let toolResult: unknown;
        if (call.function.name === "transferir_para_atendente") {
          outcome.toolCalls.push({ name: call.function.name, arguments: args, result: "ok" });
          return handoff("internal", `tool:${String(args.motivo ?? "sem motivo").slice(0, 120)}`);
        } else if (call.function.name === "buscar_conhecimento") {
          const hits = await deps.searchKnowledge(String(args.consulta ?? input.pendingText), 5).catch(() => []);
          toolResult = hits.length
            ? hits.map((h) => ({ fonte: h.source_title, trecho: h.content }))
            : "Nada encontrado na base de conhecimento.";
        } else if ((call.function.name === "calcular_valor" || call.function.name === "consultar_disponibilidade") && !kidsKnown(args)) {
          toolResult = {
            pergunte_criancas: true,
            instrucao: "Antes de passar valores, pergunte com simpatia se entre as pessoas há alguma criança e, se houver, a idade de cada uma (a tarifa e a acomodação dependem disso). Não informe valores nem envie link nesta resposta.",
          };
        } else if (call.function.name === "calcular_valor" && deps.priceTable) {
          toolResult = stripPmsIds(sized(args, quoteFrom(args)));
        } else if (call.function.name === "enviar_fotos" && deps.photos) {
          const names = deps.photos.albums.map((a) => a.name);
          const album = matchAlbum(String(args.album ?? ""), names);
          const room = MAX_PHOTOS_PER_REPLY - outcome.media.length;
          if (!album) {
            toolResult = { erro: "álbum não encontrado", albuns_disponiveis: names };
          } else if (sentAlbums.has(album)) {
            toolResult = { erro: "fotos deste álbum já foram enviadas nesta resposta; não repita", album };
          } else if (room <= 0) {
            toolResult = { erro: "limite de fotos desta resposta atingido" };
          } else {
            const sent = await sendAlbum(album, Math.max(1, Math.trunc(Number(args.quantidade ?? 4)) || 4));
            toolResult = sent ? { enviadas: sent, album } : { erro: "álbum sem fotos", album };
          }
        } else if (call.function.name === "consultar_disponibilidade" && deps.checkAvailability) {
          // Com tabela de preços: fechamento primeiro, vaga pelo PMS (categorias vinculadas) e preço pela tabela.
          const table = deps.priceTable ? quoteFrom(args) as { fechado?: boolean; sem_tarifa?: boolean; erro?: string; noites?: number; estadia_minima?: number; atende_estadia_minima?: boolean; opcoes?: Array<{ pms_category_ids?: number[] }> } : null;
          const categoryIds = [...new Set((table?.opcoes ?? []).flatMap((o) => o.pms_category_ids ?? []))];
          // Abaixo do mínimo: lê a vaga em volta para saber se é uma janela entre reservas.
          const aroundNights = table?.atende_estadia_minima === false && categoryIds.length ? Math.max(0, (table.estadia_minima ?? 0) - (table.noites ?? 0)) : 0;
          try {
            // Nenhuma acomodação da tabela comporta o grupo: responde pela tabela (nao_comportam), sem o PMS cru.
            if (table?.fechado || table?.sem_tarifa || table?.erro || (table && !table.opcoes?.length)) {
              toolResult = stripPmsIds(table);
            } else {
              const found = await deps.checkAvailability({
                checkin: String(args.checkin ?? ""),
                checkout: String(args.checkout ?? ""),
                adults: args.adultos === undefined ? undefined : Number(args.adultos),
                childrenAges: Array.isArray(args.idades_criancas) ? args.idades_criancas.map(Number) : [],
                ...(categoryIds.length ? { categoryIds } : {}),
                ...(aroundNights ? { aroundNights } : {}),
              });
              toolResult = table && categoryIds.length ? sized(args, mergeAvailability(table as never, found.rooms, { open: deps.priceTable?.isOpen })) : found;
            }
          } catch (err) {
            const link = (err as { details?: { booking_link?: unknown } })?.details?.booking_link;
            toolResult = {
              erro: err instanceof Error ? err.message : String(err),
              ...(typeof link === "string" ? { link_reserva: link } : {}),
              ...(deps.priceTable
                ? {
                  valores_tabela: stripPmsIds(sized(args, table ?? quoteFrom(args))),
                  instrucao: "Consulta indisponível: informe os valores_tabela (já calculados pela tabela oficial) exatamente como estão; quando o hóspede quiser reservar, o link_reserva confirma a vaga. A disponibilidade NÃO foi confirmada: não diga que há vaga.",
                }
                : { instrucao: "Consulta indisponível: informe o valor pela tabela de preços da base de conhecimento, se houver; quando o hóspede quiser reservar, envie o link_reserva para confirmar." }),
            };
          }
        } else {
          toolResult = { erro: "ferramenta desconhecida" };
        }
        if (tooSmall && toolResult && typeof toolResult === "object") toolResult = { acomodacao_pedida_nao_comporta: tooSmall, ...toolResult };
        outcome.toolCalls.push({ name: call.function.name, arguments: args, result: toolResult });
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(forAi(toolResult)).slice(0, 6000) });
      }
      if (promisedReply) {
        if (outcome.media.length) await sendMentioned(promisedReply);
        return { ...outcome, reply: outcome.media.length ? promisedReply : stripPhotoPromise(promisedReply) || null };
      }
    }
    return fallback();
  } catch (err) {
    outcome.aiError = err instanceof Error ? err.message : String(err);
    deps.log?.("ai_failed", { error: outcome.aiError });
    return fallback();
  }
}
