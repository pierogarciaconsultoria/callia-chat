// Provedor de disponibilidade do workspace: Hospedin (PMS). O hbook só fornece o link de reserva (a HSystem
// não permite consultas automáticas). O agente e a API pública só usam este módulo.
import { decryptSecret } from "./crypto.ts";
import { type AvailabilityQuery, formatBrDate, type HbookAvailability } from "./hbook.ts";
import { fetchHospedinAvailability, HospedinClient, type HospedinConfig, type HospedinCredentials } from "./hospedin.ts";
import type { Db } from "./supabase.ts";

export type AvailabilityFn = (q: AvailabilityQuery) => Promise<HbookAvailability>;

interface ConnectorRow {
  kind: "hbook" | "hospedin" | "booking_link";
  enabled: boolean;
  status: string;
  config: Record<string, unknown>;
  secret_ciphertext: string | null;
}

function env(name: string): string | undefined {
  // deno-lint-ignore no-explicit-any
  return (globalThis as any).Deno?.env?.get(name) || undefined;
}

export async function hospedinClientFor(secretCiphertext: string): Promise<HospedinClient> {
  const creds = JSON.parse(await decryptSecret(secretCiphertext, env("CALLIA_ENCRYPTION_KEY") ?? "")) as HospedinCredentials;
  return new HospedinClient(creds, { baseUrl: env("HOSPEDIN_BASE_URL") });
}

export async function loadConnectors(db: Db, workspaceId: string): Promise<Map<string, ConnectorRow>> {
  const { data } = await db.from("workspace_connectors")
    .select("kind, enabled, status, config, secret_ciphertext")
    .eq("workspace_id", workspaceId);
  return new Map((data ?? []).map((r: ConnectorRow) => [r.kind, r]));
}

/** Link do motor de reservas: o salvo em "Link de reservas" ou o do hbook. */
export function bookingLinkFrom(connectors: Map<string, ConnectorRow>): string | null {
  const own = connectors.get("booking_link");
  if (own?.enabled && typeof own.config?.url === "string") return own.config.url;
  const hbook = connectors.get("hbook");
  if (hbook?.enabled && hbook.config?.base_url && hbook.config?.company_id) {
    return `${String(hbook.config.base_url).replace(/\/$/, "")}/Booking?companyId=${hbook.config.company_id}`;
  }
  return null;
}

export async function loadAvailabilityProvider(db: Db, workspaceId: string): Promise<{ kind: "hospedin"; fn: AvailabilityFn } | null> {
  const connectors = await loadConnectors(db, workspaceId);
  const hospedin = connectors.get("hospedin");
  if (hospedin?.enabled && hospedin.status === "connected" && hospedin.secret_ciphertext && hospedin.config?.account_id) {
    const client = await hospedinClientFor(hospedin.secret_ciphertext);
    const cfg = { ...(hospedin.config as unknown as HospedinConfig), booking_link: bookingLinkFrom(connectors) };
    return { kind: "hospedin", fn: (q) => fetchHospedinAvailability(cfg, client, q) };
  }
  return null;
}

/** Próximo fim de semana (sexta → domingo): datas padrão do teste de integração. */
export function nextWeekend(today = new Date()): { checkin: string; checkout: string } {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const daysToFriday = ((5 - d.getUTCDay() + 7) % 7) || 7;
  const friday = new Date(d.getTime() + daysToFriday * 86_400_000);
  return { checkin: formatBrDate(friday), checkout: formatBrDate(new Date(friday.getTime() + 2 * 86_400_000)) };
}
