// @ts-nocheck
export type EvolutionInstanceRecord = {
  id: string;
  workspace_id: string;
  instance_name: string;
  display_name: string | null;
  status: string;
  phone_number: string | null;
  qr_code: string | null;
  evolution_base_url: string | null;
  webhook_token: string;
  provider_secret_ref: string | null;
  provider_type: string;
  is_default: boolean;
  connection_metadata: Record<string, unknown> | null;
};

function getEnv(name: string) {
  return (globalThis as { Deno?: { env?: { get: (key: string) => string | undefined } } }).Deno?.env?.get(name);
}

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function resolveEvolutionApiKey(secretRef: string | null) {
  if (secretRef) {
    const secret = getEnv(secretRef);
    if (secret) return secret;
  }

  const fallback = getEnv("EVOLUTION_API_KEY");
  if (fallback) return fallback;

  throw new Error("missing_evolution_secret");
}

export function getEvolutionBaseUrl(instance: EvolutionInstanceRecord, fallbackBaseUrl?: string) {
  const baseUrl = instance.evolution_base_url ?? fallbackBaseUrl ?? getEnv("EVOLUTION_BASE_URL");
  if (!baseUrl) {
    throw new Error("missing_evolution_base_url");
  }
  return baseUrl;
}

export async function evolutionRequest(options: {
  instance: EvolutionInstanceRecord;
  path: string;
  method?: "GET" | "POST" | "DELETE";
  body?: Record<string, unknown>;
}) {
  const apiKey = resolveEvolutionApiKey(options.instance.provider_secret_ref);
  const baseUrl = getEvolutionBaseUrl(options.instance);
  const response = await fetch(joinUrl(baseUrl, options.path), {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      apikey: apiKey,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const raw = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`evolution_error:${response.status}:${JSON.stringify(raw)}`);
  }

  return raw as Record<string, unknown>;
}

export function mapEvolutionStatus(raw: Record<string, unknown>) {
  const instance = asRecord(raw.instance);
  const state =
    asString(instance?.state) ??
    asString(raw.state) ??
    asString(raw.status) ??
    "disconnected";

  if (state.toLowerCase().includes("open") || state.toLowerCase().includes("connected")) {
    return "connected";
  }

  if (state.toLowerCase().includes("qr")) {
    return "qr";
  }

  if (state.toLowerCase().includes("connecting")) {
    return "connecting";
  }

  if (state.toLowerCase().includes("close") || state.toLowerCase().includes("disconnect")) {
    return "disconnected";
  }

  return state === "error" ? "error" : "connecting";
}

export function extractQrCode(raw: Record<string, unknown>) {
  return (
    asString(raw.base64) ??
    asString(raw.qrcode) ??
    asString(raw.qr) ??
    asString(asRecord(raw.qrcode)?.base64)
  );
}

export async function sendEvolutionText(input: {
  instance: EvolutionInstanceRecord;
  phoneNumber: string;
  text: string;
}) {
  return evolutionRequest({
    instance: input.instance,
    path: `/message/sendText/${input.instance.instance_name}`,
    method: "POST",
    body: {
      number: input.phoneNumber,
      text: input.text,
    },
  });
}

export async function sendEvolutionMedia(input: {
  instance: EvolutionInstanceRecord;
  phoneNumber: string;
  mediaUrl: string;
  caption?: string | null;
  mimeType?: string | null;
}) {
  return evolutionRequest({
    instance: input.instance,
    path: `/message/sendMedia/${input.instance.instance_name}`,
    method: "POST",
    body: {
      number: input.phoneNumber,
      media: input.mediaUrl,
      mediatype: input.mimeType ?? "application/octet-stream",
      caption: input.caption ?? undefined,
    },
  });
}
