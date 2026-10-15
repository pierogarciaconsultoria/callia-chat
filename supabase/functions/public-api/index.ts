// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders, createServiceClient, jsonResponse } from "../_shared/auth.ts";
import { getClientIp, sha256Hex } from "../_shared/api-keys.ts";
import { createOutboundMessageRecord, deliverOutboundMessage, resolveSendingInstance } from "../_shared/outbound.ts";
import { createSupabaseIngestStore, ingestExternalMessage, parseIngestPayload } from "../_shared/ingest.ts";
import { embedTexts } from "../_shared/agent.ts";
import { triggerPendingWebhookDispatch, triggerWebhookDispatch } from "../_shared/webhooks.ts";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getSubpath(request: Request) {
  const pathname = new URL(request.url).pathname;
  const marker = "/public-api";
  const index = pathname.indexOf(marker);
  if (index < 0) return "/";

  const subpath = pathname.slice(index + marker.length);
  return subpath || "/";
}

function parseLimit(url: URL, fallback = 50, max = 200) {
  const raw = Number(url.searchParams.get("limit") ?? fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(Math.max(Math.trunc(raw), 1), max);
}

function parseMessagePayload(payload: unknown) {
  const body = asRecord(payload) ?? {};
  const phoneNumber = typeof body.phoneNumber === "string" ? body.phoneNumber.trim() : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const instanceId = typeof body.instanceId === "string" ? body.instanceId : null;
  const idempotencyKey =
    typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : null;
  const metadata = asRecord(body.metadata) ?? {};

  if (!phoneNumber || !text) {
    throw new Error("invalid_message_payload");
  }

  return {
    phoneNumber,
    text,
    instanceId,
    idempotencyKey,
    metadata,
  };
}

function parseEventPayload(payload: unknown) {
  const body = asRecord(payload) ?? {};
  const event = typeof body.event === "string" ? body.event.trim() : "";
  const externalId = typeof body.externalId === "string" ? body.externalId.trim() : null;
  const metadata = asRecord(body.metadata) ?? {};
  const eventPayload = asRecord(body.payload) ?? {};

  if (!event) {
    throw new Error("invalid_event_payload");
  }

  return {
    event,
    externalId,
    payload: eventPayload,
    metadata,
  };
}

async function authenticateApiKey(supabase, request: Request) {
  const rawKey = request.headers.get("x-api-key")?.trim();
  if (!rawKey) {
    throw new Error("missing_api_key");
  }

  const separatorIndex = rawKey.indexOf("_");
  const prefix = separatorIndex > 0 ? rawKey.slice(0, separatorIndex) : null;
  if (!prefix) {
    throw new Error("invalid_api_key");
  }

  const keyHash = await sha256Hex(rawKey);
  const { data: apiKey } = await supabase
    .from("api_keys")
    .select("*")
    .eq("key_hash", keyHash)
    .maybeSingle();

  if (!apiKey) {
    throw new Error("api_key_not_found");
  }

  if (apiKey.prefix !== prefix) {
    throw new Error("api_key_prefix_mismatch");
  }

  if (apiKey.revoked_at) {
    throw new Error("api_key_revoked");
  }

  if (apiKey.expires_at && new Date(apiKey.expires_at).getTime() <= Date.now()) {
    throw new Error("api_key_expired");
  }

  return apiKey;
}

async function touchApiKeyUsage(supabase, apiKey, request: Request) {
  await supabase
    .from("api_keys")
    .update({
      last_used_at: new Date().toISOString(),
      last_used_ip: getClientIp(request),
      last_used_user_agent: request.headers.get("user-agent"),
    })
    .eq("id", apiKey.id);
}

async function logPublicApiRequest(supabase, input) {
  if (!input.workspaceId) return;

  await supabase
    .from("public_api_requests")
    .insert({
      workspace_id: input.workspaceId,
      api_key_id: input.apiKeyId ?? null,
      endpoint: input.endpoint,
      method: input.method,
      status_code: input.statusCode,
      request_body: input.requestBody ?? {},
      response_body: input.responseBody ?? null,
      correlation_id: input.correlationId,
      idempotency_key: input.idempotencyKey ?? null,
      error_code: input.errorCode ?? null,
    });
}

async function findExistingIdempotentResponse(supabase, input) {
  if (!input.idempotencyKey) return null;

  const { data } = await supabase
    .from("public_api_requests")
    .select("status_code, response_body")
    .eq("workspace_id", input.workspaceId)
    .eq("api_key_id", input.apiKeyId)
    .eq("endpoint", input.endpoint)
    .eq("method", input.method)
    .eq("idempotency_key", input.idempotencyKey)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data || data.status_code < 200 || data.status_code >= 300 || !data.response_body) {
    return null;
  }

  return data;
}

async function findOrCreateConversation(supabase, input) {
  const { data: existing } = await supabase
    .from("conversations")
    .select("*")
    .eq("workspace_id", input.workspaceId)
    .eq("customer_phone", input.phoneNumber)
    .maybeSingle();

  if (existing) {
    const { data, error } = await supabase
      .from("conversations")
      .update({
        whatsapp_instance_id: input.instanceId ?? existing.whatsapp_instance_id,
        last_message_at: new Date().toISOString(),
        is_closed: false,
        metadata: {
          ...((existing.metadata as Record<string, unknown> | null) ?? {}),
          last_public_api_send_at: new Date().toISOString(),
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
      workspace_id: input.workspaceId,
      whatsapp_instance_id: input.instanceId ?? null,
      customer_phone: input.phoneNumber,
      last_message_at: new Date().toISOString(),
      unread_count: 0,
      metadata: {
        created_by: "public-api",
        last_public_api_send_at: new Date().toISOString(),
      },
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createServiceClient();
  const url = new URL(request.url);
  const endpoint = getSubpath(request);
  const correlationId = crypto.randomUUID();
  let workspaceId = null;
  let apiKeyId = null;
  let requestBody: Record<string, unknown> = {};
  let idempotencyKey = null;

  try {
    const apiKey = await authenticateApiKey(supabase, request);
    workspaceId = apiKey.workspace_id;
    apiKeyId = apiKey.id;
    await touchApiKeyUsage(supabase, apiKey, request);

    if (request.method === "POST" && endpoint === "/messages/ingest") {
      // Record-only: never sends via WhatsApp and never triggers process-message.
      const rawBody = await request.json().catch(() => null);
      requestBody = rawBody && typeof rawBody === "object" ? rawBody : {};
      const payload = parseIngestPayload(rawBody);
      requestBody = payload;

      const result = await ingestExternalMessage(createSupabaseIngestStore(supabase), {
        workspaceId,
        apiKeyId,
        payload,
      });

      const statusCode = result.duplicate ? 200 : 201;
      const responseBody = {
        ok: true,
        duplicate: result.duplicate,
        conversationId: result.conversationId,
        messageId: result.messageId,
        sent: false,
      };

      await logPublicApiRequest(supabase, {
        workspaceId,
        apiKeyId,
        endpoint,
        method: request.method,
        statusCode,
        requestBody,
        responseBody,
        correlationId,
        idempotencyKey: payload.externalId,
      });

      return jsonResponse(responseBody, { status: statusCode });
    }

    if (request.method === "POST" && endpoint === "/messages") {
      const payload = parseMessagePayload(await request.json());
      requestBody = payload;
      idempotencyKey = payload.idempotencyKey;

      const existing = await findExistingIdempotentResponse(supabase, {
        workspaceId,
        apiKeyId,
        endpoint,
        method: request.method,
        idempotencyKey,
      });

      if (existing) {
        return jsonResponse(existing.response_body, { status: existing.status_code });
      }

      const targetInstance = await resolveSendingInstance(supabase, {
        workspaceId,
        instanceId: payload.instanceId,
      });

      if (!targetInstance) {
        throw new Error("instance_not_available");
      }

      const conversation = await findOrCreateConversation(supabase, {
        workspaceId,
        phoneNumber: payload.phoneNumber,
        instanceId: targetInstance.id,
      });

      const outbound = await createOutboundMessageRecord(supabase, {
        workspaceId,
        conversationId: conversation.id,
        instanceId: targetInstance.id,
        content: payload.text,
        type: "text",
        sender: "bot",
        correlationId,
        metadata: {
          ...payload.metadata,
          generated_by: "public-api",
          api_key_id: apiKeyId,
          idempotency_key: payload.idempotencyKey,
        },
      });

      const delivered = await deliverOutboundMessage(supabase, {
        workspaceId,
        conversationId: conversation.id,
        instanceId: targetInstance.id,
        phoneNumber: payload.phoneNumber,
        text: payload.text,
        messageId: outbound.message.id,
        outboundMessageId: outbound.outbound.id,
        messageMetadata: outbound.message.metadata,
        outboundPayload: outbound.outbound.payload,
      });

      const responseBody = {
        ok: true,
        conversationId: conversation.id,
        messageId: outbound.message.id,
        outboundMessageId: outbound.outbound.id,
        providerMessageId: delivered.providerMessageId,
        whatsappInstanceId: delivered.instance.id,
        instanceSelection: payload.instanceId ? "explicit" : "default",
      };

      await logPublicApiRequest(supabase, {
        workspaceId,
        apiKeyId,
        endpoint,
        method: request.method,
        statusCode: 200,
        requestBody,
        responseBody,
        correlationId,
        idempotencyKey,
      });

      return jsonResponse(responseBody, { status: 200 });
    }

    if (request.method === "POST" && endpoint === "/events") {
      const payload = parseEventPayload(await request.json());
      requestBody = payload;

      const { data, error } = await supabase
        .from("public_api_events")
        .insert({
          workspace_id: workspaceId,
          api_key_id: apiKeyId,
          event_name: payload.event,
          external_id: payload.externalId,
          payload: payload.payload,
          metadata: payload.metadata,
          correlation_id: correlationId,
        })
        .select("*")
        .single();

      if (error?.code === "23505" && payload.externalId) {
        const { data: existing } = await supabase
          .from("public_api_events")
          .select("*")
          .eq("workspace_id", workspaceId)
          .eq("event_name", payload.event)
          .eq("external_id", payload.externalId)
          .maybeSingle();

        const responseBody = {
          ok: true,
          duplicate: true,
          eventId: existing?.id ?? null,
          correlationId: existing?.correlation_id ?? correlationId,
        };

        await logPublicApiRequest(supabase, {
          workspaceId,
          apiKeyId,
          endpoint,
          method: request.method,
          statusCode: 200,
          requestBody,
          responseBody,
          correlationId,
        });

        return jsonResponse(responseBody, { status: 200 });
      }

      if (error) throw error;

      const responseBody = {
        ok: true,
        eventId: data.id,
        correlationId: data.correlation_id,
      };

      await triggerWebhookDispatch({
        workspaceId,
        event: "public_api.event.received",
        payload: {
          workspaceId,
          apiKeyId,
          publicApiEventId: data.id,
          event: payload.event,
          externalId: payload.externalId,
          payload: payload.payload,
          metadata: payload.metadata,
          correlationId: data.correlation_id,
        },
        correlationId: data.correlation_id,
      });

      await triggerPendingWebhookDispatch(workspaceId);

      await logPublicApiRequest(supabase, {
        workspaceId,
        apiKeyId,
        endpoint,
        method: request.method,
        statusCode: 201,
        requestBody,
        responseBody,
        correlationId,
      });

      return jsonResponse(responseBody, { status: 201 });
    }

    if (request.method === "GET" && endpoint === "/conversations") {
      const limit = parseLimit(url, 50, 200);
      requestBody = {
        instanceId: url.searchParams.get("instance_id"),
        mode: url.searchParams.get("mode"),
        limit,
      };

      const builder = supabase
        .from("conversations")
        .select(`
          *,
          whatsapp_instance:whatsapp_instances(
            id,
            instance_name,
            display_name,
            phone_number,
            status,
            is_default
          )
        `)
        .eq("workspace_id", workspaceId)
        .order("last_message_at", { ascending: false })
        .limit(limit);

      const instanceId = url.searchParams.get("instance_id");
      const mode = url.searchParams.get("mode");
      if (instanceId) builder.eq("whatsapp_instance_id", instanceId);
      if (mode === "bot" || mode === "human") builder.eq("mode", mode);

      const { data, error } = await builder;
      if (error) throw error;

      const responseBody = {
        ok: true,
        conversations: data ?? [],
      };

      await logPublicApiRequest(supabase, {
        workspaceId,
        apiKeyId,
        endpoint,
        method: request.method,
        statusCode: 200,
        requestBody,
        responseBody,
        correlationId,
      });

      return jsonResponse(responseBody, { status: 200 });
    }

    const messagesMatch = endpoint.match(/^\/conversations\/([a-z0-9-]+)\/messages$/i);
    if (request.method === "GET" && messagesMatch) {
      const conversationId = messagesMatch[1];
      const limit = parseLimit(url, 200, 500);
      requestBody = {
        conversationId,
        limit,
      };

      const { data: conversation } = await supabase
        .from("conversations")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("id", conversationId)
        .maybeSingle();

      if (!conversation) {
        throw new Error("conversation_not_found");
      }

      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(limit);

      if (error) throw error;

      const responseBody = {
        ok: true,
        conversationId,
        messages: data ?? [],
      };

      await logPublicApiRequest(supabase, {
        workspaceId,
        apiKeyId,
        endpoint,
        method: request.method,
        statusCode: 200,
        requestBody,
        responseBody,
        correlationId,
      });

      return jsonResponse(responseBody, { status: 200 });
    }

    if (request.method === "GET" && endpoint === "/knowledge/search") {
      const query = (url.searchParams.get("q") ?? "").trim();
      const limit = parseLimit(url, 5, 20);
      requestBody = { q: query, limit };

      if (!query) {
        throw new Error("invalid_search_query");
      }

      const [queryEmbedding] = await embedTexts([query]);

      const { data, error } = await supabase.rpc("knowledge_search", {
        _workspace_id: workspaceId,
        _query: query,
        _query_embedding: queryEmbedding ?? null,
        _limit: limit,
      });

      if (error) throw error;

      const responseBody = {
        ok: true,
        results: (data ?? []).map((row) => ({
          title: row.title,
          content: row.content,
          category: row.category,
          score: row.score,
        })),
      };

      await logPublicApiRequest(supabase, {
        workspaceId,
        apiKeyId,
        endpoint,
        method: request.method,
        statusCode: 200,
        requestBody,
        responseBody,
        correlationId,
      });

      return jsonResponse(responseBody, { status: 200 });
    }

    if (request.method === "GET" && endpoint === "/agent/context") {
      requestBody = {};

      const { data, error } = await supabase
        .from("agent_configs")
        .select(
          "persona_prompt, language, business_hours, website_url, payment_links, handoff_keywords",
        )
        .eq("workspace_id", workspaceId)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        throw new Error("agent_config_not_found");
      }

      const responseBody = {
        ok: true,
        ...data,
      };

      await logPublicApiRequest(supabase, {
        workspaceId,
        apiKeyId,
        endpoint,
        method: request.method,
        statusCode: 200,
        requestBody,
        responseBody,
        correlationId,
      });

      return jsonResponse(responseBody, { status: 200 });
    }

    throw new Error("endpoint_not_found");
  } catch (error) {
    const message = error instanceof Error ? error.message : "unexpected_error";
    const status =
      message === "missing_api_key" || message === "invalid_api_key" || message === "api_key_not_found" || message === "api_key_prefix_mismatch"
        ? 401
        : message === "api_key_revoked" || message === "api_key_expired"
          ? 403
          : message === "invalid_message_payload" || message === "invalid_event_payload" || message === "invalid_ingest_payload" || message === "invalid_search_query"
            ? 400
            : message === "conversation_not_found" || message === "endpoint_not_found" || message === "instance_not_available" || message === "agent_config_not_found"
              ? 404
              : 500;

    const responseBody = { error: message, correlationId };

    await logPublicApiRequest(supabase, {
      workspaceId,
      apiKeyId,
      endpoint,
      method: request.method,
      statusCode: status,
      requestBody,
      responseBody,
      correlationId,
      idempotencyKey,
      errorCode: message,
    }).catch(() => null);

    return jsonResponse(responseBody, { status });
  }
});
