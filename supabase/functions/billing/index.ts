// Assinatura do plano pelo Mercado Pago (dono do workspace): status, checkout, sincronização e cancelamento.
// O status do tenant muda só pela RPC apply_subscription_status, a partir do que o Mercado Pago devolve.
import { createHandler, json, readJson, RuntimeError } from "../_shared/http.ts";
import { adminDb, audit, type Db, optionalEnv, requireUser, requireWorkspaceRole } from "../_shared/supabase.ts";
import { MercadoPagoClient, normalizeStatus, type MpPreapproval } from "../_shared/mercadopago.ts";
import { getPlatformSecret } from "../_shared/platform-secrets.ts";

const PUBLIC_SITE_URL = (optionalEnv("PUBLIC_SITE_URL") ?? "https://callia.sistemalexis.com.br").replace(/\/$/, "");

interface PlanRow { id: string; code: string; name: string; price_cents: number | null; currency: string; mp_preapproval_plan_id: string | null; active: boolean }
interface SubscriptionRow {
  id: string; provider_subscription_id: string; plan_id: string | null; status: string; payer_email: string | null; init_point: string | null;
  next_payment_at: string | null; last_payment_at: string | null; last_event_at: string | null; created_at: string;
}

async function client(db: Db): Promise<MercadoPagoClient> {
  const token = await getPlatformSecret(db, "mercadopago_access_token");
  if (!token) throw new RuntimeError("unprocessable", "Cobrança ainda não configurada nesta plataforma.");
  return new MercadoPagoClient(token, { baseUrl: optionalEnv("MERCADOPAGO_BASE_URL") });
}

async function plans(db: Db): Promise<PlanRow[]> {
  const { data } = await db.from("plans").select("id, code, name, price_cents, currency, mp_preapproval_plan_id, active").eq("active", true).order("position");
  return (data ?? []) as PlanRow[];
}

async function latestSubscription(db: Db, workspaceId: string): Promise<SubscriptionRow | null> {
  const { data } = await db.from("workspace_subscriptions")
    .select("id, provider_subscription_id, plan_id, status, payer_email, init_point, next_payment_at, last_payment_at, last_event_at, created_at")
    .eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data as SubscriptionRow | null) ?? null;
}

async function applyFromMp(db: Db, workspaceId: string, planId: string | null, sub: MpPreapproval, lastPaymentAt: string | null = null) {
  const status = normalizeStatus(sub.status);
  if (!status) throw new RuntimeError("upstream_unavailable", `Status inesperado da assinatura: ${sub.status}`);
  const { data, error } = await db.rpc("apply_subscription_status", {
    p_workspace_id: workspaceId,
    p_provider_subscription_id: sub.id,
    p_plan_id: planId,
    p_status: status,
    p_payer_email: sub.payer_email ?? null,
    p_init_point: sub.init_point ?? null,
    p_next_payment_at: sub.next_payment_date ?? null,
    p_last_payment_at: lastPaymentAt,
    p_raw: { preapproval: sub },
  });
  if (error) throw new RuntimeError("internal_error", "Falha ao registrar a assinatura.", { db: error.message });
  return { status, result: data as Record<string, unknown> };
}

Deno.serve(createHandler("billing", async ({ req, correlationId }) => {
  if (req.method !== "POST") throw new RuntimeError("invalid_request", "Use POST.");
  const user = await requireUser(req);
  const body = await readJson(req);
  const workspaceId = String(body.workspace_id ?? "");
  await requireWorkspaceRole(user.id, workspaceId, ["owner"]);
  const db = adminDb();
  const action = String(body.action ?? "status");

  switch (action) {
    case "status": {
      const configured = Boolean(await getPlatformSecret(db, "mercadopago_access_token"));
      const list = await plans(db);
      return json({
        configured,
        subscription: await latestSubscription(db, workspaceId),
        plans: list.filter((p) => p.code !== "trial").map((p) => ({
          id: p.id, code: p.code, name: p.name, price_cents: p.price_cents, currency: p.currency,
          subscribable: configured && Boolean(p.mp_preapproval_plan_id) && p.price_cents !== null,
        })),
      });
    }

    case "checkout": {
      const code = String(body.plan_code ?? "");
      const plan = (await plans(db)).find((p) => p.code === code);
      if (!plan || plan.price_cents === null) throw new RuntimeError("invalid_request", "Plano inválido para assinatura.");
      if (!plan.mp_preapproval_plan_id) throw new RuntimeError("unprocessable", "Este plano ainda não tem assinatura configurada no Mercado Pago.");
      if (!user.email) throw new RuntimeError("invalid_request", "Sua conta precisa de um e-mail para assinar.");
      const current = await latestSubscription(db, workspaceId);
      if (current?.status === "authorized") throw new RuntimeError("conflict", "Este workspace já tem uma assinatura ativa. Cancele-a antes de trocar de plano.");
      const mp = await client(db);
      const sub = await mp.createPreapproval({
        preapproval_plan_id: plan.mp_preapproval_plan_id,
        reason: `Callia Chat — ${plan.name}`,
        external_reference: workspaceId,
        payer_email: user.email,
        back_url: `${PUBLIC_SITE_URL}/settings?assinatura=ok`,
      }, `${workspaceId}:${plan.code}:${Date.now()}`);
      await applyFromMp(db, workspaceId, plan.id, sub);
      await audit(db, { workspace_id: workspaceId, action: "billing.checkout_started", actor_user_id: user.id, entity: "subscription", entity_id: sub.id, details: { plan: plan.code }, correlation_id: correlationId });
      if (!sub.init_point) throw new RuntimeError("upstream_unavailable", "Mercado Pago não devolveu o endereço de pagamento.");
      return json({ init_point: sub.init_point, subscription_id: sub.id });
    }

    case "sync": {
      const current = await latestSubscription(db, workspaceId);
      if (!current) return json({ subscription: null });
      const sub = await (await client(db)).getPreapproval(current.provider_subscription_id);
      const { status } = await applyFromMp(db, workspaceId, current.plan_id, sub);
      if (status !== current.status) {
        await audit(db, { workspace_id: workspaceId, action: `billing.subscription_${status}`, actor_user_id: user.id, actor_type: "system", entity: "subscription", entity_id: sub.id, details: { via: "sync" }, correlation_id: correlationId });
      }
      return json({ subscription: await latestSubscription(db, workspaceId) });
    }

    case "cancel": {
      const current = await latestSubscription(db, workspaceId);
      if (!current || current.status === "cancelled") throw new RuntimeError("invalid_request", "Não há assinatura para cancelar.");
      const sub = await (await client(db)).cancelPreapproval(current.provider_subscription_id);
      await applyFromMp(db, workspaceId, current.plan_id, { ...sub, status: "cancelled" });
      await audit(db, { workspace_id: workspaceId, action: "billing.subscription_cancelled", actor_user_id: user.id, entity: "subscription", entity_id: current.provider_subscription_id, details: { via: "owner" }, correlation_id: correlationId });
      return json({ subscription: await latestSubscription(db, workspaceId) });
    }

    default:
      throw new RuntimeError("invalid_request", `Ação desconhecida: ${action}`);
  }
}));
