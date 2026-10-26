// Base de conhecimento pelo painel: texto, URL e documentos (PDF/DOCX/TXT/MD); busca de teste e embeddings pendentes.
import { createHandler, json, readJson, RuntimeError, runInBackground } from "../_shared/http.ts";
import { aiFromEnv } from "../_shared/agent-runtime.ts";
import { searchKnowledge } from "../_shared/knowledge.ts";
import { assertPublicHttpUrl } from "../_shared/net.ts";
import { adminDb, audit, requireUser, requireWorkspaceRole } from "../_shared/supabase.ts";
import { assertActive, assertFeature, loadEntitlements } from "../_shared/entitlements.ts";
import { priceTableSchema, quoteStay } from "../_shared/pricing.ts";
import { aiForWorkspace, assertCanAddSource, createSource, docKind, embedAndStore, indexSource, MAX_TEXT, SOURCE_COLUMNS } from "../_shared/indexing.ts";

interface Body {
  action?: string;
  workspace_id?: string;
  source_id?: string;
  title?: string;
  content?: string;
  url?: string;
  storage_path?: string;
  mime_type?: string;
  query?: string;
  limit?: number;
}

Deno.serve(createHandler("knowledge-index", async ({ req, correlationId }) => {
  if (req.method !== "POST") throw new RuntimeError("invalid_request", "Use POST.");
  const user = await requireUser(req);
  const body = await readJson<Body>(req);
  const db = adminDb();
  const title = (fallback = "") => (body.title?.trim() || fallback).slice(0, 200);

  switch (body.action) {
    case "price_table_get": {
      await requireWorkspaceRole(user.id, body.workspace_id, ["owner", "admin", "agent"]);
      const { data } = await db.from("price_tables").select("id, name, currency, data, updated_at").eq("workspace_id", body.workspace_id).eq("active", true).maybeSingle();
      return json({ price_table: data ?? null });
    }
    case "price_table_save": {
      await requireWorkspaceRole(user.id, body.workspace_id);
      const raw = body as unknown as { name?: string; currency?: string; data?: unknown };
      const parsed = priceTableSchema.safeParse(raw.data);
      if (!parsed.success) {
        throw new RuntimeError("invalid_request", "Tabela de preços inválida.", { issues: parsed.error.issues.slice(0, 10).map((i) => ({ path: i.path.join("."), message: i.message })) });
      }
      const name = (raw.name ?? "Tabela de preços").trim().slice(0, 120) || "Tabela de preços";
      await db.from("price_tables").update({ active: false }).eq("workspace_id", body.workspace_id).eq("active", true);
      const { data, error } = await db.from("price_tables").insert({ workspace_id: body.workspace_id, name, currency: raw.currency ?? "BRL", data: parsed.data, active: true, updated_by: user.id })
        .select("id, name, currency, data, updated_at").single();
      if (error) throw new RuntimeError("internal_error", "Falha ao salvar a tabela.", { db: error.message });
      await audit(db, { workspace_id: body.workspace_id as string, actor_user_id: user.id, action: "price_table.saved", entity: "price_table", entity_id: data.id, details: { name, units: parsed.data.units.length, periods: parsed.data.periods.length }, correlation_id: correlationId });
      return json({ price_table: data });
    }
    case "price_quote": {
      // Simulador de valores no painel (mesmo cálculo da MarIA).
      await requireWorkspaceRole(user.id, body.workspace_id, ["owner", "admin", "agent"]);
      const { data } = await db.from("price_tables").select("data, currency").eq("workspace_id", body.workspace_id).eq("active", true).maybeSingle();
      if (!data) throw new RuntimeError("unprocessable", "Nenhuma tabela de preços cadastrada.");
      const q = body as unknown as { checkin?: string; checkout?: string; adults?: number; children_ages?: number[] };
      return json({ quote: quoteStay(priceTableSchema.parse(data.data), { checkin: q.checkin ?? "", checkout: q.checkout ?? "", adults: Number(q.adults ?? 2), childrenAges: q.children_ages ?? [] }, data.currency) });
    }
    case "search_preview": {
      await requireWorkspaceRole(user.id, body.workspace_id, ["owner", "admin", "agent"]);
      const query = body.query?.trim() ?? "";
      if (query.length < 2) throw new RuntimeError("invalid_request", "Digite ao menos 2 caracteres.");
      const limit = Math.min(Math.max(1, Number(body.limit) || 5), 20);
      const ai = await aiForWorkspace(db, body.workspace_id as string);
      return json(await searchKnowledge(db, ai, body.workspace_id as string, query, limit));
    }
    case "create_text": {
      await requireWorkspaceRole(user.id, body.workspace_id);
      await assertCanAddSource(db, body.workspace_id as string);
      const content = body.content?.trim() ?? "";
      if (!title()) throw new RuntimeError("invalid_request", "Título obrigatório.");
      if (content.length < 20) throw new RuntimeError("invalid_request", "Texto muito curto (mínimo 20 caracteres).");
      if (content.length > MAX_TEXT) throw new RuntimeError("invalid_request", "Texto acima de 400 mil caracteres.");
      const source = await createSource(db, { workspace_id: body.workspace_id, kind: "text", title: title(), content });
      await audit(db, { workspace_id: source.workspace_id, actor_user_id: user.id, action: "knowledge.source.created", entity: "knowledge_source", entity_id: source.id, details: { kind: "text" }, correlation_id: correlationId });
      return json({ source });
    }
    case "create_url": {
      await requireWorkspaceRole(user.id, body.workspace_id);
      await assertCanAddSource(db, body.workspace_id as string);
      const url = assertPublicHttpUrl(body.url);
      const source = await createSource(db, { workspace_id: body.workspace_id, kind: "url", title: title(url), url });
      await audit(db, { workspace_id: source.workspace_id, actor_user_id: user.id, action: "knowledge.source.created", entity: "knowledge_source", entity_id: source.id, details: { kind: "url", url }, correlation_id: correlationId });
      return json({ source });
    }
    case "create_document": {
      await requireWorkspaceRole(user.id, body.workspace_id);
      await assertCanAddSource(db, body.workspace_id as string);
      const path = body.storage_path ?? "";
      // O arquivo precisa estar na pasta do próprio workspace.
      if (!path.startsWith(`${body.workspace_id}/`) || path.includes("..")) throw new RuntimeError("forbidden", "Caminho de arquivo fora do workspace.");
      if (!docKind(body.mime_type, path)) throw new RuntimeError("invalid_request", "Tipo de arquivo não suportado (use PDF, DOCX, TXT ou MD).");
      const source = await createSource(db, {
        workspace_id: body.workspace_id,
        kind: "document",
        title: title(path.split("/").pop()),
        storage_path: path,
        mime_type: body.mime_type ?? null,
      });
      await audit(db, { workspace_id: source.workspace_id, actor_user_id: user.id, action: "knowledge.source.created", entity: "knowledge_source", entity_id: source.id, details: { kind: "document", path }, correlation_id: correlationId });
      return json({ source });
    }
    case "embed_pending": {
      await requireWorkspaceRole(user.id, body.workspace_id);
      const entitlements = await loadEntitlements(db, body.workspace_id as string);
      assertActive(entitlements);
      assertFeature(entitlements, "ai_enabled");
      const ai = aiFromEnv();
      if (!ai?.embeddingsEnabled) throw new RuntimeError("unprocessable", "Defina EMBEDDING_MODEL e a chave de IA no backend para gerar embeddings.");
      const { data: rows } = await db.from("knowledge_chunks").select("id, content, source_id")
        .eq("workspace_id", body.workspace_id).is("embedding", null).limit(512);
      const embedded = await embedAndStore(db, ai, rows ?? []);
      const sourceIds = [...new Set((rows ?? []).map((r: { source_id: string }) => r.source_id))];
      for (const id of sourceIds) {
        const { count } = await db.from("knowledge_chunks").select("id", { count: "exact", head: true }).eq("source_id", id).is("embedding", null);
        if (!count) await db.from("knowledge_sources").update({ embedded: true }).eq("id", id);
      }
      return json({ embedded, remaining: (rows?.length ?? 0) === 512 ? "talvez — rode novamente" : 0 });
    }
  }

  // Ações sobre fonte existente.
  if (typeof body.source_id !== "string") throw new RuntimeError("invalid_request", "source_id obrigatório.");
  const { data: source } = await db.from("knowledge_sources").select(SOURCE_COLUMNS).eq("id", body.source_id).maybeSingle();
  if (!source) throw new RuntimeError("not_found", "Fonte não encontrada.");
  await requireWorkspaceRole(user.id, source.workspace_id);

  if (body.action === "set_pinned") {
    // Fixa a fonte nas instruções do agente (sempre lida, sem depender da busca).
    const pinned = (body as { pinned?: unknown }).pinned === true;
    const { data: row } = await db.from("knowledge_sources").select("metadata, content").eq("id", source.id).single();
    if (pinned && (row?.content ?? "").length > 12_000) throw new RuntimeError("unprocessable", "Fonte grande demais para fixar (máx. 12 mil caracteres). Use um texto resumido.");
    const { data } = await db.from("knowledge_sources").update({ metadata: { ...(row?.metadata ?? {}), pinned } }).eq("id", source.id).select(SOURCE_COLUMNS).single();
    await audit(db, { workspace_id: source.workspace_id, actor_user_id: user.id, action: pinned ? "knowledge.source.pinned" : "knowledge.source.unpinned", entity: "knowledge_source", entity_id: source.id, correlation_id: correlationId });
    return json({ source: data });
  }
  if (body.action === "reindex") {
    assertActive(await loadEntitlements(db, source.workspace_id));
    if (source.kind === "faq" || source.kind === "product") throw new RuntimeError("conflict", "FAQ e produtos são reindexados ao editar.");
    await db.from("knowledge_sources").update({ status: "pending" }).eq("id", source.id);
    runInBackground(indexSource(db, source.id));
    return json({ source: { ...source, status: "pending" } });
  }
  if (body.action === "delete") {
    if (source.kind === "faq" || source.kind === "product") throw new RuntimeError("conflict", "Exclua a FAQ ou o produto correspondente.");
    if (source.storage_path) await db.storage.from("knowledge").remove([source.storage_path]);
    await db.from("knowledge_sources").delete().eq("id", source.id);
    await audit(db, { workspace_id: source.workspace_id, actor_user_id: user.id, action: "knowledge.source.deleted", entity: "knowledge_source", entity_id: source.id, correlation_id: correlationId });
    return json({ deleted: true });
  }
  throw new RuntimeError("invalid_request", "Ação desconhecida.");
}));
