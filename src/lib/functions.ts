import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export class ApiError extends Error {
  code: string;
  status?: number;
  details?: unknown;
  correlationId?: string;
  constructor(message: string, code = "internal_error", status?: number, details?: unknown, correlationId?: string) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
    this.correlationId = correlationId;
  }
}

// Chama uma edge function e converte o corpo de erro padronizado { error: { code, message } } em ApiError.
export async function invokeFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const res = error.context as Response;
      let payload: { error?: { code?: string; message?: string; details?: unknown }; correlation_id?: string } | null = null;
      try {
        payload = await res.json();
      } catch {
        payload = null;
      }
      throw new ApiError(
        payload?.error?.message ?? `Falha em ${name} (HTTP ${res.status})`,
        payload?.error?.code ?? "internal_error",
        res.status,
        payload?.error?.details,
        payload?.correlation_id,
      );
    }
    throw new ApiError(error.message || `Não foi possível falar com ${name}`, "network_error");
  }
  return data as T;
}

// Erros do PostgREST/RPC chegam como { message, code }; normaliza para Error.
export function unwrap<T>(res: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (res.error) throw new ApiError(res.error.message, res.error.code ?? "db_error");
  return res.data as T;
}

// Códigos de erro da camada SaaS (functions e RPCs) em linguagem de usuário.
export const FRIENDLY_ERRORS: Record<string, string> = {
  tenant_inactive: "Este workspace está suspenso ou com a avaliação vencida. Fale com o suporte.",
  plan_limit_reached: "Limite do plano atingido. Fale com o suporte para ampliar o plano.",
  feature_not_in_plan: "Este recurso não está incluído no plano do workspace.",
  quota_exceeded: "A cota mensal de mensagens automáticas do plano foi atingida.",
  member_limit_reached: "Limite de membros do plano atingido. Remova alguém ou fale com o suporte para ampliar.",
  self_service_disabled: "A criação de workspaces está desativada. Peça ao administrador da plataforma.",
};

function friendlyFor(code: string | undefined, message: string): string | null {
  // RPCs devolvem o código cru como mensagem (ex.: "member_limit_reached").
  const key = Object.keys(FRIENDLY_ERRORS).find((k) => message === k || message.includes(k)) ?? (code && FRIENDLY_ERRORS[code] ? code : null);
  if (!key) return null;
  // Functions já mandam texto específico em português; só traduz quando veio o código cru.
  if (code === key && message && !/^[a-z_]+$/.test(message)) return message;
  return FRIENDLY_ERRORS[key];
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return friendlyFor(err.code, err.message) ?? err.message;
  if (err instanceof Error) return friendlyFor(undefined, err.message) ?? err.message;
  return String(err);
}
