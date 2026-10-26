// Validação de URLs informadas por usuários (webhooks, fontes de conhecimento) contra alvos internos.
import { RuntimeError } from "./http.ts";

const INTERNAL_HOSTS = new Set(["localhost", "kong", "db", "auth", "rest", "realtime", "storage", "functions", "meta", "studio", "evolution"]);

export function isInternalHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (INTERNAL_HOSTS.has(host) || host.endsWith(".internal") || host.endsWith(".local") || !host.includes(".") && !host.includes(":")) return true;
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)) return true;
  return host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:");
}

/** Só para o teste ponta a ponta, em que o site e o Instagram falsos estão na rede interna do Docker. */
function allowPrivateTargets(): boolean {
  // deno-lint-ignore no-explicit-any
  return (globalThis as any).Deno?.env?.get("CALLIA_ALLOW_PRIVATE_URLS") === "true";
}

/** Aceita apenas http(s) para hosts públicos. Não resolve DNS: é uma barreira básica, não um firewall. */
export function assertPublicHttpUrl(value: unknown, field = "url"): string {
  if (typeof value !== "string" || !value.trim()) throw new RuntimeError("invalid_request", `${field} obrigatória.`);
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new RuntimeError("invalid_request", `${field} inválida.`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new RuntimeError("invalid_request", `${field} deve usar http(s).`);
  if (parsed.username || parsed.password) throw new RuntimeError("invalid_request", `${field} não pode conter credenciais.`);
  if (isInternalHost(parsed.hostname) && !allowPrivateTargets()) throw new RuntimeError("invalid_request", "Destino interno não é permitido.");
  return parsed.toString();
}
