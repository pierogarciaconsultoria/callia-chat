import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { RuntimeError } from "./http.ts";
import { timingSafeEqual } from "./crypto.ts";

export type Db = SupabaseClient;
export type WorkspaceRole = "owner" | "admin" | "agent";

export function env(name: string, fallback?: string): string {
  const value = Deno.env.get(name) ?? fallback;
  if (value === undefined || value === "") throw new RuntimeError("internal_error", `Configuração ausente: ${name}.`);
  return value;
}

export function optionalEnv(name: string): string | undefined {
  const value = Deno.env.get(name);
  return value ? value : undefined;
}

let adminClient: Db | null = null;

/** Cliente service_role: ignora RLS. Toda query feita com ele deve filtrar workspace_id explicitamente. */
export function adminDb(): Db {
  adminClient ??= createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return adminClient;
}

export interface AuthedUser {
  id: string;
  email?: string;
}

export async function requireUser(req: Request): Promise<AuthedUser> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new RuntimeError("unauthorized", "Sessão ausente.");
  const { data, error } = await adminDb().auth.getUser(token);
  if (error || !data.user) throw new RuntimeError("unauthorized", "Sessão inválida ou expirada.");
  return { id: data.user.id, email: data.user.email ?? undefined };
}

export async function requireWorkspaceRole(
  userId: string,
  workspaceId: unknown,
  allowed: WorkspaceRole[] = ["owner", "admin"],
): Promise<WorkspaceRole> {
  if (typeof workspaceId !== "string" || !/^[0-9a-f-]{36}$/i.test(workspaceId)) {
    throw new RuntimeError("invalid_request", "workspace_id inválido.");
  }
  const { data, error } = await adminDb()
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new RuntimeError("internal_error", "Falha ao validar permissão.");
  if (!data) throw new RuntimeError("forbidden", "Você não pertence a este workspace.");
  if (!allowed.includes(data.role)) throw new RuntimeError("forbidden", "Permissão insuficiente para esta ação.");
  return data.role;
}

/** Chamadas entre functions: header x-callia-internal = INTERNAL_FUNCTION_SECRET (ou service role). */
export function isInternalCall(req: Request): boolean {
  const provided = req.headers.get("x-callia-internal") ?? "";
  const expected = optionalEnv("INTERNAL_FUNCTION_SECRET") ?? optionalEnv("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return provided.length > 0 && expected.length > 0 && timingSafeEqual(provided, expected);
}

export function internalHeaders(): Record<string, string> {
  const secret = optionalEnv("INTERNAL_FUNCTION_SECRET") ?? env("SUPABASE_SERVICE_ROLE_KEY");
  return {
    "Content-Type": "application/json",
    "x-callia-internal": secret,
    Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`,
  };
}

export function functionUrl(name: string): string {
  const base = optionalEnv("FUNCTIONS_PUBLIC_URL") ?? `${env("SUPABASE_URL").replace(/\/$/, "")}/functions/v1`;
  return `${base.replace(/\/$/, "")}/${name}`;
}

export async function audit(
  db: Db,
  entry: {
    workspace_id: string | null;
    action: string;
    actor_user_id?: string | null;
    actor_type?: "user" | "api_key" | "system";
    entity?: string;
    entity_id?: string;
    details?: Record<string, unknown>;
    correlation_id?: string;
  },
): Promise<void> {
  const { error } = await db.from("audit_logs").insert({ actor_type: "user", details: {}, ...entry });
  if (error) console.error(JSON.stringify({ level: "error", msg: "audit_failed", error: error.message }));
}
