export type ApiKeyRecord = {
  id: string;
  workspace_id: string;
  name: string;
  prefix: string;
  last4: string;
  revoked_at: string | null;
  last_used_at: string | null;
  last_used_ip: string | null;
  last_used_user_agent: string | null;
  expires_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export function buildPublicApiBaseUrl() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.replace(/\/+$/, "") ?? "";
  return supabaseUrl ? `${supabaseUrl}/functions/v1/public-api` : "";
}

export function maskStoredApiKey(key: Pick<ApiKeyRecord, "prefix" | "last4">) {
  return `${key.prefix}_live_****${key.last4}`;
}

export function getApiKeyStatusLabel(key: Pick<ApiKeyRecord, "revoked_at">) {
  return key.revoked_at ? "Revogada" : "Ativa";
}

export function getApiKeyStatusTone(key: Pick<ApiKeyRecord, "revoked_at">) {
  return key.revoked_at
    ? "border-rose-300 bg-rose-100 text-rose-800"
    : "border-emerald-300 bg-emerald-100 text-emerald-800";
}
