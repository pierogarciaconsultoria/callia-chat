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
