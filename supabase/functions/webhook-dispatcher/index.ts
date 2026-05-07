// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders, createServiceClient, jsonResponse } from "../_shared/auth.ts";
import {
  enqueueWebhookDeliveries,
  processPendingWebhookDeliveries,
} from "../_shared/webhooks.ts";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : null;
    const event = typeof body.event === "string" ? body.event : null;
    const payload = asRecord(body.payload) ?? {};
    const correlationId =
      typeof body.correlationId === "string" ? body.correlationId : crypto.randomUUID();
    const processPendingOnly = body.processPendingOnly === true;

    const supabase = createServiceClient();

    let queued = [];
    if (!processPendingOnly && workspaceId && event) {
      queued = await enqueueWebhookDeliveries(supabase, {
        workspaceId,
        event,
        payload,
        correlationId,
      });
    }

    await processPendingWebhookDeliveries(supabase, {
      workspaceId,
      limit: 25,
    });

    return jsonResponse(
      {
        ok: true,
        queued: queued.length,
        correlationId,
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unexpected_error";
    return jsonResponse({ error: message }, { status: 500 });
  }
});
