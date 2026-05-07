import { describe, expect, it } from "vitest";
import {
  extractApiKeyFromHeaders,
  publicApiMessageSchema,
  validatePublicApiMessageInput,
} from "@/lib/runtime/api-keys";
import { HeaderApiKeyAuthenticator } from "@/lib/runtime/authenticator";
import { bootstrapRuntime } from "@/lib/runtime/bootstrap";
import { createPublicApiRequestContext } from "@/lib/runtime/context";
import { createRuntimeError, toErrorResponse } from "@/lib/runtime/errors";
import { createEvolutionWhatsAppProvider } from "@/lib/runtime/evolution";
import { handleRuntimeRequest } from "@/lib/runtime/handler";
import { jsonResponse, noContentResponse, readJsonRequest } from "@/lib/runtime/http";
import {
  createExecutionContext,
  createLogEvent,
} from "@/lib/runtime/observability";
import {
  createAiProviderStub,
  createEvolutionWhatsAppStub,
} from "@/lib/runtime/provider-stubs";
import { createRuntimeRegistry } from "@/lib/runtime/registry";
import {
  InMemoryProviderSecretStore,
  resolveProviderSecret,
} from "@/lib/runtime/secrets";
import {
  normalizedInboundEventSchema,
  processMessageCommandSchema,
} from "@/lib/runtime/validation";
import type { WhatsAppProvider } from "@/lib/runtime/providers";

describe("runtime backend foundation", () => {
  it("extracts and masks x-api-key headers", () => {
    const result = extractApiKeyFromHeaders({
      "x-api-key": "ah_live_1234567890",
    });

    expect(result.prefix).toBe("ah");
    expect(result.masked).toBe("ah_l****7890");
  });

  it("validates public API message payloads", () => {
    const payload = validatePublicApiMessageInput({
      phoneNumber: "+5511999999999",
      text: "Ola, tudo bem?",
      idempotencyKey: "msg-123",
    });

    expect(payload.phoneNumber).toBe("+5511999999999");
    expect(payload.text).toBe("Ola, tudo bem?");
  });

  it("creates consistent runtime error responses", () => {
    const response = toErrorResponse(
      createRuntimeError("BAD_REQUEST", "Payload invalido."),
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("BAD_REQUEST");
  });

  it("creates correlated log events", () => {
    const context = createExecutionContext({
      correlationId: "3f0c5f13-33b3-4e91-aa93-6cfb95c57074",
      workspaceId: "ws-1",
    });

    const event = createLogEvent(context, {
      level: "info",
      message: "Webhook recebido",
      metadata: { provider: "evolution" },
    });

    expect(event.correlationId).toBe(context.correlationId);
    expect(event.workspaceId).toBe("ws-1");
  });

  it("validates normalized inbound events", () => {
    const result = normalizedInboundEventSchema.safeParse({
      workspaceId: "ca24f3dc-41c7-4c71-a3f7-9c667be0f1ea",
      whatsappInstanceId: "1f479a59-6db4-4de3-b668-59e7682fdb4b",
      provider: "evolution",
      eventType: "message.received",
      providerEventId: "evt-1",
      customerPhone: "+5511999999999",
      message: {
        type: "text",
        text: "Oi",
      },
      rawPayload: {},
    });

    expect(result.success).toBe(true);
  });

  it("validates process-message commands", () => {
    const result = processMessageCommandSchema.safeParse({
      workspaceId: "ca24f3dc-41c7-4c71-a3f7-9c667be0f1ea",
      conversationId: "9c978fd8-f2d0-48e5-ad25-d68c8bbf4842",
      messageId: "5c3d65b0-04c0-4958-ae6e-e612742a42b8",
      whatsappInstanceId: "1f479a59-6db4-4de3-b668-59e7682fdb4b",
      trigger: "inbound_message",
      correlationId: "3f0c5f13-33b3-4e91-aa93-6cfb95c57074",
    });

    expect(result.success).toBe(true);
  });

  it("authenticates a request through a resolver-backed header authenticator", async () => {
    const authenticator = new HeaderApiKeyAuthenticator({
      findByRawKey: async (rawKey) =>
        rawKey === "ah_live_1234567890"
          ? {
              apiKeyId: "api-key-1",
              workspaceId: "ws-1",
              keyName: "Principal",
              prefix: "ah",
              revokedAt: null,
            }
          : null,
    });

    const result = await authenticator.authenticate(
      new Headers({ "x-api-key": "ah_live_1234567890" }),
    );

    expect(result.workspaceId).toBe("ws-1");
    expect(result.apiKeyId).toBe("api-key-1");
  });

  it("creates public API execution context using the default instance", () => {
    const context = createPublicApiRequestContext({
      workspaceId: "ws-1",
      payload: {
        phoneNumber: "+5511999999999",
        text: "Mensagem de teste",
      },
      instances: [
        {
          id: "inst-1",
          workspaceId: "ws-1",
          instanceName: "principal",
          providerType: "evolution",
          providerSecretRef: "evolution:ws-1:instance:inst-1",
          isDefault: true,
          status: "connected",
        },
      ],
      correlationId: "3f0c5f13-33b3-4e91-aa93-6cfb95c57074",
    });

    expect(context.instanceSelection).toBe("default");
    expect(context.whatsappInstanceId).toBe("inst-1");
    expect(context.execution.correlationId).toBe(
      "3f0c5f13-33b3-4e91-aa93-6cfb95c57074",
    );
  });

  it("returns registered providers from the runtime registry", () => {
    const whatsappProvider: WhatsAppProvider = {
      connectInstance: async () => {},
      fetchInstanceStatus: async () => "connected",
      sendText: async () => ({ status: "sent" }),
      sendMedia: async () => ({ status: "sent" }),
      normalizeInboundEvent: async () => ({
        workspaceId: "ca24f3dc-41c7-4c71-a3f7-9c667be0f1ea",
        whatsappInstanceId: "1f479a59-6db4-4de3-b668-59e7682fdb4b",
        provider: "evolution",
        eventType: "message.received",
        providerEventId: "evt-1",
        customerPhone: "+5511999999999",
        message: { type: "text", text: "Oi" },
        rawPayload: {},
      }),
    };

    const registry = createRuntimeRegistry({
      whatsappProviders: { evolution: whatsappProvider },
      aiProvider: {
        generateText: async () => ({ text: "ok", model: "test-model" }),
      },
    });

    expect(registry.getWhatsAppProvider("evolution")).toBe(whatsappProvider);
    expect(registry.getAiProvider()).toBeTruthy();
  });

  it("resolves provider secrets with workspace validation", async () => {
    const secret = await resolveProviderSecret(
      new InMemoryProviderSecretStore({
        "evolution:ws-1:instance:inst-1": {
          baseUrl: "https://evolution.example.com",
          apiKey: "secret-key",
        },
      }),
      "evolution:ws-1:instance:inst-1",
      {
        expectedProvider: "evolution",
        expectedScope: "instance",
        expectedWorkspaceId: "ws-1",
      },
    );

    expect(secret.parsed.targetId).toBe("inst-1");
    expect(secret.value.baseUrl).toBe("https://evolution.example.com");
  });

  it("throws when a provider stub is called before implementation", async () => {
    const whatsappStub = createEvolutionWhatsAppStub();
    const aiStub = createAiProviderStub();

    await expect(
      whatsappStub.sendText({
        workspaceId: "ws-1",
        instanceId: "inst-1",
        phoneNumber: "+5511999999999",
        text: "Ola",
        correlationId: "3f0c5f13-33b3-4e91-aa93-6cfb95c57074",
      }),
    ).rejects.toThrow("Evolution sendText is not implemented yet.");

    await expect(
      aiStub.generateText({
        prompt: "Ola",
        correlationId: "3f0c5f13-33b3-4e91-aa93-6cfb95c57074",
      }),
    ).rejects.toThrow("AI generateText is not implemented yet.");
  });

  it("normalizes inbound payloads from the evolution provider", async () => {
    const provider = createEvolutionWhatsAppProvider({
      secretStore: new InMemoryProviderSecretStore(),
      resolveSecretRef: async () => null,
    });

    const event = await provider.normalizeInboundEvent({
      event: "messages.upsert",
      instance: "1f479a59-6db4-4de3-b668-59e7682fdb4b",
      data: {
        key: {
          id: "evt-1",
          remoteJid: "5511999999999@s.whatsapp.net",
        },
        message: {
          conversation: "Oi",
        },
        pushName: "Cliente Teste",
      },
    });

    expect(event.providerEventId).toBe("evt-1");
    expect(event.customerPhone).toBe("5511999999999");
    expect(event.message.text).toBe("Oi");
  });

  it("bootstraps runtime with evolution provider and stubs", () => {
    const runtime = bootstrapRuntime({
      secretStore: new InMemoryProviderSecretStore(),
      env: {
        VITE_RUNTIME_ENV: "development",
      },
      resolveEvolutionSecretRef: () => "evolution:ws-1:instance:inst-1",
    });

    expect(runtime.env.VITE_RUNTIME_ENV).toBe("development");
    expect(runtime.registry.getWhatsAppProvider("evolution")).toBeTruthy();
    expect(runtime.registry.getAiProvider()).toBeTruthy();
  });

  it("reads and validates JSON request payloads", async () => {
    const request = new Request("https://example.com", {
      method: "POST",
      body: JSON.stringify({
        phoneNumber: "+5511999999999",
        text: "Mensagem",
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    const payload = await readJsonRequest(request, publicApiMessageSchema);

    expect(payload.phoneNumber).toBe("+5511999999999");
  });

  it("creates JSON and no-content responses", async () => {
    const response = jsonResponse({ ok: true }, { status: 201 });
    const noContent = noContentResponse();

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(noContent.status).toBe(204);
  });

  it("handles runtime requests and converts runtime errors to responses", async () => {
    const runtime = bootstrapRuntime({
      secretStore: new InMemoryProviderSecretStore(),
      env: { VITE_RUNTIME_ENV: "development" },
      resolveEvolutionSecretRef: () => "evolution:ws-1:instance:inst-1",
    });

    const response = await handleRuntimeRequest(
      new Request("https://example.com"),
      runtime,
      async () => {
        throw createRuntimeError("FORBIDDEN", "Acesso negado.");
      },
      {
        workspaceId: "ws-1",
      },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "FORBIDDEN",
        message: "Acesso negado.",
        details: null,
      },
    });
  });
});
