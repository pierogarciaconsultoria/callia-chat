// Arquivos que o cliente manda no WhatsApp (fotos, PDFs, áudios, vídeos): cópia no bucket privado "inbox-media"
// para a equipe abrir na inbox (comprovantes, documentos) e leitura dos bytes para a IA.
import { bytesFromBase64 } from "./ai.ts";
import { evolutionFor, type InstanceRow } from "./channel.ts";
import { RuntimeError } from "./http.ts";
import type { Db } from "./supabase.ts";

export const INBOX_MEDIA_BUCKET = "inbox-media";
export const MAX_INBOX_MEDIA_BYTES = 20 * 1024 * 1024;
const ARCHIVED_TYPES = new Set(["image", "document", "audio", "video"]);

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "video/mp4": "mp4",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
};

export interface InboundMediaMessage {
  id: string;
  workspace_id: string;
  conversation_id: string;
  type: string;
  media_mime: string | null;
  metadata: Record<string, unknown> | null;
}

type MediaInstance = Pick<InstanceRow, "instance_name" | "provider_secret_ref">;

export function cleanMime(mime: string | null | undefined): string {
  return (mime ?? "").split(";")[0].trim().toLowerCase().replace("image/jpg", "image/jpeg") || "application/octet-stream";
}

/** <workspace>/<conversa>/<mensagem>.<ext>: a extensão vem do nome do arquivo (se for simples) ou do tipo. */
export function inboxMediaPath(msg: Pick<InboundMediaMessage, "id" | "workspace_id" | "conversation_id">, mime: string, fileName?: string | null): string {
  const fromName = fileName?.toLowerCase().match(/\.([a-z0-9]{1,5})$/)?.[1];
  const ext = fromName ?? EXT_BY_MIME[cleanMime(mime)] ?? "bin";
  return `${msg.workspace_id}/${msg.conversation_id}/${msg.id}.${ext}`;
}

/** PDF ou imagem com cara de comprovante: palavra de pagamento + valor em reais. */
export function looksLikePaymentProof(text: string | null | undefined): boolean {
  if (!text) return false;
  const proof = /comprovante|\bpix\b|transfer[eê]ncia|dep[oó]sito|\bted\b|pagamento (efetuado|realizado|confirmado|aprovado)|autentica[cç][aã]o|id da transa[cç][aã]o/i;
  const money = /R\$\s?\d|\b\d{1,3}(\.\d{3})*,\d{2}\b|\b\d+\s*reais\b/i;
  return proof.test(text) && money.test(text);
}

/** Bytes da mídia: a cópia guardada no Callia ou, se ainda não houver, direto da Evolution. */
export async function loadMediaBytes(db: Db, instance: MediaInstance | null, msg: Pick<InboundMediaMessage, "media_mime" | "metadata">): Promise<{ bytes: Uint8Array; mime: string }> {
  const meta = msg.metadata ?? {};
  if (typeof meta.media_path === "string") {
    const { data } = await db.storage.from(INBOX_MEDIA_BUCKET).download(meta.media_path);
    if (data) return { bytes: new Uint8Array(await data.arrayBuffer()), mime: cleanMime(msg.media_mime) };
  }
  if (!instance || !meta.wa_key) throw new RuntimeError("unprocessable", "Mídia indisponível.");
  const media = await evolutionFor(instance).getMediaBase64(instance.instance_name, meta.wa_key as Record<string, unknown>);
  return { bytes: bytesFromBase64(media.base64), mime: cleanMime(media.mimetype ?? msg.media_mime) };
}

export async function mergeMessageMetadata(db: Db, messageId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await db.rpc("merge_message_metadata", { p_message_id: messageId, p_patch: patch });
  if (error) throw new RuntimeError("internal_error", "Falha ao atualizar a mensagem.", { db: error.message });
}

/** Guarda o arquivo recebido (uma vez por mensagem) e registra o caminho em messages.metadata.media_path. */
export async function archiveInboundMedia(db: Db, instance: MediaInstance, msg: InboundMediaMessage): Promise<string | null> {
  if (!ARCHIVED_TYPES.has(msg.type) || typeof msg.metadata?.media_path === "string") return null;
  const { bytes, mime } = await loadMediaBytes(db, instance, msg);
  if (bytes.length > MAX_INBOX_MEDIA_BYTES) {
    await mergeMessageMetadata(db, msg.id, { media_error: "too_large", media_size: bytes.length });
    return null;
  }
  const path = inboxMediaPath(msg, mime, msg.metadata?.file_name as string | undefined);
  const { error } = await db.storage.from(INBOX_MEDIA_BUCKET).upload(path, bytes, { contentType: mime, upsert: true });
  if (error) throw new RuntimeError("internal_error", "Falha ao guardar o arquivo recebido.", { storage: error.message });
  await mergeMessageMetadata(db, msg.id, { media_path: path, media_size: bytes.length });
  return path;
}

/** Texto já extraído da mídia (transcrição, descrição, texto do PDF), como o agente lê no histórico. */
export function mediaNote(msg: { type: string; content: string | null; metadata: Record<string, unknown> | null }): string | null {
  const meta = msg.metadata ?? {};
  const file = typeof meta.file_name === "string" ? meta.file_name : "arquivo";
  if (msg.type === "audio" && typeof meta.transcript === "string") return meta.transcript;
  if (msg.type === "image" && typeof meta.image_description === "string") {
    return [msg.content, `[imagem: ${meta.image_description}]`].filter(Boolean).join("\n");
  }
  if (msg.type === "document") {
    const read = typeof meta.image_description === "string" ? meta.image_description : typeof meta.document_text === "string" ? meta.document_text : null;
    const body = read === null ? "" : read.trim() ? `: ${read}` : " (sem texto legível)";
    return [msg.content, `[documento "${file}"${body}]`].filter(Boolean).join("\n");
  }
  return null;
}
