import { describe, expect, it, vi } from "vitest";
import {
  buildPublicApiBaseUrl,
  getApiKeyStatusLabel,
  maskStoredApiKey,
} from "@/lib/public-api";
import {
  buildExternalAgentMetadata,
  getPublicApiMessageContent,
  parsePublicApiMessagePayload,
} from "../../supabase/functions/_shared/public-api-messages";

describe("public api helpers", () => {
  it("monta a URL base da API pública a partir do Supabase URL", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://demo.supabase.co");

    expect(buildPublicApiBaseUrl()).toBe(
      "https://demo.supabase.co/functions/v1/public-api",
    );
  });

  it("mascara a chave persistida para exibicao segura", () => {
    expect(maskStoredApiKey({ prefix: "ah", last4: "89ab" })).toBe(
      "ah_live_****89ab",
    );
  });

  it("exibe o status correto da chave", () => {
    expect(getApiKeyStatusLabel({ revoked_at: null })).toBe("Ativa");
    expect(getApiKeyStatusLabel({ revoked_at: new Date().toISOString() })).toBe(
      "Revogada",
    );
  });

  it("aceita mensagem de texto por phone ou conversationId", () => {
    expect(
      parsePublicApiMessagePayload({ phone: "5511999999999", text: "Olá" }),
    ).toMatchObject({
      phoneNumber: "5511999999999",
      conversationId: null,
      text: "Olá",
      mediaUrl: null,
    });

    expect(
      parsePublicApiMessagePayload({ conversationId: "conversation-1", text: "Olá" }),
    ).toMatchObject({
      phoneNumber: null,
      conversationId: "conversation-1",
      text: "Olá",
    });
  });

  it("aceita imagem com mimeType e caption para envio pela Evolution", () => {
    const parsed = parsePublicApiMessagePayload({
      conversationId: "conversation-1",
      mediaUrl: "https://cdn.example.com/product.jpg",
      mimeType: "image/jpeg",
      caption: "Confira este produto",
    });

    expect(parsed).toMatchObject({
      mediaUrl: "https://cdn.example.com/product.jpg",
      mimeType: "image/jpeg",
      caption: "Confira este produto",
    });
    expect(getPublicApiMessageContent(parsed)).toBe("Confira este produto");
  });

  it("marca mensagens públicas como bot do agente externo", () => {
    expect(buildExternalAgentMetadata({ flow: "n8n" }, "key-1", "idem-1")).toEqual({
      flow: "n8n",
      source: "external_agent",
      generated_by: "public-api",
      api_key_id: "key-1",
      idempotency_key: "idem-1",
    });
  });
});
