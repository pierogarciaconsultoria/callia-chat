export function asPlainRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parsePublicApiMessagePayload(payload: unknown) {
  const body = asPlainRecord(payload) ?? {};
  const phoneNumber = optionalText(body.phone) ?? optionalText(body.phoneNumber);
  const conversationId = optionalText(body.conversationId);
  const text = optionalText(body.text);
  const mediaUrl = optionalText(body.mediaUrl);
  const mimeType = optionalText(body.mimeType);
  const caption = optionalText(body.caption);
  const instanceId = optionalText(body.instanceId);
  const idempotencyKey = optionalText(body.idempotencyKey);
  const metadata = asPlainRecord(body.metadata) ?? {};

  if ((!phoneNumber && !conversationId) || (!text && !mediaUrl)) {
    throw new Error("invalid_message_payload");
  }

  return {
    phoneNumber,
    conversationId,
    text,
    mediaUrl,
    mimeType,
    caption,
    instanceId,
    idempotencyKey,
    metadata,
  };
}

export function getPublicApiMessageContent(input: {
  text: string | null;
  mediaUrl: string | null;
  caption: string | null;
}) {
  return input.mediaUrl ? input.caption ?? input.text : input.text;
}

export function buildExternalAgentMetadata(
  metadata: Record<string, unknown>,
  apiKeyId: string,
  idempotencyKey: string | null,
) {
  return {
    ...metadata,
    source: "external_agent",
    generated_by: "public-api",
    api_key_id: apiKeyId,
    idempotency_key: idempotencyKey,
  };
}
