// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders, jsonResponse, requireAdminContext } from "../_shared/auth.ts";
import {
  createAuditLog,
  maskWebhookSecret,
  processPendingWebhookDeliveries,
} from "../_shared/webhooks.ts";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function sanitizeWebhook(webhook) {
  return {
    id: webhook.id,
    workspace_id: webhook.workspace_id,
    name: webhook.name,
    description: webhook.description ?? null,
    url: webhook.url,
    events: webhook.events ?? [],
    headers: webhook.headers ?? {},
    is_active: webhook.is_active,
    created_at: webhook.created_at,
    updated_at: webhook.updated_at ?? webhook.created_at,
    secret_masked: maskWebhookSecret(webhook.secret),
  };
}

serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const {
      userId,
      workspaceId,
      supabase,
      body,
    } = await requireAdminContext(request);
    const action = typeof body.action === "string" ? body.action : "list";

    if (action === "list") {
      const { data, error } = await supabase
        .from("webhooks")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      return jsonResponse(
        {
          ok: true,
          webhooks: (data ?? []).map(sanitizeWebhook),
        },
        { status: 200 },
      );
    }

    if (action === "save") {
      const webhookId = typeof body.webhookId === "string" ? body.webhookId : null;
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const url = typeof body.url === "string" ? body.url.trim() : "";
      const description =
        typeof body.description === "string" ? body.description.trim() || null : null;
      const events = Array.isArray(body.events)
        ? body.events.filter((value) => typeof value === "string" && value.trim())
        : [];
      const headers = asRecord(body.headers) ?? {};
      const isActive = body.isActive !== false;

      if (!name || !url || events.length === 0) {
        return jsonResponse({ error: "invalid_webhook_payload" }, { status: 400 });
      }

      const builder = webhookId
        ? supabase.from("webhooks").update({
            name,
            url,
            description,
            events,
            headers,
            is_active: isActive,
          }).eq("workspace_id", workspaceId).eq("id", webhookId)
        : supabase.from("webhooks").insert({
            workspace_id: workspaceId,
            name,
            url,
            description,
            events,
            headers,
            is_active: isActive,
          });

      const { data, error } = await builder.select("*").single();
      if (error) throw error;

      await createAuditLog(supabase, {
        workspaceId,
        actorType: "user",
        actorId: userId,
        action: webhookId ? "webhook.updated" : "webhook.created",
        target: data.id,
        metadata: {
          name,
          url,
          events,
        },
      });

      return jsonResponse(
        {
          ok: true,
          webhook: sanitizeWebhook(data),
          secret: webhookId ? null : data.secret,
        },
        { status: webhookId ? 200 : 201 },
      );
    }

    if (action === "delete") {
      const webhookId = typeof body.webhookId === "string" ? body.webhookId : null;
      if (!webhookId) {
        return jsonResponse({ error: "webhook_id_required" }, { status: 400 });
      }

      const { data: existing } = await supabase
        .from("webhooks")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("id", webhookId)
        .maybeSingle();

      if (!existing) {
        return jsonResponse({ error: "webhook_not_found" }, { status: 404 });
      }

      const { error } = await supabase
        .from("webhooks")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("id", webhookId);

      if (error) throw error;

      await createAuditLog(supabase, {
        workspaceId,
        actorType: "user",
        actorId: userId,
        action: "webhook.deleted",
        target: webhookId,
        metadata: {
          name: existing.name,
          url: existing.url,
        },
      });

      return jsonResponse({ ok: true }, { status: 200 });
    }

    if (action === "rotate_secret") {
      const webhookId = typeof body.webhookId === "string" ? body.webhookId : null;
      if (!webhookId) {
        return jsonResponse({ error: "webhook_id_required" }, { status: 400 });
      }

      const { data, error } = await supabase.rpc("rotate_webhook_secret", {
        p_workspace_id: workspaceId,
        p_webhook_id: webhookId,
      });

      if (error) throw error;

      await createAuditLog(supabase, {
        workspaceId,
        actorType: "user",
        actorId: userId,
        action: "webhook.secret_rotated",
        target: webhookId,
        metadata: {},
      });

      return jsonResponse(
        {
          ok: true,
          secret: data,
        },
        { status: 200 },
      );
    }

    if (action === "process_pending") {
      const deliveries = await processPendingWebhookDeliveries(supabase, {
        workspaceId,
        limit: 50,
      });

      return jsonResponse(
        {
          ok: true,
          processed: deliveries.length,
        },
        { status: 200 },
      );
    }

    return jsonResponse({ error: "unsupported_action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unexpected_error";
    const status =
      message === "unauthorized" ? 401 :
      message === "forbidden" ? 403 :
      message === "workspace_required" ? 400 :
      500;

    return jsonResponse({ error: message }, { status });
  }
});
