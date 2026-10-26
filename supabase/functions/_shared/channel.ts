// Canal WhatsApp: resolução de instância e trilha única de envio (bot, atendente e API pública).
import { EvolutionClient, type SendResult } from "./evolution.ts";
import { RuntimeError } from "./http.ts";
import { type Db, env, optionalEnv } from "./supabase.ts";
import { emitEvent } from "./webhooks.ts";
import { assertActive, assertMonthlyQuota, loadEntitlements } from "./entitlements.ts";

export interface InstanceRow {
  id: string;
  workspace_id: string;
  name: string;
  instance_name: string;
  provider_secret_ref: string;
  status: string;
  is_default: boolean;
}

const INSTANCE_COLUMNS = "id, workspace_id, name, instance_name, provider_secret_ref, status, is_default";

export function evolutionFor(instance: Pick<InstanceRow, "provider_secret_ref">): EvolutionClient {
  if (!/^EVOLUTION_[A-Z0-9_]+$/.test(instance.provider_secret_ref)) {
    throw new RuntimeError("internal_error", "provider_secret_ref inválido.");
  }
  return new EvolutionClient({ baseUrl: env("EVOLUTION_BASE_URL"), apiKey: env(instance.provider_secret_ref) });
}

/** Seleção de instância: `explicit` (id informado, do mesmo workspace) ou `default`. */
export async function resolveInstance(db: Db, workspaceId: string, instanceId?: string | null): Promise<InstanceRow> {
  let query = db.from("whatsapp_instances").select(INSTANCE_COLUMNS).eq("workspace_id", workspaceId);
  query = instanceId ? query.eq("id", instanceId) : query.eq("is_default", true);
  const { data, error } = await query.maybeSingle();
  if (error) throw new RuntimeError("internal_error", "Falha ao carregar instância.");
  if (!data) {
    throw instanceId
      ? new RuntimeError("not_found", "Instância não encontrada neste workspace.")
      : new RuntimeError("unprocessable", "Workspace sem instância padrão de WhatsApp.");
  }
  return data as InstanceRow;
}

export type OutboundType = "text" | "image" | "video" | "document" | "audio";

export interface OutboundRequest {
  workspaceId: string;
  origin: "bot" | "agent" | "public_api" | "system";
  sender: "bot" | "agent" | "system";
  type: OutboundType;
  text?: string | null;
  mediaUrl?: string | null;
  /** Áudio gerado (TTS) em base64, sem prefixo data:. */
  audioBase64?: string | null;
  mimetype?: string | null;
  fileName?: string | null;
  /** Conversa existente (bot/inbox). Sem ela, a conversa é criada/achada pelo telefone (API pública). */
  conversation?: { id: string; instance_id: string | null; contact_phone: string; channel: string } | null;
  toPhone?: string;
  contactName?: string | null;
  instanceId?: string | null;
  agentUserId?: string | null;
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown>;
  correlationId: string;
}

export interface OutboundResult {
  duplicate: boolean;
  status: "sent" | "failed";
  conversationId: string;
  messageId: string;
  outboundId: string;
  providerMessageId: string | null;
  error?: string;
}

function previewOf(req: OutboundRequest): string {
  return (req.text?.trim() || `[${req.type}]`).slice(0, 160);
}

export async function sendOutbound(db: Db, req: OutboundRequest): Promise<OutboundResult> {
  if (req.conversation && req.conversation.channel !== "whatsapp") {
    throw new RuntimeError("channel_not_supported", "Esta conversa veio de integração externa; o envio por este canal ainda não é suportado.");
  }
  if (req.type === "text" && !req.text?.trim()) throw new RuntimeError("invalid_request", "Texto vazio.");
  if (req.type !== "text" && !req.mediaUrl && !req.audioBase64) throw new RuntimeError("invalid_request", "mediaUrl obrigatório para mídia.");

  if (req.idempotencyKey) {
    const { data: existing } = await db
      .from("outbound_messages")
      .select("id, conversation_id, message_id, status, provider_message_id, error")
      .eq("workspace_id", req.workspaceId)
      .eq("idempotency_key", req.idempotencyKey)
      .maybeSingle();
    if (existing) {
      return {
        duplicate: true,
        status: existing.status === "sent" ? "sent" : "failed",
        conversationId: existing.conversation_id,
        messageId: existing.message_id,
        outboundId: existing.id,
        providerMessageId: existing.provider_message_id,
        error: existing.error ?? undefined,
      };
    }
  }

  // Tenant inativo não envia nada; envios automáticos (bot e API) consomem a cota mensal do plano.
  const entitlements = await loadEntitlements(db, req.workspaceId);
  assertActive(entitlements);
  if (req.origin === "bot" || req.origin === "public_api") assertMonthlyQuota(entitlements);

  const instance = await resolveInstance(db, req.workspaceId, req.instanceId ?? req.conversation?.instance_id ?? null);
  if (instance.status !== "open") {
    throw new RuntimeError("unprocessable", `Instância "${instance.name}" não está conectada (status: ${instance.status}).`);
  }
  const toPhone = req.conversation?.contact_phone ?? req.toPhone;
  if (!toPhone) throw new RuntimeError("invalid_request", "Telefone de destino ausente.");

  const metadata = { ...(req.metadata ?? {}), ...(req.fileName ? { file_name: req.fileName } : {}) };
  let conversationId: string;
  let messageId: string;
  if (req.conversation) {
    conversationId = req.conversation.id;
    const { data: msg, error } = await db.from("messages").insert({
      workspace_id: req.workspaceId,
      conversation_id: conversationId,
      direction: "outbound",
      sender: req.sender,
      type: req.type,
      content: req.text ?? null,
      media_url: req.mediaUrl ?? null,
      media_mime: req.mimetype ?? null,
      status: "pending",
      agent_user_id: req.agentUserId ?? null,
      metadata,
    }).select("id").single();
    if (error) throw new RuntimeError("internal_error", "Falha ao gravar mensagem.", { db: error.message });
    messageId = msg.id;
    await db.from("conversations").update({
      last_message_at: new Date().toISOString(),
      last_message_preview: previewOf(req),
    }).eq("id", conversationId);
  } else {
    const { data, error } = await db.rpc("record_message", {
      p_workspace_id: req.workspaceId,
      p_instance_id: instance.id,
      p_channel: "whatsapp",
      p_contact_phone: toPhone,
      p_contact_name: req.contactName ?? null,
      p_direction: "outbound",
      p_sender: req.sender,
      p_type: req.type,
      p_content: req.text ?? null,
      p_media_url: req.mediaUrl ?? null,
      p_media_mime: req.mimetype ?? null,
      p_metadata: metadata,
      p_status: "pending",
    });
    if (error || !data?.[0]) throw new RuntimeError("internal_error", "Falha ao gravar mensagem.", { db: error?.message });
    conversationId = data[0].conversation_id;
    messageId = data[0].message_id;
  }

  const { data: outbound, error: outboundError } = await db.from("outbound_messages").insert({
    workspace_id: req.workspaceId,
    conversation_id: conversationId,
    message_id: messageId,
    instance_id: instance.id,
    origin: req.origin,
    to_phone: toPhone,
    type: req.type,
    payload: { text: req.text ?? null, media_url: req.mediaUrl ?? null, file_name: req.fileName ?? null, has_audio_base64: Boolean(req.audioBase64) },
    status: "queued",
    attempts: 1,
    idempotency_key: req.idempotencyKey ?? null,
    correlation_id: req.correlationId,
  }).select("id").single();
  if (outboundError) throw new RuntimeError("internal_error", "Falha ao registrar envio.", { db: outboundError.message });

  let result: SendResult | null = null;
  let failure: string | null = null;
  try {
    const client = evolutionFor(instance);
    if (req.type === "text") result = await client.sendText(instance.instance_name, toPhone, req.text!.trim());
    else if (req.type === "audio") result = await client.sendAudio(instance.instance_name, toPhone, req.audioBase64 ?? req.mediaUrl!);
    else {
      result = await client.sendMedia(instance.instance_name, toPhone, {
        type: req.type,
        url: req.mediaUrl!,
        caption: req.text ?? undefined,
        mimetype: req.mimetype ?? undefined,
        fileName: req.fileName ?? undefined,
      });
    }
  } catch (err) {
    failure = err instanceof RuntimeError ? `${err.message} ${JSON.stringify(err.details)}` : String(err);
  }

  const now = new Date().toISOString();
  if (failure || !result) {
    await db.from("messages").update({ status: "failed", metadata: { ...metadata, error: failure?.slice(0, 500) } }).eq("id", messageId);
    await db.from("outbound_messages").update({ status: "failed", error: failure?.slice(0, 1000) }).eq("id", outbound.id);
    return { duplicate: false, status: "failed", conversationId, messageId, outboundId: outbound.id, providerMessageId: null, error: failure ?? "erro" };
  }

  await linkProviderId(db, req.workspaceId, messageId, result.providerMessageId);
  await db.from("outbound_messages").update({ status: "sent", provider_message_id: result.providerMessageId, sent_at: now }).eq("id", outbound.id);

  await emitEvent(db, {
    workspaceId: req.workspaceId,
    event: "message.sent",
    correlationId: req.correlationId,
    masterKey: optionalEnv("CALLIA_ENCRYPTION_KEY"),
    data: {
      conversation_id: conversationId,
      message_id: messageId,
      origin: req.origin,
      sender: req.sender,
      to: toPhone,
      type: req.type,
      text: req.text ?? null,
      media_url: req.mediaUrl ?? null,
    },
  });

  return { duplicate: false, status: "sent", conversationId, messageId, outboundId: outbound.id, providerMessageId: result.providerMessageId };
}

/**
 * Grava o id do provedor na mensagem. Se o eco "fromMe" do webhook chegou antes e criou
 * uma cópia com o mesmo external_id, a cópia é descartada.
 */
async function linkProviderId(db: Db, workspaceId: string, messageId: string, providerId: string | null) {
  const patch = { status: "sent", external_id: providerId };
  const { error } = await db.from("messages").update(patch).eq("id", messageId);
  if (error?.code === "23505" && providerId) {
    await db.from("messages").delete().eq("workspace_id", workspaceId).eq("external_id", providerId).eq("metadata->>echo", "true");
    await db.from("messages").update(patch).eq("id", messageId);
  }
}
