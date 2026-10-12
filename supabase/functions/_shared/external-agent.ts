// @ts-nocheck
// Pure helpers for delegating replies to an external agent webhook (e.g. n8n).

export const EXTERNAL_AGENT_MIN_TIMEOUT_MS = 1000;
export const EXTERNAL_AGENT_MAX_TIMEOUT_MS = 60000;
const MEDIA_TYPES = ["image", "video", "audio", "document"];

export function clampTimeout(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 25000;
  return Math.min(EXTERNAL_AGENT_MAX_TIMEOUT_MS, Math.max(EXTERNAL_AGENT_MIN_TIMEOUT_MS, Math.round(n)));
}

export function isValidExternalAgentUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

export function buildExternalAgentPayload(input) {
  const msgType = input.message?.type === "audio" || input.message?.type === "image" ? input.message.type : "text";
  return {
    workspace_id: input.workspaceId,
    conversation_id: input.conversationId,
    message_id: input.message?.id ?? null,
    contact: {
      name: input.conversation?.customer_name ?? null,
      phone: input.conversation?.customer_phone ?? null,
    },
    message: {
      type: msgType,
      text: input.messageText ?? "",
      media_url: input.message?.media_url ?? null,
    },
    history: (input.history ?? [])
      .filter((m) => m.id !== input.message?.id)
      .slice(-20)
      .map((m) => ({
        role: m.direction === "inbound" ? "user" : "assistant",
        content: m.content ?? m.transcription ?? "",
      })),
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
}

export function parseExternalAgentResponse(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "invalid_response_shape" };
  }
  const reply = typeof raw.reply === "string" ? raw.reply.trim() : "";
  const handoff = raw.handoff === true;
  if (raw.reply !== undefined && raw.reply !== null && typeof raw.reply !== "string") {
    return { ok: false, error: "invalid_reply_type" };
  }
  if (raw.media !== undefined && raw.media !== null && !Array.isArray(raw.media)) {
    return { ok: false, error: "invalid_media_type" };
  }
  const media = [];
  for (const item of raw.media ?? []) {
    if (!item || typeof item !== "object") return { ok: false, error: "invalid_media_item" };
    if (!MEDIA_TYPES.includes(item.type)) return { ok: false, error: "invalid_media_item_type" };
    if (!isValidExternalAgentUrl(item.url)) return { ok: false, error: "invalid_media_item_url" };
    media.push({ type: item.type, url: item.url, caption: typeof item.caption === "string" ? item.caption : null });
  }
  if (!reply && media.length === 0 && !handoff) {
    return { ok: false, error: "empty_response" };
  }
  return { ok: true, value: { reply, handoff, media } };
}

export async function callExternalAgent(input, fetchImpl = fetch) {
  const controller = new AbortController();
  const timeoutMs = clampTimeout(input.timeoutMs);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetchImpl(input.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-callia-secret": input.secret ?? "" },
      body: JSON.stringify(input.payload),
      signal: controller.signal,
    });
    const text = await response.text();
    const durationMs = Date.now() - startedAt;
    if (!response.ok) {
      return { ok: false, error: `http_${response.status}`, status: response.status, body: text.slice(0, 2000), durationMs };
    }
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, error: "invalid_json", status: response.status, body: text.slice(0, 2000), durationMs };
    }
    const parsed = parseExternalAgentResponse(json);
    if (!parsed.ok) {
      return { ok: false, error: parsed.error, status: response.status, body: text.slice(0, 2000), durationMs };
    }
    return { ok: true, status: response.status, value: parsed.value, body: text.slice(0, 2000), durationMs };
  } catch (error) {
    const aborted = error?.name === "AbortError";
    return { ok: false, error: aborted ? "timeout" : "network_error", status: null, body: null, durationMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
}
