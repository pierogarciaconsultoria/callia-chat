// @ts-nocheck
import { sendEvolutionMedia, sendEvolutionText } from "./evolution.ts";
import { triggerWebhookDispatch, triggerPendingWebhookDispatch } from "./webhooks.ts";

export async function resolveSendingInstance(supabase, input) {
  if (input.instanceId) {
    const { data } = await supabase
      .from("whatsapp_instances")
      .select("*")
      .eq("workspace_id", input.workspaceId)
      .eq("id", input.instanceId)
      .maybeSingle();
    if (data) return data;
  }

  if (input.conversationId) {
    const { data: conversation } = await supabase
      .from("conversations")
      .select("whatsapp_instance_id")
      .eq("id", input.conversationId)
      .maybeSingle();

    if (conversation?.whatsapp_instance_id) {
      const { data } = await supabase
        .from("whatsapp_instances")
        .select("*")
        .eq("workspace_id", input.workspaceId)
        .eq("id", conversation.whatsapp_instance_id)
        .maybeSingle();
      if (data) return data;
    }
  }

  const { data: defaultInstance } = await supabase
    .from("whatsapp_instances")
    .select("*")
    .eq("workspace_id", input.workspaceId)
    .eq("is_default", true)
    .maybeSingle();

  if (defaultInstance) return defaultInstance;

  const { data: firstInstance } = await supabase
    .from("whatsapp_instances")
    .select("*")
    .eq("workspace_id", input.workspaceId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return firstInstance;
}

export async function createOutboundMessageRecord(supabase, input) {
  const { data: message, error } = await supabase
    .from("messages")
    .insert({
      workspace_id: input.workspaceId,
      conversation_id: input.conversationId,
      direction: "outbound",
      sender: input.sender ?? "bot",
      agent_user_id: input.agentUserId ?? null,
      type: input.type ?? "text",
      content: input.content ?? null,
      media_url: input.mediaUrl ?? null,
      transcription: input.transcription ?? null,
      ai_model: input.aiModel ?? null,
      tokens_used: input.tokensUsed ?? null,
      metadata: input.metadata ?? {},
    })
    .select("*")
    .single();

  if (error) throw error;

  const { data: outbound, error: outboundError } = await supabase
    .from("outbound_messages")
    .insert({
      workspace_id: input.workspaceId,
      conversation_id: input.conversationId,
      whatsapp_instance_id: input.instanceId ?? null,
      message_id: message.id,
      provider: "evolution",
      payload: {
        text: input.content ?? null,
        mediaUrl: input.mediaUrl ?? null,
        mimeType: input.mimeType ?? null,
        correlationId: input.correlationId ?? null,
      },
      delivery_status: "queued",
      correlation_id: input.correlationId ?? undefined,
    })
    .select("*")
    .single();

  if (outboundError) throw outboundError;

  return { message, outbound };
}

export function extractProviderMessageId(raw) {
  return raw?.key?.id ?? raw?.messageId ?? raw?.id ?? null;
}

export async function deliverOutboundMessage(supabase, input) {
  const instance = await resolveSendingInstance(supabase, {
    workspaceId: input.workspaceId,
    instanceId: input.instanceId,
    conversationId: input.conversationId,
  });

  if (!instance) {
    throw new Error("instance_not_available");
  }

  await supabase
    .from("outbound_messages")
    .update({
      whatsapp_instance_id: instance.id,
      delivery_status: "sending",
    })
    .eq("id", input.outboundMessageId);

  const raw = input.mediaUrl
    ? await sendEvolutionMedia({
        instance,
        phoneNumber: input.phoneNumber,
        mediaUrl: input.mediaUrl,
        caption: input.text,
        mimeType: input.mimeType,
      })
    : await sendEvolutionText({
        instance,
        phoneNumber: input.phoneNumber,
        text: input.text,
      });

  const providerMessageId = extractProviderMessageId(raw);
  await supabase
    .from("outbound_messages")
    .update({
      whatsapp_instance_id: instance.id,
      delivery_status: "sent",
      provider_message_id: providerMessageId,
      sent_at: new Date().toISOString(),
      payload: {
        ...((input.outboundPayload ?? {}) as Record<string, unknown>),
        response: raw,
      },
    })
    .eq("id", input.outboundMessageId);

  await supabase
    .from("messages")
    .update({
      external_id: providerMessageId,
      metadata: {
        ...((input.messageMetadata ?? {}) as Record<string, unknown>),
        provider_message_id: providerMessageId,
        provider_response: raw,
      },
    })
    .eq("id", input.messageId);

  if (input.conversationId) {
    await supabase
      .from("conversations")
      .update({
        whatsapp_instance_id: instance.id,
        last_message_at: new Date().toISOString(),
      })
      .eq("id", input.conversationId);
  }

  await triggerWebhookDispatch({
    workspaceId: input.workspaceId,
    event: "message.sent",
    payload: {
      workspaceId: input.workspaceId,
      conversationId: input.conversationId ?? null,
      whatsappInstanceId: instance.id,
      outboundMessageId: input.outboundMessageId,
      messageId: input.messageId,
      phoneNumber: input.phoneNumber,
      text: input.text ?? null,
      mediaUrl: input.mediaUrl ?? null,
      mimeType: input.mimeType ?? null,
      providerMessageId,
      provider: "evolution",
      direction: "outbound",
      sentAt: new Date().toISOString(),
    },
    correlationId: (input.outboundPayload ?? {})?.correlationId ?? undefined,
  });

  await triggerPendingWebhookDispatch(input.workspaceId);

  return {
    instance,
    raw,
    providerMessageId,
  };
}
