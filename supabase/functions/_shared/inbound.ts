// @ts-nocheck
export type NormalizedInboundPayload = {
  providerEventId: string;
  customerPhone: string;
  customerName: string | null;
  direction: "inbound" | "outbound";
  sender: "customer" | "bot";
  messageType: "text" | "audio" | "image" | "video" | "document" | "system";
  content: string | null;
  mediaUrl: string | null;
  mimeType: string | null;
  transcription: string | null;
  externalMessageId: string | null;
  metadata: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function getPrimaryData(payload: Record<string, unknown>) {
  if (Array.isArray(payload.data)) {
    const first = payload.data[0];
    return asRecord(first) ?? {};
  }

  return asRecord(payload.data) ?? {};
}

function normalizePhone(value: string | null) {
  if (!value) return null;
  return value.replace(/@.+$/, "").replace(/[^\d+]/g, "");
}

function resolveMessageType(message: Record<string, unknown>) {
  if (asRecord(message.audioMessage)) return "audio";
  if (asRecord(message.imageMessage)) return "image";
  if (asRecord(message.videoMessage)) return "video";
  if (asRecord(message.documentMessage)) return "document";
  if (asString(message.conversation) || asRecord(message.extendedTextMessage)) return "text";
  return "system";
}

function resolveMessageContent(message: Record<string, unknown>) {
  return (
    asString(message.conversation) ??
    asString(asRecord(message.extendedTextMessage)?.text) ??
    asString(asRecord(message.imageMessage)?.caption) ??
    asString(asRecord(message.videoMessage)?.caption) ??
    asString(asRecord(message.documentMessage)?.caption)
  );
}

function resolveMediaUrl(message: Record<string, unknown>, rawData: Record<string, unknown>) {
  return (
    asString(rawData.mediaUrl) ??
    asString(asRecord(message.imageMessage)?.url) ??
    asString(asRecord(message.videoMessage)?.url) ??
    asString(asRecord(message.documentMessage)?.url) ??
    asString(asRecord(message.audioMessage)?.url)
  );
}

function resolveMimeType(message: Record<string, unknown>, rawData: Record<string, unknown>) {
  return (
    asString(rawData.mimetype) ??
    asString(asRecord(message.imageMessage)?.mimetype) ??
    asString(asRecord(message.videoMessage)?.mimetype) ??
    asString(asRecord(message.documentMessage)?.mimetype) ??
    asString(asRecord(message.audioMessage)?.mimetype)
  );
}

export function normalizeEvolutionMessageUpsert(payload: Record<string, unknown>): NormalizedInboundPayload | null {
  const event = asString(payload.event);
  if (event !== "MESSAGES_UPSERT") return null;

  const rawData = getPrimaryData(payload);
  const key = asRecord(rawData.key) ?? {};
  const message = asRecord(rawData.message) ?? {};
  const remoteJid = asString(key.remoteJid) ?? asString(rawData.key?.remoteJid);
  const customerPhone = normalizePhone(remoteJid ?? asString(rawData.sender) ?? asString(rawData.from));
  const providerEventId = asString(key.id) ?? asString(rawData.id);

  if (!providerEventId || !customerPhone) {
    return null;
  }

  const fromMe = Boolean(key.fromMe ?? rawData.fromMe);
  const messageType = resolveMessageType(message);

  return {
    providerEventId,
    customerPhone,
    customerName: asString(rawData.pushName) ?? asString(rawData.senderName),
    direction: fromMe ? "outbound" : "inbound",
    sender: fromMe ? "bot" : "customer",
    messageType,
    content: resolveMessageContent(message),
    mediaUrl: resolveMediaUrl(message, rawData),
    mimeType: resolveMimeType(message, rawData),
    transcription: asString(rawData.transcription),
    externalMessageId: providerEventId,
    metadata: {
      event,
      pushName: asString(rawData.pushName),
      fromMe,
      remoteJid,
      instanceName: asString(payload.instance) ?? asString(rawData.instance),
      rawMessage: message,
    },
  };
}
