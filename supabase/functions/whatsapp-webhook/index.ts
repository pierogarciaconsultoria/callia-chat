// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders, createServiceClient, jsonResponse } from "../_shared/auth.ts";
import { extractQrCode, mapEvolutionStatus } from "../_shared/evolution.ts";
import { normalizeEvolutionMessageUpsert } from "../_shared/inbound.ts";
import {
  buildBotResumeMetadata,
  buildPhoneHandoffMetadata,
  CALLIA_OUTBOUND_ECHO_WINDOW_MS,
  findMatchingRecentOutbound,
  isPhoneHumanReply,
  markMessageAsPhoneReply,
  shouldReturnConversationToBot,
} from "../_shared/human-handoff.ts";
import { triggerPendingWebhookDispatch, triggerWebhookDispatch } from "../_shared/webhooks.ts";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getEnv(name: string) {
  return (globalThis as { Deno?: { env?: { get: (key: string) => string | undefined } } }).Deno?.env?.get(name);
}

async function triggerProcessMessage(input) {
  const supabaseUrl = getEnv("SUPABASE_URL");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return;

  await fetch(`${supabaseUrl.replace(/\/+$/, "")}/functions/v1/process-message`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  }).catch(() => null);
}

async function findExistingMessage(supabase, workspaceId, externalId) {
  const { data } = await supabase
    .from("messages")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("external_id", externalId)
    .maybeSingle();

  return data;
}

async function findRecentCalliaOutbound(supabase, conversationId, content) {
  if (!content) return null;
  const now = new Date();
  const cutoff = new Date(now.getTime() - CALLIA_OUTBOUND_ECHO_WINDOW_MS).toISOString();
  const { data } = await supabase
    .from("outbound_messages")
    .select("id, message_id, payload, queued_at, sent_at, provider_message_id")
    .eq("conversation_id", conversationId)
    .gte("queued_at", cutoff)
    .order("queued_at", { ascending: false })
    .limit(10);

  return findMatchingRecentOutbound(data ?? [], content, now);
}

async function reconcileCalliaEcho(supabase, outbound, externalMessageId) {
  if (!outbound?.message_id) return null;

  await Promise.all([
    externalMessageId
      ? supabase
          .from("messages")
          .update({ external_id: externalMessageId })
          .eq("id", outbound.message_id)
          .is("external_id", null)
      : Promise.resolve(),
    externalMessageId
      ? supabase
          .from("outbound_messages")
          .update({ provider_message_id: externalMessageId })
          .eq("id", outbound.id)
          .is("provider_message_id", null)
      : Promise.resolve(),
  ]);

  const { data } = await supabase
    .from("messages")
    .select("*")
    .eq("id", outbound.message_id)
    .maybeSingle();
  return data;
}

async function getAgentRuntimeConfig(supabase, workspaceId) {
  const { data } = await supabase
    .from("agent_configs")
    .select("external_agent_enabled, human_pause_hours")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  return {
    externalAgentEnabled: data?.external_agent_enabled === true,
    humanPauseHours:
      Number.isInteger(data?.human_pause_hours) && data.human_pause_hours > 0
        ? data.human_pause_hours
        : 12,
  };
}

async function upsertConversation(supabase, instance, normalized) {
  const { data: existing } = await supabase
    .from("conversations")
    .select("*")
    .eq("workspace_id", instance.workspace_id)
    .eq("customer_phone", normalized.customerPhone)
    .maybeSingle();

  if (existing) {
    const nextUnreadCount =
      normalized.direction === "inbound" && normalized.sender === "customer"
        ? (existing.unread_count ?? 0) + 1
        : existing.unread_count ?? 0;

    const { data, error } = await supabase
      .from("conversations")
      .update({
        whatsapp_instance_id: instance.id,
        customer_name: normalized.customerName ?? existing.customer_name,
        last_message_at: new Date().toISOString(),
        unread_count: nextUnreadCount,
        is_closed: false,
        metadata: {
          ...((existing.metadata as Record<string, unknown> | null) ?? {}),
          last_event_type: "MESSAGES_UPSERT",
          last_message_direction: normalized.direction,
          last_message_type: normalized.messageType,
        },
      })
      .eq("id", existing.id)
      .select("*")
      .single();

    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from("conversations")
    .insert({
      workspace_id: instance.workspace_id,
      whatsapp_instance_id: instance.id,
      customer_phone: normalized.customerPhone,
      customer_name: normalized.customerName,
      last_message_at: new Date().toISOString(),
      unread_count: normalized.direction === "inbound" ? 1 : 0,
      metadata: {
        last_event_type: "MESSAGES_UPSERT",
        last_message_direction: normalized.direction,
        last_message_type: normalized.messageType,
      },
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

async function insertMessage(supabase, instance, conversation, normalized, knownExisting = null) {
  const existing = knownExisting ?? (normalized.externalMessageId
    ? await findExistingMessage(supabase, instance.workspace_id, normalized.externalMessageId)
    : null);

  if (existing) {
    return existing;
  }

  const { data, error } = await supabase
    .from("messages")
    .insert({
      workspace_id: instance.workspace_id,
      conversation_id: conversation.id,
      direction: normalized.direction,
      sender: normalized.sender,
      type: normalized.messageType,
      content: normalized.content,
      media_url: normalized.mediaUrl,
      transcription: normalized.transcription,
      external_id: normalized.externalMessageId,
      metadata: {
        ...normalized.metadata,
        mimeType: normalized.mimeType,
      },
    })
    .select("*")
    .single();

  if (error) {
    if (normalized.externalMessageId) {
      const duplicate = await findExistingMessage(
        supabase,
        instance.workspace_id,
        normalized.externalMessageId,
      );
      if (duplicate) return duplicate;
    }
    throw error;
  }

  return data;
}

async function registerInboundEvent(supabase, instance, payload, normalized) {
  const basePayload = {
    workspace_id: instance.workspace_id,
    whatsapp_instance_id: instance.id,
    provider: "evolution",
    event_type: "MESSAGES_UPSERT",
    provider_event_id: normalized.providerEventId,
    payload,
    processing_status: "processing",
  };

  const { data, error } = await supabase
    .from("inbound_events")
    .insert(basePayload)
    .select("*")
    .single();

  if (!error) return { event: data, duplicate: false };

  const duplicateError =
    typeof error.code === "string" && error.code === "23505";

  if (!duplicateError) throw error;

  const { data: existing } = await supabase
    .from("inbound_events")
    .select("*")
    .eq("provider", "evolution")
    .eq("provider_event_id", normalized.providerEventId)
    .maybeSingle();

  return { event: existing, duplicate: true };
}

serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(request.url);
  const instanceId = url.searchParams.get("instance_id");
  const token = url.searchParams.get("token");

  if (!instanceId || !token) {
    return jsonResponse({ error: "missing_params" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: instance } = await supabase
    .from("whatsapp_instances")
    .select("*")
    .eq("id", instanceId)
    .eq("webhook_token", token)
    .maybeSingle();

  if (!instance) {
    return jsonResponse({ error: "forbidden" }, { status: 403 });
  }

  if (request.method !== "POST") {
    return jsonResponse({ ok: true, message: "webhook_ready" }, { status: 200 });
  }

  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const event = typeof payload.event === "string" ? payload.event : null;
  const data = asRecord(payload.data) ?? {};

  if (event === "QRCODE_UPDATED") {
    await supabase
      .from("whatsapp_instances")
      .update({
        status: "qr",
        qr_code: extractQrCode(data),
        last_seen_at: new Date().toISOString(),
        connection_metadata: {
          ...((instance.connection_metadata as Record<string, unknown> | null) ?? {}),
          last_qrcode_event: payload,
        },
      })
      .eq("id", instanceId);
  }

  if (event === "CONNECTION_UPDATE") {
    const status = mapEvolutionStatus(data);
    await supabase
      .from("whatsapp_instances")
      .update({
        status,
        qr_code: status === "connected" ? null : instance.qr_code,
        last_seen_at: new Date().toISOString(),
        connection_metadata: {
          ...((instance.connection_metadata as Record<string, unknown> | null) ?? {}),
          last_connection_event: payload,
        },
      })
      .eq("id", instanceId);
  }

  if (event === "MESSAGES_UPSERT") {
    const normalized = normalizeEvolutionMessageUpsert(payload);

    if (!normalized) {
      return jsonResponse({ ok: true, skipped: "invalid_message_payload" }, { status: 202 });
    }

    const registered = await registerInboundEvent(supabase, instance, payload, normalized);
    if (registered.duplicate) {
      return jsonResponse({ ok: true, duplicate: true }, { status: 202 });
    }

    try {
      const runtimeConfig = await getAgentRuntimeConfig(supabase, instance.workspace_id);
      let conversation = await upsertConversation(supabase, instance, normalized);
      const existingMessage = normalized.externalMessageId
        ? await findExistingMessage(supabase, instance.workspace_id, normalized.externalMessageId)
        : null;
      const recentOutbound =
        normalized.direction === "outbound" && !existingMessage
          ? await findRecentCalliaOutbound(supabase, conversation.id, normalized.content)
          : null;
      const phoneReply = isPhoneHumanReply({
        fromMe: normalized.direction === "outbound",
        existingMessage,
        matchingRecentOutbound: recentOutbound,
      });

      if (
        normalized.direction === "inbound" &&
        normalized.sender === "customer" &&
        shouldReturnConversationToBot({
          mode: conversation.mode,
          metadata: conversation.metadata,
        })
      ) {
        const { data, error } = await supabase
          .from("conversations")
          .update({
            mode: "bot",
            assigned_agent_id: null,
            metadata: buildBotResumeMetadata(conversation.metadata),
          })
          .eq("id", conversation.id)
          .select("*")
          .single();
        if (error) throw error;
        conversation = data;
      }

      if (phoneReply) {
        const { data, error } = await supabase
          .from("conversations")
          .update({
            mode: "human",
            assigned_agent_id: null,
            metadata: buildPhoneHandoffMetadata(
              conversation.metadata,
              runtimeConfig.humanPauseHours,
            ),
          })
          .eq("id", conversation.id)
          .select("*")
          .single();
        if (error) throw error;
        conversation = data;
      }

      const normalizedMessage = phoneReply ? markMessageAsPhoneReply(normalized) : normalized;

      const reconciledMessage = recentOutbound
        ? await reconcileCalliaEcho(supabase, recentOutbound, normalized.externalMessageId)
        : null;
      const message = reconciledMessage ?? await insertMessage(
        supabase,
        instance,
        conversation,
        normalizedMessage,
        existingMessage,
      );

      if (normalized.direction === "inbound" && normalized.sender === "customer") {
        await triggerWebhookDispatch({
          workspaceId: instance.workspace_id,
          event: "message.received",
          payload: {
            workspaceId: instance.workspace_id,
            conversationId: conversation.id,
            whatsappInstanceId: instance.id,
            instanceId: instance.id,
            conversationMode: conversation.mode,
            messageId: message.id,
            customerPhone: conversation.customer_phone,
            customerName: conversation.customer_name,
            type: message.type,
            content: message.content,
            mediaUrl: message.media_url,
            transcription: message.transcription,
            externalId: message.external_id,
            direction: message.direction,
            receivedAt: message.created_at,
          },
          correlationId: crypto.randomUUID(),
        });
      }

      if (phoneReply) {
        await triggerWebhookDispatch({
          workspaceId: instance.workspace_id,
          event: "conversation.handoff",
          payload: {
            workspaceId: instance.workspace_id,
            conversationId: conversation.id,
            whatsappInstanceId: instance.id,
            instanceId: instance.id,
            customerPhone: conversation.customer_phone,
            customerName: conversation.customer_name,
            mode: conversation.mode,
            reason: "phone_reply",
            humanUntil: conversation.metadata?.human_until ?? null,
            handoffAt: conversation.metadata?.handoff_at ?? new Date().toISOString(),
          },
          correlationId: crypto.randomUUID(),
        });
      }

      await supabase
        .from("inbound_events")
        .update({
          processing_status: "processed",
          message_id: message.id,
          processed_at: new Date().toISOString(),
        })
        .eq("id", registered.event.id);

      if (
        normalized.direction === "inbound" &&
        normalized.sender === "customer" &&
        !runtimeConfig.externalAgentEnabled
      ) {
        await triggerProcessMessage({
          workspaceId: instance.workspace_id,
          conversationId: conversation.id,
          messageId: message.id,
          correlationId: crypto.randomUUID(),
        });
      }

      await triggerPendingWebhookDispatch(instance.workspace_id);

      return jsonResponse(
        {
          ok: true,
          conversationId: conversation.id,
          messageId: message.id,
        },
        { status: 202 },
      );
    } catch (error) {
      await supabase
        .from("inbound_events")
        .update({
          processing_status: "failed",
          processed_at: new Date().toISOString(),
          payload: {
            ...payload,
            processing_error: error instanceof Error ? error.message : "unknown_error",
          },
        })
        .eq("id", registered.event.id);

      throw error;
    }
  }

  return jsonResponse({ ok: true }, { status: 202 });
});
