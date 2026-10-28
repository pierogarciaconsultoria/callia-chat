import { describe, expect, it } from "vitest";
import { getPlatformSecret, platformSecretStatus, setPlatformSecret } from "../../supabase/functions/_shared/platform-secrets.ts";
import type { Db } from "../../supabase/functions/_shared/supabase.ts";

// Banco falso: só a tabela platform_secrets, com os métodos que o módulo usa.
function fakeDb() {
  const rows = new Map<string, { key: string; ciphertext: string; hint: string | null; updated_at: string }>();
  const db = {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_c: string, key: string) => ({ maybeSingle: async () => ({ data: rows.get(key) ?? null, error: null }) }),
        in: (_c: string, keys: string[]) => Promise.resolve({ data: keys.map((k) => rows.get(k)).filter(Boolean), error: null }),
      }),
      upsert: async (row: { key: string; ciphertext: string; hint: string | null; updated_at: string }) => { rows.set(row.key, row); return { error: null }; },
      delete: () => ({ eq: async (_c: string, key: string) => { rows.delete(key); return { error: null }; } }),
    }),
  };
  return { db: db as unknown as Db, rows };
}
const env = (vars: Record<string, string>) => (name: string) => vars[name];

describe("segredos da plataforma", () => {
  it("grava cifrado com pista dos 4 últimos caracteres e lê de volta; vazio apaga", async () => {
    const { db, rows } = fakeDb();
    const e = env({ CALLIA_ENCRYPTION_KEY: "chave-mestra-de-teste-com-32-caracteres-ou-mais" });
    await setPlatformSecret(db, "mercadopago_access_token", "APP_USR-123456-0264", "user-1", e);
    const stored = rows.get("mercadopago_access_token")!;
    expect(stored.ciphertext.startsWith("v1.")).toBe(true);
    expect(stored.ciphertext).not.toContain("APP_USR");
    expect(stored.hint).toBe("0264");
    expect(await getPlatformSecret(db, "mercadopago_access_token", e)).toBe("APP_USR-123456-0264");
    const status = await platformSecretStatus(db, ["mercadopago_access_token", "mercadopago_webhook_secret"], e);
    expect(status.mercadopago_access_token).toMatchObject({ configured: true, source: "database", hint: "0264" });
    expect(status.mercadopago_webhook_secret).toMatchObject({ configured: false, source: null });
    await setPlatformSecret(db, "mercadopago_access_token", "   ", "user-1", e);
    expect(rows.has("mercadopago_access_token")).toBe(false);
  });

  it("sem registro no banco, usa a variável de ambiente; sem nada, null", async () => {
    const { db } = fakeDb();
    const e = env({ CALLIA_ENCRYPTION_KEY: "chave-mestra-de-teste-com-32-caracteres-ou-mais", MERCADOPAGO_WEBHOOK_SECRET: "segredo-env" });
    expect(await getPlatformSecret(db, "mercadopago_webhook_secret", e)).toBe("segredo-env");
    expect(await getPlatformSecret(db, "mercadopago_access_token", e)).toBeNull();
    expect((await platformSecretStatus(db, ["mercadopago_webhook_secret"], e)).mercadopago_webhook_secret).toMatchObject({ configured: true, source: "env", hint: "-env" });
  });
});
