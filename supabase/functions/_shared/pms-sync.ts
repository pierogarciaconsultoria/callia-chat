// Sincronização das reservas do Hospedin (pms_reservations): base de comparação para "orçamentos x reservas".
// A API não informa quando a reserva foi criada; first_seen_at (quando o Callia a viu pela primeira vez)
// faz esse papel. Na primeira sincronização tudo vira "base" (baseline) e não conta como reserva nova.
import type { HospedinClient, HospedinReservation } from "./hospedin.ts";
import type { Db } from "./supabase.ts";

const BASELINE_PAGES = 3;
const MAX_PAGES = 3;
const MAX_NEW_PER_RUN = 60;

type Client = Pick<HospedinClient, "reservations" | "reservationDetail" | "guestPhone">;

export interface SyncResult { baseline: number; created: number; status_changed: number; detail_errors: number }

function row(workspaceId: string, r: HospedinReservation, now: string) {
  return {
    workspace_id: workspaceId,
    provider: "hospedin",
    external_id: r.id,
    code: r.searchable_code ?? null,
    status: r.status,
    sale_channel: r.sale_channel ?? null,
    check_in: r.check_in ? r.check_in.slice(0, 10) : null,
    check_out: r.check_out ? r.check_out.slice(0, 10) : null,
    place_type_id: r.place_type_id ?? null,
    total_cents: r.total_daily_cents ?? null,
    first_seen_at: now,
    status_changed_at: now,
  };
}

export async function syncHospedinReservations(db: Db, workspaceId: string, client: Client, account: string, now = new Date()): Promise<SyncResult> {
  const at = now.toISOString();
  const result: SyncResult = { baseline: 0, created: 0, status_changed: 0, detail_errors: 0 };
  const { count } = await db.from("pms_reservations").select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId).eq("provider", "hospedin");

  if (!count) {
    for (let page = 1; page <= BASELINE_PAGES; page++) {
      const { items, last } = await client.reservations(account, page);
      if (items.length) {
        const { error } = await db.from("pms_reservations").upsert(items.map((r) => ({ ...row(workspaceId, r, at), baseline: true })), { onConflict: "workspace_id,provider,external_id", ignoreDuplicates: true });
        if (error) throw new Error(error.message);
        result.baseline += items.length;
      }
      if (page >= last || !items.length) break;
    }
    return result;
  }

  // Mais recentes primeiro: lê páginas até encontrar reservas já conhecidas.
  const seen: HospedinReservation[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { items, last } = await client.reservations(account, page);
    seen.push(...items);
    const { data: known } = await db.from("pms_reservations").select("external_id").eq("workspace_id", workspaceId)
      .eq("provider", "hospedin").in("external_id", items.map((r) => r.id));
    if ((known?.length ?? 0) > 0 || page >= last || !items.length) break;
  }
  const { data: knownRows } = await db.from("pms_reservations").select("external_id, status").eq("workspace_id", workspaceId)
    .eq("provider", "hospedin").in("external_id", seen.map((r) => r.id));
  const known = new Map((knownRows ?? []).map((k: { external_id: number; status: string }) => [Number(k.external_id), k.status]));

  for (const r of seen) {
    const before = known.get(r.id);
    if (before !== undefined && before !== r.status) {
      await db.from("pms_reservations").update({ status: r.status, status_changed_at: at, updated_at: at })
        .eq("workspace_id", workspaceId).eq("provider", "hospedin").eq("external_id", r.id);
      result.status_changed++;
    }
  }

  const fresh = seen.filter((r) => !known.has(r.id)).slice(0, MAX_NEW_PER_RUN);
  for (const r of fresh) {
    let extra: Record<string, unknown> = {};
    try {
      const d = await client.reservationDetail(account, r.id);
      const phone = d.guest_id ? await client.guestPhone(account, d.guest_id) : null;
      extra = { guest_phone: phone, adults: d.adults, children: d.children };
    } catch {
      result.detail_errors++;
    }
    const { error } = await db.from("pms_reservations").upsert({ ...row(workspaceId, r, at), ...extra, baseline: false }, { onConflict: "workspace_id,provider,external_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    result.created++;
  }
  return result;
}
