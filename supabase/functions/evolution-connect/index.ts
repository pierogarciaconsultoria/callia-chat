// Gestão de instâncias na Evolution: criar, conectar (QR), sincronizar, desconectar, excluir, padrão e token.
import { createHandler, json, readJson, RuntimeError } from "../_shared/http.ts";
import { assertActive, assertCanAdd, loadEntitlements } from "../_shared/entitlements.ts";
import { randomToken, sha256Hex } from "../_shared/crypto.ts";
import { evolutionFor } from "../_shared/channel.ts";
import { normalizePhone } from "../_shared/evolution.ts";
import { adminDb, audit, type Db, functionUrl, optionalEnv, requireUser, requireWorkspaceRole } from "../_shared/supabase.ts";

const PUBLIC_COLUMNS =
  "id, workspace_id, name, instance_name, provider, status, qr_code, qr_updated_at, phone_number, profile_name, is_default, last_connected_at, last_error, webhook_token_rotated_at, created_at, updated_at";

interface Body {
  action?: string;
  workspace_id?: string;
  instance_id?: string;
  name?: string;
  make_default?: boolean;
  /** DDD + número: conecta por código de pareamento em vez de QR. */
  phone?: string;
}

function pairingPhone(phone: unknown): string | null {
  if (phone === undefined || phone === null || phone === "") return null;
  const normalized = normalizePhone(String(phone));
  if (!normalized) throw new RuntimeError("invalid_request", "Número inválido. Use DDD + número, ex.: (48) 99999-0000.");
  return normalized;
}

function webhookUrl(instanceId: string, token: string): string {
  // A Evolution precisa alcançar esta URL; em self-host costuma ser o endereço público do Supabase.
  const base = optionalEnv("EVOLUTION_WEBHOOK_BASE_URL")?.replace(/\/$/, "") ?? functionUrl("whatsapp-webhook").replace(/\/whatsapp-webhook$/, "");
  return `${base}/whatsapp-webhook?instance=${instanceId}&token=${token}`;
}

function toDataUrl(base64: string | undefined | null): string | null {
  if (!base64) return null;
  return base64.startsWith("data:") ? base64 : `data:image/png;base64,${base64}`;
}

Deno.serve(createHandler("evolution-connect", async ({ req, correlationId }) => {
  if (req.method !== "POST") throw new RuntimeError("invalid_request", "Use POST.");
  const user = await requireUser(req);
  const body = await readJson<Body>(req);
  const db = adminDb();

  if (body.action === "create") {
    await requireWorkspaceRole(user.id, body.workspace_id);
    const name = body.name?.trim() ?? "";
    if (name.length < 2 || name.length > 60) throw new RuntimeError("invalid_request", "Nome deve ter entre 2 e 60 caracteres.");
    const workspaceId = body.workspace_id as string;
    const entitlements = await loadEntitlements(db, workspaceId);
    assertActive(entitlements);
    assertCanAdd(entitlements, "instances");
    const { count } = await db.from("whatsapp_instances").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
    const makeDefault = body.make_default === true || (count ?? 0) === 0;
    const token = randomToken(40);
    const instanceName = `callia-${workspaceId.slice(0, 8)}-${randomToken(6).toLowerCase()}`;

    if (makeDefault) await db.from("whatsapp_instances").update({ is_default: false }).eq("workspace_id", workspaceId).eq("is_default", true);
    const { data: row, error } = await db.from("whatsapp_instances").insert({
      workspace_id: workspaceId,
      name,
      instance_name: instanceName,
      webhook_token_hash: await sha256Hex(token),
      webhook_token_rotated_at: new Date().toISOString(),
      is_default: makeDefault,
      status: "connecting",
    }).select("id, provider_secret_ref").single();
    if (error) throw new RuntimeError("internal_error", "Falha ao criar instância.", { db: error.message });

    const phone = pairingPhone(body.phone);
    let pairingCode: string | null = null;
    try {
      const evo = evolutionFor(row);
      const created = await evo.createInstance(instanceName, webhookUrl(row.id, token));
      let qr = toDataUrl(created?.qrcode?.base64);
      if (phone) {
        const paired = await evo.connect(instanceName, phone);
        pairingCode = paired?.pairingCode ?? null;
        qr = toDataUrl(paired?.base64) ?? qr;
      }
      await db.from("whatsapp_instances").update({
        status: qr || pairingCode ? "qr" : "connecting",
        qr_code: qr,
        qr_updated_at: qr ? new Date().toISOString() : null,
      }).eq("id", row.id);
    } catch (err) {
      await db.from("whatsapp_instances").delete().eq("id", row.id);
      throw err;
    }
    await audit(db, { workspace_id: workspaceId, actor_user_id: user.id, action: "whatsapp.instance.created", entity: "whatsapp_instance", entity_id: row.id, details: { by: phone ? "pairing_code" : "qr" }, correlation_id: correlationId });
    const instance = await publicRow(db, row.id);
    return json({ instance, qr_code: instance?.qr_code ?? null, pairing_code: pairingCode });
  }

  // Demais ações operam sobre uma instância existente.
  if (typeof body.instance_id !== "string") throw new RuntimeError("invalid_request", "instance_id obrigatório.");
  const { data: inst } = await db
    .from("whatsapp_instances")
    .select("id, workspace_id, instance_name, provider_secret_ref, status, is_default")
    .eq("id", body.instance_id)
    .maybeSingle();
  if (!inst) throw new RuntimeError("not_found", "Instância não encontrada.");
  await requireWorkspaceRole(user.id, inst.workspace_id);
  const evo = evolutionFor(inst);
  const log = (action: string, details: Record<string, unknown> = {}) =>
    audit(db, { workspace_id: inst.workspace_id, actor_user_id: user.id, action, entity: "whatsapp_instance", entity_id: inst.id, details, correlation_id: correlationId });

  switch (body.action) {
    case "connect": {
      assertActive(await loadEntitlements(db, inst.workspace_id));
      const res = await evo.connect(inst.instance_name, pairingPhone(body.phone) ?? undefined);
      const qr = toDataUrl(res?.base64);
      const state = qr || res?.pairingCode ? "qr" : await evo.connectionState(inst.instance_name);
      await db.from("whatsapp_instances").update({ status: state, qr_code: qr, qr_updated_at: qr ? new Date().toISOString() : null })
        .eq("id", inst.id);
      await log("whatsapp.instance.connect");
      return json({ instance: await publicRow(db, inst.id), qr_code: qr, pairing_code: res?.pairingCode ?? null });
    }
    case "refresh": {
      const state = await evo.connectionState(inst.instance_name);
      const patch: Record<string, unknown> = {};
      if (state === "open") {
        const info = await evo.fetchInstance(inst.instance_name).catch(() => ({ phone: null, profileName: null }));
        Object.assign(patch, { status: "open", qr_code: null, last_error: null });
        if (inst.status !== "open") patch.last_connected_at = new Date().toISOString();
        if (info.phone) patch.phone_number = info.phone;
        if (info.profileName) patch.profile_name = info.profileName;
      } else if (!(state === "connecting" && inst.status === "qr")) {
        // Enquanto há QR na tela, "connecting" não deve apagar o QR.
        patch.status = state;
      }
      if (Object.keys(patch).length) await db.from("whatsapp_instances").update(patch).eq("id", inst.id);
      return json({ instance: await publicRow(db, inst.id) });
    }
    case "disconnect": {
      await evo.logout(inst.instance_name).catch(() => null);
      await db.from("whatsapp_instances").update({ status: "close", qr_code: null }).eq("id", inst.id);
      await log("whatsapp.instance.disconnected");
      return json({ instance: await publicRow(db, inst.id) });
    }
    case "delete": {
      await evo.logout(inst.instance_name).catch(() => null);
      await evo.deleteInstance(inst.instance_name).catch(() => null);
      await db.from("whatsapp_instances").delete().eq("id", inst.id);
      if (inst.is_default) {
        const { data: next } = await db.from("whatsapp_instances").select("id").eq("workspace_id", inst.workspace_id)
          .order("created_at").limit(1).maybeSingle();
        if (next) await db.from("whatsapp_instances").update({ is_default: true }).eq("id", next.id);
      }
      await log("whatsapp.instance.deleted", { instance_name: inst.instance_name });
      return json({ deleted: true });
    }
    case "set_default": {
      await db.from("whatsapp_instances").update({ is_default: false }).eq("workspace_id", inst.workspace_id).eq("is_default", true);
      await db.from("whatsapp_instances").update({ is_default: true }).eq("id", inst.id);
      await log("whatsapp.instance.set_default");
      return json({ instance: await publicRow(db, inst.id) });
    }
    case "rotate_token": {
      const token = randomToken(40);
      // Reconfigura a Evolution primeiro: se falhar, o token antigo continua válido.
      await evo.setWebhook(inst.instance_name, webhookUrl(inst.id, token));
      await db.from("whatsapp_instances").update({
        webhook_token_hash: await sha256Hex(token),
        webhook_token_rotated_at: new Date().toISOString(),
      }).eq("id", inst.id);
      await log("whatsapp.instance.token_rotated");
      return json({ instance: await publicRow(db, inst.id) });
    }
    default:
      throw new RuntimeError("invalid_request", "Ação desconhecida.");
  }
}));

async function publicRow(db: Db, id: string) {
  const { data } = await db.from("whatsapp_instances").select(PUBLIC_COLUMNS).eq("id", id).single();
  return data;
}
