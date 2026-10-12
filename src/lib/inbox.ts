export type ConversationMode = "bot" | "human";
export type MessageType =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "document"
  | "system";

export type ConversationRow = {
  id: string;
  workspace_id: string;
  whatsapp_instance_id: string | null;
  customer_phone: string;
  customer_name: string | null;
  mode: ConversationMode;
  assigned_agent_id: string | null;
  last_message_at: string;
  unread_count: number;
  is_closed: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type MessageRow = {
  id: string;
  workspace_id: string;
  conversation_id: string;
  direction: "inbound" | "outbound";
  sender: "customer" | "bot" | "agent" | "system";
  type: MessageType;
  content: string | null;
  media_url: string | null;
  transcription: string | null;
  ai_model: string | null;
  tokens_used: number | null;
  agent_user_id: string | null;
  external_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type InboxInstance = {
  id: string;
  instance_name: string;
  display_name: string | null;
  phone_number: string | null;
  status: string | null;
  is_default: boolean | null;
};

export type InboxConversation = ConversationRow & {
  whatsapp_instance: InboxInstance | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function getConversationTitle(conversation: InboxConversation) {
  return (
    conversation.customer_name?.trim() ||
    formatPhoneLabel(conversation.customer_phone) ||
    "Contato sem nome"
  );
}

export function getConversationSecondaryLabel(conversation: InboxConversation) {
  const instanceName =
    conversation.whatsapp_instance?.display_name ||
    conversation.whatsapp_instance?.instance_name ||
    "Sem instancia";

  return `${formatPhoneLabel(conversation.customer_phone)} • ${instanceName}`;
}

export function formatPhoneLabel(phone: string | null | undefined) {
  if (!phone) return "Sem telefone";
  return phone.startsWith("+") ? phone : `+${phone}`;
}

export function getConversationPreview(message: MessageRow | null | undefined) {
  if (!message) return "Nenhuma mensagem ainda";

  const content = getMessageContent(message);
  if (content) return content;

  const labelByType: Record<MessageType, string> = {
    text: "Mensagem sem texto",
    image: "Imagem recebida",
    audio: "Audio recebido",
    video: "Video recebido",
    document: "Documento recebido",
    system: "Evento do sistema",
  };

  return labelByType[message.type];
}

export function getConversationPreviewFromConversation(conversation: InboxConversation) {
  const metadata = asRecord(conversation.metadata);
  const type = metadata?.last_message_type;
  const direction = metadata?.last_message_direction;

  if (typeof type !== "string") {
    return "Sem preview disponivel";
  }

  const labels: Record<string, string> = {
    text: "Ultima mensagem de texto",
    image: "Ultima mensagem com imagem",
    audio: "Ultima mensagem com audio",
    video: "Ultima mensagem com video",
    document: "Ultima mensagem com documento",
    system: "Ultimo evento do sistema",
  };

  const base = labels[type] ?? "Ultima mensagem registrada";
  if (direction === "outbound") return `${base} enviada`;
  if (direction === "inbound") return `${base} recebida`;
  return base;
}

export function getMessageContent(message: MessageRow) {
  const text = message.content?.trim() || message.transcription?.trim();
  if (text) return text;

  const metadata = asRecord(message.metadata);
  const mediaSummary = metadata?.media_summary;
  return typeof mediaSummary === "string" && mediaSummary.trim()
    ? mediaSummary.trim()
    : "";
}

export function getMessageActorLabel(message: MessageRow) {
  if (message.direction === "inbound") return "Cliente";
  if (message.sender === "agent") return "Atendente";
  if (message.sender === "system") return "Sistema";
  return "Bot";
}

export function getMessageTypeLabel(message: MessageRow) {
  const labels: Record<MessageType, string> = {
    text: "Texto",
    image: "Imagem",
    audio: "Audio",
    video: "Video",
    document: "Documento",
    system: "Sistema",
  };

  return labels[message.type];
}

export function getModeBadgeLabel(mode: ConversationMode) {
  return mode === "human" ? "Humano" : "Bot";
}

export function getModeBadgeTone(mode: ConversationMode) {
  return mode === "human"
    ? "border-violet-300 bg-violet-100 text-violet-800"
    : "border-emerald-300 bg-emerald-100 text-emerald-800";
}

export function isExternalSource(item: { metadata?: unknown } | null | undefined) {
  const metadata = asRecord(item?.metadata);
  return metadata?.source === "external";
}
