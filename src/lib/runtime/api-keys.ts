import { z } from "zod";
import { createRuntimeError } from "./errors";

export const publicApiMessageSchema = z.object({
  phoneNumber: z.string().min(8).max(30),
  text: z.string().min(1).max(4000),
  instanceId: z.string().uuid().optional(),
  idempotencyKey: z.string().min(4).max(120).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type PublicApiMessageInput = z.infer<typeof publicApiMessageSchema>;

export interface ExtractedApiKey {
  raw: string;
  masked: string;
  prefix: string;
}

export function maskApiKey(key: string) {
  if (key.length <= 8) return `${key.slice(0, 2)}****`;
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

export function parseApiKeyPrefix(key: string) {
  const separatorIndex = key.indexOf("_");
  if (separatorIndex <= 0) {
    throw createRuntimeError("UNAUTHORIZED", "Invalid API key format.");
  }

  return key.slice(0, separatorIndex);
}

export function extractApiKeyFromHeaders(headers: Headers | Record<string, string>) {
  const value =
    headers instanceof Headers
      ? headers.get("x-api-key")
      : headers["x-api-key"] ?? headers["X-API-Key"];

  if (!value) {
    throw createRuntimeError("UNAUTHORIZED", "Missing x-api-key header.");
  }

  const raw = value.trim();
  if (!raw) {
    throw createRuntimeError("UNAUTHORIZED", "Empty x-api-key header.");
  }

  return {
    raw,
    masked: maskApiKey(raw),
    prefix: parseApiKeyPrefix(raw),
  } satisfies ExtractedApiKey;
}

export function validatePublicApiMessageInput(payload: unknown) {
  const result = publicApiMessageSchema.safeParse(payload);

  if (!result.success) {
    throw createRuntimeError("BAD_REQUEST", "Invalid public API message payload.", {
      issues: result.error.issues,
    });
  }

  return result.data;
}
