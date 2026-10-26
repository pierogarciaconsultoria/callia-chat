// CRUD de webhooks de saída. O segredo HMAC é mostrado uma vez e guardado cifrado.
import { createHandler, json, readJson, RuntimeError } from "../_shared/http.ts";
import { encryptSecret, randomToken } from "../_shared/crypto.ts";
import { adminDb, audit, env, requireUser, requireWorkspaceRole } from "../_shared/supabase.ts";
import { deliverWebhook, emitEvent, WEBHOOK_EVENTS } from "../_shared/webhooks.ts";
import { assertPublicHttpUrl } from "../_shared/net.ts";
import { assertActive, loadEntitlements } from "../_shared/entitlements.ts";

const PUBLIC_COLUMNS = "id, workspace_id, name, url, events, active, secret_last4, max_attempts, created_by, created_at, updated_at";
const DELIVERY_COLUMNS = "id, webhook_id, event, status, attempts, last_status_code, last_error, created_at, delivered_at, next_attempt_at";

interface Body {
  action?: string;
  workspace_id?: string;
  webhook_id?: string;
  delivery_id?: string;
  name?: string;
  url?: string;
  events?: unknown;
  active?: boolean;
  max_attempts?: number;
}

function validateEvents(events: unknown): string[] {
  if (!Array.isArray(events) || events.length === 0) throw new RuntimeError("invalid_request", "Selecione ao menos um evento.");
  const invalid = events.filter((e) => !(WEBHOOK_EVENTS as readonly string[]).includes(e));
  if (invalid.length) throw new RuntimeError("invalid_request", `Eventos inválidos: ${invalid.join(", ")}.`);
  return [...new Set(events as string[])];
}

function validateAttempts(n: unknown): number | undefined {
  if (n === undefined) return undefined;
  const v = Number(n);
  if (!Number.isInteger(v) || v < 1 || v > 12) throw new RuntimeError("invalid_request", "max_attempts entre 1 e 12.");
  return v;
}

Deno.serve(createHandler("manage-webhooks", async ({ req, correlationId }) => {
  if (req.method !== "POST") throw new RuntimeError("invalid_request", "Use POST.");
  const user = await requireUser(req);
  const body = await readJson<Body>(req);
  const db = adminDb();
  const masterKey = env("CALLIA_ENCRYPTION_KEY");

  if (body.action === "create") {
    await requireWorkspaceRole(user.id, body.workspace_id);
    assertActive(await loadEntitlements(db, body.workspace_id as string));
    const name = body.name?.trim() ?? "";
    if (name.length < 2 || name.length > 80) throw new RuntimeError("invalid_request", "Nome deve ter entre 2 e 80 caracteres.");
    const secret = `whsec_${randomToken(40)}`;
    const { data, error } = await db.from("webhooks").insert({
      workspace_id: body.workspace_id,
      name,
      url: assertPublicHttpUrl(body.url),
      events: validateEvents(body.events),
      max_attempts: validateAttempts(body.max_attempts) ?? 6,
      secret_ciphertext: await encryptSecret(secret, masterKey),
      secret_last4: secret.slice(-4),
      created_by: user.id,
    }).select(PUBLIC_COLUMNS).single();
    if (error) throw new RuntimeError("internal_error", "Falha ao criar webhook.", { db: error.message });
    await audit(db, { workspace_id: data.workspace_id, actor_user_id: user.id, action: "webhook.created", entity: "webhook", entity_id: data.id, details: { url: data.url }, correlation_id: correlationId });
    return json({ webhook: data, secret });
  }

  if (body.action === "retry") {
    if (typeof body.delivery_id !== "string") throw new RuntimeError("invalid_request", "delivery_id obrigatório.");
    const { data: delivery } = await db.from("webhook_deliveries").select("id, workspace_id, status").eq("id", body.delivery_id).maybeSingle();
    if (!delivery) throw new RuntimeError("not_found", "Entrega não encontrada.");
    await requireWorkspaceRole(user.id, delivery.workspace_id);
    if (delivery.status === "success") throw new RuntimeError("conflict", "Entrega já concluída.");
    // Retentativa manual: uma tentativa agora; se falhar de novo, segue o limite configurado.
    await db.from("webhook_deliveries").update({ status: "retrying" }).eq("id", delivery.id);
    return json({ delivery: await deliverWebhook(db, delivery.id, masterKey) });
  }

  if (typeof body.webhook_id !== "string") throw new RuntimeError("invalid_request", "webhook_id obrigatório.");
  const { data: hook } = await db.from("webhooks").select(PUBLIC_COLUMNS).eq("id", body.webhook_id).maybeSingle();
  if (!hook) throw new RuntimeError("not_found", "Webhook não encontrado.");
  await requireWorkspaceRole(user.id, hook.workspace_id);
  const log = (action: string, details: Record<string, unknown> = {}) =>
    audit(db, { workspace_id: hook.workspace_id, actor_user_id: user.id, action, entity: "webhook", entity_id: hook.id, details, correlation_id: correlationId });

  switch (body.action) {
    case "update": {
      const patch: Record<string, unknown> = {};
      if (body.name !== undefined) {
        const name = String(body.name).trim();
        if (name.length < 2 || name.length > 80) throw new RuntimeError("invalid_request", "Nome deve ter entre 2 e 80 caracteres.");
        patch.name = name;
      }
      if (body.url !== undefined) patch.url = assertPublicHttpUrl(body.url);
      if (body.events !== undefined) patch.events = validateEvents(body.events);
      if (body.active !== undefined) patch.active = Boolean(body.active);
      const attempts = validateAttempts(body.max_attempts);
      if (attempts !== undefined) patch.max_attempts = attempts;
      const { data } = await db.from("webhooks").update(patch).eq("id", hook.id).select(PUBLIC_COLUMNS).single();
      await log("webhook.updated", { fields: Object.keys(patch) });
      return json({ webhook: data });
    }
    case "rotate_secret": {
      const secret = `whsec_${randomToken(40)}`;
      const { data } = await db.from("webhooks").update({
        secret_ciphertext: await encryptSecret(secret, masterKey),
        secret_last4: secret.slice(-4),
      }).eq("id", hook.id).select(PUBLIC_COLUMNS).single();
      await log("webhook.secret_rotated");
      return json({ webhook: data, secret });
    }
    case "delete": {
      await db.from("webhooks").delete().eq("id", hook.id);
      await log("webhook.deleted", { url: hook.url });
      return json({ deleted: true });
    }
    case "test": {
      if (!hook.active) throw new RuntimeError("conflict", "Ative o webhook antes de testar.");
      const [deliveryId] = await emitEvent(db, {
        workspaceId: hook.workspace_id,
        event: "webhook.test",
        onlyWebhookId: hook.id,
        correlationId,
        masterKey,
        data: { message: "Entrega de teste do Callia Chat.", webhook_id: hook.id },
      });
      const { data: delivery } = await db.from("webhook_deliveries").select(DELIVERY_COLUMNS).eq("id", deliveryId).maybeSingle();
      return json({ delivery });
    }
    default:
      throw new RuntimeError("invalid_request", "Ação desconhecida.");
  }
}));
