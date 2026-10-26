import { Badge } from "@/components/ui";
import { STATUS_LABEL, statusToneOf } from "@/lib/entitlements";
import type { EffectiveTenantStatus } from "@/lib/database.types";

export const adminKeys = {
  overview: ["admin", "overview"] as const,
  tenants: ["admin", "tenants"] as const,
  tenant: (id: string) => ["admin", "tenant", id] as const,
  plans: ["admin", "plans"] as const,
  users: (search: string) => ["admin", "users", search] as const,
  audit: (f: Record<string, unknown>) => ["admin", "audit", f] as const,
  settings: ["admin", "settings"] as const,
};

export function TenantStatusBadge({ status }: { status: EffectiveTenantStatus }) {
  return <Badge tone={statusToneOf(status)}>{STATUS_LABEL[status] ?? status}</Badge>;
}

export function formatNumber(n: number | null | undefined): string {
  return new Intl.NumberFormat("pt-BR").format(Number(n ?? 0));
}

export function formatPriceCents(cents: number | null, currency = "BRL"): string {
  if (cents === null || cents === undefined) return "—";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}
