// Webhooks de saída: assinatura HMAC-SHA256, entregas persistidas e retentativas com backoff.
import { decryptSecret, hmacSha256Hex } from "./crypto.ts";

export const WEBHOOK_EVENTS = ["message.received", "message.sent", "conversation.handoff", "public_api.event.received"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number] | "webhook.test";

/** x-callia-signature = sha256=<hex HMAC-SHA256(secret, `${timestamp}.${body}`)> */
export async function signWebhook(secret: string, timestamp: string, body: string): Promise<string> {
  return `sha256=${await hmacSha256Hex(secret, `${timestamp}.${body}`)}`;
}

/** Atraso antes da tentativa n+1 (n = tentativas já feitas): 30s, 2min, 10min, 30min, 1h, 2h... */
export function retryDelaySeconds(attemptsMade: number): number {
  const table = [30, 120, 600, 1800, 3600];
  return attemptsMade <= table.length ? table[Math.max(0, attemptsMade - 1)] : 7200;
}

export function buildEnvelope(event: WebhookEvent, workspaceId: string, data: Record<string, unknown>, deliveryId: string) {
  return { id: deliveryId, event, workspace_id: workspaceId, created_at: new Date().toISOString(), data };
}

// deno-lint-ignore no-explicit-any
type Db = any;

/**
 * Cria uma entrega por webhook ativo inscrito no evento e já tenta enviar.
 * Falhas ficam em `retrying` e são retomadas pelo webhook-dispatcher (cron).
 */
export async function emitEvent(
  db: Db,
  args: { workspaceId: string; event: WebhookEvent; data: Record<string, unknown>; correlationId?: string; masterKey?: string; onlyWebhookId?: string },
): Promise<string[]> {
  let query = db.from("webhooks").select("id, events").eq("workspace_id", args.workspaceId).eq("active", true);
  if (args.onlyWebhookId) query = query.eq("id", args.onlyWebhookId);
  const { data: hooks, error } = await query;
  if (error || !hooks?.length) return [];
  const targets = args.onlyWebhookId ? hooks : hooks.filter((h: { events: string[] }) => h.events.includes(args.event));
  if (!targets.length) return [];

  const rows = targets.map((h: { id: string }) => {
    const id = crypto.randomUUID();
    return {
      id,
      workspace_id: args.workspaceId,
      webhook_id: h.id,
      event: args.event,
      payload: buildEnvelope(args.event, args.workspaceId, args.data, id),
      correlation_id: args.correlationId ?? null,
    };
  });
  const { error: insertError } = await db.from("webhook_deliveries").insert(rows);
  if (insertError) {
    console.error(JSON.stringify({ level: "error", msg: "webhook_delivery_insert_failed", error: insertError.message }));
    return [];
  }
  if (args.masterKey) {
    await Promise.all(rows.map((r: { id: string }) => deliverWebhook(db, r.id, args.masterKey!)));
  }
  return rows.map((r: { id: string }) => r.id);
}

export async function deliverWebhook(db: Db, deliveryId: string, masterKey: string, fetchImpl: typeof fetch = fetch) {
  const { data: delivery } = await db
    .from("webhook_deliveries")
    .select("id, workspace_id, webhook_id, event, payload, attempts, status, correlation_id, webhooks(url, secret_ciphertext, max_attempts, active)")
    .eq("id", deliveryId)
    .maybeSingle();
  if (!delivery || delivery.status === "success") return delivery;
  const hook = delivery.webhooks;
  const attempt = delivery.attempts + 1;
  const body = JSON.stringify(delivery.payload);
  const timestamp = String(Math.floor(Date.now() / 1000));

  let statusCode: number | null = null;
  let errorText: string | null = null;
  if (!hook?.active) {
    errorText = "webhook inativo";
  } else {
    try {
      const secret = await decryptSecret(hook.secret_ciphertext, masterKey);
      const res = await fetchImpl(hook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "CalliaChat-Webhooks/1.0",
          "x-callia-event": delivery.event,
          "x-callia-delivery-id": delivery.id,
          "x-callia-correlation-id": delivery.correlation_id ?? delivery.id,
          "x-callia-attempt": String(attempt),
          "x-callia-timestamp": timestamp,
          "x-callia-signature": await signWebhook(secret, timestamp, body),
        },
        body,
        signal: AbortSignal.timeout(10_000),
        redirect: "manual",
      });
      statusCode = res.status;
      await res.body?.cancel();
      if (res.status < 200 || res.status >= 300) errorText = `HTTP ${res.status}`;
    } catch (err) {
      errorText = (err as Error)?.name === "TimeoutError" ? "timeout (10s)" : String(err).slice(0, 300);
    }
  }

  const ok = errorText === null;
  const exhausted = attempt >= (hook?.max_attempts ?? 6) || !hook?.active;
  const update = {
    attempts: attempt,
    last_status_code: statusCode,
    last_error: errorText,
    status: ok ? "success" : exhausted ? "failed" : "retrying",
    delivered_at: ok ? new Date().toISOString() : null,
    next_attempt_at: new Date(Date.now() + retryDelaySeconds(attempt) * 1000).toISOString(),
  };
  const { data: updated } = await db.from("webhook_deliveries").update(update).eq("id", delivery.id).select(
    "id, webhook_id, event, status, attempts, last_status_code, last_error, created_at, delivered_at, next_attempt_at",
  ).maybeSingle();
  return updated;
}
