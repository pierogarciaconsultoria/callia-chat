// Equipe: convite de membro pelo administrador do workspace.
// Se o e-mail já tem usuário na plataforma, só vincula; se não tem, convida pelo GoTrue (a pessoa define a senha
// pelo link do e-mail) e vincula em seguida. O vínculo passa pela RPC add_workspace_member, executada como o
// usuário que pediu, para manter as regras de papel, plano e auditoria num lugar só.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { createHandler, json, readJson, RuntimeError } from "../_shared/http.ts";
import { adminDb, audit, type Db, env, optionalEnv, requireUser, requireWorkspaceRole } from "../_shared/supabase.ts";
import { assertActive, assertCanAdd, loadEntitlements } from "../_shared/entitlements.ts";

interface Body {
  action?: string;
  workspace_id?: string;
  email?: string;
  role?: string;
  full_name?: string;
  user_id?: string;
}

function parseName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, 80) : "";
  if (name.length < 2) throw new RuntimeError("invalid_request", "Informe um nome com pelo menos 2 letras.");
  return name;
}

const ROLES = ["owner", "admin", "agent"] as const;
type Role = (typeof ROLES)[number];

export function normalizeEmail(raw: unknown): string {
  const address = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || address.length > 254) throw new RuntimeError("invalid_request", "Informe um e-mail válido.");
  return address;
}

function parseRole(raw: unknown): Role {
  if (typeof raw === "string" && (ROLES as readonly string[]).includes(raw)) return raw as Role;
  throw new RuntimeError("invalid_request", "Papel inválido.");
}

function panelUrl(): string {
  return (optionalEnv("PANEL_URL") ?? optionalEnv("SUPABASE_PUBLIC_URL") ?? "").replace(/\/$/, "");
}

function userDb(req: Request): Db {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  return createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// A RPC devolve códigos crus como mensagem; vira erro tipado para o painel.
function rpcError(message: string): RuntimeError {
  if (message.includes("member_limit_reached")) return new RuntimeError("plan_limit_reached", "Limite de membros do plano atingido. Remova alguém ou fale com o suporte para ampliar.");
  if (message.includes("tenant_inactive")) return new RuntimeError("tenant_inactive", "Este workspace está suspenso ou com a avaliação vencida.");
  if (message.includes("only_owner_can_grant_owner")) return new RuntimeError("forbidden", "Só um proprietário pode adicionar outro proprietário.");
  if (message.includes("forbidden")) return new RuntimeError("forbidden", "Você não tem permissão para gerenciar a equipe.");
  return new RuntimeError("internal_error", "Não foi possível adicionar o membro.", { db: message });
}

Deno.serve(createHandler("team", async ({ req, correlationId }) => {
  if (req.method !== "POST") throw new RuntimeError("invalid_request", "Use POST.");
  const user = await requireUser(req);
  const body = await readJson<Body>(req);
  if (body.action !== "invite" && body.action !== "rename") throw new RuntimeError("invalid_request", "Ação desconhecida.");
  const callerRole = await requireWorkspaceRole(user.id, body.workspace_id);
  const workspaceId = body.workspace_id as string;

  // Admin define o nome de exibição de um membro da equipe (o nome é do usuário, vale em todos os workspaces dele).
  if (body.action === "rename") {
    const targetId = String(body.user_id ?? "");
    const name = parseName(body.full_name);
    const admin = adminDb();
    const { data: member } = await admin.from("workspace_members").select("user_id").eq("workspace_id", workspaceId).eq("user_id", targetId).maybeSingle();
    if (!member) throw new RuntimeError("not_found", "Esta pessoa não está na equipe.");
    const { data: target, error: loadError } = await admin.auth.admin.getUserById(targetId);
    if (loadError || !target.user) throw new RuntimeError("not_found", "Usuário não encontrado.");
    const { error } = await admin.auth.admin.updateUserById(targetId, { user_metadata: { ...(target.user.user_metadata ?? {}), full_name: name } });
    if (error) throw new RuntimeError("internal_error", "Não foi possível salvar o nome.", { reason: error.message });
    await audit(admin, { workspace_id: workspaceId, actor_user_id: user.id, action: "member.renamed", entity: "user", entity_id: targetId, details: { full_name: name }, correlation_id: correlationId });
    return json({ ok: true, full_name: name });
  }
  const address = normalizeEmail(body.email);
  const role = parseRole(body.role);
  if (role === "owner" && callerRole !== "owner") throw new RuntimeError("forbidden", "Só um proprietário pode adicionar outro proprietário.");
  const inviteName = body.full_name !== undefined && body.full_name !== "" ? parseName(body.full_name) : null;

  const db = adminDb();
  const { data: existingId, error: lookupError } = await db.rpc("platform_user_id_by_email", { p_email: address });
  if (lookupError) throw new RuntimeError("internal_error", "Falha ao procurar o usuário.", { db: lookupError.message });

  // Checa plano e status antes de mandar e-mail, para não convidar alguém que não caberia na equipe.
  const ent = await loadEntitlements(db, workspaceId);
  assertActive(ent);
  let invited = false;
  if (!existingId) {
    assertCanAdd(ent, "members");
    const { data, error } = await db.auth.admin.inviteUserByEmail(address, {
      redirectTo: `${panelUrl()}/definir-senha`,
      data: { invited_to_workspace: workspaceId, ...(inviteName ? { full_name: inviteName } : {}) },
    });
    if (error || !data.user) throw new RuntimeError("upstream_unavailable", "Não foi possível enviar o convite por e-mail.", { reason: error?.message });
    invited = true;
  }

  const { data: userId, error } = await userDb(req).rpc("add_workspace_member", { p_workspace_id: workspaceId, p_email: address, p_role: role });
  if (error) throw rpcError(error.message);
  if (invited) {
    await audit(db, { workspace_id: workspaceId, actor_user_id: user.id, action: "member.invited", entity: "user", entity_id: String(userId), details: { email: address, role }, correlation_id: correlationId });
  }
  return json({ user_id: userId, invited });
}));
