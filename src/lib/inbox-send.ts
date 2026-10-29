// Envio pela inbox além do texto: anexo (upload no bucket privado), encaminhamento e conversa nova.
import { supabase } from "@/lib/supabase";
import type { Message } from "@/lib/database.types";

export const INBOX_MEDIA_BUCKET = "inbox-media";
/** Mesmo limite do bucket (20 MB). */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export type OutboundMediaType = "image" | "video" | "audio" | "document";

/** Imagem, vídeo e áudio vão no formato nativo do WhatsApp; o resto (PDF, planilha…) vai como documento. */
export function mediaTypeFor(mime: string | null | undefined): OutboundMediaType {
  const m = (mime ?? "").toLowerCase();
  if (m.startsWith("image/") && m !== "image/svg+xml") return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  return "document";
}

/** <workspace>/outbound/<id>.<ext>: a extensão vem do nome do arquivo quando é simples. */
export function outboundMediaPath(workspaceId: string, fileName: string, id: string = crypto.randomUUID()): string {
  const ext = fileName.toLowerCase().match(/\.([a-z0-9]{1,5})$/)?.[1] ?? "bin";
  return `${workspaceId}/outbound/${id}.${ext}`;
}

export function validateUpload(file: Pick<File, "size" | "name">): string | null {
  if (file.size <= 0) return "O arquivo está vazio.";
  if (file.size > MAX_UPLOAD_BYTES) return "Arquivo acima de 20 MB. Reduza o tamanho e tente de novo.";
  if (!file.name.trim()) return "Arquivo sem nome.";
  return null;
}

export interface UploadedAttachment {
  mediaPath: string;
  fileName: string;
  mimetype: string;
  type: OutboundMediaType;
}

export async function uploadAttachment(workspaceId: string, file: File): Promise<UploadedAttachment> {
  const problem = validateUpload(file);
  if (problem) throw new Error(problem);
  const mimetype = file.type || "application/octet-stream";
  const mediaPath = outboundMediaPath(workspaceId, file.name);
  const { error } = await supabase.storage.from(INBOX_MEDIA_BUCKET).upload(mediaPath, file, { contentType: mimetype, upsert: false });
  if (error) throw new Error(`Não foi possível enviar o arquivo: ${error.message}`);
  return { mediaPath, fileName: file.name, mimetype, type: mediaTypeFor(mimetype) };
}

const FORWARDABLE = new Set(["text", "image", "video", "document", "audio", "sticker", "location", "contact"]);

/** Mensagens que a inbox consegue reenviar: texto, arquivo guardado, figurinha (vira imagem), localização e contato (viram texto). */
export function canForward(m: Pick<Message, "type" | "content" | "media_url" | "metadata" | "sender">): boolean {
  if (m.sender === "system" || !FORWARDABLE.has(m.type)) return false;
  if (m.type === "text" || m.type === "location" || m.type === "contact") return Boolean(m.content?.trim());
  return typeof m.metadata?.media_path === "string" || Boolean(m.media_url);
}

/** Resumo curto da mensagem para o diálogo de encaminhar. */
export function forwardPreview(m: Pick<Message, "type" | "content" | "metadata">): string {
  const fileName = typeof m.metadata?.file_name === "string" ? m.metadata.file_name : null;
  const label: Record<string, string> = { image: "Imagem", video: "Vídeo", audio: "Áudio", document: fileName ?? "Documento", sticker: "Figurinha", location: "Localização", contact: "Contato" };
  const text = m.content?.trim();
  if (m.type === "text") return text ? (text.length > 120 ? `${text.slice(0, 117)}…` : text) : "";
  return text ? `${label[m.type] ?? m.type}: ${text.length > 90 ? `${text.slice(0, 87)}…` : text}` : label[m.type] ?? m.type;
}
