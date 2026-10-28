import { describe, expect, it, vi } from "vitest";
import { normalizeStatus, notificationOf, processNotification, signWebhook, verifyWebhookSignature, type WebhookDeps } from "../../supabase/functions/_shared/mercadopago.ts";

describe("Mercado Pago: notificações", () => {
  it("valida a x-signature (manifesto id;request-id;ts) e rejeita assinatura velha ou alterada", async () => {
    const secret = "segredo-do-webhook";
    const ts = Math.floor(Date.now() / 1000);
    const xSignature = await signWebhook({ dataId: "2c938084726fca480172750000000000", xRequestId: "req-1", secret, ts });
    expect(await verifyWebhookSignature({ xSignature, xRequestId: "req-1", dataId: "2c938084726fca480172750000000000", secret })).toBe(true);
    expect(await verifyWebhookSignature({ xSignature, xRequestId: "req-2", dataId: "2c938084726fca480172750000000000", secret })).toBe(false);
    expect(await verifyWebhookSignature({ xSignature, xRequestId: "req-1", dataId: "outro", secret })).toBe(false);
    expect(await verifyWebhookSignature({ xSignature, xRequestId: "req-1", dataId: "2c938084726fca480172750000000000", secret: "errado" })).toBe(false);
    const old = await signWebhook({ dataId: "abc", xRequestId: null, secret, ts: ts - 3600 });
    expect(await verifyWebhookSignature({ xSignature: old, xRequestId: null, dataId: "abc", secret })).toBe(false);
    expect(await verifyWebhookSignature({ xSignature: null, xRequestId: null, dataId: "abc", secret })).toBe(false);
  });

  it("reconhece o tipo e o id nos dois formatos de notificação", () => {
    const url = new URL("https://x/billing-webhook");
    expect(notificationOf({ type: "subscription_preapproval", data: { id: "sub1" } }, url)).toEqual({ kind: "subscription", id: "sub1" });
    expect(notificationOf({ type: "subscription_authorized_payment", data: { id: 123 } }, url)).toEqual({ kind: "authorized_payment", id: "123" });
    expect(notificationOf({ topic: "payment", id: "77" }, url)).toEqual({ kind: "payment", id: "77" });
    expect(notificationOf({}, new URL("https://x/billing-webhook?type=preapproval&data.id=s9"))).toEqual({ kind: "subscription", id: "s9" });
    expect(normalizeStatus("AUTHORIZED")).toBe("authorized");
    expect(normalizeStatus("weird")).toBeNull();
  });

  it("assinatura autorizada: resolve o workspace pela referência externa e aplica; sem workspace, registra e ignora", async () => {
    const apply = vi.fn(async () => {});
    const log = vi.fn();
    const deps: WebhookDeps = {
      getPreapproval: async (id) => ({ id, status: "authorized", external_reference: "ws-1", preapproval_plan_id: "plan-mp", payer_email: "dona@x.com", init_point: "https://mp/x", next_payment_date: "2026-11-28T00:00:00Z" }),
      getAuthorizedPayment: async () => { throw new Error("não usado"); },
      resolve: async ({ externalReference, preapprovalPlanId }) => (externalReference === "ws-1" && preapprovalPlanId === "plan-mp" ? { workspaceId: "ws-1", planId: "plan-db" } : null),
      apply,
      log,
    };
    expect(await processNotification(deps, "subscription", "sub-1")).toEqual({ handled: true });
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "ws-1", providerSubscriptionId: "sub-1", planId: "plan-db", status: "authorized", payerEmail: "dona@x.com", nextPaymentAt: "2026-11-28T00:00:00Z" }));

    const orphan: WebhookDeps = { ...deps, getPreapproval: async (id) => ({ id, status: "authorized", external_reference: "desconhecido" }), resolve: async () => null };
    expect(await processNotification(orphan, "subscription", "sub-2")).toMatchObject({ handled: false });
    expect(log).toHaveBeenCalledWith("billing_subscription_unmatched", expect.objectContaining({ id: "sub-2" }));
    expect(await processNotification(deps, "payment", "1")).toMatchObject({ handled: false });
    expect(await processNotification(deps, "subscription", null)).toMatchObject({ handled: false });
  });

  it("pagamento recorrente aprovado: marca o último pagamento e mantém a assinatura autorizada", async () => {
    const apply = vi.fn(async () => {});
    const deps: WebhookDeps = {
      getPreapproval: async (id) => ({ id, status: "authorized", external_reference: "ws-1", next_payment_date: "2026-12-28T00:00:00Z" }),
      getAuthorizedPayment: async (id) => ({ id, preapproval_id: "sub-1", status: "processed", date_created: "2026-11-28T10:00:00Z", payment: { id: 5, status: "approved" } }),
      resolve: async () => ({ workspaceId: "ws-1", planId: "plan-db" }),
      apply,
      log: vi.fn(),
    };
    expect(await processNotification(deps, "authorized_payment", "pay-1")).toEqual({ handled: true });
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ status: "authorized", lastPaymentAt: "2026-11-28T10:00:00Z", nextPaymentAt: "2026-12-28T00:00:00Z" }));
  });
});
