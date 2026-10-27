// Assistente de configuração: importa site e Instagram, gera persona e instruções com IA e aplica o que o admin aprovar.
import { createHandler, json, readJson, RuntimeError, runInBackground } from "../_shared/http.ts";
import { aiFromEnv } from "../_shared/agent-runtime.ts";
import { buildSetupMessages, type DraftContent, draftContentSchema, normalizeDraft, sameQuestion, SETUP_JSON_SCHEMA, type SetupMaterial } from "../_shared/agent-setup.ts";
import { assertActive, assertFeature, loadEntitlements } from "../_shared/entitlements.ts";
import { assertCanAddSource, createSource, indexSource, SOURCE_COLUMNS } from "../_shared/indexing.ts";
import { fetchInstagramProfile, parseInstagramHandle } from "../_shared/instagram.ts";
import { assertPublicHttpUrl } from "../_shared/net.ts";
import { adminDb, audit, type Db, optionalEnv, requireUser, requireWorkspaceRole } from "../_shared/supabase.ts";

type Body = Record<string, unknown> & { action?: string; workspace_id?: string };

const SETUP_SOURCE_KINDS = ["site", "social", "url", "document", "text"];
const DRAFT_COLUMNS = "id, workspace_id, status, source_ids, extra_text, model, draft, usage, created_by, created_at, applied_at, applied_sections";

async function requireAdminActive(db: Db, userId: string, workspaceId: unknown) {
  await requireWorkspaceRole(userId, workspaceId);
  const entitlements = await loadEntitlements(db, workspaceId as string);
  assertActive(entitlements);
  return entitlements;
}

/** Reaproveita a fonte quando o mesmo site/perfil é importado de novo (não gasta limite do plano). */
async function findSource(db: Db, workspaceId: string, kind: string, url: string) {
  const { data } = await db.from("knowledge_sources").select(SOURCE_COLUMNS).eq("workspace_id", workspaceId).eq("kind", kind).eq("url", url).maybeSingle();
  return data;
}

async function generateDraft(db: Db, workspaceId: string, sourceIds: string[] | null, extraText: string | null) {
  const ai = aiFromEnv();
  if (!ai) throw new RuntimeError("unprocessable", "IA não configurada no servidor (AI_COMPAT_API_KEY).");

  let query = db.from("knowledge_sources").select("id, title, kind, url, content, status")
    .eq("workspace_id", workspaceId).in("kind", SETUP_SOURCE_KINDS).eq("status", "indexed");
  if (sourceIds?.length) query = query.in("id", sourceIds);
  const { data: sources } = await query.order("created_at");
  const materials: SetupMaterial[] = (sources ?? [])
    .filter((s: { content: string | null }) => s.content?.trim())
    .map((s: { title: string; kind: string; url: string | null; content: string }) => ({ title: s.title, kind: s.kind, url: s.url, content: s.content }));
  if (!materials.length && !extraText?.trim()) {
    throw new RuntimeError("invalid_request", "Adicione ao menos uma fonte indexada (site, Instagram, documento) ou um texto.");
  }

  const [{ data: cfg }, { data: faqs }, { data: products }] = await Promise.all([
    db.from("agent_configs").select("agent_name, persona_prompt, guardrails, segment_id").eq("workspace_id", workspaceId).single(),
    db.from("faqs").select("question").eq("workspace_id", workspaceId),
    db.from("products").select("name").eq("workspace_id", workspaceId),
  ]);
  const { messages, truncated } = buildSetupMessages(materials, {
    agent_name: cfg?.agent_name ?? "Assistente",
    persona_prompt: cfg?.persona_prompt ?? "",
    guardrails: cfg?.guardrails ?? null,
    segment_id: cfg?.segment_id ?? null,
    faqs: faqs ?? [],
    products: products ?? [],
  }, extraText);
  const model = optionalEnv("AI_SETUP_MODEL") ?? optionalEnv("AI_DEFAULT_MODEL") ?? "gpt-4o-mini";

  const strict = { type: "json_schema", json_schema: { name: "agent_setup", strict: true, schema: SETUP_JSON_SCHEMA } };
  let result;
  try {
    result = await ai.chat({ messages, model, temperature: 0.3, maxTokens: 12_000, responseFormat: strict, timeoutMs: 120_000 });
  } catch (err) {
    // Provedores compatíveis sem json_schema: tenta JSON simples com o formato descrito no prompt.
    if (!(err instanceof RuntimeError) || err.details?.status !== 400) throw err;
    const withSchema = [...messages, { role: "user" as const, content: `Responda só com JSON válido neste formato (JSON Schema):\n${JSON.stringify(SETUP_JSON_SCHEMA)}` }];
    result = await ai.chat({ messages: withSchema, model, temperature: 0.3, maxTokens: 12_000, responseFormat: { type: "json_object" }, timeoutMs: 120_000 });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.content ?? "");
  } catch {
    throw new RuntimeError("upstream_unavailable", "A IA não devolveu um JSON válido. Tente gerar de novo.");
  }
  let draft: DraftContent;
  try {
    draft = normalizeDraft(parsed);
  } catch (err) {
    throw new RuntimeError("upstream_unavailable", "A resposta da IA veio fora do formato esperado. Tente gerar de novo.", { reason: String(err).slice(0, 300) });
  }
  return { draft, model, usage: { ...result.usage, truncated_sources: truncated }, sourceIds: (sources ?? []).map((s: { id: string }) => s.id) };
}

Deno.serve(createHandler("agent-setup", async ({ req, correlationId }) => {
  if (req.method !== "POST") throw new RuntimeError("invalid_request", "Use POST.");
  const user = await requireUser(req);
  const body = await readJson<Body>(req);
  const db = adminDb();
  const log = (action: string, workspaceId: string, details: Record<string, unknown> = {}, entityId?: string) =>
    audit(db, { workspace_id: workspaceId, actor_user_id: user.id, action: `agent_setup.${action}`, entity: "agent_setup", entity_id: entityId, details, correlation_id: correlationId });

  switch (body.action) {
    case "import_site": {
      await requireAdminActive(db, user.id, body.workspace_id);
      const workspaceId = body.workspace_id as string;
      const url = assertPublicHttpUrl(body.url);
      const maxPages = Math.min(Math.max(1, Number(body.max_pages) || 20), 40);
      const existing = await findSource(db, workspaceId, "site", url);
      let source;
      if (existing) {
        await db.from("knowledge_sources").update({ status: "pending", metadata: { ...existing.metadata, max_pages: maxPages } }).eq("id", existing.id);
        runInBackground(indexSource(db, existing.id));
        source = { ...existing, status: "pending" };
      } else {
        await assertCanAddSource(db, workspaceId);
        source = await createSource(db, { workspace_id: workspaceId, kind: "site", title: new URL(url).hostname, url, metadata: { max_pages: maxPages } });
      }
      await log("site_imported", workspaceId, { url, max_pages: maxPages, reused: Boolean(existing) }, source.id);
      return json({ source });
    }

    case "import_instagram": {
      await requireAdminActive(db, user.id, body.workspace_id);
      const workspaceId = body.workspace_id as string;
      const handle = parseInstagramHandle(typeof body.profile === "string" ? body.profile : "");
      if (!handle) throw new RuntimeError("invalid_request", "Informe o perfil (@perfil ou link do Instagram).");
      const pasted = typeof body.pasted_text === "string" ? body.pasted_text.trim().slice(0, 30_000) : "";
      const publicData = await fetchInstagramProfile(handle, { baseUrl: optionalEnv("INSTAGRAM_BASE_URL") });
      const content = [publicData.text, pasted && `Texto informado pelo dono (bio, destaques, legendas):\n${pasted}`].filter(Boolean).join("\n\n");
      if (!content) {
        throw new RuntimeError("unprocessable", `${publicData.note ?? "Não foi possível ler o perfil."} Cole a bio, os destaques e legendas importantes no campo de texto.`);
      }
      const url = `https://www.instagram.com/${handle}/`;
      const metadata = { network: "instagram", handle, fetched: publicData.fetched };
      const existing = await findSource(db, workspaceId, "social", url);
      let source;
      if (existing) {
        await db.from("knowledge_sources").update({ content, metadata, status: "pending" }).eq("id", existing.id);
        runInBackground(indexSource(db, existing.id));
        source = { ...existing, metadata, status: "pending" };
      } else {
        await assertCanAddSource(db, workspaceId);
        source = await createSource(db, { workspace_id: workspaceId, kind: "social", title: `Instagram @${handle}`, url, content, metadata });
      }
      await log("instagram_imported", workspaceId, { handle, fetched: publicData.fetched, pasted: Boolean(pasted) }, source.id);
      const note = publicData.fetched
        ? publicData.note
        : pasted ? `${publicData.note ?? "Leitura pública indisponível."} Usamos o texto que você colou.` : publicData.note;
      return json({ source, fetched: publicData.fetched, note });
    }

    case "generate": {
      const entitlements = await requireAdminActive(db, user.id, body.workspace_id);
      assertFeature(entitlements, "ai_enabled");
      const workspaceId = body.workspace_id as string;
      const sourceIds = Array.isArray(body.source_ids) ? body.source_ids.filter((x): x is string => typeof x === "string").slice(0, 50) : null;
      const extraText = typeof body.extra_text === "string" ? body.extra_text.slice(0, 30_000) : null;
      const out = await generateDraft(db, workspaceId, sourceIds, extraText);
      const { data: row, error } = await db.from("agent_setup_drafts").insert({
        workspace_id: workspaceId,
        source_ids: out.sourceIds,
        extra_text: extraText,
        model: out.model,
        draft: out.draft,
        usage: out.usage,
        created_by: user.id,
      }).select(DRAFT_COLUMNS).single();
      if (error) throw new RuntimeError("internal_error", "Falha ao salvar o rascunho.", { db: error.message });
      await log("draft_generated", workspaceId, { sources: out.sourceIds.length, model: out.model, faqs: out.draft.faqs.length }, row.id);
      return json({ draft: row });
    }

    case "list_drafts": {
      await requireWorkspaceRole(user.id, body.workspace_id);
      const { data } = await db.from("agent_setup_drafts").select(DRAFT_COLUMNS).eq("workspace_id", body.workspace_id).order("created_at", { ascending: false }).limit(10);
      return json({ drafts: data ?? [] });
    }

    case "apply":
    case "discard": {
      if (typeof body.draft_id !== "string") throw new RuntimeError("invalid_request", "draft_id obrigatório.");
      const { data: row } = await db.from("agent_setup_drafts").select(DRAFT_COLUMNS).eq("id", body.draft_id).maybeSingle();
      if (!row) throw new RuntimeError("not_found", "Rascunho não encontrado.");
      await requireAdminActive(db, user.id, row.workspace_id);
      if (row.status !== "ready") throw new RuntimeError("conflict", "Este rascunho já foi aplicado ou descartado.");

      if (body.action === "discard") {
        await db.from("agent_setup_drafts").update({ status: "discarded" }).eq("id", row.id);
        await log("draft_discarded", row.workspace_id, {}, row.id);
        return json({ ok: true });
      }

      const parsed = draftContentSchema.safeParse(body.draft ?? row.draft);
      if (!parsed.success) {
        throw new RuntimeError("invalid_request", "Rascunho revisado inválido.", {
          issues: parsed.error.issues.slice(0, 10).map((i) => ({ path: i.path.join("."), message: i.message })),
        });
      }
      const d = parsed.data;
      const sections = (body.sections ?? {}) as Record<string, unknown>;
      const indices = (v: unknown, max: number) =>
        Array.isArray(v) ? [...new Set(v.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < max))] : [];

      const patch: Record<string, unknown> = {};
      const applied: Record<string, unknown> = {};
      if (sections.profile) {
        Object.assign(patch, { agent_name: d.agent.agent_name, language: d.agent.language, persona_prompt: d.agent.persona_prompt });
        if (d.business.website_url) patch.website_url = d.business.website_url;
        applied.profile = true;
      }
      if (sections.guardrails) {
        patch.guardrails = d.agent.guardrails || null;
        applied.guardrails = true;
      }
      if (sections.business_hours && d.business_hours) {
        Object.assign(patch, { business_hours: d.business_hours.weekly, timezone: d.business_hours.timezone });
        applied.business_hours = true;
      }
      if (sections.handoff) {
        Object.assign(patch, { handoff_keywords: d.handoff.keywords, handoff_message: d.handoff.message, out_of_hours_message: d.handoff.out_of_hours_message });
        applied.handoff = true;
      }
      if (sections.payment_links) {
        patch.payment_links = d.payment_links;
        applied.payment_links = d.payment_links.length;
      }
      if (Object.keys(patch).length) {
        const { error } = await db.from("agent_configs").update(patch).eq("workspace_id", row.workspace_id);
        if (error) throw new RuntimeError("internal_error", "Falha ao atualizar o agente.", { db: error.message });
      }
      // Segmento detectado: só preenche se o dono ainda não escolheu um.
      if (sections.profile && d.business.segment_id) {
        await db.from("agent_configs").update({ segment_id: d.business.segment_id }).eq("workspace_id", row.workspace_id).is("segment_id", null);
      }

      const faqIdx = indices(sections.faqs, d.faqs.length);
      if (faqIdx.length) {
        const { data: existing } = await db.from("faqs").select("question, position").eq("workspace_id", row.workspace_id);
        let position = Math.max(0, ...(existing ?? []).map((f: { position: number }) => f.position)) + 1;
        const rows = faqIdx.map((i) => d.faqs[i])
          .filter((f) => !(existing ?? []).some((e: { question: string }) => sameQuestion(e.question, f.question)))
          .map((f) => ({ workspace_id: row.workspace_id, question: f.question, answer: f.answer, position: position++ }));
        if (rows.length) {
          const { error } = await db.from("faqs").insert(rows);
          if (error) throw new RuntimeError("internal_error", "Falha ao importar perguntas.", { db: error.message });
        }
        applied.faqs = rows.length;
      }
      const productIdx = indices(sections.products, d.products.length);
      if (productIdx.length) {
        const rows = productIdx.map((i) => d.products[i]).map((p) => ({
          workspace_id: row.workspace_id, name: p.name, description: p.description, price: p.price, currency: p.currency, url: p.url,
        }));
        const { error } = await db.from("products").insert(rows);
        if (error) throw new RuntimeError("internal_error", "Falha ao importar o catálogo.", { db: error.message });
        applied.products = rows.length;
      }
      if (!Object.keys(applied).length) throw new RuntimeError("invalid_request", "Selecione ao menos uma seção para aplicar.");

      await db.from("agent_setup_drafts").update({
        status: "applied",
        draft: d,
        applied_at: new Date().toISOString(),
        applied_by: user.id,
        applied_sections: Object.keys(applied),
      }).eq("id", row.id);
      await log("draft_applied", row.workspace_id, applied, row.id);
      return json({ applied });
    }

    default:
      throw new RuntimeError("invalid_request", "Ação desconhecida.");
  }
}));
