// @ts-nocheck
const encoder = new TextEncoder();

export function getApiKeyPrefix() {
  return "ah";
}

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return toHex(digest);
}

export function generateRawApiKey() {
  const secret =
    `${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  return `${getApiKeyPrefix()}_live_${secret}`;
}

export function getApiKeyLast4(rawKey: string) {
  return rawKey.slice(-4);
}

export function getClientIp(request: Request) {
  const forwarded =
    request.headers.get("x-forwarded-for") ??
    request.headers.get("x-real-ip") ??
    "";

  return forwarded.split(",")[0]?.trim() || null;
}

export function sanitizeApiKeyRecord(record) {
  return {
    id: record.id,
    workspace_id: record.workspace_id,
    name: record.name,
    prefix: record.prefix,
    last4: record.last4,
    revoked_at: record.revoked_at ?? null,
    last_used_at: record.last_used_at ?? null,
    last_used_ip: record.last_used_ip ?? null,
    last_used_user_agent: record.last_used_user_agent ?? null,
    expires_at: record.expires_at ?? null,
    metadata: record.metadata ?? {},
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}
