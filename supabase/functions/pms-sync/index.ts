// Sincroniza as reservas do Hospedin de cada workspace conectado (chamado pelo pg_cron a cada 15 min).
import { createHandler, json, readJson, RuntimeError } from "../_shared/http.ts";
import { hospedinClientFor } from "../_shared/availability.ts";
import { syncHospedinReservations } from "../_shared/pms-sync.ts";
import { adminDb, isInternalCall } from "../_shared/supabase.ts";

Deno.serve(createHandler("pms-sync", async ({ req, log }) => {
  if (req.method !== "POST") throw new RuntimeError("invalid_request", "Use POST.");
  if (!isInternalCall(req)) throw new RuntimeError("unauthorized", "Chamada interna apenas.");
  const body = await readJson<{ workspace_id?: string }>(req).catch(() => ({} as { workspace_id?: string }));
  const db = adminDb();
  let q = db.from("workspace_connectors").select("workspace_id, config, secret_ciphertext")
    .eq("kind", "hospedin").eq("enabled", true).eq("status", "connected").not("secret_ciphertext", "is", null);
  if (body.workspace_id) q = q.eq("workspace_id", body.workspace_id);
  const { data: rows } = await q;

  const results: Record<string, unknown> = {};
  for (const row of rows ?? []) {
    const account = String((row.config as { account_id?: string })?.account_id ?? "");
    if (!account) continue;
    try {
      const client = await hospedinClientFor(row.secret_ciphertext as string);
      results[row.workspace_id] = await syncHospedinReservations(db, row.workspace_id, client, account);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results[row.workspace_id] = { error: message };
      log.info("pms_sync_failed", { workspace_id: row.workspace_id, error: message });
    }
  }
  return json({ ok: true, workspaces: results });
}));
