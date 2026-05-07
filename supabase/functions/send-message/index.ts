// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders, jsonResponse, requireWorkspaceMemberContext } from "../_shared/auth.ts";
import { createOutboundMessageRecord, deliverOutboundMessage } from "../_shared/outbound.ts";

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
    const {
      userId,
      workspaceId,
      supabase,
      body,
    } = await requireWorkspaceMemberContext(request);
    const conversationId =
      typeof body.conversationId === "string" ? body.conversationId : null;
    const instanceId = typeof body.instanceId === "string" ? body.instanceId : null;
    const inputPhoneNumber =
      typeof body.phoneNumber === "string" ? body.phoneNumber.trim() : null;
    const text = typeof body.text === "string" ? body.text : "";
    const mediaUrl = typeof body.mediaUrl === "string" ? body.mediaUrl : null;
    const mimeType = typeof body.mimeType === "string" ? body.mimeType : null;
    const sender = body.sender === "agent" ? "agent" : "bot";
    const metadata = asRecord(body.metadata) ?? {};
    const correlationId =
      typeof body.correlationId === "string" ? body.correlationId : crypto.randomUUID();

    if (!workspaceId || !conversationId || (!inputPhoneNumber && !conversationId) || (!text && !mediaUrl)) {
      return jsonResponse({ error: "invalid_payload" }, { status: 400 });
    }

    const { data: conversation } = await supabase
      .from("conversations")
      .select("id, customer_phone")
      .eq("workspace_id", workspaceId)
      .eq("id", conversationId)
      .maybeSingle();

    if (!conversation) {
      return jsonResponse({ error: "conversation_not_found" }, { status: 404 });
    }

    const phoneNumber = inputPhoneNumber || conversation.customer_phone;
    if (!phoneNumber) {
      return jsonResponse({ error: "phone_required" }, { status: 400 });
    }

    const outbound = await createOutboundMessageRecord(supabase, {
      workspaceId,
      conversationId,
      instanceId,
      content: text || null,
      mediaUrl,
      mimeType,
      type: mediaUrl ? "image" : "text",
      sender,
      agentUserId: sender === "agent" ? userId : null,
      correlationId,
      metadata: {
        ...metadata,
        generated_by: sender === "agent" ? "human-inbox" : "send-message",
      },
    });

    const delivered = await deliverOutboundMessage(supabase, {
      workspaceId,
      conversationId,
      instanceId,
      phoneNumber,
      text,
      mediaUrl,
      mimeType,
      messageId: outbound.message.id,
      outboundMessageId: outbound.outbound.id,
      messageMetadata: outbound.message.metadata,
      outboundPayload: outbound.outbound.payload,
    });

    return jsonResponse(
      {
        ok: true,
        messageId: outbound.message.id,
        outboundMessageId: outbound.outbound.id,
        providerMessageId: delivered.providerMessageId,
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unexpected_error";
    return jsonResponse({ error: message }, { status: 500 });
  }
});
