// Envio manual pela inbox (sender = agent). Mesma trilha outbound do bot.
// Aceita texto, anexo enviado pelo painel (bucket inbox-media), encaminhamento de uma mensagem existente e
// conversa nova para um número que ainda não escreveu.
import { createHandler, json, readJson, RuntimeError } from "../_shared/http.ts";
import { sendOutbound, type OutboundType } from "../_shared/channel.ts";
import { adminDb, type Db, env, optionalEnv, requireUser, requireWorkspaceRole } from "../_shared/supabase.ts";
import { normalizePhone } from "../_shared/evolution.ts";
import { assertOutboundPath, INBOX_MEDIA_BUCKET, outboundTypeFor, planForward, publicSignedUrl, SIGNED_URL_SECONDS, type SourceMessage } from "../_shared/forward.ts";

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

  // 2. Conteúdo: encaminhamento, anexo ou texto.
  let type: OutboundType = "text";
  let text = cleanText(body.text);
  let mediaUrl: string | null = null;
  let mimetype: string | null = null;
  let fileName: string | null = null;
  const metadata: Record<string, unknown> = {};
  if (typeof body.forward_message_id === "string") {
    const { data: source } = await db.from("messages").select("id, workspace_id, type, content, media_url, media_mime, metadata")
      .eq("id", body.forward_message_id).eq("workspace_id", workspaceId).maybeSingle();
    if (!source) throw new RuntimeError("not_found", "Mensagem de origem não encontrada.");
    const plan = planForward(source as SourceMessage);
    type = plan.type;
    text = text ?? plan.text;
    mimetype = plan.mimetype;
    fileName = plan.fileName;
    metadata.forwarded_from = source.id;
    if (plan.mediaPath) {
      mediaUrl = await signedUrlFor(db, plan.mediaPath);
      metadata.media_path = plan.mediaPath;
    } else {
      mediaUrl = plan.mediaUrl;
    }
  } else if (typeof body.media_path === "string") {
    const path = assertOutboundPath(body.media_path, workspaceId);
    mimetype = typeof body.mimetype === "string" && body.mimetype ? body.mimetype.slice(0, 100) : null;
    type = outboundTypeFor(mimetype, body.type);
    fileName = typeof body.file_name === "string" && body.file_name ? body.file_name.slice(0, 200) : path.split("/").pop() ?? null;
    mediaUrl = await signedUrlFor(db, path);
    metadata.media_path = path;
  } else {
    if ((body.type ?? "text") !== "text") throw new RuntimeError("invalid_request", "Para enviar um arquivo, anexe-o pelo painel.");
    if (!text) throw new RuntimeError("invalid_request", "Mensagem vazia.");
  }
  if (type === "audio" && text) {
    // O WhatsApp não aceita legenda em áudio: o texto vai como segunda mensagem.
    metadata.caption_sent_separately = true;
  }

  // 3. Quem responde pela inbox assume a conversa, para o bot não responder por cima.
  if (conversation && conversation.mode !== "human") {
    await db.from("conversations").update({ mode: "human", assigned_user_id: user.id, handoff_at: new Date().toISOString() }).eq("id", conversation.id);
  }

  const result = await sendOutbound(db, {
    workspaceId,
    origin: "agent",
    sender: "agent",
    type,
    text: type === "audio" ? null : text,
    mediaUrl,
    mimetype,
    fileName,
    conversation,
    toPhone: conversation ? undefined : toPhone!,
    contactName: typeof body.contact_name === "string" && body.contact_name.trim() ? body.contact_name.trim().slice(0, 120) : null,
    instanceId: conversation ? null : (typeof body.instance_id === "string" ? body.instance_id : null),
    agentUserId: user.id,
    metadata,
    correlationId,
  });

  // Conversa criada agora: fica com quem a iniciou, para a resposta do cliente não cair no bot.
  if (!conversation) {
    await db.from("conversations").update({ mode: "human", assigned_user_id: user.id, handoff_at: new Date().toISOString() }).eq("id", result.conversationId);
  }
  if (type === "audio" && text && result.status === "sent") {
    await sendOutbound(db, { workspaceId, origin: "agent", sender: "agent", type: "text", text, conversation: conversation ?? { id: result.conversationId, instance_id: null, contact_phone: toPhone!, channel: "whatsapp" }, agentUserId: user.id, correlationId });
  }

  const [{ data: message }, { data: outbound }] = await Promise.all([
    db.from("messages").select("*").eq("id", result.messageId).single(),
    db.from("outbound_messages").select("id, status, error, provider_message_id, created_at, sent_at").eq("id", result.outboundId).single(),
  ]);
  if (result.status === "failed") {
    throw new RuntimeError("upstream_unavailable", "Não foi possível enviar pelo WhatsApp.", { message_id: result.messageId, reason: result.error?.slice(0, 300) });
  }
  return json({ message, outbound, conversation_id: result.conversationId, created: !conversation });
}));
