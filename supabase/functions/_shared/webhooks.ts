// @ts-nocheck
import { createServiceClient } from "./auth.ts";

const MAX_WEBHOOK_ATTEMPTS = 3;

function getEnv(name: string) {
  return (globalThis as { Deno?: { env?: { get: (key: string) => string | undefined } } }).Deno?.env?.get(name);
}

function textToHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function signWebhookPayload(input: {
  secret: string;
  timestamp: string;
  payload: string;
}) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(input.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${input.timestamp}.${input.payload}`),
  );

  return `sha256=${textToHex(signatureBuffer)}`;
}

export function maskWebhookSecret(secret: string | null | undefined) {
  if (!secret) return "nao_definido";
  return `${secret.slice(0, 6)}****${secret.slice(-6)}`;
}

export async function createAuditLog(supabase, input) {
  await supabase.from("audit_logs").insert({
    workspace_id: input.workspaceId,
    actor_type: input.actorType,
    actor_id: input.actorId ?? null,
    action: input.action,
    target: input.target ?? null,
    metadata: input.metadata ?? {},
  });
}

export async function enqueueWebhookDeliveries(supabase, input) {
  const { data: webhooks } = await supabase
    .from("webhooks")
    .select("*")
    .eq("workspace_id", input.workspaceId)
    .eq("is_active", true)
    .contains("events", [input.event]);

  if (!webhooks || webhooks.length === 0) {
    return [];
  }

  const deliveries = webhooks.map((webhook) => ({
    webhook_id: webhook.id,
    workspace_id: input.workspaceId,
    event: input.event,
    payload: input.payload,
    attempted_at: new Date().toISOString(),
    last_attempt_at: new Date().toISOString(),
    attempt_number: 1,
    retry_count: 0,
    correlation_id: input.correlationId ?? crypto.randomUUID(),
    delivery_status: "pending",
    webhook_url: webhook.url,
    request_headers: webhook.headers ?? {},
  }));

  const { data, error } = await supabase
    .from("webhook_deliveries")
    .insert(deliveries)
    .select("*");

  if (error) throw error;
  return data ?? [];
}

function getRetryDate(attemptNumber: number) {
  const delaySeconds = attemptNumber === 1 ? 30 : attemptNumber === 2 ? 120 : 300;
  return new Date(Date.now() + delaySeconds * 1000).toISOString();
}

export async function dispatchWebhookDelivery(supabase, delivery) {
  const { data: webhook } = await supabase
    .from("webhooks")
    .select("*")
    .eq("id", delivery.webhook_id)
    .maybeSingle();

  if (!webhook || !webhook.is_active) {
    await supabase
      .from("webhook_deliveries")
      .update({
        delivery_status: "failed",
        error: "webhook_inactive_or_missing",
        last_attempt_at: new Date().toISOString(),
      })
      .eq("id", delivery.id);
    return;
  }

  const payloadText = JSON.stringify(delivery.payload ?? {});
  const timestamp = new Date().toISOString();
  const signature = await signWebhookPayload({
    secret: webhook.secret,
    timestamp,
    payload: payloadText,
  });

  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "CalliaChat-Webhooks/1.0",
    "x-callia-event": delivery.event,
    "x-callia-delivery-id": delivery.id,
    "x-callia-correlation-id": delivery.correlation_id,
    "x-callia-attempt": String(delivery.attempt_number ?? 1),
    "x-callia-timestamp": timestamp,
    "x-callia-signature": signature,
    ...((webhook.headers as Record<string, string> | null) ?? {}),
  };

  try {
    const response = await fetch(webhook.url, {
      method: "POST",
      headers,
      body: payloadText,
    });

    const responseBody = await response.text().catch(() => "");
    const responseHeaders = Object.fromEntries(response.headers.entries());

    if (response.ok) {
      await supabase
        .from("webhook_deliveries")
        .update({
          delivery_status: "delivered",
          response_status: response.status,
          response_body: responseBody,
          response_headers: responseHeaders,
          request_headers: headers,
          delivered_at: new Date().toISOString(),
          last_attempt_at: new Date().toISOString(),
          next_retry_at: null,
          error: null,
          webhook_url: webhook.url,
        })
        .eq("id", delivery.id);

      await supabase
        .from("webhooks")
        .update({
          updated_at: new Date().toISOString(),
        })
        .eq("id", webhook.id);

      return;
    }

    const nextAttempt = (delivery.attempt_number ?? 1) + 1;
    const exhausted = nextAttempt > MAX_WEBHOOK_ATTEMPTS;

    await supabase
      .from("webhook_deliveries")
      .update({
        delivery_status: exhausted ? "failed" : "pending",
        response_status: response.status,
        response_body: responseBody,
        response_headers: responseHeaders,
        request_headers: headers,
        error: `http_${response.status}`,
        attempt_number: nextAttempt,
        retry_count: nextAttempt - 1,
        next_retry_at: exhausted ? null : getRetryDate(nextAttempt - 1),
        last_attempt_at: new Date().toISOString(),
        webhook_url: webhook.url,
      })
      .eq("id", delivery.id);
  } catch (error) {
    const nextAttempt = (delivery.attempt_number ?? 1) + 1;
    const exhausted = nextAttempt > MAX_WEBHOOK_ATTEMPTS;

    await supabase
      .from("webhook_deliveries")
      .update({
        delivery_status: exhausted ? "failed" : "pending",
        error: error instanceof Error ? error.message : "network_error",
        request_headers: headers,
        attempt_number: nextAttempt,
        retry_count: nextAttempt - 1,
        next_retry_at: exhausted ? null : getRetryDate(nextAttempt - 1),
        last_attempt_at: new Date().toISOString(),
        webhook_url: webhook.url,
      })
      .eq("id", delivery.id);
  }
}

export async function processPendingWebhookDeliveries(supabase, input: {
  deliveryId?: string | null;
  workspaceId?: string | null;
  limit?: number;
}) {
  const limit = input.limit ?? 20;
  let query = supabase
    .from("webhook_deliveries")
    .select("*")
    .in("delivery_status", ["pending"])
    .order("attempted_at", { ascending: true })
    .limit(limit);

  if (input.deliveryId) {
    query = query.eq("id", input.deliveryId);
  } else {
    query = query.or(`next_retry_at.is.null,next_retry_at.lte.${new Date().toISOString()}`);
  }

  if (input.workspaceId) {
    query = query.eq("workspace_id", input.workspaceId);
  }

  const { data, error } = await query;
  if (error) throw error;

  for (const delivery of data ?? []) {
    await dispatchWebhookDelivery(supabase, delivery);
  }

  return data ?? [];
}

export async function triggerWebhookDispatch(input: {
  workspaceId: string;
  event: string;
  payload: Record<string, unknown>;
  correlationId?: string;
}) {
  const supabaseUrl = getEnv("SUPABASE_URL");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return;

  await fetch(`${supabaseUrl.replace(/\/+$/, "")}/functions/v1/webhook-dispatcher`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  }).catch(() => null);
}

export async function triggerPendingWebhookDispatch(workspaceId?: string | null) {
  const supabaseUrl = getEnv("SUPABASE_URL");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return;

  await fetch(`${supabaseUrl.replace(/\/+$/, "")}/functions/v1/webhook-dispatcher`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      workspaceId: workspaceId ?? null,
      processPendingOnly: true,
    }),
  }).catch(() => null);
}
