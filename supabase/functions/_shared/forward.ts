// Envio pela inbox além do texto: anexo enviado pelo painel, encaminhamento de uma mensagem e conversa nova.
// Funções puras; a function send-message faz a parte com banco e WhatsApp.
import { RuntimeError } from "./http.ts";
import type { OutboundType } from "./channel.ts";

export const INBOX_MEDIA_BUCKET = "inbox-media";
/** Pasta do bucket onde o painel grava anexos: <workspace>/outbound/<arquivo>. */
export const OUTBOUND_FOLDER = "outbound";
/** Validade da URL assinada entregue ao provedor para baixar o arquivo. */
export const SIGNED_URL_SECONDS = 900;

export interface SourceMessage {
  id: string;
  workspace_id: string;
  type: string;
  content: string | null;
  media_url: string | null;
  media_mime: string | null;
  metadata: Record<string, unknown> | null;
}

export interface ForwardPlan {
  type: OutboundType;
  text: string | null;
  /** Caminho no bucket inbox-media (arquivo guardado) ou null quando só há URL pública. */
  mediaPath: string | null;
  mediaUrl: string | null;
  mimetype: string | null;
  fileName: string | null;
}

const MEDIA_TYPES = new Set(["image", "video", "document", "audio"]);

/** Tipo de envio a partir do MIME do anexo: imagem, vídeo e áudio nativos; o resto vai como documento. */
export function outboundTypeFor(mime: string | null | undefined, requested?: string | null): OutboundType {
  if (requested && MEDIA_TYPES.has(requested)) return requested as OutboundType;
  const m = (mime ?? "").toLowerCase();
  if (m.startsWith("image/") && m !== "image/svg+xml") return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  return "document";
}

/** O painel só pode apontar para arquivos da própria pasta de saída do workspace. */
export function assertOutboundPath(path: unknown, workspaceId: string): string {
  if (typeof path !== "string" || path.includes("..") || !path.startsWith(`${workspaceId}/${OUTBOUND_FOLDER}/`) || path.length > 300) {
    throw new RuntimeError("invalid_request", "Arquivo inválido para envio.");
  }
  return path;
}

/** A URL assinada vem com o host interno do gateway; o provedor de WhatsApp precisa do endereço público. */
export function publicSignedUrl(signedUrl: string, internalBase: string, publicBase: string | undefined): string {
  if (!publicBase) return signedUrl;
  const internal = internalBase.replace(/\/$/, "");
  const pub = publicBase.replace(/\/$/, "");
  if (signedUrl.startsWith(internal)) return pub + signedUrl.slice(internal.length);
  if (signedUrl.startsWith("/")) return pub + signedUrl;
  return signedUrl;
}

/** O que encaminhar de uma mensagem: texto vira texto; arquivo guardado vai por URL assinada; localização e contato viram texto. */
export function planForward(source: SourceMessage): ForwardPlan {
  const meta = source.metadata ?? {};
  const mediaPath = typeof meta.media_path === "string" && meta.media_path ? meta.media_path : null;
  const fileName = typeof meta.file_name === "string" && meta.file_name ? meta.file_name : null;
  const text = source.content?.trim() || null;
  const type = source.type === "sticker" ? "image" : source.type;

  if (MEDIA_TYPES.has(type)) {
    if (!mediaPath && !source.media_url) throw new RuntimeError("unprocessable", "Este arquivo não ficou guardado, então não dá para encaminhar. Baixe pelo celular e envie por lá.");
    return { type: type as OutboundType, text, mediaPath, mediaUrl: mediaPath ? null : source.media_url, mimetype: source.media_mime, fileName };
  }
  if (type === "text" || type === "location" || type === "contact") {
    if (!text) throw new RuntimeError("unprocessable", "Esta mensagem não tem conteúdo para encaminhar.");
    return { type: "text", text, mediaPath: null, mediaUrl: null, mimetype: null, fileName: null };
  }
  throw new RuntimeError("unprocessable", "Este tipo de mensagem não pode ser encaminhado.");
}
