// Agente externo por workspace (n8n, LangChain, Flowise, Make...).
import { z } from "npm:zod@3.23.8";

export const SECRET_REF_PATTERN = /^EXTERNAL_AGENT_[A-Z0-9_]+$/;

export interface ExternalAgentPayload {
  workspace_id: string;
  conversation_id: string;
  message_id: string;
  contact: { name: string | null; phone: string };
  message: { type: string; text: string | null; media_url: string | null };
  history: Array<{ role: "customer" | "bot" | "agent" | "system"; type: string; text: string | null; at: string }>;
  timestamp: string;
}

const mediaItem = z.object({
  type: z.enum(["image", "video", "document", "audio"]),
  url: z.string().url(),
  caption: z.string().max(1024).optional(),
  file_name: z.string().max(200).optional(),
  mimetype: z.string().max(100).optional(),
});

export const externalAgentResponseSchema = z.object({
  reply: z.string().max(4096).nullish(),
  handoff: z.boolean().optional().default(false),
  media: z.array(mediaItem).max(10).optional().default([]),
});

export type ExternalAgentReply = z.infer<typeof externalAgentResponseSchema>;

export class ExternalAgentError extends Error {
  constructor(readonly reason: "timeout" | "http_error" | "invalid_response" | "network" | "misconfigured", message: string, readonly status?: number) {
    super(message);
    this.name = "ExternalAgentError";
  }
}

/** Resolve o segredo pelo nome de referência, aceitando só o prefixo controlado. */
export function resolveExternalSecret(ref: string | null | undefined, getEnv: (name: string) => string | undefined): string | null {
  if (!ref) return null;
  if (!SECRET_REF_PATTERN.test(ref)) throw new ExternalAgentError("misconfigured", "Referência de segredo fora do padrão EXTERNAL_AGENT_*.");
  const value = getEnv(ref);
  if (!value) throw new ExternalAgentError("misconfigured", `Segredo ${ref} não está definido no backend.`);
  return value;
}

export async function callExternalAgent(args: {
  url: string;
  secret: string | null;
  payload: ExternalAgentPayload;
  timeoutMs: number;
  correlationId: string;
  fetchImpl?: typeof fetch;
}): Promise<ExternalAgentReply> {
  if (!/^https:\/\//.test(args.url)) throw new ExternalAgentError("misconfigured", "URL do agente externo deve usar HTTPS.");
  const doFetch = args.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(args.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-callia-correlation-id": args.correlationId,
        "x-callia-message-id": args.payload.message_id,
        ...(args.secret ? { "x-callia-secret": args.secret } : {}),
      },
      body: JSON.stringify(args.payload),
      signal: AbortSignal.timeout(args.timeoutMs),
    });
  } catch (err) {
    const name = (err as Error)?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new ExternalAgentError("timeout", `Agente externo não respondeu em ${args.timeoutMs} ms.`);
    }
    throw new ExternalAgentError("network", `Falha de rede no agente externo: ${String(err)}`);
  }
  if (!res.ok) throw new ExternalAgentError("http_error", `Agente externo respondeu HTTP ${res.status}.`, res.status);

  let body: unknown;
  try {
    const text = await res.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new ExternalAgentError("invalid_response", "Agente externo retornou JSON inválido.");
  }
  // n8n costuma devolver [ { ... } ] no nó "Respond to Webhook".
  if (Array.isArray(body) && body.length === 1) body = body[0];
  const parsed = externalAgentResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new ExternalAgentError("invalid_response", `Resposta fora do contrato: ${parsed.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}`);
  }
  const reply = parsed.data;
  if (!reply.reply?.trim() && !reply.handoff && reply.media.length === 0) {
    throw new ExternalAgentError("invalid_response", "Resposta vazia (sem reply, media ou handoff).");
  }
  return reply;
}
