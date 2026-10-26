// Envio de documentos para a base de conhecimento: storage privado + create_document na knowledge-index.
import { supabase } from "./supabase";
import { invokeFunction } from "./functions";
import { safeFileName } from "./format";
import type { KnowledgeSource } from "./database.types";

export const KNOWLEDGE_ACCEPT =
  ".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown";
export const KNOWLEDGE_MAX_BYTES = 20 * 1024 * 1024;

/** Sobe o arquivo em <workspace_id>/<uuid>-<nome> e cria a fonte (indexação em segundo plano). */
export async function uploadKnowledgeDocument(workspaceId: string, file: File): Promise<KnowledgeSource | undefined> {
  if (file.size > KNOWLEDGE_MAX_BYTES) throw new Error("Arquivo maior que 20 MB.");
  const path = `${workspaceId}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
  const mime = file.type || (file.name.endsWith(".md") ? "text/markdown" : "application/octet-stream");
  const { error } = await supabase.storage.from("knowledge").upload(path, file, { contentType: mime, upsert: false });
  if (error) throw new Error(error.message);
  const res = await invokeFunction<{ source?: KnowledgeSource }>("knowledge-index", {
    action: "create_document",
    workspace_id: workspaceId,
    title: file.name.replace(/\.[^.]+$/, ""),
    storage_path: path,
    mime_type: mime,
  });
  return res.source;
}
