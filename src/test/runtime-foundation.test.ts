import { describe, expect, it } from "vitest";
import {
  decryptSecret, encryptSecret, generateApiKey, hashApiKey, hmacSha256Hex, maskApiKey, parseApiKey, randomToken, timingSafeEqual,
} from "../../supabase/functions/_shared/crypto.ts";
import { createHandler, newCorrelationId, RuntimeError } from "../../supabase/functions/_shared/http.ts";

describe("chaves da API pública", () => {
  it("gera chave com prefixo, last4 e hash estáveis", async () => {
    const key = await generateApiKey("pepper");
    expect(key.raw).toMatch(/^ck_live_[A-Za-z0-9]{32}$/);
    expect(key.prefix).toBe(key.raw.slice(0, 16));
    expect(key.last4).toBe(key.raw.slice(-4));
    expect(key.hash).toBe(await hashApiKey(key.raw, "pepper"));
    expect(key.hash).not.toBe(await hashApiKey(key.raw, "outro"));
  });

  it("extrai do header e rejeita formatos inválidos", () => {
    const raw = "ck_live_" + "a".repeat(32);
    expect(parseApiKey(` ${raw} `)).toEqual({ raw, prefix: raw.slice(0, 16) });
    expect(parseApiKey("Bearer xyz")).toBeNull();
    expect(parseApiKey(null)).toBeNull();
  });

  it("mascara a chave para logs", () => {
    expect(maskApiKey("ck_live_abcdefghijklmnopqrstuvwxyz123456")).toBe("ck_live_ab…3456");
  });
});

describe("criptografia", () => {
  it("cifra e decifra segredos com AES-GCM (IV aleatório)", async () => {
    const master = "m".repeat(40);
    const a = await encryptSecret("whsec_123", master);
    const b = await encryptSecret("whsec_123", master);
    expect(a).not.toBe(b);
    expect(await decryptSecret(a, master)).toBe("whsec_123");
    await expect(decryptSecret(a, "n".repeat(40))).rejects.toThrow();
    await expect(encryptSecret("x", "curta")).rejects.toThrow(/CALLIA_ENCRYPTION_KEY/);
  });

  it("HMAC-SHA256 confere com vetor conhecido", async () => {
    expect(await hmacSha256Hex("key", "The quick brown fox jumps over the lazy dog"))
      .toBe("f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
  });

  it("tokens e comparação em tempo constante", () => {
    expect(randomToken(40)).toMatch(/^[A-Za-z0-9]{40}$/);
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});

describe("handler-base", () => {
  it("reaproveita correlation id válido e gera um novo para inválidos", () => {
    expect(newCorrelationId(new Request("http://x", { headers: { "x-correlation-id": "abc-12345678" } }))).toBe("abc-12345678");
    expect(newCorrelationId(new Request("http://x", { headers: { "x-correlation-id": "<script>" } }))).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("traduz RuntimeError em JSON padronizado e esconde erros internos", async () => {
    const quiet = { ...console, error: () => {} };
    const original = console.error;
    console.error = quiet.error;
    try {
      const forbidden = createHandler("t", async () => { throw new RuntimeError("forbidden", "Sem acesso.", { a: 1 }); });
      const res = await forbidden(new Request("http://x/fn", { method: "POST" }));
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body).toMatchObject({ error: { code: "forbidden", message: "Sem acesso.", details: { a: 1 } } });
      expect(res.headers.get("x-correlation-id")).toBe(body.correlation_id);

      const boom = createHandler("t", async () => { throw new Error("senha do banco: 123"); });
      const res2 = await boom(new Request("http://x/fn", { method: "POST" }));
      expect(res2.status).toBe(500);
      expect(JSON.stringify(await res2.json())).not.toContain("senha");
    } finally {
      console.error = original;
    }
  });

  it("responde preflight CORS", async () => {
    const res = await createHandler("t", async () => new Response("nunca"))(new Request("http://x", { method: "OPTIONS" }));
    expect(res.headers.get("access-control-allow-headers")).toContain("x-api-key");
  });
});
