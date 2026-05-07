export type RuntimeProviderType = "evolution";

export type RuntimeSecretScope = "workspace" | "instance";

export type InboundEventProcessingStatus =
  | "received"
  | "processing"
  | "processed"
  | "failed";

export type OutboundDeliveryStatus =
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "failed";

export type InstanceSelectionStrategy = "explicit" | "default";

export type ProviderSecretRef = `${RuntimeProviderType}:${string}:${RuntimeSecretScope}:${string}`;

export interface ParsedProviderSecretRef {
  provider: RuntimeProviderType;
  workspaceId: string;
  scope: RuntimeSecretScope;
  targetId: string;
}

export interface BuildProviderSecretRefInput {
  provider: RuntimeProviderType;
  workspaceId: string;
  scope: RuntimeSecretScope;
  targetId: string;
}

export interface NormalizedInboundMessage {
  type: "text" | "audio" | "image" | "video" | "document" | "system";
  text?: string | null;
  mediaUrl?: string | null;
  mimeType?: string | null;
  externalMessageId?: string | null;
}

export interface NormalizedInboundEvent {
  workspaceId: string;
  whatsappInstanceId: string;
  provider: RuntimeProviderType;
  eventType: string;
  providerEventId: string;
  customerPhone: string;
  customerName?: string | null;
  correlationId?: string;
  message: NormalizedInboundMessage;
  rawPayload: Record<string, unknown>;
}

export interface ProcessMessageCommand {
  workspaceId: string;
  conversationId: string;
  messageId: string;
  whatsappInstanceId: string;
  trigger: "inbound_message" | "manual_retry" | "proactive_send";
  correlationId: string;
}

export interface PublicApiMessageRequest {
  phoneNumber: string;
  text: string;
  instanceId?: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface WebhookDispatchPayload {
  workspaceId: string;
  event: string;
  deliveryId: string;
  correlationId: string;
  payload: Record<string, unknown>;
}

const SECRET_REF_PATTERN =
  /^(evolution):([a-zA-Z0-9-]+):(workspace|instance):([a-zA-Z0-9-]+)$/;

function assertIdentifier(value: string, fieldName: string) {
  if (!value || !/^[a-zA-Z0-9-]+$/.test(value)) {
    throw new Error(`Invalid ${fieldName}. Use only letters, numbers, and hyphens.`);
  }
}

export function buildProviderSecretRef(
  input: BuildProviderSecretRefInput,
): ProviderSecretRef {
  assertIdentifier(input.workspaceId, "workspaceId");
  assertIdentifier(input.targetId, "targetId");

  return `${input.provider}:${input.workspaceId}:${input.scope}:${input.targetId}`;
}

export function parseProviderSecretRef(
  value: string | null | undefined,
): ParsedProviderSecretRef | null {
  if (!value) return null;

  const match = value.match(SECRET_REF_PATTERN);
  if (!match) return null;

  const [, provider, workspaceId, scope, targetId] = match;

  return {
    provider: provider as RuntimeProviderType,
    workspaceId,
    scope: scope as RuntimeSecretScope,
    targetId,
  };
}
