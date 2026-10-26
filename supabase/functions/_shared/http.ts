// Runtime comum das edge functions: erros padronizados, correlation_id, CORS e logs estruturados.

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key, x-correlation-id, x-callia-internal",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

export type ErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "unprocessable"
  | "channel_not_supported"
  | "tenant_inactive"
  | "plan_limit_reached"
  | "feature_not_in_plan"
  | "quota_exceeded"
  | "rate_limited"
  | "upstream_unavailable"
  | "internal_error";

const statusByCode: Record<ErrorCode, number> = {
  invalid_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  unprocessable: 422,
  channel_not_supported: 422,
  tenant_inactive: 403,
  plan_limit_reached: 403,
  feature_not_in_plan: 403,
  quota_exceeded: 429,
  rate_limited: 429,
  upstream_unavailable: 502,
  internal_error: 500,
};

export class RuntimeError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
    status?: number,
  ) {
    super(message);
    this.name = "RuntimeError";
    this.status = status ?? statusByCode[code];
  }
}

export function newCorrelationId(req?: Request): string {
  const incoming = req?.headers.get("x-correlation-id")?.trim();
  if (incoming && /^[A-Za-z0-9._:-]{8,80}$/.test(incoming)) return incoming;
  return crypto.randomUUID();
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

export function errorResponse(err: unknown, correlationId: string): Response {
  if (err instanceof RuntimeError) {
    return json(
      { error: { code: err.code, message: err.message, details: err.details }, correlation_id: correlationId },
      err.status,
      { "x-correlation-id": correlationId },
    );
  }
  return json(
    { error: { code: "internal_error", message: "Erro interno.", details: {} }, correlation_id: correlationId },
    500,
    { "x-correlation-id": correlationId },
  );
}

export type Logger = ReturnType<typeof createLogger>;

export function createLogger(fn: string, correlationId: string) {
  const emit = (level: "info" | "warn" | "error", msg: string, extra?: Record<string, unknown>) => {
    const line = JSON.stringify({ level, fn, correlation_id: correlationId, msg, ...extra });
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  };
  return {
    info: (msg: string, extra?: Record<string, unknown>) => emit("info", msg, extra),
    warn: (msg: string, extra?: Record<string, unknown>) => emit("warn", msg, extra),
    error: (msg: string, extra?: Record<string, unknown>) => emit("error", msg, extra),
  };
}

export interface HandlerContext {
  req: Request;
  url: URL;
  correlationId: string;
  log: Logger;
}

/** Envolve um handler com CORS, correlation_id e tradução de erros. */
export function createHandler(fn: string, handler: (ctx: HandlerContext) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    const correlationId = newCorrelationId(req);
    const log = createLogger(fn, correlationId);
    try {
      const res = await handler({ req, url: new URL(req.url), correlationId, log });
      res.headers.set("x-correlation-id", correlationId);
      return res;
    } catch (err) {
      if (!(err instanceof RuntimeError) || err.status >= 500) {
        log.error("unhandled", { error: err instanceof Error ? err.message : String(err) });
      }
      return errorResponse(err, correlationId);
    }
  };
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    const text = await req.text();
    return (text ? JSON.parse(text) : {}) as T;
  } catch {
    throw new RuntimeError("invalid_request", "Corpo JSON inválido.");
  }
}

/** Executa sem bloquear a resposta quando o runtime suporta (Supabase Edge Runtime). */
export function runInBackground(promise: Promise<unknown>): void {
  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime;
  const guarded = promise.catch((err) => console.error(JSON.stringify({ level: "error", msg: "background", error: String(err) })));
  if (runtime?.waitUntil) runtime.waitUntil(guarded);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
