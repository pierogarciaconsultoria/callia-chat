// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders, jsonResponse, requireAdminContext } from "../_shared/auth.ts";
import { embedTexts } from "../_shared/agent.ts";
import { chunkText, stripHtml } from "../_shared/knowledge.ts";
import { createAuditLog } from "../_shared/webhooks.ts";

async function extractPdf(buffer: ArrayBuffer) {
  const { extractText, getDocumentProxy } = await import("npm:unpdf@^1");
  const document = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(document, { mergePages: true });
  return (text ?? []).join("\n\n").trim();
}

async function extractDocx(buffer: ArrayBuffer) {
  const mammoth = await import("npm:mammoth@^1");
  const { value } = await mammoth.extractRawText({ arrayBuffer: buffer });
  return (value ?? "").trim();
}

async function readSourceText(supabase, source) {
  if (source.type === "url") {
    const response = await fetch(source.source_url, {
      headers: { "user-agent": "CalliaBot/1.0 (+knowledge-index)" },
      redirect: "follow",
    });
    if (!response.ok) throw new Error(`url_fetch_failed_${response.status}`);
    const body = await response.text();
    const text = body.slice(0, 2_000_000);
    return source.source_url.endsWith(".txt") || source.source_url.endsWith(".md")
      ? text.trim()
      : stripHtml(text);
  }

  if (source.type === "file") {
    const { data, error } = await supabase.storage
      .from("knowledge-files")
      .download(source.file_path);
    if (error || !data) throw new Error("file_not_found");

    const buffer = await data.arrayBuffer();
    const path = source.file_path.toLowerCase();

    if (path.endsWith(".pdf")) return extractPdf(buffer);
    if (path.endsWith(".docx")) return extractDocx(buffer);
    if (path.endsWith(".txt") || path.endsWith(".md") || path.endsWith(".csv")) {
      return new TextDecoder().decode(buffer).trim();
    }
    throw new Error("unsupported_file_type");
  }

  return (source.content ?? "").trim();
}

async function indexSource(supabase, workspaceId, source) {
  await supabase
    .from("knowledge_sources")
    .update({ index_status: "indexing", index_error: null })
    .eq("id", source.id);

  try {
    const extracted = await readSourceText(supabase, source);
    const chunks = chunkText(extracted);

    if (chunks.length === 0) throw new Error("nothing_to_index");

    await supabase.from("knowledge_chunks").delete().eq("source_id", source.id);

    const vectors = await embedTexts(chunks.map((chunk) => chunk.content));

    const rows = chunks.map((chunk, index) => ({
      workspace_id: workspaceId,
      source_id: source.id,
      content: chunk.content,
      position: chunk.position,
      embedding: vectors[index] ?? null,
    }));

    const { error: insertError } = await supabase.from("knowledge_chunks").insert(rows);
    if (insertError) throw new Error(insertError.message);

    // Keep the searchable body in sync with what was actually indexed, so a
    // PDF or a web page shows the extracted text in the panel.
    await supabase
      .from("knowledge_sources")
      .update({
        content: extracted.slice(0, 200_000),
        index_status: "indexed",
        index_error: null,
        indexed_at: new Date().toISOString(),
        chunk_count: rows.length,
      })
      .eq("id", source.id);

    return { sourceId: source.id, title: source.title, chunks: rows.length, embedded: vectors.some(Boolean) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "index_failed";
    await supabase
      .from("knowledge_sources")
      .update({ index_status: "error", index_error: message, chunk_count: 0 })
      .eq("id", source.id);

    return { sourceId: source.id, title: source.title, error: message };
  }
}

serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const correlationId = crypto.randomUUID();

  try {
    const { userId, workspaceId, supabase, body } = await requireAdminContext(request);

    // The settings panel has no x-api-key to call public-api with, so it runs
    // the retrieval through here: same embedding call and same SQL function,
    // which keeps the preview identical to what the key-based endpoint returns.
    if (body.action === "search") {
      const query = typeof body.query === "string" ? body.query.trim() : "";
      if (!query) throw new Error("invalid_search_query");

      const limit = Math.min(Math.max(Number(body.limit ?? 5) || 5, 1), 20);
      const [queryEmbedding] = await embedTexts([query]);

      const { data, error } = await supabase.rpc("knowledge_search", {
        _workspace_id: workspaceId,
        _query: query,
        _query_embedding: queryEmbedding ?? null,
        _limit: limit,
      });

      if (error) throw new Error(error.message);

      return jsonResponse(
        {
          ok: true,
          correlationId,
          results: (data ?? []).map((row) => ({
            title: row.title,
            content: row.content,
            category: row.category,
            score: row.score,
          })),
        },
        { status: 200 },
      );
    }

    const sourceIds = Array.isArray(body.sourceIds) ? (body.sourceIds as string[]) : [];

    let query = supabase
      .from("knowledge_sources")
      .select("*")
      .eq("workspace_id", workspaceId);

    query = sourceIds.length
      ? query.in("id", sourceIds)
      : query.eq("index_status", "pending");

    const { data: sources, error } = await query;
    if (error) throw new Error(error.message);

    const results = [];
    for (const source of sources ?? []) {
      results.push(await indexSource(supabase, workspaceId, source));
    }

    await createAuditLog(supabase, {
      workspaceId,
      actorType: "user",
      actorId: userId,
      action: "knowledge.index",
      target: sourceIds.length ? sourceIds.join(",") : "pending",
      metadata: {
        correlationId,
        attempted: results.length,
        failed: results.filter((item) => item.error).length,
      },
    });

    return jsonResponse(
      {
        ok: true,
        correlationId,
        indexed: results.filter((item) => !item.error),
        failed: results.filter((item) => item.error),
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unexpected_error";
    const status =
      message === "unauthorized"
        ? 401
        : message === "forbidden"
          ? 403
          : message === "workspace_required" || message === "invalid_search_query"
            ? 400
            : 500;

    return jsonResponse({ error: message, correlationId }, { status });
  }
});
