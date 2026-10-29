// Envio manual pela inbox (sender = agent). Mesma trilha outbound do bot.
// Aceita texto, anexo enviado pelo painel (bucket inbox-media), fotos da galeria (media_assets), encaminhamento de
// uma mensagem existente e conversa nova para um número que ainda não escreveu.
import { createHandler, json, readJson, RuntimeError } from "../_shared/http.ts";
import { sendOutbound, type OutboundType } from "../_shared/channel.ts";
import { adminDb, type Db, env, optionalEnv, requireUser, requireWorkspaceRole } from "../_shared/supabase.ts";
import { normalizePhone } from "../_shared/evolution.ts";
import { assertOutboundPath, type GalleryAsset, INBOX_MEDIA_BUCKET, outboundTypeFor, planForward, planPhotos, publicSignedUrl, SIGNED_URL_SECONDS, type SourceMessage } from "../_shared/forward.ts";

interface Body {
  conversation_id?: string;
  workspace_id?: string;
  to_phone?: string;
  contact_name?: string;
  instance_id?: string;
  type?: string;
  text?: string;
  media_path?: string;
  file_name?: string;
  mimetype?: string;
  forward_message_id?: string;
  /** Fotos da galeria do workspace (Informações da empresa → Fotos), até 5 por envio. */
  media_asset_ids?: string[];
}

/** Um envio ao WhatsApp; fotos da galeria geram vários a partir de um único pedido. */
interface Send {
  type: OutboundType;
  text: string | null;
  mediaUrl: string | null;
  mimetype: string | null;
  fileName: string | null;
  metadata: Record<string, unknown>;
}

type ConversationRow = { id: string; workspace_id: string; instance_id: string | null; channel: string; contact_phone: string; mode: string };
const CONVERSATION_COLUMNS = "id, workspace_id, instance_id, channel, contact_phone, mode";
const MEMBER_ROLES = ["owner", "admin", "agent"] as const;

async function signedUrlFor(db: Db, path: string): Promise<string> {
  const { data, error } = await db.storage.from(INBOX_MEDIA_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) throw new RuntimeError("not_found", "Arquivo não encontrado.", { reason: error?.message });
  return publicSignedUrl(data.signedUrl, env("SUPABASE_URL"), optionalEnv("SUPABASE_PUBLIC_URL"));
}

function cleanText(raw: unknown): string | null {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text.length > 4096) throw new RuntimeError("invalid_request", "Mensagem acima de 4096 caracteres.");
  return text || null;
}

Deno.serve(createHandler("send-message", async ({ req, correlationId }) => {
  if (req.method !== "POST") throw new RuntimeError("invalid_request", "Use POST.");
  const user = await requireUser(req);
  const body = await readJson<Body>(req);
  const db = adminDb();

  // 1. Destino: conversa existente, ou número (que pode já ter conversa).
  let conversation: ConversationRow | null = null;
  let workspaceId: string;
  let toPhone: string | null = null;
  if (typeof body.conversation_id === "string") {
    const { data } = await db.from("conversations").select(CONVERSATION_COLUMNS).eq("id", body.conversation_id).maybeSingle();
    if (!data) throw new RuntimeError("not_found", "Conversa não encontrada.");
    conversation = data as ConversationRow;
    workspaceId = conversation.workspace_id;
    await requireWorkspaceRole(user.id, workspaceId, [...MEMBER_ROLES]);
  } else {
    await requireWorkspaceRole(user.id, body.workspace_id, [...MEMBER_ROLES]);
    workspaceId = body.workspace_id as string;
    toPhone = normalizePhone(body.to_phone);
    if (!toPhone) throw new RuntimeError("invalid_request", "Informe um número de WhatsApp válido, com DDD.");
    const { data } = await db.from("conversations").select(CONVERSATION_COLUMNS)
      .eq("workspace_id", workspaceId).eq("channel", "whatsapp").eq("contact_phone", toPhone)
      .order("last_message_at", { ascending: false }).limit(1).maybeSingle();
    if (data) conversation = data as ConversationRow;
  }
  if (conversation && conversation.channel !== "whatsapp") {
    throw new RuntimeError("channel_not_supported", "Conversa via integração: a resposta manual fica bloqueada até existir adaptador do canal.");
  }

  // 2. Conteúdo: encaminhamento, anexo, fotos da galeria ou texto.
  const text = cleanText(body.text);
  const sends: Send[] = [];
  if (typeof body.forward_message_id === "string") {
    const { data: source } = await db.from("messages").select("id, workspace_id, type, content, media_url, media_mime, metadata")
      .eq("id", body.forward_message_id).eq("workspace_id", workspaceId).maybeSingle();
    if (!source) throw new RuntimeError("not_found", "Mensagem de origem não encontrada.");
    const plan = planForward(source as SourceMessage);
    const metadata: Record<string, unknown> = { forwarded_from: source.id };
    let mediaUrl = plan.mediaUrl;
    if (plan.mediaPath) {
      mediaUrl = await signedUrlFor(db, plan.mediaPath);
      metadata.media_path = plan.mediaPath;
    }
    sends.push({ type: plan.type, text: text ?? plan.text, mediaUrl, mimetype: plan.mimetype, fileName: plan.fileName, metadata });
  } else if (typeof body.media_path === "string") {
    const path = assertOutboundPath(body.media_path, workspaceId);
    const mimetype = typeof body.mimetype === "string" && body.mimetype ? body.mimetype.slice(0, 100) : null;
    const fileName = typeof body.file_name === "string" && body.file_name ? body.file_name.slice(0, 200) : path.split("/").pop() ?? null;
    sends.push({ type: outboundTypeFor(mimetype, body.type), text, mediaUrl: await signedUrlFor(db, path), mimetype, fileName, metadata: { media_path: path } });
  } else if (body.media_asset_ids !== undefined) {
    const ids = Array.isArray(body.media_asset_ids) ? body.media_asset_ids : [];
    const { data: assets } = await db.from("media_assets").select("id, album, public_url, caption, mime_type")
      .eq("workspace_id", workspaceId).in("id", ids.filter((id) => typeof id === "string").slice(0, 50));
    for (const p of planPhotos(body.media_asset_ids, (assets ?? []) as GalleryAsset[], text)) sends.push({ ...p, fileName: null });
  } else {
    if ((body.type ?? "text") !== "text") throw new RuntimeError("invalid_request", "Para enviar um arquivo, anexe-o pelo painel.");
    if (!text) throw new RuntimeError("invalid_request", "Mensagem vazia.");
    sends.push({ type: "text", text, mediaUrl: null, mimetype: null, fileName: null, metadata: {} });
  }
  const first = sends[0];
  // O WhatsApp não aceita legenda em áudio: o texto vai como segunda mensagem.
  const audioCaption = first.type === "audio" ? first.text : null;
  if (audioCaption) {
    first.text = null;
    first.metadata.caption_sent_separately = true;
  }

  // 3. Quem responde pela inbox assume a conversa, para o bot não responder por cima.
  if (conversation && conversation.mode !== "human") {
    await db.from("conversations").update({ mode: "human", assigned_user_id: user.id, handoff_at: new Date().toISOString() }).eq("id", conversation.id);
  }

  const result = await sendOutbound(db, {
    workspaceId,
    origin: "agent",
    sender: "agent",
    type: first.type,
    text: first.text,
    mediaUrl: first.mediaUrl,
    mimetype: first.mimetype,
    fileName: first.fileName,
    conversation,
    toPhone: conversation ? undefined : toPhone!,
    contactName: typeof body.contact_name === "string" && body.contact_name.trim() ? body.contact_name.trim().slice(0, 120) : null,
    instanceId: conversation ? null : (typeof body.instance_id === "string" ? body.instance_id : null),
    agentUserId: user.id,
    metadata: first.metadata,
    correlationId,
  });

  // Conversa criada agora: fica com quem a iniciou, para a resposta do cliente não cair no bot.
  if (!conversation) {
    await db.from("conversations").update({ mode: "human", assigned_user_id: user.id, handoff_at: new Date().toISOString() }).eq("id", result.conversationId);
  }
  const target = conversation ?? { id: result.conversationId, instance_id: null, contact_phone: toPhone!, channel: "whatsapp" };
  const base = { workspaceId, origin: "agent" as const, sender: "agent" as const, conversation: target, agentUserId: user.id, correlationId };
  const messageIds = [result.messageId];
  let failed = result.status === "failed" ? 1 : 0;
  if (audioCaption && result.status === "sent") {
    await sendOutbound(db, { ...base, type: "text", text: audioCaption });
  }
  // Demais fotos da galeria, na ordem escolhida.
  if (result.status !== "failed") {
    for (const s of sends.slice(1)) {
      const r = await sendOutbound(db, { ...base, type: s.type, text: s.text, mediaUrl: s.mediaUrl, mimetype: s.mimetype, fileName: s.fileName, metadata: s.metadata });
      messageIds.push(r.messageId);
      if (r.status === "failed") failed++;
    }
  }

  const [{ data: messages }, { data: outbound }] = await Promise.all([
    db.from("messages").select("*").in("id", messageIds).order("created_at"),
    db.from("outbound_messages").select("id, status, error, provider_message_id, created_at, sent_at").eq("id", result.outboundId).single(),
  ]);
  if (result.status === "failed") {
    throw new RuntimeError("upstream_unavailable", "Não foi possível enviar pelo WhatsApp.", { message_id: result.messageId, reason: result.error?.slice(0, 300) });
  }
  if (failed) {
    throw new RuntimeError("upstream_unavailable", `${failed} de ${sends.length} fotos não foram enviadas pelo WhatsApp.`, { message_ids: messageIds, failed });
  }
  const message = (messages ?? []).find((m: { id: string }) => m.id === result.messageId) ?? messages?.[0] ?? null;
  return json({ message, messages: messages ?? [], outbound, conversation_id: result.conversationId, created: !conversation });
}));