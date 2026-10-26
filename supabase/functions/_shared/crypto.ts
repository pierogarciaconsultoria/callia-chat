// Primitivas criptográficas sobre Web Crypto (iguais em Deno e Node 20+).

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(value: string): Uint8Array {
  const bin = atob(value);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function sha256Hex(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

/** Comparação em tempo constante para strings de mesmo tamanho. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Token aleatório em base62 sem viés de módulo. */
export function randomToken(length = 32): string {
  const out: string[] = [];
  while (out.length < length) {
    const buf = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const b of buf) {
      if (b < 248) out.push(ALPHABET[b % 62]);
      if (out.length === length) break;
    }
  }
  return out.join("");
}

async function aesKey(masterKey: string): Promise<CryptoKey> {
  if (!masterKey || masterKey.length < 32) {
    throw new Error("CALLIA_ENCRYPTION_KEY ausente ou curta (mínimo 32 caracteres).");
  }
  const raw = await crypto.subtle.digest("SHA-256", encoder.encode(masterKey));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** Cifra com AES-256-GCM. Saída: "v1.<iv base64>.<ciphertext base64>". */
export async function encryptSecret(plain: string, masterKey: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(masterKey), encoder.encode(plain));
  return `v1.${toBase64(iv)}.${toBase64(new Uint8Array(cipher))}`;
}

export async function decryptSecret(payload: string, masterKey: string): Promise<string> {
  const [version, ivB64, dataB64] = payload.split(".");
  if (version !== "v1" || !ivB64 || !dataB64) throw new Error("Formato de segredo cifrado inválido.");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(ivB64) },
    await aesKey(masterKey),
    fromBase64(dataB64),
  );
  return decoder.decode(plain);
}

// ---------------------------------------------------------------------------
// API keys públicas: ck_live_<32 base62>. Banco guarda prefixo (16 chars), hash e last4.
// ---------------------------------------------------------------------------
export const API_KEY_PREFIX = "ck_live_";
const API_KEY_PATTERN = /^ck_live_[A-Za-z0-9]{32}$/;

export interface GeneratedApiKey {
  raw: string;
  prefix: string;
  last4: string;
  hash: string;
}

export async function hashApiKey(raw: string, pepper = ""): Promise<string> {
  return sha256Hex(`${pepper}:${raw}`);
}

export async function generateApiKey(pepper = ""): Promise<GeneratedApiKey> {
  const raw = API_KEY_PREFIX + randomToken(32);
  return { raw, prefix: raw.slice(0, 16), last4: raw.slice(-4), hash: await hashApiKey(raw, pepper) };
}

/** Extrai a chave do header; retorna null para formato inválido sem lançar. */
export function parseApiKey(headerValue: string | null | undefined): { raw: string; prefix: string } | null {
  const raw = headerValue?.trim();
  if (!raw || !API_KEY_PATTERN.test(raw)) return null;
  return { raw, prefix: raw.slice(0, 16) };
}

/** Máscara para logs: ck_live_ab…wxyz */
export function maskApiKey(raw: string | null | undefined): string {
  if (!raw) return "(vazia)";
  if (raw.length < 14) return "***";
  return `${raw.slice(0, 10)}…${raw.slice(-4)}`;
}
