// Gravação de voz pela inbox: formato que o navegador consegue gravar, nome do arquivo, duração e mensagens de erro.
// A Evolution converte qualquer entrada (webm/opus do Chrome, mp4/aac do Safari) para ogg/opus, o formato de nota de voz.

/** Limite de uma gravação; acima disso o gravador para sozinho. */
export const MAX_RECORDING_SECONDS = 5 * 60;
/** Abaixo disso a gravação é descartada (clique acidental). */
export const MIN_RECORDING_MS = 500;

const CANDIDATES = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm", "audio/mp4", "audio/aac"];

/** Primeiro formato suportado pelo MediaRecorder, na ordem de preferência; null quando nenhum serve. */
export function pickRecorderMime(isSupported: (mime: string) => boolean): string | null {
  for (const mime of CANDIDATES) {
    try {
      if (isSupported(mime)) return mime;
    } catch {
      // Navegadores antigos lançam em isTypeSupported.
    }
  }
  return null;
}

/** Tipo sem parâmetros (audio/webm;codecs=opus → audio/webm): é o que vai no arquivo e no Content-Type do bucket. */
export function baseMime(mime: string): string {
  return mime.split(";")[0].trim().toLowerCase() || "application/octet-stream";
}

export function audioExtensionFor(mime: string): string {
  const base = baseMime(mime);
  if (base === "audio/webm") return "webm";
  if (base === "audio/ogg") return "ogg";
  if (base === "audio/mp4" || base === "audio/aac" || base === "audio/x-m4a") return "m4a";
  if (base === "audio/mpeg") return "mp3";
  if (base === "audio/wav" || base === "audio/x-wav") return "wav";
  return "bin";
}

/** voz-20261102-143015.webm */
export function recordingFileName(mime: string, at: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`;
  return `voz-${stamp}.${audioExtensionFor(mime)}`;
}

/** 0:07, 1:30 */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export type RecorderSupport = "ok" | "insecure" | "unsupported";

/** getUserMedia só existe em HTTPS (ou localhost); MediaRecorder falta em navegadores antigos. */
export function recorderSupport(env: { isSecureContext?: boolean; hasMediaDevices: boolean; hasMediaRecorder: boolean }): RecorderSupport {
  if (env.isSecureContext === false) return "insecure";
  if (!env.hasMediaDevices || !env.hasMediaRecorder) return "unsupported";
  return "ok";
}

export const SUPPORT_MESSAGE: Record<Exclude<RecorderSupport, "ok">, string> = {
  insecure: "A gravação de voz só funciona com o painel aberto em HTTPS.",
  unsupported: "Este navegador não grava áudio. Use Chrome, Edge, Firefox ou Safari atualizados, ou anexe um arquivo de áudio pelo clipe.",
};

/** Texto para o operador a partir do erro de getUserMedia/MediaRecorder. */
export function voiceErrorMessage(err: unknown): string {
  const name = (err as { name?: string } | null)?.name ?? "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    return "Permita o uso do microfone no navegador (ícone de cadeado ao lado do endereço) e tente de novo.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") return "Nenhum microfone encontrado neste dispositivo.";
  if (name === "NotReadableError" || name === "TrackStartError") return "O microfone está em uso por outro aplicativo.";
  const message = (err as { message?: string } | null)?.message;
  return message ? `Não foi possível gravar: ${message}` : "Não foi possível gravar o áudio.";
}
