// Mercado Pago: assinaturas (preapproval) e verificação das notificações (x-signature).
import { RuntimeError } from "./http.ts";

export const MP_DEFAULT_BASE = "https://api.mercadopago.com";
export type MpSubscriptionStatus = "pending" | "authorized" | "paused" | "cancelled";

export interface MpPreapproval {
  id: string;
  status: MpSubscriptionStatus | string;
  external_reference?: string | null;
  preapproval_plan_id?: string | null;
  payer_email?: string | null;
  init_point?: string | null;
  next_payment_date?: string | null;
  reason?: string | null;
  date_created?: string | null;
}

export interface MpAuthorizedPayment {
  id: string | number;
  preapproval_id?: string | null;
  status?: string | null;
  date_created?: string | null;
  payment?: { id?: number; status?: string; status_detail?: string } | null;
}

export class MercadoPagoClient {
  private readonly base: string;
  private readonly doFetch: typeof fetch;
  constructor(private readonly accessToken: string, opts: { baseUrl?: string; fetchImpl?: typeof fetch } = {}) {
    this.base = (opts.baseUrl ?? MP_DEFAULT_BASE).replace(/\/$/, "");
    this.doFetch = opts.fetchImpl ?? fetch;
  }

  private async request<T>(path: string, init: RequestInit & { idempotencyKey?: string } = {}): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.accessToken}`, "Content-Type": "application/json", ...(init.headers as Record<string, string> ?? {}) };
    if (init.idempotencyKey) headers["X-Idempotency-Key"] = init.idempotencyKey;
    const res = await this.doFetch(`${this.base}${path}`, { ...init, headers }).catch((err) => {
      throw new RuntimeError("upstream_unavailable", "Mercado Pago indisponível.", { error: String(err) });
    });
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const msg = (data as { message?: string } | null)?.message ?? `HTTP ${res.status}`;
      throw new RuntimeError(res.status === 404 ? "not_found" : "upstream_unavailable", `Mercado Pago recusou: ${msg}`, { status: res.status, body: typeof data === "string" ? data.slice(0, 300) : data });
    }
    return data as T;
  }

  /**
   * Cria a assinatura pendente "sem plano associado" (valor e recorrência no próprio pedido): o cliente conclui no
   * init_point. A variante com preapproval_plan_id exige card_token_id (checkout transparente), por isso não é usada.
   */
  createPreapproval(input: { reason: string; amount: number; currency: string; external_reference: string; payer_email: string; back_url: string }, idempotencyKey: string): Promise<MpPreapproval> {
    return this.request<MpPreapproval>("/preapproval", {
      method: "POST",
      idempotencyKey,
      body: JSON.stringify({
        reason: input.reason,
        external_reference: input.external_reference,
        payer_email: input.payer_email,
        back_url: input.back_url,
        auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: input.amount, currency_id: input.currency },
        status: "pending",
      }),
    });
  }
  getPreapproval(id: string): Promise<MpPreapproval> {
    return this.request<MpPreapproval>(`/preapproval/${encodeURIComponent(id)}`);
  }
  cancelPreapproval(id: string): Promise<MpPreapproval> {
    return this.request<MpPreapproval>(`/preapproval/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ status: "cancelled" }) });
  }
  getAuthorizedPayment(id: string): Promise<MpAuthorizedPayment> {
    return this.request<MpAuthorizedPayment>(`/authorized_payments/${encodeURIComponent(id)}`);
  }
  /** Conta dona do token (teste de conexão). */
  getMe(): Promise<{ id?: number; nickname?: string; email?: string; site_id?: string }> {
    return this.request("/users/me");
  }
  /** Plano de assinatura mensal no cartão, sem teste grátis (o trial é do Callia). */
  createPreapprovalPlan(input: { reason: string; amount: number; currency: string; back_url: string }): Promise<{ id: string; status?: string; init_point?: string }> {
    return this.request("/preapproval_plan", {
      method: "POST",
      body: JSON.stringify({
        reason: input.reason,
        auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: input.amount, currency_id: input.currency },
        payment_methods_allowed: { payment_types: [{ id: "credit_card" }] },
        back_url: input.back_url,
      }),
    });
  }
}

export function normalizeStatus(status: string | null | undefined): MpSubscriptionStatus | null {
  const s = (status ?? "").toLowerCase();
  return s === "pending" || s === "authorized" || s === "paused" || s === "cancelled" ? s : null;
}

/** Tipo e id da notificação (formato novo: type + data.id; formato antigo: topic + id/resource). */
export function notificationOf(body: Record<string, unknown>, url: URL): { kind: "subscription" | "authorized_payment" | "payment" | "other"; id: string | null } {
  const type = String(body.type ?? body.topic ?? url.searchParams.get("type") ?? url.searchParams.get("topic") ?? "").toLowerCase();
  const data = body.data as { id?: unknown } | undefined;
  const id = data?.id ?? body.id ?? url.searchParams.get("data.id") ?? url.searchParams.get("id") ?? null;
  const kind = type === "subscription_preapproval" || type === "preapproval" ? "subscription"
    : type === "subscription_authorized_payment" ? "authorized_payment"
    : type === "payment" ? "payment"
    : "other";
  return { kind, id: id === null || id === undefined ? null : String(id) };
}

/**
 * x-signature do Mercado Pago: "ts=...,v1=<hmac>"; o HMAC-SHA256 (hex) do manifesto
 * "id:<data.id>;request-id:<x-request-id>;ts:<ts>;" com a assinatura secreta do webhook.
 */
export async function verifyWebhookSignature(args: { xSignature: string | null; xRequestId: string | null; dataId: string | null; secret: string; nowMs?: number; toleranceSec?: number }): Promise<boolean> {
  if (!args.xSignature || !args.dataId) return false;
  const parts = Object.fromEntries(args.xSignature.split(",").map((p) => p.trim().split("=", 2) as [string, string]));
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;
  const tolerance = args.toleranceSec ?? 10 * 60;
  const age = Math.abs((args.nowMs ?? Date.now()) / 1000 - Number(ts));
  if (!Number.isFinite(age) || age > tolerance) return false;
  const id = /^[a-z0-9]+$/i.test(args.dataId) ? args.dataId.toLowerCase() : args.dataId;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(args.secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const hmac = async (manifest: string) => {
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest)));
    return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
  };
  const expected = v1.toLowerCase();
  // Com request-id (como o Mercado Pago envia) e, por segurança, sem ele (gateways podem gerar o próprio x-request-id).
  const manifests = [`id:${id};${args.xRequestId ? `request-id:${args.xRequestId};` : ""}ts:${ts};`, `id:${id};ts:${ts};`];
  for (const m of new Set(manifests)) if (timingSafeEqual(await hmac(m), expected)) return true;
  return false;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Assina um manifesto (para testes e simulações de notificação). */
export async function signWebhook(args: { dataId: string; xRequestId: string | null; secret: string; ts: number }): Promise<string> {
  const id = /^[a-z0-9]+$/i.test(args.dataId) ? args.dataId.toLowerCase() : args.dataId;
  const manifest = `id:${id};${args.xRequestId ? `request-id:${args.xRequestId};` : ""}ts:${args.ts};`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(args.secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest)));
  return `ts=${args.ts},v1=${[...sig].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

// ---------------------------------------------------------------------------
// Processamento das notificações, com dependências injetadas (testável sem banco nem Mercado Pago).
// ---------------------------------------------------------------------------
export interface SubscriptionApply {
  workspaceId: string;
  providerSubscriptionId: string;
  planId: string | null;
  status: MpSubscriptionStatus;
  payerEmail: string | null;
  initPoint: string | null;
  nextPaymentAt: string | null;
  lastPaymentAt: string | null;
  raw: Record<string, unknown>;
}

export interface WebhookDeps {
  getPreapproval: (id: string) => Promise<MpPreapproval>;
  getAuthorizedPayment: (id: string) => Promise<MpAuthorizedPayment>;
  /** Workspace e plano da assinatura: pela referência externa (id do workspace) ou pela assinatura já conhecida. */
  resolve: (args: { externalReference: string | null; providerSubscriptionId: string; preapprovalPlanId: string | null }) => Promise<{ workspaceId: string; planId: string | null } | null>;
  apply: (a: SubscriptionApply) => Promise<void>;
  log: (msg: string, extra?: Record<string, unknown>) => void;
}

export async function processNotification(deps: WebhookDeps, kind: ReturnType<typeof notificationOf>["kind"], id: string | null): Promise<{ handled: boolean; reason?: string }> {
  if (!id) return { handled: false, reason: "sem id" };
  if (kind === "subscription") {
    const sub = await deps.getPreapproval(id);
    const status = normalizeStatus(sub.status);
    if (!status) return { handled: false, reason: `status desconhecido: ${sub.status}` };
    const target = await deps.resolve({ externalReference: sub.external_reference ?? null, providerSubscriptionId: sub.id, preapprovalPlanId: sub.preapproval_plan_id ?? null });
    if (!target) {
      deps.log("billing_subscription_unmatched", { id: sub.id, external_reference: sub.external_reference });
      return { handled: false, reason: "assinatura sem workspace" };
    }
    await deps.apply({
      workspaceId: target.workspaceId, providerSubscriptionId: sub.id, planId: target.planId, status,
      payerEmail: sub.payer_email ?? null, initPoint: sub.init_point ?? null, nextPaymentAt: sub.next_payment_date ?? null, lastPaymentAt: null,
      raw: { preapproval: sub },
    });
    return { handled: true };
  }
  if (kind === "authorized_payment") {
    const pay = await deps.getAuthorizedPayment(id);
    if (!pay.preapproval_id) return { handled: false, reason: "pagamento sem assinatura" };
    const sub = await deps.getPreapproval(pay.preapproval_id);
    const status = normalizeStatus(sub.status);
    if (!status) return { handled: false, reason: `status desconhecido: ${sub.status}` };
    const target = await deps.resolve({ externalReference: sub.external_reference ?? null, providerSubscriptionId: sub.id, preapprovalPlanId: sub.preapproval_plan_id ?? null });
    if (!target) return { handled: false, reason: "assinatura sem workspace" };
    const approved = (pay.payment?.status ?? pay.status ?? "").toLowerCase() === "approved" || (pay.status ?? "").toLowerCase() === "processed";
    await deps.apply({
      workspaceId: target.workspaceId, providerSubscriptionId: sub.id, planId: target.planId, status,
      payerEmail: sub.payer_email ?? null, initPoint: null, nextPaymentAt: sub.next_payment_date ?? null,
      lastPaymentAt: approved ? (pay.date_created ?? new Date().toISOString()) : null,
      raw: { preapproval: sub, authorized_payment: pay },
    });
    return { handled: true };
  }
  return { handled: false, reason: `tipo ignorado: ${kind}` };
}
