// Notificações do Mercado Pago (assinaturas e pagamentos recorrentes). Pública (verify_jwt = false):
// a autenticidade vem da x-signature e, sempre, da releitura do recurso na API com o token da plataforma.
import { createHandler, json, readJson, RuntimeError } from "../_shared/http.ts";
import { adminDb, audit, optionalEnv } from "../_shared/supabase.ts";
import { getPlatformSecret } from "../_shared/platform-secrets.ts";
import { MercadoPagoClient, notificationOf, processNotification, verifyWebhookSignature } from "../_shared/mercadopago.ts";

Deno.serve(createHandler("billing-webhook", async ({ req, url, correlationId, log }) => {
  if (req.method !== "POST") return json({ ok: true });
  const db = adminDb();
  const token = await getPlatformSecret(db, "mercadopago_access_token");
  if (!token) throw new RuntimeError("unprocessable", "Cobrança não configurada.");
  const body = await readJson(req);
  const { kind, id } = notificationOf(body, url);

  const secret = await getPlatformSecret(db, "mercadopago_webhook_secret");
  if (secret) {
    const ok = await verifyWebhookSignature({ xSignature: req.headers.get("x-signature"), xRequestId: req.headers.get("x-request-id"), dataId: id, secret });
    if (!ok) throw new RuntimeError("unauthorized", "Assinatura da notificação inválida.");
  }

  const mp = new MercadoPagoClient(token, { baseUrl: optionalEnv("MERCADOPAGO_BASE_URL") });
  const result = await processNotificationSafely(mp, db, { kind, id, correlationId, log });
  return json({ ok: true, ...result });
}));

/** Recurso inexistente no Mercado Pago (ex.: "Simular notificação" com id fictício): 200 e ignora; erro real continua 5xx para reentrega. */
async function processNotificationSafely(mp: MercadoPagoClient, db: ReturnType<typeof adminDb>, args: { kind: ReturnType<typeof notificationOf>["kind"]; id: string | null; correlationId: string; log: { info: (m: string, e?: Record<string, unknown>) => void; warn: (m: string, e?: Record<string, unknown>) => void } }) {
  const { kind, id, correlationId, log } = args;
  try {
    return await processNotification({
    getPreapproval: (sid) => mp.getPreapproval(sid),
    getAuthorizedPayment: (pid) => mp.getAuthorizedPayment(pid),
    resolve: async ({ externalReference, providerSubscriptionId, preapprovalPlanId }) => {
      const { data: known } = await db.from("workspace_subscriptions").select("workspace_id, plan_id").eq("provider_subscription_id", providerSubscriptionId).maybeSingle();
      let workspaceId: string | null = (known as { workspace_id: string } | null)?.workspace_id ?? null;
      if (!workspaceId && externalReference && /^[0-9a-f-]{36}$/i.test(externalReference)) {
        const { data: ws } = await db.from("workspaces").select("id").eq("id", externalReference).maybeSingle();
        workspaceId = (ws as { id: string } | null)?.id ?? null;
      }
      if (!workspaceId) return null;
      let planId: string | null = (known as { plan_id: string | null } | null)?.plan_id ?? null;
      if (!planId && preapprovalPlanId) {
        const { data: plan } = await db.from("plans").select("id").eq("mp_preapproval_plan_id", preapprovalPlanId).maybeSingle();
        planId = (plan as { id: string } | null)?.id ?? null;
      }
      return { workspaceId, planId };
    },
    apply: async (a) => {
      const { data, error } = await db.rpc("apply_subscription_status", {
        p_workspace_id: a.workspaceId, p_provider_subscription_id: a.providerSubscriptionId, p_plan_id: a.planId, p_status: a.status,
        p_payer_email: a.payerEmail, p_init_point: a.initPoint, p_next_payment_at: a.nextPaymentAt, p_last_payment_at: a.lastPaymentAt, p_raw: a.raw,
      });
      if (error) throw new RuntimeError("internal_error", "Falha ao aplicar a assinatura.", { db: error.message });
      const r = data as { workspace_status_before?: string; workspace_status_after?: string; previous_subscription_status?: string | null };
      if (r.previous_subscription_status !== a.status || r.workspace_status_before !== r.workspace_status_after) {
        await audit(db, { workspace_id: a.workspaceId, action: `billing.subscription_${a.status}`, actor_type: "system", entity: "subscription", entity_id: a.providerSubscriptionId,
          details: { via: "webhook", workspace_status_before: r.workspace_status_before, workspace_status_after: r.workspace_status_after, last_payment_at: a.lastPaymentAt }, correlation_id: correlationId });
      }
      log.info("billing_applied", { workspace_id: a.workspaceId, status: a.status, ...r });
    },
    log: (msg, extra) => log.warn(msg, extra),
  }, kind, id);
  } catch (err) {
    if (err instanceof RuntimeError && err.code === "not_found") {
      log.warn("billing_resource_not_found", { kind, id });
      return { handled: false, reason: "recurso não encontrado no Mercado Pago" };
    }
    throw err;
  }
}
