// Segredos da plataforma: gravados cifrados em platform_secrets pelo console; lidos pelas functions.
// Variável de ambiente com o mesmo nome em maiúsculas serve de alternativa (ex.: MERCADOPAGO_ACCESS_TOKEN).
import { decryptSecret, encryptSecret } from "./crypto.ts";
import type { Db } from "./supabase.ts";

export const PLATFORM_SECRET_KEYS = ["mercadopago_access_token", "mercadopago_webhook_secret"] as const;
export type PlatformSecretKey = typeof PLATFORM_SECRET_KEYS[number];

type EnvGet = (name: string) => string | undefined;
const denoEnv: EnvGet = (name) => (globalThis as { Deno?: { env: { get: (n: string) => string | undefined } } }).Deno?.env.get(name);

export function masterKey(envGet: EnvGet = denoEnv): string {
  const key = envGet("CALLIA_ENCRYPTION_KEY");
  if (!key) throw new Error("CALLIA_ENCRYPTION_KEY ausente.");
  return key;
}

/** Valor do segredo: banco (cifrado) primeiro; senão a variável de ambiente; senão null. */
export async function getPlatformSecret(db: Db, key: PlatformSecretKey, envGet: EnvGet = denoEnv): Promise<string | null> {
  const { data } = await db.from("platform_secrets").select("ciphertext").eq("key", key).maybeSingle();
  const ciphertext = (data as { ciphertext?: string } | null)?.ciphertext;
  if (ciphertext) return decryptSecret(ciphertext, masterKey(envGet));
  return envGet(key.toUpperCase()) || null;
}

/** Grava (ou apaga, com valor vazio) um segredo. Guarda só os 4 últimos caracteres como pista. */
export async function setPlatformSecret(db: Db, key: PlatformSecretKey, plain: string, userId: string | null, envGet: EnvGet = denoEnv): Promise<void> {
  const value = plain.trim();
  if (!value) {
    const { error } = await db.from("platform_secrets").delete().eq("key", key);
    if (error) throw new Error(`Falha ao apagar segredo: ${error.message}`);
    return;
  }
  const { error } = await db.from("platform_secrets").upsert({
    key, ciphertext: await encryptSecret(value, masterKey(envGet)), hint: value.slice(-4), updated_at: new Date().toISOString(), updated_by: userId,
  });
  if (error) throw new Error(`Falha ao gravar segredo: ${error.message}`);
}

export interface SecretStatus { configured: boolean; source: "database" | "env" | null; hint: string | null; updated_at: string | null }

/** Situação de cada segredo para o console, sem expor valores. */
export async function platformSecretStatus(db: Db, keys: readonly PlatformSecretKey[], envGet: EnvGet = denoEnv): Promise<Record<string, SecretStatus>> {
  const { data } = await db.from("platform_secrets").select("key, hint, updated_at").in("key", [...keys]);
  const rows = new Map(((data ?? []) as Array<{ key: string; hint: string | null; updated_at: string }>).map((r) => [r.key, r]));
  const out: Record<string, SecretStatus> = {};
  for (const key of keys) {
    const row = rows.get(key);
    const env = envGet(key.toUpperCase());
    out[key] = row
      ? { configured: true, source: "database", hint: row.hint, updated_at: row.updated_at }
      : env ? { configured: true, source: "env", hint: env.slice(-4), updated_at: null } : { configured: false, source: null, hint: null, updated_at: null };
  }
  return out;
}
