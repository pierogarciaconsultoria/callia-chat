// Assistente do painel (administradores): conversa, propõe alterações nos fatos estruturados e grava só após confirmação.
import { createHandler, json, readJson, RuntimeError } from "../_shared/http.ts";
import { adminDb, audit, type Db, requireUser, requireWorkspaceRole } from "../_shared/supabase.ts";
import { aiFromEnv, loadAgentConfig, loadBusinessName } from "../_shared/agent-runtime.ts";
import { assertActive, assertFeature, loadEntitlements } from "../_shared/entitlements.ts";
import type { ChatMessage } from "../_shared/ai.ts";
import { priceTableSchema } from "../_shared/pricing.ts";
import { applyHours, applyPriceOps, ASSISTANT_TOOLS, AssistantError, buildAssistantPrompt, type Hours, type PriceOp, SCREENS } from "../_shared/assistant.ts";

const MAX_ROUNDS = 4;
const MAX_HISTORY = 20;

interface Proposal { id: string; kind: string; title: string; changes: string[] }

async function loadFacts(db: Db, workspaceId: string) {
  const config = await loadAgentConfig(db, workspaceId);
  const [{ data: pt }, { data: policies }] = await Promise.all([
    db.from("price_tables").select("id, name, currency, data").eq("workspace_id", workspaceId).eq("active", true).maybeSingle(),
    db.from("workspace_policies").select("id, topic, title, content").eq("workspace_id", workspaceId).eq("active", true).order("position"),
  ]);
  const parsed = pt ? priceTableSchema.safeParse(pt.data) : null;
  return {
    config,
    priceTableRow: pt as { id: string; name: string; currency: string } | null,
    priceTable: parsed?.success ? parsed.data : null,
    policies: (policies ?? []) as Array<{ id: string; topic: string; title: string; content: string }>,
  };
}

Deno.serve(createHandler("assistant", async ({ req, correlationId, log }) => {
  if (req.method !== "POST") throw new RuntimeError("invalid_request", "Use POST.");
  const user = await requireUser(req);
  const body = await readJson(req);
  const workspaceId = String(body.workspace_id ?? "");
  await requireWorkspaceRole(user.id, workspaceId);
  const db = adminDb();
  const action = String(body.action ?? "chat");

  if (action === "apply" || action === "discard") {
    const id = String(body.proposal_id ?? "");
    const { data: p } = await db.from("assistant_proposals").select("*").eq("id", id).eq("workspace_id", workspaceId).maybeSingle();
    if (!p) throw new RuntimeError("not_found", "Proposta não encontrada.");
    if (p.status !== "pending") throw new RuntimeError("conflict", `Proposta já ${p.status === "applied" ? "aplicada" : "encerrada"}.`);
    if (action === "discard" || Date.parse(p.expires_at) < Date.now()) {
      await db.from("assistant_proposals").update({ status: action === "discard" ? "discarded" : "expired" }).eq("id", id);
      if (action !== "discard") throw new RuntimeError("conflict", "Proposta expirou; peça de novo ao assistente.");
      return json({ ok: true, status: "discarded" });
    }
    const payload = p.payload as Record<string, unknown>;
    if (p.kind === "price_table") {
      const parsed = priceTableSchema.safeParse(payload.data);
      if (!parsed.success) throw new RuntimeError("unprocessable", "Tabela inválida.");
      await db.from("price_tables").update({ active: false }).eq("workspace_id", workspaceId).eq("active", true);
      const { error } = await db.from("price_tables").insert({ workspace_id: workspaceId, name: String(payload.name ?? "Tabela de preços"), currency: String(payload.currency ?? "BRL"), data: parsed.data, active: true, updated_by: user.id });
      if (error) throw new RuntimeError("internal_error", "Falha ao salvar a tabela.", { db: error.message });
    } else if (p.kind === "policy") {
      const row = { workspace_id: workspaceId, topic: String(payload.topic), title: String(payload.title), content: String(payload.content), active: true };
      const q = payload.id ? db.from("workspace_policies").update(row).eq("id", String(payload.id)).eq("workspace_id", workspaceId) : db.from("workspace_policies").insert(row);
      const { error } = await q;
      if (error) throw new RuntimeError("internal_error", "Falha ao salvar a política.", { db: error.message });
    } else if (p.kind === "business_hours") {
      const { error } = await db.from("agent_configs").update({ business_hours: payload.business_hours, ...(payload.out_of_hours_message !== undefined ? { out_of_hours_message: payload.out_of_hours_message } : {}) }).eq("workspace_id", workspaceId);
      if (error) throw new RuntimeError("internal_error", "Falha ao salvar o horário.", { db: error.message });
    } else if (p.kind === "guardrails") {
      const { error } = await db.from("agent_configs").update({ guardrails: String(payload.guardrails ?? "") || null }).eq("workspace_id", workspaceId);
      if (error) throw new RuntimeError("internal_error", "Falha ao salvar as regras.", { db: error.message });
    }
    await db.from("assistant_proposals").update({ status: "applied", applied_at: new Date().toISOString() }).eq("id", id);
    await audit(db, { workspace_id: workspaceId, actor_user_id: user.id, action: `assistant.applied.${p.kind}`, entity: "assistant_proposal", entity_id: id, details: { title: p.title, changes: p.changes }, correlation_id: correlationId });
    return json({ ok: true, status: "applied", kind: p.kind });
  }

  if (action !== "chat") throw new RuntimeError("invalid_request", `Ação desconhecida: ${action}`);
  const entitlements = await loadEntitlements(db, workspaceId);
  assertActive(entitlements);
  assertFeature(entitlements, "ai_enabled");
  const ai = aiFromEnv();
  if (!ai) throw new RuntimeError("unprocessable", "IA não configurada nesta plataforma.");

  const history = (Array.isArray(body.messages) ? body.messages : []) as Array<{ role: string; content: string }>;
  const turns: ChatMessage[] = history
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content.slice(0, 4000) }));
  if (!turns.length || turns[turns.length - 1].role !== "user") throw new RuntimeError("invalid_request", "Envie a mensagem do usuário.");

  const facts = await loadFacts(db, workspaceId);
  const businessName = await loadBusinessName(db, workspaceId);
  const system = buildAssistantPrompt({
    agentName: facts.config.agent_name, businessName, priceTable: facts.priceTable, currency: facts.priceTableRow?.currency ?? "BRL",
    policies: facts.policies, businessHours: (facts.config.business_hours ?? {}) as Hours, outOfHoursMessage: facts.config.out_of_hours_message,
    guardrails: facts.config.guardrails, timezone: facts.config.timezone,
  });
  const messages: ChatMessage[] = [{ role: "system", content: system }, ...turns];
  const proposals: Proposal[] = [];
  let navigation: { to: string; label: string } | null = null;

  const propose = async (kind: string, title: string, changes: string[], payload: Record<string, unknown>) => {
    // O modelo às vezes chama a mesma ferramenta duas vezes na rodada: uma proposta por tipo basta.
    const dup = proposals.find((p) => p.kind === kind);
    if (dup) return { proposta_registrada: true, aviso: "Já existe uma proposta deste tipo nesta rodada; não repita. Resuma e peça confirmação.", alteracoes: dup.changes };
    const { data, error } = await db.from("assistant_proposals").insert({ workspace_id: workspaceId, user_id: user.id, kind, title, changes, payload }).select("id").single();
    if (error) throw new RuntimeError("internal_error", "Falha ao registrar a proposta.", { db: error.message });
    proposals.push({ id: data.id, kind, title, changes });
    return { proposta_registrada: true, titulo: title, alteracoes: changes, instrucao: "Resuma em uma frase e peça para confirmar no cartão. Não repita a lista inteira." };
  };

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const result = await ai.chat({ messages, tools: ASSISTANT_TOOLS, model: facts.config.ai_model ?? undefined, temperature: 0.2, maxTokens: 700 });
    if (!result.toolCalls.length) {
      return json({ reply: result.content?.trim() || "Não entendi; pode dizer de outro jeito?", proposals, navigation });
    }
    messages.push({ role: "assistant", content: result.content, tool_calls: result.toolCalls });
    for (const call of result.toolCalls) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(call.function.arguments || "{}"); } catch { args = {}; }
      let toolResult: unknown;
      try {
        if (call.function.name === "navegar") {
          const screen = SCREENS.find((s) => s.id === args.tela);
          navigation = screen ? { to: screen.to, label: screen.label } : null;
          toolResult = screen ? { tela: screen.label, caminho: screen.to, o_que_tem: screen.what } : { erro: "tela desconhecida" };
        } else if (call.function.name === "propor_tabela_precos") {
          if (!facts.priceTable) throw new AssistantError("Não há tabela de preços cadastrada; crie em Catálogo e preços.");
          const ops = (Array.isArray(args.operacoes) ? args.operacoes : []) as PriceOp[];
          const { table, changes } = applyPriceOps(facts.priceTable, ops, facts.priceTableRow?.currency ?? "BRL");
          toolResult = await propose("price_table", "Tabela de preços", changes, { name: facts.priceTableRow?.name, currency: facts.priceTableRow?.currency ?? "BRL", data: table });
        } else if (call.function.name === "propor_horario") {
          const dias = (Array.isArray(args.dias) ? args.dias : []) as Array<{ days: string[]; ranges: Array<[string, string]> }>;
          const { hours, changes } = applyHours((facts.config.business_hours ?? {}) as Hours, dias);
          const msg = args.mensagem_fora_do_horario;
          if (typeof msg === "string" && msg.trim() !== (facts.config.out_of_hours_message ?? "").trim()) changes.push(`Mensagem fora do horário: "${facts.config.out_of_hours_message ?? ""}" → "${msg.trim()}"`);
          if (!changes.length) throw new AssistantError("Nada mudaria em relação ao horário atual.");
          toolResult = await propose("business_hours", "Horário da equipe", changes, { business_hours: hours, ...(typeof msg === "string" ? { out_of_hours_message: msg.trim() || null } : {}) });
        } else if (call.function.name === "propor_politica") {
          const topic = String(args.topic ?? "outro").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "outro";
          const title = String(args.title ?? "").trim().slice(0, 120);
          const content = String(args.content ?? "").trim().slice(0, 4000);
          if (title.length < 2 || content.length < 2) throw new AssistantError("Título e texto são obrigatórios.");
          const existing = args.id ? facts.policies.find((p) => p.id === args.id) : facts.policies.find((p) => p.topic === topic);
          const changes = existing ? [`Política "${existing.title}": "${existing.content}" → "${content}"`] : [`Política nova (${topic}) "${title}": ${content}`];
          toolResult = await propose("policy", existing ? `Política: ${existing.title}` : `Política nova: ${title}`, changes, { id: existing?.id, topic, title, content });
        } else if (call.function.name === "propor_regras") {
          const texto = String(args.texto ?? "").trim().slice(0, 6000);
          if (texto === (facts.config.guardrails ?? "").trim()) throw new AssistantError("As regras ficariam iguais às atuais.");
          toolResult = await propose("guardrails", "Regras de comportamento do agente", [`Regras: "${(facts.config.guardrails ?? "").trim().slice(0, 300)}…" → "${texto.slice(0, 300)}…"`], { guardrails: texto });
        } else {
          toolResult = { erro: "ferramenta desconhecida" };
        }
      } catch (err) {
        if (err instanceof AssistantError) toolResult = { erro: err.message, instrucao: "Explique o problema ao usuário em uma frase e pergunte o que falta." };
        else throw err;
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(toolResult).slice(0, 6000) });
    }
  }
  log.warn("assistant_max_rounds", { workspace_id: workspaceId });
  return json({ reply: "Não consegui concluir; pode repetir o pedido com os dados completos?", proposals, navigation });
}));
