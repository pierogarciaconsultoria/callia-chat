// Indexação de fontes da base de conhecimento (compartilhada por knowledge-index e agent-setup).
// Tipos: texto, URL, documento (PDF/DOCX/TXT/MD), site inteiro e rede social → chunks (+ embeddings se o plano incluir IA).
import { extractText as extractPdfText, getDocumentProxy } from "npm:unpdf@0.12.1";
import { strFromU8, unzipSync } from "npm:fflate@0.8.2";
import { RuntimeError, runInBackground } from "./http.ts";
import { type AiProvider, toPgVector } from "./ai.ts";
import { aiFromEnv } from "./agent-runtime.ts";
import { chunkText, extractHtmlTitle, htmlToText } from "./knowledge.ts";
import { assertPublicHttpUrl } from "./net.ts";
import { crawlSite } from "./site-crawler.ts";
import type { Db } from "./supabase.ts";
import { assertActive, assertCanAdd, hasFeature, loadEntitlements } from "./entitlements.ts";

export const SOURCE_COLUMNS =
  "id, workspace_id, kind, title, origin_id, url, storage_path, mime_type, metadata, status, error, chunk_count, embedded, indexed_at, created_at, updated_at";
export const MAX_TEXT = 400_000;
const EMBED_BATCH = 64;

const DOC_TYPES: Record<string, "pdf" | "docx" | "text"> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "text",
  "text/markdown": "text",
  "text/x-markdown": "text",
};

export function docKind(mime: string | null | undefined, path: string | null | undefined): "pdf" | "docx" | "text" | null {
  const byMime = mime ? DOC_TYPES[mime.split(";")[0].trim()] : undefined;
  if (byMime) return byMime;
  const ext = path?.split(".").pop()?.toLowerCase();
  return ext === "pdf" ? "pdf" : ext === "docx" ? "docx" : ext === "txt" || ext === "md" ? "text" : null;
}

function docxToText(bytes: Uint8Array): string {
  const files = unzipSync(bytes, { filter: (f) => f.name === "word/document.xml" });
  const xml = files["word/document.xml"];
  if (!xml) throw new RuntimeError("unprocessable", "DOCX sem word/document.xml.");
  return strFromU8(xml)
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface Extracted {
  text: string;
  title?: string | null;
  /** Site: um bloco por página, para os trechos não misturarem páginas. */
  pages?: Array<{ url: string; title: string | null; text: string }>;
  metadata?: Record<string, unknown>;
}

// deno-lint-ignore no-explicit-any
async function extractSourceText(db: Db, source: Record<string, any>): Promise<Extracted> {
  if (source.kind === "text" || source.kind === "social") return { text: source.content ?? "" };
  if (source.kind === "site") {
    const maxPages = Number(source.metadata?.max_pages ?? 20);
    const { pages, skipped } = await crawlSite(source.url, { maxPages });
    if (!pages.length) {
      throw new RuntimeError("unprocessable", `Nenhuma página com texto foi lida (bloqueadas pelo robots.txt: ${skipped.robots}, erros: ${skipped.errors}).`);
    }
    return {
      text: pages.map((p) => `## ${p.title ?? p.url}\n${p.url}\n\n${p.text}`).join("\n\n"),
      title: pages[0].title,
      pages,
      metadata: { ...(source.metadata ?? {}), pages: pages.map((p) => ({ url: p.url, title: p.title })), skipped },
    };
  }
  if (source.kind === "url") {
    const res = await fetch(assertPublicHttpUrl(source.url), {
      headers: { "User-Agent": "CalliaChat-KnowledgeBot/1.0", Accept: "text/html,text/plain;q=0.9" },
      signal: AbortSignal.timeout(15_000),
      redirect: "follow",
    }).catch(() => null);
    if (!res?.ok) throw new RuntimeError("unprocessable", `Não foi possível baixar a URL (${res?.status ?? "sem resposta"}).`);
    if (res.url && res.url !== source.url) assertPublicHttpUrl(res.url);
    const raw = (await res.text()).slice(0, 3_000_000);
    const isHtml = (res.headers.get("content-type") ?? "").includes("html") || /<html[\s>]/i.test(raw);
    return isHtml ? { text: htmlToText(raw), title: extractHtmlTitle(raw) } : { text: raw };
  }
  if (source.kind === "document") {
    const kind = docKind(source.mime_type, source.storage_path);
    if (!kind) throw new RuntimeError("unprocessable", "Tipo de arquivo não suportado (use PDF, DOCX, TXT ou MD).");
    const { data: file, error } = await db.storage.from("knowledge").download(source.storage_path!);
    if (error || !file) throw new RuntimeError("unprocessable", "Arquivo não encontrado no storage.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (kind === "text") return { text: new TextDecoder().decode(bytes) };
    if (kind === "docx") return { text: docxToText(bytes) };
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractPdfText(pdf, { mergePages: true });
    return { text: Array.isArray(text) ? text.join("\n\n") : text };
  }
  throw new RuntimeError("unprocessable", "FAQ e produtos são indexados automaticamente.");
}

/** IA (embeddings) só quando o plano do workspace inclui IA. */
export async function aiForWorkspace(db: Db, workspaceId: string): Promise<AiProvider | null> {
  return hasFeature(await loadEntitlements(db, workspaceId), "ai_enabled") ? aiFromEnv() : null;
}

export async function assertCanAddSource(db: Db, workspaceId: string): Promise<void> {
  const entitlements = await loadEntitlements(db, workspaceId);
  assertActive(entitlements);
  assertCanAdd(entitlements, "knowledge_sources");
}

export async function embedAndStore(db: Db, ai: AiProvider, rows: Array<{ id: string; content: string }>): Promise<number> {
  let done = 0;
  for (let i = 0; i < rows.length; i += EMBED_BATCH) {
    const batch = rows.slice(i, i + EMBED_BATCH);
    const vectors = await ai.embed(batch.map((r) => r.content));
    await Promise.all(batch.map((r, j) => db.from("knowledge_chunks").update({ embedding: toPgVector(vectors[j]) }).eq("id", r.id)));
    done += batch.length;
  }
  return done;
}

export async function indexSource(db: Db, sourceId: string): Promise<void> {
  const { data: source } = await db.from("knowledge_sources").select("*").eq("id", sourceId).single();
  await db.from("knowledge_sources").update({ status: "indexing", error: null }).eq("id", sourceId);
  try {
    const { text, title, pages, metadata } = await extractSourceText(db, source);
    const clean = text.slice(0, MAX_TEXT).trim();
    if (clean.length < 20) throw new RuntimeError("unprocessable", "Pouco ou nenhum texto extraído (PDF escaneado sem OCR?).");
    // Site: trechos por página, cada um com título e URL da página de origem.
    const rows: Array<{ content: string; metadata: Record<string, unknown> }> = pages
      ? pages.flatMap((p) =>
        chunkText(p.text, { size: 1100, overlap: 150 }).map((c) => ({
          content: `Página: ${p.title ?? p.url} (${p.url})\n${c}`,
          metadata: { url: p.url, title: p.title },
        }))
      )
      : chunkText(clean, { size: 1200, overlap: 200 }).map((c) => ({ content: c, metadata: {} }));
    const chunks = rows.map((r) => r.content);

    await db.from("knowledge_chunks").delete().eq("source_id", sourceId);
    const { data: inserted, error } = await db.from("knowledge_chunks").insert(
      rows.map((r, i) => ({ workspace_id: source.workspace_id, source_id: sourceId, chunk_index: i, content: r.content, metadata: r.metadata })),
    ).select("id, content");
    if (error) throw new RuntimeError("internal_error", `Falha ao gravar trechos: ${error.message}`);

    const ai = await aiForWorkspace(db, source.workspace_id);
    let embedded = false;
    if (ai?.embeddingsEnabled) {
      try {
        await embedAndStore(db, ai, inserted ?? []);
        embedded = true;
      } catch (err) {
        console.warn(JSON.stringify({ level: "warn", msg: "embedding_failed", source_id: sourceId, error: String(err) }));
      }
    }
    await db.from("knowledge_sources").update({
      status: "indexed",
      chunk_count: chunks.length,
      embedded,
      indexed_at: new Date().toISOString(),
      content: source.kind === "text" || source.kind === "social" ? source.content : clean,
      ...(metadata ? { metadata } : {}),
      ...((source.kind === "url" || source.kind === "site") && title && source.title === source.url ? { title } : {}),
    }).eq("id", sourceId);
  } catch (err) {
    await db.from("knowledge_sources").update({
      status: "failed",
      error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
    }).eq("id", sourceId);
  }
}

export async function createSource(db: Db, row: Record<string, unknown>) {
  const { data, error } = await db.from("knowledge_sources").insert({ ...row, status: "pending" }).select(SOURCE_COLUMNS).single();
  if (error) throw new RuntimeError("internal_error", "Falha ao criar fonte.", { db: error.message });
  runInBackground(indexSource(db, data.id));
  return data;
}
