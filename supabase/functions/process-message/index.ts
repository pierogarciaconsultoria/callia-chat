// Pipeline de IA: idempotência, debounce, mídia, handoff, agente externo/interno e envio da resposta.
import { createHandler, json, type Logger, readJson, RuntimeError, sleep } from "../_shared/http.ts";
import type { HistoryItem } from "../_shared/agent-core.ts";
import { type PipelineInput, runAgentPipeline } from "../_shared/agent-pipeline.ts";
import {
  aiFromEnv,
  buildPipelineDeps,
  loadAgentConfig,
  loadBusinessName,
  loadProducts,
  preprocessMedia,
  synthesizeVoice,
} from "../_shared/agent-runtime.ts";
import { type InstanceRow, sendOutbound } from "../_shared/channel.ts";
import { looksLikePaymentProof, mediaNote, unintelligibleTranscript } from "../_shared/inbox-media.ts";
import { adminDb, type Db, isInternalCall, optionalEnv, requireUser, requireWorkspaceRole } from "../_shared/supabase.ts";
import { emitEvent } from "../_shared/webhooks.ts";
import { assertActive, hasFeature, loadEntitlements, monthlyMessagesLeft } from "../_shared/entitlements.ts";

Deno.serve(createHandler("process-message", async ({ req, correlationId, log }) => {
  if (req.method !== "POST") throw new RuntimeError("invalid_request", "Use POST.");
  const body = await readJson<{ action?: string; message_id?: string; workspace_id?: string; conversation_id?: string; messages?: unknown }>(req);

  if (body.action === "simulate") return json(await simulate(req, body, correlationId, log));
  if (body.action === "resume") return json(await resume(req, body, correlationId, log));
  if (!isInternalCall(req)) throw new RuntimeError("unauthorized", "Chamada interna apenas.");
  if (typeof body.message_id !== "string") throw new RuntimeError("invalid_request", "message_id obrigatório.");
  return json(await processMessage(adminDb(), body.message_id, correlationId, log));
}));

interface ConversationRow {
  id: string;
  workspace_id: string;
  instance_id: string | null;
  channel: string;
  contact_phone: string;
  contact_name: string | null;
  mode: "bot" | "human" | "closed";
}

async function processMessage(db: Db, messageId: string, correlationId: string, log: Logger) {
  const started = Date.now();
  const { data: msg } = await db
    .from("messages")
    .select("id, seq, workspace_id, conversation_id, direction, sender, type, content, media_url, media_mime, metadata, created_at")
    .eq("id", messageId)
    .maybeSingle();
  if (!msg) throw new RuntimeError("not_found", "Mensagem não encontrada.");
  if (msg.direction !== "inbound" || msg.sender !== "customer") return { skipped: "not_customer_message" };

  const loadConversation = async () =>
    (await db
      .from("conversations")
      .select("id, workspace_id, instance_id, channel, contact_phone, contact_name, mode")
      .eq("id", msg.conversation_id)
      .single()).data as ConversationRow;
  let conversation = await loadConversation();
  if (conversation.channel !== "whatsapp") return { skipped: "external_channel" };
  if (conversation.mode !== "bot") return { skipped: `mode_${conversation.mode}` };

  const config = await loadAgentConfig(db, msg.workspace_id);
  if (!config.enabled) return { skipped: "agent_disabled" };
  // Tenant suspenso, cancelado ou com trial vencido: a mensagem fica guardada, o bot não responde.
  const entitlements = await loadEntitlements(db, msg.workspace_id);
  if (!entitlements.active) return { skipped: `tenant_${entitlements.effective_status}` };

  // Idempotência: uma execução por mensagem gatilho.
  const { data: run, error: runError } = await db.from("agent_runs").insert({
    workspace_id: msg.workspace_id,
    conversation_id: conversation.id,
    trigger_message_id: msg.id,
    correlation_id: correlationId,
  }).select("id").single();
  if (runError?.code === "23505") return { skipped: "already_processed" };
  if (runError) throw new RuntimeError("internal_error", "Falha ao registrar execução.", { db: runError.message });

  const finishRun = (patch: Record<string, unknown>) =>
    db.from("agent_runs").update({ ...patch, latency_ms: Date.now() - started, finished_at: new Date().toISOString() }).eq("id", run.id);

  try {
    // Debounce: se o cliente mandar outra mensagem logo em seguida, quem responde é a execução da última.
    if (config.reply_debounce_ms > 0) await sleep(config.reply_debounce_ms);
    const { data: newer } = await db
      .from("messages")
      .select("id")
      .eq("conversation_id", conversation.id)
      .eq("direction", "inbound")
      .eq("sender", "customer")
      .gt("seq", msg.seq)
      .limit(1);
    if (newer?.length) {
      await finishRun({ status: "superseded", reason: "newer_customer_message" });
      return { skipped: "superseded" };
    }

    // Cota mensal esgotada: a conversa passa para a equipe em vez de o cliente ficar sem resposta.
    if (monthlyMessagesLeft(entitlements) === 0) {
      await db.from("conversations").update({ mode: "human", handoff_at: new Date().toISOString() }).eq("id", conversation.id);
      await emitEvent(db, {
        workspaceId: msg.workspace_id,
        event: "conversation.handoff",
        correlationId,
        masterKey: optionalEnv("CALLIA_ENCRYPTION_KEY"),
        data: { conversation_id: conversation.id, reason: "quota_exceeded", contact_phone: conversation.contact_phone },
      });
      await finishRun({ status: "skipped", reason: "quota_exceeded" });
      return { skipped: "quota_exceeded" };
    }

    const { data: instance } = conversation.instance_id
      ? await db.from("whatsapp_instances").select("id, workspace_id, name, instance_name, provider_secret_ref, status, is_default")
        .eq("id", conversation.instance_id).maybeSingle()
      : { data: null };

    const ai = hasFeature(entitlements, "ai_enabled") ? aiFromEnv() : null;
    const { data: recent } = await db
      .from("messages")
      .select("id, direction, sender, type, content, media_mime, metadata, created_at")
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: false })
      .order("seq", { ascending: false })
      .limit(20);
    const chronological = (recent ?? []).reverse();

    // Mensagens do cliente desde a última resposta (nossa ou da equipe).
    const lastOutboundIdx = chronological.map((m: { direction: string }) => m.direction).lastIndexOf("outbound");
    const pending = chronological.slice(lastOutboundIdx + 1).filter((m: { sender: string }) => m.sender === "customer");
    const history: HistoryItem[] = [];
    let paymentProof = false;
    let unintelligibleAudio = pending.length > 0;
    for (const m of chronological) {
      const isPending = pending.some((p: { id: string }) => p.id === m.id);
      const text = isPending ? await preprocessMedia(db, ai, instance as InstanceRow | null, m, config.language) : textForHistory(m);
      if (isPending && (m.type === "image" || m.type === "document") && looksLikePaymentProof(text)) paymentProof = true;
      if (isPending && (m.type !== "audio" || !unintelligibleTranscript(text))) unintelligibleAudio = false;
      history.push({ direction: m.direction, sender: m.sender, type: m.type, content: text, created_at: m.created_at });
    }
    const pendingText = history.slice(history.length - pending.length).map((h) => h.content).filter(Boolean).join("\n") ||
      msg.content || "";

    const input: PipelineInput = {
      workspaceId: msg.workspace_id,
      businessName: await loadBusinessName(db, msg.workspace_id),
      conversation: { id: conversation.id, contact_name: conversation.contact_name, contact_phone: conversation.contact_phone },
      trigger: { id: msg.id, type: msg.type, text: pendingText, media_url: msg.media_url, created_at: msg.created_at },
      pendingText,
      history,
      products: await loadProducts(db, msg.workspace_id),
      paymentProof,
      unintelligibleAudio,
    };
    const deps = await buildPipelineDeps(db, { workspaceId: msg.workspace_id, config, ai, entitlements, correlationId, log: log.info });
    const outcome = await runAgentPipeline(input, deps);

    // A equipe pode ter assumido enquanto a IA pensava.
    conversation = await loadConversation();
    if (conversation.mode !== "bot") {
      await finishRun({ status: "skipped", engine: outcome.engine, reason: "mode_changed_during_run", usage: outcome.usage });
      return { skipped: "mode_changed" };
    }

    if (outcome.action === "handoff") {
      await db.from("conversations").update({ mode: "human", handoff_at: new Date().toISOString() }).eq("id", conversation.id);
      await emitEvent(db, {
        workspaceId: msg.workspace_id,
        event: "conversation.handoff",
        correlationId,
        masterKey: optionalEnv("CALLIA_ENCRYPTION_KEY"),
        data: { conversation_id: conversation.id, reason: outcome.handoffReason, contact_phone: conversation.contact_phone },
      });
    }

    const sendBase = {
      workspaceId: msg.workspace_id,
      origin: "bot" as const,
      sender: "bot" as const,
      conversation,
      correlationId,
      metadata: { agent_run_id: run.id, engine: outcome.engine },
    };
    const sends: string[] = [];
    if (outcome.reply) {
      const useVoice = config.voice_enabled && msg.type === "audio" && ai && outcome.action === "reply";
      let sent = false;
      if (useVoice) {
        try {
          const audioBase64 = await synthesizeVoice(ai!, outcome.reply, config.voice_id);
          const r = await sendOutbound(db, { ...sendBase, type: "audio", audioBase64, text: outcome.reply, mimetype: "audio/ogg" });
          sent = r.status === "sent";
          sends.push(r.status);
        } catch (err) {
          log.warn("voice_reply_failed", { error: String(err) });
        }
      }
      if (!sent) sends.push((await sendOutbound(db, { ...sendBase, type: "text", text: outcome.reply })).status);
    }
    for (const media of outcome.media) {
      const r = await sendOutbound(db, {
        ...sendBase,
        type: media.type,
        mediaUrl: media.url,
        text: media.caption ?? null,
        fileName: media.file_name ?? null,
        mimetype: media.mimetype ?? null,
      });
      sends.push(r.status);
    }

    const failed = sends.filter((s) => s === "failed").length;
    await finishRun({
      status: failed && failed === sends.length ? "failed" : outcome.action === "handoff" ? "handoff" : "replied",
      engine: outcome.engine,
      reason: outcome.handoffReason,
      error: [outcome.externalError && `externo: ${outcome.externalError}`, outcome.aiError && `ia: ${outcome.aiError}`,
        failed ? `${failed} envio(s) falharam` : null].filter(Boolean).join(" | ") || null,
      usage: { ...outcome.usage, tool_calls: outcome.toolCalls.map((t) => t.name), knowledge_hits: outcome.knowledge.length },
    });
    return { ok: true, action: outcome.action, engine: outcome.engine, sends };
  } catch (err) {
    await finishRun({ status: "failed", error: err instanceof Error ? err.message.slice(0, 500) : String(err) });
    throw err;
  }
}

function textForHistory(m: { type: string; content: string | null; metadata: Record<string, unknown> | null }): string | null {
  return mediaNote(m) ?? m.content;
}

/**
 * Conversa devolvida ao bot pelo painel: se a última mensagem é do cliente (ficou sem resposta
 * enquanto estava com a equipe), a MarIA responde agora.
 */
async function resume(req: Request, body: { workspace_id?: string; conversation_id?: string }, correlationId: string, log: Logger) {
  const user = await requireUser(req);
  await requireWorkspaceRole(user.id, body.workspace_id, ["owner", "admin", "agent"]);
  const db = adminDb();
  const { data: conv } = await db.from("conversations").select("id, mode").eq("id", body.conversation_id ?? "").eq("workspace_id", body.workspace_id as string).maybeSingle();
  if (!conv) throw new RuntimeError("not_found", "Conversa não encontrada.");
  if (conv.mode !== "bot") return { skipped: "not_bot_mode" };
  const { data: last } = await db.from("messages").select("id, direction, sender").eq("conversation_id", conv.id)
    .order("seq", { ascending: false }).limit(1).maybeSingle();
  if (!last || last.direction !== "inbound" || last.sender !== "customer") return { skipped: "nothing_pending" };
  return await processMessage(db, last.id, correlationId, log);
}

/** Simulador do painel: roda o pipeline com mensagens fictícias, sem enviar nem gravar nada. */
async function simulate(
  req: Request,
  body: { workspace_id?: string; messages?: unknown },
  correlationId: string,
  log: Logger,
) {
  const user = await requireUser(req);
  await requireWorkspaceRole(user.id, body.workspace_id);
  const workspaceId = body.workspace_id as string;
  const items = Array.isArray(body.messages) ? body.messages.slice(-20) : [];
  const parsed = items
    .filter((m): m is { role: string; text: string } => typeof m?.text === "string" && m.text.trim().length > 0)
    .map((m) => ({ role: m.role === "bot" ? "bot" : "customer", text: m.text.trim().slice(0, 2000) }));
  if (!parsed.length || parsed[parsed.length - 1].role !== "customer") {
    throw new RuntimeError("invalid_request", "A última mensagem da simulação deve ser do cliente.");
  }
  const db = adminDb();
  const config = await loadAgentConfig(db, workspaceId);
  const entitlements = await loadEntitlements(db, workspaceId);
  assertActive(entitlements);
  const now = new Date().toISOString();
  const history: HistoryItem[] = parsed.map((m) => ({
    direction: m.role === "bot" ? "outbound" : "inbound",
    sender: m.role === "bot" ? "bot" : "customer",
    type: "text",
    content: m.text,
    created_at: now,
  }));
  let tail = history.length;
  while (tail > 0 && history[tail - 1].direction === "inbound") tail--;
  const pendingText = history.slice(tail).map((h) => h.content).join("\n");
  const ai = hasFeature(entitlements, "ai_enabled") ? aiFromEnv() : null;
  const outcome = await runAgentPipeline(
    {
      workspaceId,
      businessName: await loadBusinessName(db, workspaceId),
      conversation: { id: "simulation", contact_name: "Cliente (simulação)", contact_phone: "0000000000000" },
      trigger: { id: `simulation-${correlationId}`, type: "text", text: pendingText, media_url: null, created_at: now },
      pendingText,
      history,
      products: await loadProducts(db, workspaceId),
    },
    await buildPipelineDeps(db, { workspaceId, config, ai, entitlements, correlationId, log: log.info }),
  );
  return {
    reply: outcome.reply,
    handoff: outcome.action === "handoff",
    handoff_reason: outcome.handoffReason,
    engine: outcome.engine,
    media: outcome.media,
    knowledge: outcome.knowledge.map((k) => ({ source_title: k.source_title, content: k.content, score: k.score })),
    tool_calls: outcome.toolCalls,
    errors: { external: outcome.externalError, ai: outcome.aiError },
    ai_configured: Boolean(ai),
  };
}
