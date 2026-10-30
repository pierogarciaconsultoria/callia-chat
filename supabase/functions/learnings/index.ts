// Aprendizados do atendimento: analisa as conversas de cada empresa (todo dia pelo pg_cron, ou a pedido do admin),
// grava sugestões com evidência e aplica as aprovadas (FAQ, política ou regra do agente). Nada entra sem aprovação.
import { createHandler, json, readJson, RuntimeError } from "../_shared/http.ts";
import { adminDb, audit, type Db, isInternalCall, optionalEnv, requireUser, requireWorkspaceRole } from "../_shared/supabase.ts";
import { aiFromEnv, loadAgentConfig, loadBusinessName } from "../_shared/agent-runtime.ts";
import type { AiProvider } from "../_shared/ai.ts";
import { assertActive, assertFeature, hasFeature, loadEntitlements } from "../_shared/entitlements.ts";
import {
  appendGuardrail, buildLearningMessages, type Evidence, LEARNING_JSON_SCHEMA, LearningError, type LearningFacts, LIMITS, mergeEvidence,
  messageText, normalizeSuggestions, resolveApplied, selectTranscripts, type Suggestion, type SuggestionKind, type Transcript, whoFor,
} from "../_shared/learnings.ts";

const MANUAL_COOLDOWN_MS = 30 * 60 * 1000;
const FIRST_PERIOD_DAYS = 7;
const MAX_PERIOD_DAYS = 30;
/** Sugestões descartadas (ou já aplicadas) não voltam por este prazo. */
const DECIDED_MEMORY_DAYS = 60;
const SCHEDULE_BUDGET_MS = 110_000;

interface RunArgs { workspaceId: string; since: Date; until: Date; trigger: "schedule" | "manual"; requestedBy: string | null }

async function loadTranscripts(db: Db, workspaceId: string, since: Date, until: Date): Promise<Transcript[]> {
  const { data: convs } = await db.from("conversations").select("id, contact_name, contact_phone")
    .eq("workspace_id", workspaceId).gte("last_message_at", since.toISOString()).lte("last_message_at", until.toISOString())
    .order("last_message_at", { ascending: false }).limit(120);
  if (!convs?.length) return [];
  const ids = convs.map((c: { id: string }) => c.id);
  const [{ data: msgs }, { data: runs }] = await Promise.all([
    db.from("messages").select("conversation_id, sender, type, content, created_at").eq("workspace_id", workspaceId)
      .in("conversation_id", ids).order("created_at", { ascending: true }).order("seq", { ascending: true }).limit(6000),
    db.from("agent_runs").select("conversation_id, reason").eq("workspace_id", workspaceId).eq("status", "handoff")
      .in("conversation_id", ids).gte("created_at", since.toISOString()),
  ]);
  const handoffs = new Map<string, string>();
  for (const r of runs ?? []) handoffs.set(r.conversation_id, String(r.reason ?? "handoff"));
  const byConv = new Map<string, Transcript>();
  for (const c of convs) {
    byConv.set(c.id, { id: c.id, contact: c.contact_name || `+${String(c.contact_phone).replace(/\D/g, "")}`, handoff: handoffs.get(c.id) ?? null, messages: [] });
  }
  for (const m of msgs ?? []) {
    const who = whoFor(m.sender);
    const t = byConv.get(m.conversation_id);
    if (!who || !t) continue;
    const text = messageText(m);
    if (!text) continue;
    t.messages.push({ who, text, at: m.created_at });
  }
  // Só conversas que tiveram mensagem de cliente dentro do período.
  return [...byConv.values()].filter((t) => t.messages.some((m) => m.who === "cliente" && m.at >= since.toISOString()));
}

async function loadFacts(db: Db, workspaceId: string): Promise<LearningFacts> {
  const config = await loadAgentConfig(db, workspaceId);
  const [businessName, { data: faqs }, { data: policies }] = await Promise.all([
    loadBusinessName(db, workspaceId),
    db.from("faqs").select("question, answer").eq("workspace_id", workspaceId).eq("active", true).order("position").limit(200),
    db.from("workspace_policies").select("id, topic, title, content").eq("workspace_id", workspaceId).eq("active", true).order("position"),
  ]);
  return { agentName: config.agent_name, businessName, faqs: faqs ?? [], policies: policies ?? [], guardrails: config.guardrails };
}

async function askAi(ai: AiProvider, model: string | undefined, facts: LearningFacts, transcripts: Transcript[]) {
  const messages = buildLearningMessages(facts, transcripts);
  const strict = { type: "json_schema", json_schema: { name: "learnings", strict: true, schema: LEARNING_JSON_SCHEMA } };
  let result;
  try {
    result = await ai.chat({ messages, model, temperature: 0.2, maxTokens: 6000, responseFormat: strict, timeoutMs: 120_000 });
  } catch (err) {
    // Provedores compatíveis sem json_schema: JSON simples com o formato descrito.
    if (!(err instanceof RuntimeError) || err.details?.status !== 400) throw err;
    const withSchema = [...messages, { role: "user" as const, content: `Responda só com JSON válido neste formato (JSON Schema):\n${JSON.stringify(LEARNING_JSON_SCHEMA)}` }];
    result = await ai.chat({ messages: withSchema, model, temperature: 0.2, maxTokens: 6000, responseFormat: { type: "json_object" }, timeoutMs: 120_000 });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.content ?? "");
  } catch {
    throw new RuntimeError("upstream_unavailable", "A IA não devolveu um JSON válido.");
  }
  return { suggestions: normalizeSuggestions(parsed, transcripts, facts), usage: result.usage, model: result.model };
}

/** Grava as sugestões: soma às pendentes iguais, ignora as decididas há pouco, insere as novas. */
async function storeSuggestions(db: Db, workspaceId: string, runId: string, suggestions: Suggestion[]): Promise<number> {
  if (!suggestions.length) return 0;
  const memory = new Date(Date.now() - DECIDED_MEMORY_DAYS * 86_400_000).toISOString();
  const { data: existing } = await db.from("learning_suggestions").select("id, fingerprint, status, evidence, occurrences, decided_at")
    .eq("workspace_id", workspaceId).in("fingerprint", suggestions.map((s) => s.fingerprint));
  let created = 0;
  for (const s of suggestions) {
    const rows = (existing ?? []).filter((e: { fingerprint: string }) => e.fingerprint === s.fingerprint);
    const pending = rows.find((e: { status: string }) => e.status === "pending");
    if (pending) {
      await db.from("learning_suggestions").update({
        evidence: mergeEvidence(pending.evidence as Evidence[], s.evidence),
        occurrences: Number(pending.occurrences) + s.occurrences,
        run_id: runId,
      }).eq("id", pending.id);
      continue;
    }
    if (rows.some((e: { decided_at: string | null }) => e.decided_at && e.decided_at >= memory)) continue;
    const { error } = await db.from("learning_suggestions").insert({
      workspace_id: workspaceId, run_id: runId, kind: s.kind, fingerprint: s.fingerprint, title: s.title, rationale: s.rationale,
      payload: s.payload, evidence: s.evidence, occurrences: s.occurrences,
    });
    if (!error) created++;
  }
  return created;
}

async function analyzeWorkspace(db: Db, ai: AiProvider, args: RunArgs, log: (m: string, e?: Record<string, unknown>) => void) {
  const { data: run, error } = await db.from("learning_runs").insert({
    workspace_id: args.workspaceId, trigger: args.trigger, requested_by: args.requestedBy,
    period_start: args.since.toISOString(), period_end: args.until.toISOString(),
  }).select("id").single();
  if (error || !run) throw new RuntimeError("internal_error", "Falha ao registrar a análise.", { db: error?.message });
  try {
    const transcripts = selectTranscripts(await loadTranscripts(db, args.workspaceId, args.since, args.until));
    let created = 0;
    let usage: Record<string, unknown> = {};
    let model: string | null = null;
    if (transcripts.length) {
      const facts = await loadFacts(db, args.workspaceId);
      const config = await loadAgentConfig(db, args.workspaceId);
      const result = await askAi(ai, optionalEnv("AI_LEARNING_MODEL") ?? config.ai_model ?? undefined, facts, transcripts);
      created = await storeSuggestions(db, args.workspaceId, run.id, result.suggestions);
      usage = { ...result.usage, suggested: result.suggestions.length, limits: { conversations: LIMITS.conversations } };
      model = result.model;
    }
    await db.from("learning_runs").update({ status: "done", conversations_analyzed: transcripts.length, suggestions_created: created, usage, model, finished_at: new Date().toISOString() }).eq("id", run.id);
    log("learning_run_done", { workspace_id: args.workspaceId, conversations: transcripts.length, created });
    return { run_id: run.id, conversations_analyzed: transcripts.length, suggestions_created: created };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.from("learning_runs").update({ status: "failed", error: message.slice(0, 1000), finished_at: new Date().toISOString() }).eq("id", run.id);
    throw err;
  }
}

Deno.serve(createHandler("learnings", async ({ req, correlationId, log }) => {
  if (req.method !== "POST") throw new RuntimeError("invalid_request", "Use POST.");
  const db = adminDb();
  const body = await readJson<Record<string, unknown>>(req).catch(() => ({} as Record<string, unknown>));
  const hasSession = /^Bearer\s+\S+/i.test(req.headers.get("authorization") ?? "") && !isInternalCall(req);

  // Rodada agendada (pg_cron): todas as empresas com conversa nova desde a última análise.
  if (!hasSession) {
    if (!isInternalCall(req)) throw new RuntimeError("unauthorized", "Chamada interna apenas.");
    const ai = aiFromEnv();
    if (!ai) return json({ ok: true, skipped: "IA não configurada." });
    const { data: due, error } = await db.rpc("learning_due_workspaces");
    if (error) throw new RuntimeError("internal_error", "Falha ao listar as empresas.", { db: error.message });
    const started = Date.now();
    const results: Record<string, unknown> = {};
    for (const row of (due ?? []) as Array<{ workspace_id: string; since: string }>) {
      if (body.workspace_id && row.workspace_id !== body.workspace_id) continue;
      if (Date.now() - started > SCHEDULE_BUDGET_MS) { results[row.workspace_id] = { skipped: "tempo esgotado; fica para a próxima rodada" }; continue; }
      try {
        const ent = await loadEntitlements(db, row.workspace_id);
        if (!ent.active || !hasFeature(ent, "ai_enabled")) { results[row.workspace_id] = { skipped: "inativo ou sem IA no plano" }; continue; }
        const since = new Date(Math.max(Date.parse(row.since), Date.now() - MAX_PERIOD_DAYS * 86_400_000));
        results[row.workspace_id] = await analyzeWorkspace(db, ai, { workspaceId: row.workspace_id, since, until: new Date(), trigger: "schedule", requestedBy: null }, log.info);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results[row.workspace_id] = { error: message };
        log.warn("learning_run_failed", { workspace_id: row.workspace_id, error: message });
      }
    }
    return json({ ok: true, workspaces: results });
  }

  // Ações do admin no painel.
  const user = await requireUser(req);
  const workspaceId = String(body.workspace_id ?? "");
  await requireWorkspaceRole(user.id, workspaceId);
  const action = String(body.action ?? "");

  if (action === "run") {
    const ent = await loadEntitlements(db, workspaceId);
    assertActive(ent);
    assertFeature(ent, "ai_enabled");
    const ai = aiFromEnv();
    if (!ai) throw new RuntimeError("unprocessable", "IA não configurada nesta plataforma.");
    const { data: last } = await db.from("learning_runs").select("created_at, period_end, status").eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (last && last.status !== "failed" && Date.now() - Date.parse(last.created_at) < MANUAL_COOLDOWN_MS) {
      const minutes = Math.ceil((MANUAL_COOLDOWN_MS - (Date.now() - Date.parse(last.created_at))) / 60_000);
      throw new RuntimeError("rate_limited", `A última análise foi há pouco. Tente de novo em ${minutes} min.`);
    }
    const { data: lastDone } = await db.from("learning_runs").select("period_end").eq("workspace_id", workspaceId).eq("status", "done")
      .order("period_end", { ascending: false }).limit(1).maybeSingle();
    const floor = Date.now() - MAX_PERIOD_DAYS * 86_400_000;
    const since = new Date(Math.max(lastDone ? Date.parse(lastDone.period_end) : Date.now() - FIRST_PERIOD_DAYS * 86_400_000, floor));
    const result = await analyzeWorkspace(db, ai, { workspaceId, since, until: new Date(), trigger: "manual", requestedBy: user.id }, log.info);
    return json({ ok: true, ...result });
  }

  if (action === "apply" || action === "dismiss") {
    const id = String(body.suggestion_id ?? "");
    const { data: s } = await db.from("learning_suggestions").select("*").eq("id", id).eq("workspace_id", workspaceId).maybeSingle();
    if (!s) throw new RuntimeError("not_found", "Sugestão não encontrada.");
    if (s.status !== "pending") throw new RuntimeError("conflict", `Sugestão já ${s.status === "applied" ? "aplicada" : "descartada"}.`);
    const decided = { decided_by: user.id, decided_at: new Date().toISOString() };
    if (action === "dismiss") {
      await db.from("learning_suggestions").update({ status: "dismissed", ...decided }).eq("id", id);
      await audit(db, { workspace_id: workspaceId, actor_user_id: user.id, action: "learning.dismissed", entity: "learning_suggestion", entity_id: id, details: { kind: s.kind, title: s.title }, correlation_id: correlationId });
      return json({ ok: true, status: "dismissed" });
    }
    const kind = s.kind as SuggestionKind;
    let applied;
    try {
      applied = resolveApplied(kind, s.payload, (body.payload ?? null) as Record<string, unknown> | null);
    } catch (err) {
      if (err instanceof LearningError) throw new RuntimeError("unprocessable", err.message);
      throw err;
    }
    if (kind === "faq") {
      const p = applied as { question: string; answer: string };
      const { count } = await db.from("faqs").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
      const { error } = await db.from("faqs").insert({ workspace_id: workspaceId, question: p.question, answer: p.answer, active: true, position: count ?? 0 });
      if (error) throw new RuntimeError("internal_error", "Falha ao salvar a pergunta.", { db: error.message });
    } else if (kind === "policy") {
      const p = applied as { topic: string; title: string; content: string; id: string | null };
      const row = { workspace_id: workspaceId, topic: p.topic, title: p.title, content: p.content, active: true };
      const q = p.id ? db.from("workspace_policies").update(row).eq("id", p.id).eq("workspace_id", workspaceId) : db.from("workspace_policies").insert(row);
      const { error } = await q;
      if (error) throw new RuntimeError("internal_error", "Falha ao salvar a política.", { db: error.message });
    } else {
      const p = applied as { text: string };
      const config = await loadAgentConfig(db, workspaceId);
      const { error } = await db.from("agent_configs").update({ guardrails: appendGuardrail(config.guardrails, p.text) }).eq("workspace_id", workspaceId);
      if (error) throw new RuntimeError("internal_error", "Falha ao salvar a regra.", { db: error.message });
    }
    await db.from("learning_suggestions").update({ status: "applied", applied_payload: applied, ...decided }).eq("id", id);
    await audit(db, { workspace_id: workspaceId, actor_user_id: user.id, action: `learning.applied.${kind}`, entity: "learning_suggestion", entity_id: id, details: { title: s.title, applied }, correlation_id: correlationId });
    return json({ ok: true, status: "applied", kind, applied });
  }

  throw new RuntimeError("invalid_request", `Ação desconhecida: ${action}`);
}));
