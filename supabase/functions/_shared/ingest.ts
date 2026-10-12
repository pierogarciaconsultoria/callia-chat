// @ts-nocheck
// Record-only ingestion of messages from external channels (e.g. Meta Cloud API via n8n).
// This module MUST NOT send anything to WhatsApp nor trigger the AI pipeline.

const DIRECTIONS = ["inbound", "outbound"];
const SENDERS = { customer: "customer", ai: "bot", human: "agent" };
const TYPES = ["text", "image", "audio", "document"];
const CHANNELS = ["whatsapp_cloud"];

export class IngestValidationError extends Error {
  constructor(public field: string) {
    super("invalid_ingest_payload");
  }
}

function str(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseIngestPayload(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new IngestValidationError("body");
  const externalId = str(raw.externalId);
  if (!externalId || externalId.length > 255) throw new IngestValidationError("externalId");
  const channel = str(raw.channel) ?? "whatsapp_cloud";
  if (!CHANNELS.includes(channel)) throw new IngestValidationError("channel");
  if (!DIRECTIONS.includes(raw.direction)) throw new IngestValidationError("direction");
  if (!Object.keys(SENDERS).includes(raw.sender)) throw new IngestValidationError("sender");
  if (raw.direction === "inbound" && raw.sender !== "customer") throw new IngestValidationError("sender");
  if (raw.direction === "outbound" && raw.sender === "customer") throw new IngestValidationError("sender");
  const phone = str(raw.contact?.phone);
  if (!phone || !/^\+?\d{8,20}$/.test(phone.replace(/[\s()-]/g, ""))) throw new IngestValidationError("contact.phone");
  const type = raw.type ?? "text";
  if (!TYPES.includes(type)) throw new IngestValidationError("type");
  const content = typeof raw.content === "string" ? raw.content.slice(0, 10000) : null;
  const mediaUrl = str(raw.mediaUrl);
  if (!content && !mediaUrl) throw new IngestValidationError("content");
  let timestamp = new Date().toISOString();
  if (raw.timestamp !== undefined && raw.timestamp !== null) {
    const d = new Date(raw.timestamp);
    if (Number.isNaN(d.getTime())) throw new IngestValidationError("timestamp");
    timestamp = d.toISOString();
  }
  return {
    externalId,
    channel,
    direction: raw.direction,
    sender: SENDERS[raw.sender],
    contact: { phone: phone.replace(/[\s()-]/g, ""), name: str(raw.contact?.name) },
    type,
    content,
    mediaUrl,
    timestamp,
    conversationExternalId: str(raw.conversationExternalId),
  };
}

/**
 * store: {
 *   findMessageByExternalId(workspaceId, externalId)
 *   findConversationByPhone(workspaceId, phone)
 *   insertConversation(row)
 *   updateConversation(id, patch)
 *   insertMessage(row)  // throws { code: "23505" } on duplicate
 * }
 */
export async function ingestExternalMessage(store, input) {
  const { workspaceId, apiKeyId, payload } = input;

  const existingMessage = await store.findMessageByExternalId(workspaceId, payload.externalId);
  if (existingMessage) {
    return { duplicate: true, conversationId: existingMessage.conversation_id, messageId: existingMessage.id };
  }

  let conversation = await store.findConversationByPhone(workspaceId, payload.contact.phone);
  if (!conversation) {
    conversation = await store.insertConversation({
      workspace_id: workspaceId,
      whatsapp_instance_id: null,
      customer_phone: payload.contact.phone,
      customer_name: payload.contact.name,
      last_message_at: payload.timestamp,
      unread_count: 0,
      metadata: {
        source: "external",
        channel: payload.channel,
        conversation_external_id: payload.conversationExternalId,
        created_by: "public-api-ingest",
      },
    });
  }

  let message;
  try {
    message = await store.insertMessage({
      workspace_id: workspaceId,
      conversation_id: conversation.id,
      direction: payload.direction,
      sender: payload.sender,
      type: payload.type,
      content: payload.content,
      media_url: payload.mediaUrl,
      external_id: payload.externalId,
      created_at: payload.timestamp,
      metadata: {
        source: "external",
        channel: payload.channel,
        ingested_via: "public-api",
        api_key_id: apiKeyId ?? null,
        conversation_external_id: payload.conversationExternalId,
      },
    });
  } catch (error) {
    if (error?.code === "23505") {
      const dup = await store.findMessageByExternalId(workspaceId, payload.externalId);
      return { duplicate: true, conversationId: dup?.conversation_id ?? conversation.id, messageId: dup?.id ?? null };
    }
    throw error;
  }

  const prevLast = conversation.last_message_at ? new Date(conversation.last_message_at).getTime() : 0;
  const isCustomerInbound = payload.direction === "inbound" && payload.sender === "customer";
  const prevMeta = conversation.metadata && typeof conversation.metadata === "object" ? conversation.metadata : {};
  await store.updateConversation(conversation.id, {
    last_message_at: new Date(Math.max(prevLast, new Date(payload.timestamp).getTime())).toISOString(),
    unread_count: (conversation.unread_count ?? 0) + (isCustomerInbound ? 1 : 0),
    customer_name: conversation.customer_name ?? payload.contact.name,
    is_closed: false,
    metadata: {
      ...prevMeta,
      external_channel: payload.channel,
      last_message_type: payload.type,
      last_message_direction: payload.direction,
      last_external_ingest_at: new Date().toISOString(),
    },
  });

  return { duplicate: false, conversationId: conversation.id, messageId: message.id };
}

export function createSupabaseIngestStore(supabase) {
  return {
    async findMessageByExternalId(workspaceId, externalId) {
      const { data } = await supabase
        .from("messages")
        .select("id, conversation_id")
        .eq("workspace_id", workspaceId)
        .eq("external_id", externalId)
        .maybeSingle();
      return data;
    },
    async findConversationByPhone(workspaceId, phone) {
      const { data } = await supabase
        .from("conversations")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("customer_phone", phone)
        .maybeSingle();
      return data;
    },
    async insertConversation(row) {
      const { data, error } = await supabase.from("conversations").insert(row).select("*").single();
      if (error?.code === "23505") {
        const { data: existing } = await supabase
          .from("conversations").select("*")
          .eq("workspace_id", row.workspace_id).eq("customer_phone", row.customer_phone).single();
        return existing;
      }
      if (error) throw error;
      return data;
    },
    async updateConversation(id, patch) {
      const { error } = await supabase.from("conversations").update(patch).eq("id", id);
      if (error) throw error;
    },
    async insertMessage(row) {
      const { data, error } = await supabase.from("messages").insert(row).select("id, conversation_id").single();
      if (error) throw error;
      return data;
    },
  };
}
