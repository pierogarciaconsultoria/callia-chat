// Provider de IA compatível com a API da OpenAI (OpenAI, gateways compatíveis, Lovable AI).
import { RuntimeError } from "./http.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null | Array<Record<string, unknown>>;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolDefinition {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatResult {
  content: string | null;
  toolCalls: ToolCall[];
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  model: string;
}

export interface ChatArgs {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Ex.: { type: "json_schema", json_schema: {...} } ou { type: "json_object" }. */
  responseFormat?: Record<string, unknown>;
  /** "auto" (padrão), "required" ou uma função específica: { type: "function", function: { name } }. */
  toolChoice?: "auto" | "required" | { type: "function"; function: { name: string } };
  timeoutMs?: number;
}

export interface AiProvider {
  readonly embeddingsEnabled: boolean;
  chat(args: ChatArgs): Promise<ChatResult>;
  transcribe(audio: Uint8Array, mime: string, language?: string): Promise<string>;
  describeImage(imageDataUrl: string, instruction: string): Promise<string>;
  embed(texts: string[]): Promise<number[][]>;
  speech(text: string, voice?: string): Promise<Uint8Array>;
}

export interface AiConfig {
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  sttModel: string;
  visionModel: string;
  ttsModel: string;
  embeddingModel?: string;
  timeoutMs?: number;
}

export const EMBEDDING_DIMENSIONS = 1536;

export function aiConfigFromEnv(get: (name: string) => string | undefined): AiConfig | null {
  const apiKey = get("AI_COMPAT_API_KEY") ?? get("OPENAI_API_KEY");
  if (!apiKey) return null;
  const defaultModel = get("AI_DEFAULT_MODEL") ?? "gpt-4o-mini";
  return {
    apiKey,
    baseUrl: (get("AI_COMPAT_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/$/, ""),
    defaultModel,
    sttModel: get("STT_MODEL") ?? "whisper-1",
    visionModel: get("VISION_MODEL") ?? defaultModel,
    ttsModel: get("TTS_MODEL") ?? "gpt-4o-mini-tts",
    embeddingModel: get("EMBEDDING_MODEL"),
  };
}

export function base64FromBytes(bytes: Uint8Array): string {
  let bin = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(bin);
}

export function bytesFromBase64(b64: string): Uint8Array {
  const clean = b64.includes(",") && b64.startsWith("data:") ? b64.slice(b64.indexOf(",") + 1) : b64;
  const bin = atob(clean);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export class OpenAiCompatProvider implements AiProvider {
  constructor(private readonly cfg: AiConfig, private readonly fetchImpl: typeof fetch = fetch) {}

  get embeddingsEnabled(): boolean {
    return Boolean(this.cfg.embeddingModel);
  }

  private async request(path: string, init: RequestInit, timeoutMs?: number): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.cfg.baseUrl}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${this.cfg.apiKey}`, ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(timeoutMs ?? this.cfg.timeoutMs ?? 45000),
      });
    } catch (err) {
      throw new RuntimeError("upstream_unavailable", "Provedor de IA indisponível.", { path, cause: String(err) });
    }
    if (!res.ok) {
      const body = (await res.text()).slice(0, 400);
      throw new RuntimeError("upstream_unavailable", "Provedor de IA recusou a requisição.", { path, status: res.status, body });
    }
    return res;
  }

  async chat(args: ChatArgs): Promise<ChatResult> {
    const model = args.model || this.cfg.defaultModel;
    const res = await this.request("/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: args.messages,
        temperature: args.temperature ?? 0.4,
        max_tokens: args.maxTokens ?? 700,
        ...(args.tools?.length ? { tools: args.tools, tool_choice: args.toolChoice ?? "auto" } : {}),
        ...(args.responseFormat ? { response_format: args.responseFormat } : {}),
      }),
    }, args.timeoutMs);
    const data = await res.json();
    const choice = data?.choices?.[0]?.message ?? {};
    return {
      content: typeof choice.content === "string" ? choice.content : null,
      toolCalls: Array.isArray(choice.tool_calls) ? choice.tool_calls : [],
      usage: data?.usage ?? {},
      model,
    };
  }

  async transcribe(audio: Uint8Array, mime: string, language = "pt"): Promise<string> {
    const ext = mime.includes("mpeg") ? "mp3" : mime.includes("mp4") ? "m4a" : mime.includes("wav") ? "wav" : "ogg";
    const form = new FormData();
    form.append("file", new Blob([audio], { type: mime.split(";")[0] }), `audio.${ext}`);
    form.append("model", this.cfg.sttModel);
    form.append("language", language.slice(0, 2));
    const res = await this.request("/audio/transcriptions", { method: "POST", body: form }, 60000);
    const data = await res.json();
    return String(data?.text ?? "").trim();
  }

  async describeImage(imageDataUrl: string, instruction: string): Promise<string> {
    const result = await this.chat({
      model: this.cfg.visionModel,
      temperature: 0.2,
      maxTokens: 300,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: instruction },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      }],
    });
    return (result.content ?? "").trim();
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.cfg.embeddingModel) throw new RuntimeError("unprocessable", "EMBEDDING_MODEL não configurado.");
    if (texts.length === 0) return [];
    const res = await this.request("/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.cfg.embeddingModel,
        input: texts.map((t) => t.slice(0, 8000)),
        // Modelos text-embedding-3 aceitam reduzir dimensões; a coluna é vector(1536).
        ...(this.cfg.embeddingModel.startsWith("text-embedding-3") ? { dimensions: EMBEDDING_DIMENSIONS } : {}),
      }),
    });
    const data = await res.json();
    const vectors: number[][] = (data?.data ?? [])
      .sort((a: { index: number }, b: { index: number }) => a.index - b.index)
      .map((d: { embedding: number[] }) => d.embedding);
    if (vectors.some((v) => v.length !== EMBEDDING_DIMENSIONS)) {
      throw new RuntimeError("unprocessable", `O modelo de embedding deve gerar ${EMBEDDING_DIMENSIONS} dimensões.`);
    }
    return vectors;
  }

  async speech(text: string, voice = "alloy"): Promise<Uint8Array> {
    const res = await this.request("/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.cfg.ttsModel, voice, input: text.slice(0, 4000), response_format: "opus" }),
    }, 60000);
    return new Uint8Array(await res.arrayBuffer());
  }
}

export function aiProviderFromEnv(get: (name: string) => string | undefined): AiProvider | null {
  const cfg = aiConfigFromEnv(get);
  return cfg ? new OpenAiCompatProvider(cfg) : null;
}

/** Formato aceito pelo pgvector via PostgREST. */
export function toPgVector(values: number[]): string {
  return `[${values.join(",")}]`;
}
