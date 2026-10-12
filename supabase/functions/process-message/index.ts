// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders, createServiceClient, jsonResponse } from "../_shared/auth.ts";
import {
  analyzeImage,
  buildFallbackReply,
  buildSystemPrompt,
  buildUserPrompt,
  generateAiReply,
  shouldTriggerHandoff,
  transcribeAudio,
} from "../_shared/agent.ts";
import { createOutboundMessageRecord, deliverOutboundMessage, resolveSendingInstance } from "../_shared/outbound.ts";
import { buildExternalAgentPayload, callExternalAgent, isAllowedSecretRef } from "../_shared/external-agent.ts";
import { triggerPendingWebhookDispatch, triggerWebhookDispatch } from "../_shared/webhooks.ts";

function getEnv(name: string) {
  return (globalThis as { Deno?: { env?: { get: (key: string) => string | undefined } } }).Deno?.env?.get(name);
}

function buildHistorySnippet(messages) {
  return (messages ?? [])
    .slice(-12)
    .map((message) => {
      const actor =
        message.direction === "inbound"
          ? "Cliente"
          : message.sender === "agent"
            ? "Atendente"
            : message.sender === "system"
              ? "Sistema"
              : "Bot";
      const content = message.content ?? message.transcription ?? "[sem conteúdo]";
      return `${actor}: ${content}`;
    })
    .join("\n");
}

async function updateConversationForHandoff(supabase, conversation, reason) {
  const { data, error } = await supabase
    .from("conversations")
    .update({
      mode: "human",
      metadata: {
        ...((conversation.metadata as Record<string, unknown> | null) ?? {}),
        handoff_reason: reason,
        handoff_at: new Date().toISOString(),
      },
    })
    .eq("id", conversation.id)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

async function markOutboundFailure(supabase, outboundId, message) {
  await supabase
    .from("outbound_messages")
    .update({
      delivery_status: "failed",
      last_error: message,
      retry_count: 1,
    })
    .eq("id", outboundId);
}

async function logWorkspaceEvent(supabase, workspaceId, action, target, metadata) {
  await supabase
    .from("audit_logs")
    .insert({ workspace_id: workspaceId, actor_type: "system", actor_id: "process-message", action, target, metadata })
    .then(() => null, () => null);
}

// Returns a response body when the external agent handled the message, or null to fall back
// to the internal pipeline. Never throws for agent failures.
async function tryExternalAgent(supabase, ctx) {
  const { workspaceId, conversation, message, agentConfig, history, messageText, correlationId } = ctx;
  const baseMeta = (message.metadata as Record<string, unknown> | null) ?? {};

  // Idempotency: claim the message atomically so the agent is called at most once per message_id.
  const attemptedAt = new Date().toISOString();
  const { data: claimed } = await supabase
    .from("messages")
    .update({ metadata: { ...baseMeta, external_agent: { status: "calling", attempted_at: attemptedAt } } })
    .eq("id", message.id)
    .is("metadata->external_agent", null)
    .select("id");

  if (!claimed || claimed.length === 0) {
    const { data: existingReply } = await supabase
      .from("messages")
      .select("id")
      .eq("conversation_id", conversation.id)
      .eq("direction", "outbound")
      .eq("metadata->>source_message_id", message.id)
      .limit(1)
      .maybeSingle();
    if (existingReply) {
      return { ok: true, skipped: "already_processed", conversationId: conversation.id, replyMessageId: existingReply.id };
    }
    return null; // already attempted without reply: use internal pipeline, do not call agent again
  }

  const setStatus = async (status, extra = {}) => {
    await supabase
      .from("messages")
      .update({ metadata: { ...baseMeta, external_agent: { status, attempted_at: attemptedAt, ...extra } } })
      .eq("id", message.id);
  };

  const fail = async (error, details = {}) => {
    await setStatus("failed", { error });
    await logWorkspaceEvent(supabase, workspaceId, "external_agent.failed", message.id, {
      error,
      conversation_id: conversation.id,
      correlation_id: correlationId,
      ...details,
    });
    return null;
  };

  const secretRef = agentConfig.external_agent_secret_ref;
  const secret = secretRef && isAllowedSecretRef(secretRef) ? getEnv(secretRef) : null;
  if (!agentConfig.external_agent_url) return await fail("missing_url");
  if (secretRef && !isAllowedSecretRef(secretRef)) return await fail("secret_ref_not_allowed", { secret_ref: secretRef });
  if (secretRef && !secret) return await fail("secret_not_found", { secret_ref: secretRef });

  const payload = buildExternalAgentPayload({
    workspaceId,
    conversationId: conversation.id,
    conversation,
    message,
    messageText,
    history,
  });

  const result = await callExternalAgent({
    url: agentConfig.external_agent_url,
    secret: secret ?? "",
    timeoutMs: agentConfig.external_agent_timeout_ms ?? 25000,
    payload,
  });

  if (!result.ok) {
    return await fail(result.error, { status: result.status, duration_ms: result.durationMs, body: result.body });
  }

  const { reply, handoff, media } = result.value;
  const instance = await resolveSendingInstance(supabase, {
    workspaceId,
    conversationId: conversation.id,
    instanceId: conversation.whatsapp_instance_id,
  });
  const instanceId = instance?.id ?? conversation.whatsapp_instance_id;
  const sentIds = [];

  const send = async (item) => {
    const outbound = await createOutboundMessageRecord(supabase, {
      workspaceId,
      conversationId: conversation.id,
      instanceId,
      content: item.text || null,
      mediaUrl: item.mediaUrl ?? null,
      mimeType: item.mediaType ?? null,
      type: item.mediaType ?? "text",
      sender: "bot",
      correlationId,
      metadata: { generated_by: "external-agent", source_message_id: message.id },
    });
    sentIds.push(outbound.message.id);
    try {
      await deliverOutboundMessage(supabase, {
        workspaceId,
        conversationId: conversation.id,
        instanceId,
        phoneNumber: conversation.customer_phone,
        text: item.text ?? "",
        mediaUrl: item.mediaUrl ?? null,
        mimeType: item.mediaType ?? null,
        messageId: outbound.message.id,
        outboundMessageId: outbound.outbound.id,
        messageMetadata: outbound.message.metadata,
        outboundPayload: outbound.outbound.payload,
      });
    } catch (error) {
      await markOutboundFailure(supabase, outbound.outbound.id, error instanceof Error ? error.message : "send_failed");
    }
  };

  if (reply) await send({ text: reply });
  for (const item of media) {
    await send({ text: item.caption ?? "", mediaUrl: item.url, mediaType: item.type });
  }

  if (handoff) {
    const updated = await updateConversationForHandoff(supabase, conversation, "external_agent");
    await triggerWebhookDispatch({
      workspaceId,
      event: "conversation.handoff",
      payload: {
        workspaceId,
        conversationId: updated.id,
        whatsappInstanceId: updated.whatsapp_instance_id,
        customerPhone: updated.customer_phone,
        customerName: updated.customer_name,
        mode: updated.mode,
        reason: "external_agent",
        handoffAt: new Date().toISOString(),
      },
      correlationId,
    });
    await triggerPendingWebhookDispatch(workspaceId);
  }

  await setStatus("succeeded", { duration_ms: result.durationMs, reply_message_ids: sentIds, handoff });

  return {
    ok: true,
    conversationId: conversation.id,
    sourceMessageId: message.id,
    replyMessageIds: sentIds,
    handoff,
    usedExternalAgent: true,
  };
}

serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : null;
    const conversationId = typeof body.conversationId === "string" ? body.conversationId : null;
    const messageId = typeof body.messageId === "string" ? body.messageId : null;
    const correlationId =
      typeof body.correlationId === "string" ? body.correlationId : crypto.randomUUID();

    if (!workspaceId || !conversationId || !messageId) {
      return jsonResponse({ error: "invalid_payload" }, { status: 400 });
    }

    const supabase = createServiceClient();

    const [{ data: conversation }, { data: message }, { data: agentConfig }, { data: faqs }, { data: products }] =
      await Promise.all([
        supabase.from("conversations").select("*").eq("id", conversationId).maybeSingle(),
        supabase.from("messages").select("*").eq("id", messageId).maybeSingle(),
        supabase.from("agent_configs").select("*").eq("workspace_id", workspaceId).maybeSingle(),
        supabase.from("faqs").select("*").eq("workspace_id", workspaceId).eq("is_active", true),
        supabase.from("products").select("*").eq("workspace_id", workspaceId).eq("is_active", true),
      ]);

    if (!conversation || !message || !agentConfig) {
      return jsonResponse({ error: "not_found" }, { status: 404 });
    }

    if (conversation.mode === "human") {
      return jsonResponse({ ok: true, skipped: "conversation_in_human_mode" }, { status: 200 });
    }

    const { data: history } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    let mediaSummary = null;
    let messageText = message.content ?? "";
    let transcription = message.transcription ?? null;

    if (message.type === "audio" && message.media_url) {
      const transcriptionResult = await transcribeAudio(message.media_url);
      if (transcriptionResult?.text) {
        transcription = transcriptionResult.text;
        messageText = transcriptionResult.text;
        await supabase
          .from("messages")
          .update({ transcription: transcriptionResult.text })
          .eq("id", message.id);
      }
    }

    if (message.type === "image" && message.media_url) {
      const imageAnalysis = await analyzeImage(
        message.media_url,
        "Descreva a imagem com foco em atendimento comercial, produto, texto visível e intenção do cliente.",
      );
      if (imageAnalysis?.text) {
        mediaSummary = imageAnalysis.text;
        if (!messageText) {
          messageText = imageAnalysis.text;
        }
      }
    }

    if (!messageText) {
      messageText = transcription ?? mediaSummary ?? "";
    }

    const shouldHandoff = shouldTriggerHandoff(
      `${messageText} ${mediaSummary ?? ""}`.trim(),
      agentConfig.handoff_keywords ?? [],
    );

    if (shouldHandoff) {
      const updatedConversation = await updateConversationForHandoff(
        supabase,
        conversation,
        "keyword_match",
      );

      await triggerWebhookDispatch({
        workspaceId,
        event: "conversation.handoff",
        payload: {
          workspaceId,
          conversationId: updatedConversation.id,
          whatsappInstanceId: updatedConversation.whatsapp_instance_id,
          customerPhone: updatedConversation.customer_phone,
          customerName: updatedConversation.customer_name,
          mode: updatedConversation.mode,
          reason: "keyword_match",
          handoffAt: new Date().toISOString(),
        },
        correlationId,
      });

      const outbound = await createOutboundMessageRecord(supabase, {
        workspaceId,
        conversationId,
        instanceId: updatedConversation.whatsapp_instance_id,
        content:
          "Vou encaminhar seu atendimento para um atendente humano para te ajudar melhor.",
        type: "text",
        sender: "bot",
        correlationId,
        metadata: {
          generated_by: "handoff-rule",
        },
      });

      try {
        await deliverOutboundMessage(supabase, {
          workspaceId,
          conversationId,
          instanceId: updatedConversation.whatsapp_instance_id,
          phoneNumber: conversation.customer_phone,
          text: outbound.message.content,
          messageId: outbound.message.id,
          outboundMessageId: outbound.outbound.id,
          messageMetadata: outbound.message.metadata,
          outboundPayload: outbound.outbound.payload,
        });
      } catch (error) {
        await markOutboundFailure(
          supabase,
          outbound.outbound.id,
          error instanceof Error ? error.message : "handoff_delivery_failed",
        );
      }

      await triggerPendingWebhookDispatch(workspaceId);

      return jsonResponse(
        {
          ok: true,
          handoff: true,
          conversationId,
          messageId: outbound.message.id,
        },
        { status: 200 },
      );
    }

    if (agentConfig.external_agent_enabled === true) {
      try {
        const externalResult = await tryExternalAgent(supabase, {
          workspaceId,
          conversation,
          message,
          agentConfig,
          history: history ?? [],
          messageText,
          correlationId,
        });
        if (externalResult) {
          return jsonResponse(externalResult, { status: 200 });
        }
      } catch (error) {
        await logWorkspaceEvent(supabase, workspaceId, "external_agent.failed", messageId, {
          error: error instanceof Error ? error.message : "unexpected_error",
          conversation_id: conversationId,
          correlation_id: correlationId,
        });
        const { data: partialReply } = await supabase
          .from("messages")
          .select("id")
          .eq("conversation_id", conversationId)
          .eq("metadata->>source_message_id", messageId)
          .limit(1)
          .maybeSingle();
        if (partialReply) {
          return jsonResponse({ ok: true, conversationId, replyMessageId: partialReply.id, partial: true }, { status: 200 });
        }
      }
    }

    const systemPrompt = buildSystemPrompt({
      personaPrompt: agentConfig.persona_prompt,
      faqs: faqs ?? [],
      products: products ?? [],
      paymentLinks: agentConfig.payment_links ?? [],
      websiteUrl: agentConfig.website_url,
      businessHours: agentConfig.business_hours,
    });

    const userPrompt = buildUserPrompt({
      historySnippet: buildHistorySnippet(history ?? []),
      messageText: messageText || "[mensagem sem texto reconhecido]",
      mediaSummary,
    });

    const aiReply = await generateAiReply({
      model: agentConfig.ai_model ?? getEnv("AI_DEFAULT_MODEL") ?? "gpt-4o-mini",
      systemPrompt,
      userPrompt,
    });

    const replyText =
      aiReply?.text?.trim() ||
      buildFallbackReply({
        messageText,
        messageType: message.type,
        faqs: faqs ?? [],
        products: products ?? [],
        paymentLinks: agentConfig.payment_links ?? [],
        mediaSummary,
      });

    const targetInstance = await resolveSendingInstance(supabase, {
      workspaceId,
      conversationId,
      instanceId: conversation.whatsapp_instance_id,
    });

    const outbound = await createOutboundMessageRecord(supabase, {
      workspaceId,
      conversationId,
      instanceId: targetInstance?.id ?? conversation.whatsapp_instance_id,
      content: replyText,
      type: "text",
      sender: "bot",
      aiModel: aiReply?.model ?? null,
      tokensUsed: aiReply?.tokensUsed ?? null,
      correlationId,
      metadata: {
        generated_by: aiReply ? "ai-provider" : "fallback-rules",
        media_summary: mediaSummary,
        source_message_id: message.id,
      },
    });

    try {
      const delivered = await deliverOutboundMessage(supabase, {
        workspaceId,
        conversationId,
        instanceId: targetInstance?.id ?? conversation.whatsapp_instance_id,
        phoneNumber: conversation.customer_phone,
        text: replyText,
        messageId: outbound.message.id,
        outboundMessageId: outbound.outbound.id,
        messageMetadata: outbound.message.metadata,
        outboundPayload: outbound.outbound.payload,
      });

      await supabase
        .from("conversations")
        .update({
          whatsapp_instance_id: delivered.instance.id,
          last_message_at: new Date().toISOString(),
          metadata: {
            ...((conversation.metadata as Record<string, unknown> | null) ?? {}),
            last_bot_reply_at: new Date().toISOString(),
            last_ai_model: aiReply?.model ?? "fallback-rules",
          },
        })
        .eq("id", conversationId);
    } catch (error) {
      await markOutboundFailure(
        supabase,
        outbound.outbound.id,
        error instanceof Error ? error.message : "send_failed",
      );
      throw error;
    }

    return jsonResponse(
      {
        ok: true,
        conversationId,
        sourceMessageId: messageId,
        replyMessageId: outbound.message.id,
        handoff: false,
        usedAi: Boolean(aiReply),
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unexpected_error";
    return jsonResponse({ error: message }, { status: 500 });
  }
});
