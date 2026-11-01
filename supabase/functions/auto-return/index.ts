// Devolução automática ao bot por inatividade (pg_cron, a cada minuto): a RPC decide e grava; aqui só pedimos à IA
// que responda a mensagem do cliente que ficou sem resposta, pelo mesmo caminho do "Devolver ao bot" da inbox.
import { createHandler, json, RuntimeError } from "../_shared/http.ts";
import { adminDb, functionUrl, internalHeaders, isInternalCall } from "../_shared/supabase.ts";

interface Returned { conversation_id: string; workspace_id: string; idle_minutes: number; pending_message_id: string | null }

Deno.serve(createHandler("auto-return", async ({ req, correlationId, log }) => {
  if (req.method !== "POST") throw new RuntimeError("invalid_request", "Use POST.");
  if (!isInternalCall(req)) throw new RuntimeError("unauthorized", "Chamada interna apenas.");
  const db = adminDb();
  const { data, error } = await db.rpc("auto_return_idle_conversations", { p_limit: 50 });
  if (error) throw new RuntimeError("internal_error", "Falha ao devolver conversas.", { db: error.message });
  const returned = (data ?? []) as Returned[];
  let answered = 0;
  for (const row of returned) {
    log.info("conversation_auto_returned", { workspace_id: row.workspace_id, conversation_id: row.conversation_id, idle_minutes: row.idle_minutes, pending: Boolean(row.pending_message_id) });
    if (!row.pending_message_id) continue;
    try {
      const res = await fetch(functionUrl("process-message"), {
        method: "POST",
        headers: { ...internalHeaders(), "x-correlation-id": correlationId },
        body: JSON.stringify({ message_id: row.pending_message_id }),
        signal: AbortSignal.timeout(60_000),
      });
      if (res.ok) answered++;
      else log.warn("auto_return_resume_failed", { conversation_id: row.conversation_id, status: res.status, body: (await res.text()).slice(0, 200) });
    } catch (err) {
      log.warn("auto_return_resume_failed", { conversation_id: row.conversation_id, error: String(err) });
    }
  }
  return json({ ok: true, returned: returned.length, answered });
}));
