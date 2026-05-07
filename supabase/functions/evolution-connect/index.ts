// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders, jsonResponse, requireAdminContext } from "../_shared/auth.ts";
import {
  evolutionRequest,
  extractQrCode,
  mapEvolutionStatus,
  type EvolutionInstanceRecord,
} from "../_shared/evolution.ts";

type FormPayload = {
  display_name?: string;
  instance_name?: string;
  evolution_base_url?: string;
  provider_secret_ref?: string;
  phone_number?: string;
  is_default?: boolean;
};

type Action = "create_instance" | "connect_instance" | "refresh_status" | "disconnect_instance";

function getWebhookUrl(instance: EvolutionInstanceRecord) {
  const supabaseUrl =
    (globalThis as { Deno?: { env?: { get: (key: string) => string | undefined } } }).Deno?.env?.get(
      "SUPABASE_URL",
    ) ?? "";

  return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/whatsapp-webhook?instance_id=${instance.id}&token=${instance.webhook_token}`;
}

function normalizePayload(payload: unknown) {
  const value = (payload ?? {}) as FormPayload;
  return {
    display_name: value.display_name?.trim() || null,
    instance_name: value.instance_name?.trim() || "",
    evolution_base_url: value.evolution_base_url?.trim() || null,
    provider_secret_ref: value.provider_secret_ref?.trim() || null,
    phone_number: value.phone_number?.trim() || null,
    is_default: Boolean(value.is_default),
  };
}

async function loadInstance(
  supabase: Awaited<ReturnType<typeof requireAdminContext>>["supabase"],
  workspaceId: string,
  instanceId: string,
) {
  const { data } = await supabase
    .from("whatsapp_instances")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", instanceId)
    .maybeSingle();

  if (!data) {
    throw new Error("instance_not_found");
  }

  return data as unknown as EvolutionInstanceRecord;
}

async function persistInstanceUpdate(
  supabase: Awaited<ReturnType<typeof requireAdminContext>>["supabase"],
  instanceId: string,
  update: Record<string, unknown>,
) {
  const { data, error } = await supabase
    .from("whatsapp_instances")
    .update(update)
    .eq("id", instanceId)
    .select("*")
    .single();

  if (error) throw error;
  return data as unknown as EvolutionInstanceRecord;
}

async function configureInstanceWebhook(
  supabase: Awaited<ReturnType<typeof requireAdminContext>>["supabase"],
  instance: EvolutionInstanceRecord,
) {
  const response = await evolutionRequest({
    instance,
    path: `/webhook/set/${instance.instance_name}`,
    method: "POST",
    body: {
      enabled: true,
      url: getWebhookUrl(instance),
      webhookByEvents: false,
      webhookBase64: true,
      events: [
        "QRCODE_UPDATED",
        "CONNECTION_UPDATE",
        "MESSAGES_UPSERT",
        "MESSAGES_UPDATE",
        "MESSAGES_DELETE",
        "SEND_MESSAGE",
      ],
    },
  });

  return persistInstanceUpdate(supabase, instance.id, {
    connection_metadata: {
      ...(instance.connection_metadata ?? {}),
      webhook_url: getWebhookUrl(instance),
      last_webhook_response: response,
    },
  });
}

serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { workspaceId, supabase, body } = await requireAdminContext(request);
    const action = body.action as Action | undefined;
    const instanceId = typeof body.instanceId === "string" ? body.instanceId : null;
    const payload = normalizePayload(body.payload);

    if (!action) {
      return jsonResponse({ error: "action_required" }, { status: 400 });
    }

    if (action === "create_instance") {
      if (!payload.instance_name || !payload.evolution_base_url || !payload.provider_secret_ref) {
        return jsonResponse({ error: "invalid_payload" }, { status: 400 });
      }

      const { data: created, error } = await supabase
        .from("whatsapp_instances")
        .insert({
          workspace_id: workspaceId,
          instance_name: payload.instance_name,
          display_name: payload.display_name,
          evolution_base_url: payload.evolution_base_url,
          provider_secret_ref: payload.provider_secret_ref,
          phone_number: payload.phone_number,
          provider_type: "evolution",
          status: "connecting",
          connection_metadata: {
            source: "evolution-connect",
          },
        })
        .select("*")
        .single();

      if (error) throw error;

      let instance = created as unknown as EvolutionInstanceRecord;

      if (payload.is_default) {
        await supabase.rpc("set_default_whatsapp_instance", {
          p_workspace_id: workspaceId,
          p_instance_id: instance.id,
        });
        instance = await loadInstance(supabase, workspaceId, instance.id);
      }

      const createResponse = await evolutionRequest({
        instance,
        path: "/instance/create",
        method: "POST",
        body: {
          instanceName: instance.instance_name,
          qrcode: true,
          integration: "WHATSAPP-BAILEYS",
        },
      });

      instance = await configureInstanceWebhook(supabase, instance);

      const connectResponse = await evolutionRequest({
        instance,
        path: `/instance/connect/${instance.instance_name}`,
      });

      const qrCode = extractQrCode(connectResponse) ?? extractQrCode(createResponse);

      instance = await persistInstanceUpdate(supabase, instance.id, {
        status: qrCode ? "qr" : "connecting",
        qr_code: qrCode,
        last_seen_at: new Date().toISOString(),
        connection_metadata: {
          ...(instance.connection_metadata ?? {}),
          last_create_response: createResponse,
          last_connect_response: connectResponse,
        },
      });

      return jsonResponse({ instance }, { status: 200 });
    }

    if (!instanceId) {
      return jsonResponse({ error: "instance_required" }, { status: 400 });
    }

    let instance = await loadInstance(supabase, workspaceId, instanceId);

    if (action === "connect_instance") {
      instance = await configureInstanceWebhook(supabase, instance);

      const raw = await evolutionRequest({
        instance,
        path: `/instance/connect/${instance.instance_name}`,
      });

      const qrCode = extractQrCode(raw);
      const status = qrCode ? "qr" : mapEvolutionStatus(raw);
      const updated = await persistInstanceUpdate(supabase, instance.id, {
        status,
        qr_code: qrCode,
        last_seen_at: new Date().toISOString(),
        connection_metadata: {
          ...(instance.connection_metadata ?? {}),
          last_connect_response: raw,
        },
      });

      return jsonResponse({ instance: updated }, { status: 200 });
    }

    if (action === "refresh_status") {
      const raw = await evolutionRequest({
        instance,
        path: `/instance/connectionState/${instance.instance_name}`,
      });

      const updated = await persistInstanceUpdate(supabase, instance.id, {
        status: mapEvolutionStatus(raw),
        qr_code: mapEvolutionStatus(raw) === "connected" ? null : instance.qr_code,
        last_seen_at: new Date().toISOString(),
        connection_metadata: {
          ...(instance.connection_metadata ?? {}),
          last_status_response: raw,
        },
      });

      return jsonResponse({ instance: updated }, { status: 200 });
    }

    if (action === "disconnect_instance") {
      const raw = await evolutionRequest({
        instance,
        path: `/instance/logout/${instance.instance_name}`,
        method: "DELETE",
      });

      const updated = await persistInstanceUpdate(supabase, instance.id, {
        status: "disconnected",
        qr_code: null,
        last_seen_at: new Date().toISOString(),
        connection_metadata: {
          ...(instance.connection_metadata ?? {}),
          last_disconnect_response: raw,
        },
      });

      return jsonResponse({ instance: updated }, { status: 200 });
    }

    return jsonResponse({ error: "unsupported_action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unexpected_error";
    const status =
      message === "unauthorized"
        ? 401
        : message === "forbidden"
          ? 403
          : message === "instance_not_found" || message === "workspace_required"
            ? 404
            : 500;

    return jsonResponse({ error: message }, { status });
  }
});
