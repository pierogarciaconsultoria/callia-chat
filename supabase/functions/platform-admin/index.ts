// Console central da plataforma: tenants, planos, usuários, auditoria e configurações.
// Só para user_roles.role = 'platform_admin'. Toda alteração fica em audit_logs com ação "platform.*".
import { createHandler, json, readJson, RuntimeError } from "../_shared/http.ts";
import { adminDb, audit, type Db, optionalEnv, requireUser } from "../_shared/supabase.ts";
import { effectiveLimits } from "../_shared/entitlements.ts";

type Body = Record<string, unknown> & { action?: string };

const TENANT_STATUSES = ["trial", "active", "suspended", "canceled"] as const;
const NUMERIC_LIMITS = ["max_instances", "max_members", "max_monthly_messages", "max_knowledge_sources"] as const;
const FEATURE_FLAGS = ["ai_enabled", "external_agent_enabled", "connectors_enabled"] as const;
const SETTINGS_KEYS = ["allow_self_service_workspaces", "self_service_plan_code", "trial_days", "platform_name", "support_email"] as const;

interface PlanRow {
  id: string;
  code: string;
  name: string;
  max_instances: number | null;
  max_members: number | null;
  max_monthly_messages: number | null;
  max_knowledge_sources: number | null;
  ai_enabled: boolean;
  external_agent_enabled: boolean;
  connectors_enabled: boolean;
  [k: string]: unknown;
}

interface TenantRow {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  plan_id: string | null;
  trial_ends_at: string | null;
  limit_overrides: Record<string, unknown>;
  instances_open: number;
  usage: Record<string, number>;
  [k: string]: unknown;
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) throw new RuntimeError("invalid_request", `${field} inválido.`);
  return value;
}

function text(value: unknown, field: string, min = 1, max = 200): string {
  const v = typeof value === "string" ? value.trim() : "";
  if (v.length < min || v.length > max) throw new RuntimeError("invalid_request", `${field} deve ter entre ${min} e ${max} caracteres.`);
  return v;
}

function email(value: unknown): string {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new RuntimeError("invalid_request", "E-mail inválido.");
  return v;
}

function optionalLimit(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 10_000_000) throw new RuntimeError("invalid_request", `${field} deve ser inteiro ≥ 0 ou vazio (ilimitado).`);
  return n;
}

function validateOverrides(value: unknown): Record<string, number | boolean | null> {
  if (value === null || value === undefined) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new RuntimeError("invalid_request", "limit_overrides deve ser um objeto.");
  const out: Record<string, number | boolean | null> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if ((NUMERIC_LIMITS as readonly string[]).includes(k)) out[k] = optionalLimit(v, k);
    else if ((FEATURE_FLAGS as readonly string[]).includes(k)) {
      if (typeof v !== "boolean") throw new RuntimeError("invalid_request", `${k} deve ser true ou false.`);
      out[k] = v;
    } else throw new RuntimeError("invalid_request", `Limite desconhecido: ${k}.`);
  }
  return out;
}

async function requirePlatformAdmin(db: Db, userId: string) {
  const { data } = await db.from("user_roles").select("role").eq("user_id", userId).eq("role", "platform_admin").maybeSingle();
  if (!data) throw new RuntimeError("forbidden", "Acesso restrito à administração da plataforma.");
}

async function listTenants(db: Db): Promise<TenantRow[]> {
  const { data, error } = await db.rpc("platform_list_tenants");
  if (error) throw new RuntimeError("internal_error", "Falha ao listar clientes.", { db: error.message });
  return data ?? [];
}

async function listPlans(db: Db): Promise<PlanRow[]> {
  const { data } = await db.from("plans").select("*").order("position").order("name");
  return data ?? [];
}

async function tenantById(db: Db, id: string): Promise<TenantRow> {
  const tenant = (await listTenants(db)).find((t) => t.id === id);
  if (!tenant) throw new RuntimeError("not_found", "Cliente não encontrado.");
  return tenant;
}

async function readSettings(db: Db) {
  const { data } = await db.from("platform_settings").select("key, value");
  const map = Object.fromEntries((data ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value]));
  return {
    allow_self_service_workspaces: map.allow_self_service_workspaces === true,
    self_service_plan_code: (map.self_service_plan_code as string) ?? "trial",
    trial_days: Number(map.trial_days ?? 14),
    platform_name: (map.platform_name as string) ?? "Callia Chat",
    support_email: (map.support_email as string | null) ?? null,
  };
}

function panelUrl(): string {
  return (optionalEnv("PANEL_URL") ?? optionalEnv("SUPABASE_PUBLIC_URL") ?? "").replace(/\/$/, "");
}

async function inviteUser(db: Db, address: string): Promise<string> {
  const { data, error } = await db.auth.admin.inviteUserByEmail(address, { redirectTo: `${panelUrl()}/definir-senha` });
  if (error || !data.user) throw new RuntimeError("upstream_unavailable", "Não foi possível enviar o convite.", { reason: error?.message });
  return data.user.id;
}

Deno.serve(createHandler("platform-admin", async ({ req, correlationId }) => {
  if (req.method !== "POST") throw new RuntimeError("invalid_request", "Use POST.");
  const user = await requireUser(req);
  const db = adminDb();
  await requirePlatformAdmin(db, user.id);
  const body = await readJson<Body>(req);
  const log = (action: string, workspaceId: string | null, details: Record<string, unknown> = {}, entity?: string, entityId?: string) =>
    audit(db, { workspace_id: workspaceId, actor_user_id: user.id, action: `platform.${action}`, entity, entity_id: entityId, details, correlation_id: correlationId });

  switch (body.action) {
    case "overview": {
      const [tenants, plans, { data: users }] = await Promise.all([listTenants(db), listPlans(db), db.rpc("platform_list_users", { p_search: null })]);
      const planById = new Map(plans.map((p) => [p.id, p]));
      const totals = {
        tenants: tenants.length, active: 0, trial: 0, suspended: 0, canceled: 0, trial_expired: 0,
        users: users?.length ?? 0, instances_open: 0, monthly_messages: 0, monthly_ai_runs: 0, monthly_ai_tokens: 0,
      };
      const attention: Array<{ workspace_id: string; workspace_name: string; kind: string; detail: string }> = [];
      const soon = Date.now() + 3 * 86_400_000;
      for (const t of tenants) {
        (totals as Record<string, number>)[t.effective_status] = ((totals as Record<string, number>)[t.effective_status] ?? 0) + 1;
        totals.instances_open += t.instances_open ?? 0;
        totals.monthly_messages += Number(t.usage?.monthly_messages ?? 0);
        totals.monthly_ai_runs += Number(t.usage?.monthly_ai_runs ?? 0);
        totals.monthly_ai_tokens += Number(t.usage?.monthly_ai_tokens ?? 0);
        const add = (kind: string, detail: string) => attention.push({ workspace_id: t.id, workspace_name: t.name, kind, detail });
        if (t.effective_status === "trial_expired") add("trial_expired", "Avaliação terminou.");
        else if (t.status === "trial" && t.trial_ends_at && Date.parse(t.trial_ends_at) < soon) {
          add("trial_ending", `Avaliação termina em ${new Date(t.trial_ends_at).toLocaleDateString("pt-BR")}.`);
        }
        const limits = effectiveLimits(t.plan_id ? planById.get(t.plan_id) : undefined, t.limit_overrides);
        const quota = limits.max_monthly_messages as number | null;
        const used = Number(t.usage?.monthly_messages ?? 0);
        if (quota !== null && quota > 0) {
          if (used >= quota) add("quota_exceeded", `Cota mensal esgotada (${used}/${quota}).`);
          else if (used >= quota * 0.8) add("quota_near", `Cota mensal em ${Math.round((used / quota) * 100)}% (${used}/${quota}).`);
        }
      }
      const since = new Date(Date.now() - 86_400_000).toISOString();
      const [{ data: down }, { data: failedRuns }, { data: failedHooks }] = await Promise.all([
        db.from("whatsapp_instances").select("workspace_id, name, status").neq("status", "open").not("last_connected_at", "is", null),
        db.from("agent_runs").select("workspace_id").eq("status", "failed").gte("created_at", since),
        db.from("webhook_deliveries").select("workspace_id").eq("status", "failed").gte("created_at", since),
      ]);
      const nameOf = new Map(tenants.map((t) => [t.id, t.name]));
      for (const i of down ?? []) {
        attention.push({ workspace_id: i.workspace_id, workspace_name: nameOf.get(i.workspace_id) ?? "", kind: "instance_down", detail: `Instância "${i.name}" desconectada (${i.status}).` });
      }
      const countBy = (rows: Array<{ workspace_id: string }> | null) =>
        (rows ?? []).reduce((m, r) => m.set(r.workspace_id, (m.get(r.workspace_id) ?? 0) + 1), new Map<string, number>());
      for (const [ws, n] of countBy(failedRuns)) {
        if (n >= 3) attention.push({ workspace_id: ws, workspace_name: nameOf.get(ws) ?? "", kind: "agent_failures", detail: `${n} falhas do agente nas últimas 24 h.` });
      }
      for (const [ws, n] of countBy(failedHooks)) {
        attention.push({ workspace_id: ws, workspace_name: nameOf.get(ws) ?? "", kind: "webhook_failures", detail: `${n} webhook(s) sem entrega nas últimas 24 h.` });
      }
      return json({ totals, attention });
    }

    case "list_tenants":
      return json({ tenants: await listTenants(db) });

    case "get_tenant": {
      const id = uuid(body.workspace_id, "workspace_id");
      const tenant = await tenantById(db, id);
      const [{ data: entitlements }, { data: memberRows }, { data: instances }, apiKeys, webhooks, conversations, { data: auditRows }] = await Promise.all([
        db.rpc("get_workspace_entitlements", { p_workspace_id: id }),
        db.from("workspace_members").select("user_id, role, is_support, created_at").eq("workspace_id", id).order("created_at"),
        db.from("whatsapp_instances").select("id, name, status, phone_number, is_default, last_connected_at").eq("workspace_id", id).order("created_at"),
        db.from("api_keys").select("id", { count: "exact", head: true }).eq("workspace_id", id).is("revoked_at", null),
        db.from("webhooks").select("id", { count: "exact", head: true }).eq("workspace_id", id),
        db.from("conversations").select("id", { count: "exact", head: true }).eq("workspace_id", id),
        db.rpc("platform_audit", { p_workspace_id: id, p_action_prefix: null, p_limit: 50 }),
      ]);
      const { data: users } = await db.rpc("platform_list_users", { p_search: null });
      const emailOf = new Map((users ?? []).map((u: { id: string; email: string }) => [u.id, u.email]));
      return json({
        tenant,
        entitlements,
        members: (memberRows ?? []).map((m: { user_id: string }) => ({ ...m, email: emailOf.get(m.user_id) ?? null })),
        instances: instances ?? [],
        counts: { api_keys: apiKeys.count ?? 0, webhooks: webhooks.count ?? 0, conversations: conversations.count ?? 0 },
        audit: auditRows ?? [],
      });
    }

    case "create_tenant": {
      const name = text(body.name, "Nome", 2, 120);
      const ownerEmail = email(body.owner_email);
      const status = body.status === "trial" ? "trial" : body.status === "active" || body.status === undefined ? "active" : null;
      if (!status) throw new RuntimeError("invalid_request", "status inicial deve ser trial ou active.");
      let planId: string | null = null;
      if (body.plan_id) {
        planId = uuid(body.plan_id, "plan_id");
        const { data: plan } = await db.from("plans").select("id, active").eq("id", planId).maybeSingle();
        if (!plan?.active) throw new RuntimeError("invalid_request", "Plano inexistente ou inativo.");
      }
      const settings = await readSettings(db);
      const trialDays = body.trial_days === undefined ? settings.trial_days : Number(body.trial_days);
      if (status === "trial" && (!Number.isInteger(trialDays) || trialDays < 1 || trialDays > 365)) {
        throw new RuntimeError("invalid_request", "trial_days entre 1 e 365.");
      }
      const { data: existingId } = await db.rpc("platform_user_id_by_email", { p_email: ownerEmail });
      const ownerInvited = !existingId;
      const ownerId: string = existingId ?? await inviteUser(db, ownerEmail);
      const { data: workspaceId, error } = await db.rpc("provision_workspace", {
        p_name: name,
        p_owner: ownerId,
        p_plan_id: planId,
        p_status: status,
        p_trial_ends_at: status === "trial" ? new Date(Date.now() + trialDays * 86_400_000).toISOString() : null,
        p_actor: user.id,
      });
      if (error) throw new RuntimeError("internal_error", "Falha ao criar cliente.", { db: error.message });
      await log("tenant.created", workspaceId, { name, owner_email: ownerEmail, owner_invited: ownerInvited, plan_id: planId, status }, "workspace", workspaceId);
      return json({ workspace_id: workspaceId, owner_invited: ownerInvited });
    }

    case "update_tenant": {
      const id = uuid(body.workspace_id, "workspace_id");
      await tenantById(db, id);
      const patch: Record<string, unknown> = {};
      if (body.name !== undefined) patch.name = text(body.name, "Nome", 2, 120);
      if (body.plan_id !== undefined) {
        if (body.plan_id === null) patch.plan_id = null;
        else {
          const { data: plan } = await db.from("plans").select("id").eq("id", uuid(body.plan_id, "plan_id")).maybeSingle();
          if (!plan) throw new RuntimeError("invalid_request", "Plano inexistente.");
          patch.plan_id = plan.id;
        }
      }
      if (body.limit_overrides !== undefined) patch.limit_overrides = validateOverrides(body.limit_overrides);
      if (body.notes !== undefined) patch.notes = body.notes === null ? null : String(body.notes).slice(0, 4000);
      if (body.trial_ends_at !== undefined) {
        if (body.trial_ends_at === null) patch.trial_ends_at = null;
        else {
          const d = new Date(String(body.trial_ends_at));
          if (Number.isNaN(d.getTime())) throw new RuntimeError("invalid_request", "trial_ends_at inválido.");
          patch.trial_ends_at = d.toISOString();
        }
      }
      if (!Object.keys(patch).length) throw new RuntimeError("invalid_request", "Nada para alterar.");
      const { error } = await db.from("workspaces").update(patch).eq("id", id);
      if (error) throw new RuntimeError("internal_error", "Falha ao atualizar cliente.", { db: error.message });
      await log("tenant.updated", id, { fields: Object.keys(patch), ...patch }, "workspace", id);
      return json({ tenant: await tenantById(db, id) });
    }

    case "set_status": {
      const id = uuid(body.workspace_id, "workspace_id");
      const before = await tenantById(db, id);
      const status = String(body.status ?? "");
      if (!(TENANT_STATUSES as readonly string[]).includes(status)) throw new RuntimeError("invalid_request", "Status inválido.");
      const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
      if ((status === "suspended" || status === "canceled") && !reason) throw new RuntimeError("invalid_request", "Informe o motivo.");
      const patch: Record<string, unknown> = { status };
      if (status === "suspended" || status === "canceled") Object.assign(patch, { suspended_at: new Date().toISOString(), suspended_reason: reason });
      else Object.assign(patch, { suspended_at: null, suspended_reason: null });
      if (status === "active") patch.trial_ends_at = null;
      if (status === "trial" && !before.trial_ends_at) {
        const settings = await readSettings(db);
        patch.trial_ends_at = new Date(Date.now() + settings.trial_days * 86_400_000).toISOString();
      }
      await db.from("workspaces").update(patch).eq("id", id);
      await log("tenant.status_changed", id, { from: before.status, to: status, reason: reason || null }, "workspace", id);
      return json({ tenant: await tenantById(db, id) });
    }

    case "support_access": {
      const id = uuid(body.workspace_id, "workspace_id");
      await tenantById(db, id);
      const { data: membership } = await db.from("workspace_members").select("role, is_support").eq("workspace_id", id).eq("user_id", user.id).maybeSingle();
      if (body.enable === true) {
        if (membership && !membership.is_support) throw new RuntimeError("conflict", "Você já é membro deste workspace.");
        if (!membership) await db.from("workspace_members").insert({ workspace_id: id, user_id: user.id, role: "admin", is_support: true });
        await log("support.access_granted", id, {}, "workspace", id);
      } else {
        if (membership?.is_support) await db.from("workspace_members").delete().eq("workspace_id", id).eq("user_id", user.id).eq("is_support", true);
        await log("support.access_revoked", id, {}, "workspace", id);
      }
      return json({ ok: true });
    }

    case "list_plans":
      return json({ plans: await listPlans(db) });

    case "upsert_plan": {
      const p = (body.plan ?? {}) as Record<string, unknown>;
      const row: Record<string, unknown> = {
        code: text(p.code, "Código", 2, 40).toLowerCase(),
        name: text(p.name, "Nome", 2, 80),
        description: typeof p.description === "string" ? p.description.slice(0, 500) : null,
        price_cents: optionalLimit(p.price_cents, "price_cents"),
        currency: typeof p.currency === "string" && /^[A-Z]{3}$/.test(p.currency) ? p.currency : "BRL",
        max_instances: optionalLimit(p.max_instances, "max_instances"),
        max_members: optionalLimit(p.max_members, "max_members"),
        max_monthly_messages: optionalLimit(p.max_monthly_messages, "max_monthly_messages"),
        max_knowledge_sources: optionalLimit(p.max_knowledge_sources, "max_knowledge_sources"),
        ai_enabled: p.ai_enabled !== false,
        external_agent_enabled: p.external_agent_enabled !== false,
        connectors_enabled: p.connectors_enabled !== false,
        active: p.active !== false,
        position: Number.isInteger(p.position) ? p.position : 0,
      };
      if (!/^[a-z0-9_-]{2,40}$/.test(row.code as string)) throw new RuntimeError("invalid_request", "Código: letras minúsculas, números, - ou _.");
      if (row.max_members === 0) throw new RuntimeError("invalid_request", "max_members deve ser ≥ 1.");
      const query = p.id ? db.from("plans").update(row).eq("id", uuid(p.id, "id")) : db.from("plans").insert(row);
      const { data, error } = await query.select("*").single();
      if (error?.code === "23505") throw new RuntimeError("conflict", "Já existe um plano com esse código.");
      if (error) throw new RuntimeError("internal_error", "Falha ao salvar plano.", { db: error.message });
      await log(p.id ? "plan.updated" : "plan.created", null, row, "plan", data.id);
      return json({ plan: data });
    }

    case "list_users": {
      const search = typeof body.search === "string" ? body.search.trim().slice(0, 100) : null;
      const { data, error } = await db.rpc("platform_list_users", { p_search: search || null });
      if (error) throw new RuntimeError("internal_error", "Falha ao listar usuários.", { db: error.message });
      return json({ users: data ?? [] });
    }

    case "invite_user": {
      const address = email(body.email);
      const { data: existingId } = await db.rpc("platform_user_id_by_email", { p_email: address });
      if (existingId) throw new RuntimeError("conflict", "Já existe um usuário com esse e-mail.");
      const userId = await inviteUser(db, address);
      await log("user.invited", null, { email: address }, "user", userId);
      return json({ user_id: userId });
    }

    case "set_platform_admin": {
      const target = uuid(body.user_id, "user_id");
      if (body.enabled === true) {
        await db.from("user_roles").upsert({ user_id: target, role: "platform_admin" }, { onConflict: "user_id,role", ignoreDuplicates: true });
      } else {
        const { count } = await db.from("user_roles").select("user_id", { count: "exact", head: true }).eq("role", "platform_admin");
        if ((count ?? 0) <= 1) throw new RuntimeError("conflict", "A plataforma precisa de pelo menos um administrador.");
        await db.from("user_roles").delete().eq("user_id", target).eq("role", "platform_admin");
      }
      await log(body.enabled === true ? "user.platform_admin_granted" : "user.platform_admin_revoked", null, {}, "user", target);
      return json({ ok: true });
    }

    case "set_user_blocked": {
      const target = uuid(body.user_id, "user_id");
      if (target === user.id) throw new RuntimeError("conflict", "Você não pode bloquear a si mesmo.");
      const blocked = body.blocked === true;
      const { error } = await db.auth.admin.updateUserById(target, { ban_duration: blocked ? "876000h" : "none" });
      if (error) throw new RuntimeError("upstream_unavailable", "Falha ao atualizar o usuário.", { reason: error.message });
      await log(blocked ? "user.blocked" : "user.unblocked", null, {}, "user", target);
      return json({ ok: true });
    }

    case "audit": {
      const { data, error } = await db.rpc("platform_audit", {
        p_workspace_id: body.workspace_id ? uuid(body.workspace_id, "workspace_id") : null,
        p_action_prefix: typeof body.action_prefix === "string" ? body.action_prefix.slice(0, 80) : null,
        p_limit: Math.min(Math.max(1, Number(body.limit) || 100), 500),
      });
      if (error) throw new RuntimeError("internal_error", "Falha ao ler auditoria.", { db: error.message });
      return json({ entries: data ?? [] });
    }

    case "get_settings":
      return json({ settings: await readSettings(db) });

    case "update_settings": {
      const input = (body.settings ?? {}) as Record<string, unknown>;
      const updates: Array<{ key: string; value: unknown }> = [];
      for (const key of Object.keys(input)) {
        if (!(SETTINGS_KEYS as readonly string[]).includes(key)) throw new RuntimeError("invalid_request", `Configuração desconhecida: ${key}.`);
      }
      if (input.allow_self_service_workspaces !== undefined) updates.push({ key: "allow_self_service_workspaces", value: input.allow_self_service_workspaces === true });
      if (input.self_service_plan_code !== undefined) {
        const code = String(input.self_service_plan_code);
        const { data: plan } = await db.from("plans").select("id").eq("code", code).eq("active", true).maybeSingle();
        if (!plan) throw new RuntimeError("invalid_request", "Plano de autoatendimento inexistente ou inativo.");
        updates.push({ key: "self_service_plan_code", value: code });
      }
      if (input.trial_days !== undefined) {
        const days = Number(input.trial_days);
        if (!Number.isInteger(days) || days < 1 || days > 365) throw new RuntimeError("invalid_request", "trial_days entre 1 e 365.");
        updates.push({ key: "trial_days", value: days });
      }
      if (input.platform_name !== undefined) updates.push({ key: "platform_name", value: text(input.platform_name, "Nome da plataforma", 2, 80) });
      if (input.support_email !== undefined) updates.push({ key: "support_email", value: input.support_email ? email(input.support_email) : null });
      for (const u of updates) {
        await db.from("platform_settings").upsert({ key: u.key, value: u.value, updated_at: new Date().toISOString(), updated_by: user.id });
      }
      await log("settings.updated", null, Object.fromEntries(updates.map((u) => [u.key, u.value])));
      return json({ settings: await readSettings(db) });
    }

    default:
      throw new RuntimeError("invalid_request", "Ação desconhecida.");
  }
}));
