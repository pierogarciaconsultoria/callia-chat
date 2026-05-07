import { describe, expect, it, vi } from "vitest";
import {
  buildPublicApiBaseUrl,
  getApiKeyStatusLabel,
  maskStoredApiKey,
} from "@/lib/public-api";

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
});
