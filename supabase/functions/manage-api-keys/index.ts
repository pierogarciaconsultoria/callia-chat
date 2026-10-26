// CRUD de API keys. A chave bruta só existe na resposta de create/rotate; o banco guarda hash, prefixo e last4.
import { createHandler, json, readJson, RuntimeError } from "../_shared/http.ts";
import { generateApiKey } from "../_shared/crypto.ts";
import { adminDb, audit, type Db, optionalEnv, requireUser, requireWorkspaceRole } from "../_shared/supabase.ts";
import { assertActive, loadEntitlements } from "../_shared/entitlements.ts";

const PUBLIC_COLUMNS = "id, workspace_id, name, prefix, last4, scopes, created_by, created_at, last_used_at, expires_at, revoked_at";

async function insertKey(db: Db, workspaceId: string, name: string, expiresAt: string | null, userId: string) {
  const key = await generateApiKey(optionalEnv("API_KEY_PEPPER") ?? "");
  const { data, error } = await db.from("api_keys").insert({
    workspace_id: workspaceId,
    name,
    prefix: key.prefix,
    key_hash: key.hash,
    last4: key.last4,
    expires_at: expiresAt,
    created_by: userId,
  }).select(PUBLIC_COLUMNS).single();
  if (error) throw new RuntimeError("internal_error", "Falha ao criar chave.", { db: error.message });
  return { api_key: data, raw_key: key.raw };
}

Deno.serve(createHandler("manage-api-keys", async ({ req, correlationId }) => {
  if (req.method !== "POST") throw new RuntimeError("invalid_request", "Use POST.");
  const user = await requireUser(req);
  const body = await readJson<{ action?: string; workspace_id?: string; key_id?: string; name?: string; expires_at?: string | null }>(req);
  const db = adminDb();

  if (body.action === "create") {
    await requireWorkspaceRole(user.id, body.workspace_id);
    assertActive(await loadEntitlements(db, body.workspace_id as string));
    const name = body.name?.trim() ?? "";
    if (name.length < 2 || name.length > 80) throw new RuntimeError("invalid_request", "Nome deve ter entre 2 e 80 caracteres.");
    let expiresAt: string | null = null;
    if (body.expires_at) {
      const d = new Date(body.expires_at);
      if (Number.isNaN(d.getTime()) || d <= new Date()) throw new RuntimeError("invalid_request", "expires_at deve ser uma data futura.");
      expiresAt = d.toISOString();
    }
    const result = await insertKey(db, body.workspace_id as string, name, expiresAt, user.id);
    await audit(db, { workspace_id: body.workspace_id as string, actor_user_id: user.id, action: "api_key.created", entity: "api_key", entity_id: result.api_key.id, details: { name, prefix: result.api_key.prefix }, correlation_id: correlationId });
    return json(result);
  }

  if (typeof body.key_id !== "string") throw new RuntimeError("invalid_request", "key_id obrigatório.");
  const { data: existing } = await db.from("api_keys").select(PUBLIC_COLUMNS).eq("id", body.key_id).maybeSingle();
  if (!existing) throw new RuntimeError("not_found", "Chave não encontrada.");
  await requireWorkspaceRole(user.id, existing.workspace_id);

  if (body.action === "revoke") {
    const { data } = await db.from("api_keys").update({ revoked_at: existing.revoked_at ?? new Date().toISOString() })
      .eq("id", existing.id).select(PUBLIC_COLUMNS).single();
    await audit(db, { workspace_id: existing.workspace_id, actor_user_id: user.id, action: "api_key.revoked", entity: "api_key", entity_id: existing.id, correlation_id: correlationId });
    return json({ api_key: data });
  }

  if (body.action === "rotate") {
    assertActive(await loadEntitlements(db, existing.workspace_id));
    if (existing.revoked_at) throw new RuntimeError("conflict", "Chave já revogada; crie uma nova.");
    const result = await insertKey(db, existing.workspace_id, existing.name, existing.expires_at, user.id);
    await db.from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", existing.id);
    await audit(db, { workspace_id: existing.workspace_id, actor_user_id: user.id, action: "api_key.rotated", entity: "api_key", entity_id: existing.id, details: { new_key_id: result.api_key.id }, correlation_id: correlationId });
    return json(result);
  }

  throw new RuntimeError("invalid_request", "Ação desconhecida.");
}));
