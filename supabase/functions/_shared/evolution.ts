// Adapter da Evolution API v2 (Baileys): cliente HTTP + normalização dos eventos de webhook.
import { RuntimeError } from "./http.ts";

export const EVOLUTION_WEBHOOK_EVENTS = ["QRCODE_UPDATED", "MESSAGES_UPSERT", "CONNECTION_UPDATE"] as const;

export type MessageType =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "document"
  | "sticker"
  | "location"
  | "contact"
  | "reaction"
  | "unknown";

export interface EvolutionMessageEvent {
  kind: "message";
  instanceName: string;
  externalId: string;
  fromMe: boolean;
  phone: string;
  contactName: string | null;
  type: MessageType;
  text: string | null;
  mediaMime: string | null;
  fileName: string | null;
  timestamp: string;
  /** Necessário para baixar a mídia depois (chat/getBase64FromMediaMessage). */
  key: Record<string, unknown>;
}

export type EvolutionEvent =
  | { kind: "qrcode"; instanceName: string; qrBase64: string | null; pairingCode: string | null }
  | {
    kind: "connection";
    instanceName: string;
    state: "open" | "close" | "connecting";
    phone: string | null;
    profileName: string | null;
    reason: number | null;
  }
  | EvolutionMessageEvent
  | { kind: "ignored"; instanceName: string; reason: string };

// deno-lint-ignore no-explicit-any
type Json = any;

/** "messages.upsert" e "MESSAGES_UPSERT" viram "MESSAGES_UPSERT". */
export function normalizeEventName(name: unknown): string {
  return String(name ?? "").trim().replace(/[.\-]/g, "_").toUpperCase();
}

export function jidToPhone(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const user = jid.split("@")[0]?.split(":")[0] ?? "";
  const digits = user.replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}

/** Normaliza para dígitos com DDI. Números brasileiros sem DDI (10–11 dígitos) recebem 55. */
export function normalizePhone(input: string | null | undefined, defaultCountry = "55"): string | null {
  if (!input) return null;
  let digits = String(input).replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10 || digits.length === 11) digits = defaultCountry + digits;
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

function toIsoTimestamp(value: Json): string {
  let seconds: number | null = null;
  if (typeof value === "number") seconds = value;
  else if (typeof value === "string" && /^\d+$/.test(value)) seconds = Number(value);
  else if (value && typeof value === "object" && typeof value.low === "number") seconds = value.low >>> 0;
  if (!seconds) return new Date().toISOString();
  // Alguns provedores mandam milissegundos.
  const ms = seconds > 1e12 ? seconds : seconds * 1000;
  return new Date(ms).toISOString();
}

/** Desembrulha mensagens efêmeras, de visualização única e documento com legenda. */
function unwrapMessage(message: Json): Json {
  let current = message ?? {};
  for (let i = 0; i < 4; i++) {
    const inner = current.ephemeralMessage?.message ??
      current.viewOnceMessage?.message ??
      current.viewOnceMessageV2?.message ??
      current.viewOnceMessageV2Extension?.message ??
      current.documentWithCaptionMessage?.message ??
      current.editedMessage?.message;
    if (!inner) break;
    current = inner;
  }
  return current;
}

function classify(message: Json): { type: MessageType; text: string | null; mime: string | null; fileName: string | null } {
  const m = unwrapMessage(message);
  if (typeof m.conversation === "string") return { type: "text", text: m.conversation, mime: null, fileName: null };
  if (m.extendedTextMessage) return { type: "text", text: m.extendedTextMessage.text ?? null, mime: null, fileName: null };
  if (m.imageMessage) return { type: "image", text: m.imageMessage.caption ?? null, mime: m.imageMessage.mimetype ?? "image/jpeg", fileName: null };
  if (m.audioMessage) return { type: "audio", text: null, mime: m.audioMessage.mimetype ?? "audio/ogg", fileName: null };
  if (m.videoMessage) return { type: "video", text: m.videoMessage.caption ?? null, mime: m.videoMessage.mimetype ?? "video/mp4", fileName: null };
  if (m.documentMessage) {
    return {
      type: "document",
      text: m.documentMessage.caption ?? null,
      mime: m.documentMessage.mimetype ?? "application/octet-stream",
      fileName: m.documentMessage.fileName ?? m.documentMessage.title ?? null,
    };
  }
  if (m.stickerMessage) return { type: "sticker", text: null, mime: m.stickerMessage.mimetype ?? "image/webp", fileName: null };
  if (m.locationMessage || m.liveLocationMessage) {
    const loc = m.locationMessage ?? m.liveLocationMessage;
    const label = [loc.name, loc.address].filter(Boolean).join(" — ");
    return { type: "location", text: `${label ? label + " " : ""}(${loc.degreesLatitude}, ${loc.degreesLongitude})`, mime: null, fileName: null };
  }
  if (m.contactMessage) return { type: "contact", text: m.contactMessage.displayName ?? null, mime: null, fileName: null };
  if (m.reactionMessage) return { type: "reaction", text: m.reactionMessage.text ?? null, mime: null, fileName: null };
  // Respostas de botões e listas chegam como texto escolhido.
  const choice = m.buttonsResponseMessage?.selectedDisplayText ??
    m.listResponseMessage?.title ??
    m.templateButtonReplyMessage?.selectedDisplayText;
  if (choice) return { type: "text", text: choice, mime: null, fileName: null };
  return { type: "unknown", text: null, mime: null, fileName: null };
}

function parseMessage(instanceName: string, data: Json): EvolutionEvent {
  const key = data?.key ?? {};
  const remoteJid: string = key.remoteJid ?? "";
  if (!remoteJid) return { kind: "ignored", instanceName, reason: "missing_remote_jid" };
  if (remoteJid.endsWith("@g.us")) return { kind: "ignored", instanceName, reason: "group_message" };
  if (remoteJid === "status@broadcast" || remoteJid.endsWith("@broadcast") || remoteJid.endsWith("@newsletter")) {
    return { kind: "ignored", instanceName, reason: "broadcast" };
  }
  const raw = data.message ?? {};
  if (raw.protocolMessage || raw.senderKeyDistributionMessage && Object.keys(raw).length === 1) {
    return { kind: "ignored", instanceName, reason: "protocol_message" };
  }
  // Contas com LID (@lid) trazem o número real em campos alternativos.
  const jidForPhone = remoteJid.endsWith("@lid")
    ? key.remoteJidAlt ?? key.senderPn ?? data.senderPn ?? data.remoteJidAlt ?? null
    : remoteJid;
  const phone = jidToPhone(jidForPhone);
  if (!phone) return { kind: "ignored", instanceName, reason: "unresolved_phone" };
  if (!key.id) return { kind: "ignored", instanceName, reason: "missing_message_id" };

  const { type, text, mime, fileName } = classify(raw);
  if (type === "reaction") return { kind: "ignored", instanceName, reason: "reaction" };
  const fromMe = key.fromMe === true;
  return {
    kind: "message",
    instanceName,
    externalId: String(key.id),
    fromMe,
    phone,
    contactName: fromMe ? null : (typeof data.pushName === "string" && data.pushName.trim() ? data.pushName.trim() : null),
    type,
    text: text?.trim() ? text : null,
    mediaMime: mime,
    fileName,
    timestamp: toIsoTimestamp(data.messageTimestamp),
    key,
  };
}

/** Converte o corpo bruto do webhook da Evolution em eventos normalizados. */
export function parseEvolutionWebhook(body: Json): EvolutionEvent[] {
  const instanceName = String(body?.instance ?? body?.instanceName ?? "");
  const event = normalizeEventName(body?.event);
  const data = body?.data;

  if (event === "QRCODE_UPDATED") {
    const qr = data?.qrcode ?? data;
    const base64 = typeof qr?.base64 === "string" ? qr.base64 : null;
    return [{
      kind: "qrcode",
      instanceName,
      qrBase64: base64 && !base64.startsWith("data:") ? `data:image/png;base64,${base64}` : base64,
      pairingCode: qr?.pairingCode ?? null,
    }];
  }

  if (event === "CONNECTION_UPDATE") {
    const state = data?.state === "open" || data?.state === "connecting" ? data.state : "close";
    return [{
      kind: "connection",
      instanceName,
      state,
      phone: jidToPhone(data?.wuid ?? data?.ownerJid ?? null),
      profileName: data?.profileName ?? null,
      reason: typeof data?.statusReason === "number" ? data.statusReason : null,
    }];
  }

  if (event === "MESSAGES_UPSERT") {
    const items = Array.isArray(data) ? data : Array.isArray(data?.messages) ? data.messages : [data];
    return items.filter(Boolean).map((item: Json) => parseMessage(instanceName, item));
  }

  return [{ kind: "ignored", instanceName, reason: `event_${event.toLowerCase() || "unknown"}` }];
}

// ---------------------------------------------------------------------------
// Cliente HTTP
// ---------------------------------------------------------------------------
export interface EvolutionConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

export interface SendResult {
  providerMessageId: string | null;
  raw: Json;
}

export class EvolutionClient {
  constructor(private readonly cfg: EvolutionConfig) {}

  private async call(method: string, path: string, body?: unknown): Promise<Json> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, "")}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", apikey: this.cfg.apiKey },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 20000),
      });
    } catch (err) {
      throw new RuntimeError("upstream_unavailable", "Evolution API indisponível.", { path, cause: String(err) });
    }
    const text = await res.text();
    let parsed: Json = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { raw: text.slice(0, 500) };
    }
    if (!res.ok) {
      const message = parsed?.response?.message ?? parsed?.message ?? parsed?.error ?? `HTTP ${res.status}`;
      throw new RuntimeError("upstream_unavailable", "Evolution API recusou a requisição.", {
        path,
        status: res.status,
        message: Array.isArray(message) ? message.join("; ") : String(message).slice(0, 300),
      });
    }
    return parsed;
  }

  webhookConfig(url: string) {
    return { enabled: true, url, byEvents: false, base64: false, events: [...EVOLUTION_WEBHOOK_EVENTS] };
  }

  createInstance(instanceName: string, webhookUrl: string) {
    return this.call("POST", "/instance/create", {
      instanceName,
      qrcode: true,
      integration: "WHATSAPP-BAILEYS",
      groupsIgnore: true,
      alwaysOnline: false,
      readMessages: false,
      webhook: this.webhookConfig(webhookUrl),
    });
  }

  setWebhook(instanceName: string, webhookUrl: string) {
    return this.call("POST", `/webhook/set/${encodeURIComponent(instanceName)}`, { webhook: this.webhookConfig(webhookUrl) });
  }

  /** Com `number`, a Evolution devolve pairingCode para conectar sem QR (WhatsApp → Conectar com número de telefone). */
  connect(instanceName: string, number?: string): Promise<{ base64?: string; code?: string; pairingCode?: string }> {
    const q = number ? `?number=${encodeURIComponent(number)}` : "";
    return this.call("GET", `/instance/connect/${encodeURIComponent(instanceName)}${q}`);
  }

  async connectionState(instanceName: string): Promise<"open" | "close" | "connecting"> {
    const res = await this.call("GET", `/instance/connectionState/${encodeURIComponent(instanceName)}`);
    const state = res?.instance?.state ?? res?.state;
    return state === "open" || state === "connecting" ? state : "close";
  }

  async fetchInstance(instanceName: string): Promise<{ phone: string | null; profileName: string | null }> {
    const res = await this.call("GET", `/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`);
    const item = Array.isArray(res) ? res[0] : res;
    const inst = item?.instance ?? item;
    return { phone: jidToPhone(inst?.ownerJid ?? inst?.owner ?? null), profileName: inst?.profileName ?? null };
  }

  logout(instanceName: string) {
    return this.call("DELETE", `/instance/logout/${encodeURIComponent(instanceName)}`);
  }

  deleteInstance(instanceName: string) {
    return this.call("DELETE", `/instance/delete/${encodeURIComponent(instanceName)}`);
  }

  async sendText(instanceName: string, number: string, text: string, delayMs = 1200): Promise<SendResult> {
    const raw = await this.call("POST", `/message/sendText/${encodeURIComponent(instanceName)}`, { number, text, delay: delayMs });
    return { providerMessageId: raw?.key?.id ?? null, raw };
  }

  async sendMedia(
    instanceName: string,
    number: string,
    media: { type: "image" | "video" | "document"; url: string; caption?: string; mimetype?: string; fileName?: string },
  ): Promise<SendResult> {
    const raw = await this.call("POST", `/message/sendMedia/${encodeURIComponent(instanceName)}`, {
      number,
      mediatype: media.type,
      media: media.url,
      caption: media.caption,
      mimetype: media.mimetype,
      fileName: media.fileName,
    });
    return { providerMessageId: raw?.key?.id ?? null, raw };
  }

  /** audio: URL ou base64 (sem prefixo data:). */
  async sendAudio(instanceName: string, number: string, audio: string): Promise<SendResult> {
    const raw = await this.call("POST", `/message/sendWhatsAppAudio/${encodeURIComponent(instanceName)}`, { number, audio });
    return { providerMessageId: raw?.key?.id ?? null, raw };
  }

  async getMediaBase64(instanceName: string, key: Record<string, unknown>): Promise<{ base64: string; mimetype: string | null }> {
    const raw = await this.call("POST", `/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`, {
      message: { key },
      convertToMp4: false,
    });
    if (!raw?.base64) throw new RuntimeError("upstream_unavailable", "Evolution não retornou a mídia.");
    return { base64: raw.base64, mimetype: raw.mimetype ?? null };
  }
}
