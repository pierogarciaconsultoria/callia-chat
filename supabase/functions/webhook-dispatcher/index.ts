// Retoma entregas pendentes/retentando cujo horário chegou. Acionado por cron (pg_cron + pg_net, ver DEPLOY_RUNBOOK).
import { createHandler, json, RuntimeError } from "../_shared/http.ts";
import { adminDb, env, isInternalCall } from "../_shared/supabase.ts";
import { deliverWebhook } from "../_shared/webhooks.ts";

const BATCH = 50;

Deno.serve(createHandler("webhook-dispatcher", async ({ req, log }) => {
  if (!isInternalCall(req)) throw new RuntimeError("unauthorized", "Chamada interna apenas.");
  const db = adminDb();
  const masterKey = env("CALLIA_ENCRYPTION_KEY");
  const { data: due, error } = await db
    .from("webhook_deliveries")
    .select("id")
    .in("status", ["pending", "retrying"])
    .lte("next_attempt_at", new Date().toISOString())
    .order("next_attempt_at")
    .limit(BATCH);
  if (error) throw new RuntimeError("internal_error", "Falha ao buscar entregas.", { db: error.message });

  // Empurra o próximo horário antes de tentar, para duas execuções do cron não pegarem a mesma entrega.
  const ids = (due ?? []).map((d: { id: string }) => d.id);
  if (ids.length) {
    await db.from("webhook_deliveries").update({ next_attempt_at: new Date(Date.now() + 120_000).toISOString() }).in("id", ids);
  }
  const results = await Promise.allSettled(ids.map((id: string) => deliverWebhook(db, id, masterKey)));
  const summary = { picked: ids.length, delivered: 0, retrying: 0, failed: 0, errors: 0 };
  for (const r of results) {
    if (r.status === "rejected") summary.errors++;
    else if (r.value?.status === "success") summary.delivered++;
    else if (r.value?.status === "failed") summary.failed++;
    else summary.retrying++;
  }
  if (ids.length) log.info("dispatch_round", summary);
  return json(summary);
}));
