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

type EvolutionMediaType = "image" | "video" | "audio" | "document";

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  heic: "image/heic",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  opus: "audio/opus",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv",
  txt: "text/plain",
  zip: "application/zip",
};

const EXTENSION_BY_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(MIME_BY_EXTENSION).map(([extension, mimeType]) => [mimeType, extension]),
);

function getUrlFileName(mediaUrl: string) {
  try {
    const pathname = new URL(mediaUrl).pathname;
    const candidate = decodeURIComponent(pathname.split("/").filter(Boolean).at(-1) ?? "");
    return candidate || null;
  } catch {
    const candidate = mediaUrl.split(/[?#]/, 1)[0].split("/").filter(Boolean).at(-1) ?? "";
    return candidate || null;
  }
}

function getFileExtension(fileName: string | null) {
  const match = fileName?.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? null;
}

function getEvolutionMediaType(mimeType: string): EvolutionMediaType {
  const normalized = mimeType.toLowerCase();
  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("video/")) return "video";
  if (normalized.startsWith("audio/")) return "audio";
  return "document";
}

export function buildEvolutionMediaPayload(input: {
  phoneNumber: string;
  mediaUrl: string;
  caption?: string | null;
  mimeType?: string | null;
}) {
  const urlFileName = getUrlFileName(input.mediaUrl);
  const extension = getFileExtension(urlFileName);
  const inferredMimeType = extension ? MIME_BY_EXTENSION[extension] : null;
  const mimeType = input.mimeType?.trim().toLowerCase() || inferredMimeType || "image/jpeg";
  const mediaType = getEvolutionMediaType(mimeType);
  const fileName = mediaType === "document"
    ? urlFileName && extension
      ? urlFileName
      : `document.${EXTENSION_BY_MIME[mimeType] ?? "bin"}`
    : undefined;

  return {
    number: input.phoneNumber,
    media: input.mediaUrl,
    mediatype: mediaType,
    mimetype: mimeType,
    ...(fileName ? { fileName } : {}),
    caption: input.caption ?? undefined,
  };
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
    body: buildEvolutionMediaPayload(input),
  });
}
