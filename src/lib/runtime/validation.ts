import { z } from "zod";

export const normalizedInboundMessageSchema = z.object({
  type: z.enum(["text", "audio", "image", "video", "document", "system"]),
  text: z.string().nullable().optional(),
  mediaUrl: z.string().url().nullable().optional(),
  mimeType: z.string().nullable().optional(),
  externalMessageId: z.string().nullable().optional(),
});

export const normalizedInboundEventSchema = z.object({
  workspaceId: z.string().uuid(),
  whatsappInstanceId: z.string().uuid(),
  provider: z.literal("evolution"),
  eventType: z.string().min(1),
  providerEventId: z.string().min(1),
  customerPhone: z.string().min(8).max(30),
  customerName: z.string().nullable().optional(),
  correlationId: z.string().uuid().optional(),
  message: normalizedInboundMessageSchema,
  rawPayload: z.record(z.string(), z.unknown()),
});

export const processMessageCommandSchema = z.object({
  workspaceId: z.string().uuid(),
  conversationId: z.string().uuid(),
  messageId: z.string().uuid(),
  whatsappInstanceId: z.string().uuid(),
  trigger: z.enum(["inbound_message", "manual_retry", "proactive_send"]),
  correlationId: z.string().uuid(),
});

export const webhookDispatchPayloadSchema = z.object({
  workspaceId: z.string().uuid(),
  event: z.string().min(1),
  deliveryId: z.string().uuid(),
  correlationId: z.string().uuid(),
  payload: z.record(z.string(), z.unknown()),
});
