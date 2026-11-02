// Barra de gravação de voz da inbox: começa a gravar ao montar, mostra o tempo, e devolve o arquivo ao concluir.
// O arquivo entra como anexo da mensagem (o operador ouve antes de enviar); a Evolution o converte em nota de voz.
import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { Button, useToast } from "@/components/ui";
import {
  baseMime,
  formatDuration,
  MAX_RECORDING_SECONDS,
  MIN_RECORDING_MS,
  pickRecorderMime,
  recorderSupport,
  recordingFileName,
  SUPPORT_MESSAGE,
  voiceErrorMessage,
} from "@/lib/voice";

export function VoiceRecorder({ onRecorded, onCancel }: { onRecorded: (file: File) => void; onCancel: () => void }) {
  const toast = useToast();
  const [seconds, setSeconds] = useState(0);
  const [ready, setReady] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const discardRef = useRef(false);
  const finishedRef = useRef(false);
  const callbacks = useRef({ onRecorded, onCancel, toast });
  callbacks.current = { onRecorded, onCancel, toast };

  useEffect(() => {
    let cancelled = false;
    const support = recorderSupport({
      isSecureContext: typeof window !== "undefined" ? window.isSecureContext : undefined,
      hasMediaDevices: typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function",
      hasMediaRecorder: typeof MediaRecorder !== "undefined",
    });
    if (support !== "ok") {
      callbacks.current.toast.error(SUPPORT_MESSAGE[support]);
      callbacks.current.onCancel();
      return;
    }
    const mime = pickRecorderMime((m) => MediaRecorder.isTypeSupported(m));

    const stopTracks = () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        recorderRef.current = rec;
        chunksRef.current = [];
        rec.ondataavailable = (e: BlobEvent) => {
          if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
        };
        rec.onerror = () => {
          discardRef.current = true;
          callbacks.current.toast.error("A gravação foi interrompida pelo navegador.");
        };
        rec.onstop = () => {
          if (finishedRef.current) return;
          finishedRef.current = true;
          stopTracks();
          const type = baseMime(rec.mimeType || mime || "audio/webm");
          const blob = new Blob(chunksRef.current, { type });
          const elapsed = Date.now() - startedAtRef.current;
          if (discardRef.current) return callbacks.current.onCancel();
          if (blob.size === 0 || elapsed < MIN_RECORDING_MS) {
            callbacks.current.toast.error("Gravação muito curta. Segure um pouco mais e conclua.");
            return callbacks.current.onCancel();
          }
          callbacks.current.onRecorded(new File([blob], recordingFileName(type), { type }));
        };
        startedAtRef.current = Date.now();
        rec.start(1000);
        setReady(true);
      } catch (err) {
        if (cancelled) return;
        stopTracks();
        callbacks.current.toast.error(voiceErrorMessage(err));
        callbacks.current.onCancel();
      }
    })();

    const timer = setInterval(() => {
      if (!startedAtRef.current) return;
      const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
      setSeconds(elapsed);
      if (elapsed >= MAX_RECORDING_SECONDS) finish();
    }, 500);

    return () => {
      cancelled = true;
      clearInterval(timer);
      // Desmontou no meio (trocou de conversa): descarta sem devolver arquivo.
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        discardRef.current = true;
        finishedRef.current = true;
        try {
          recorderRef.current.stop();
        } catch {
          // já parado
        }
      }
      stopTracks();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function finish() {
    const rec = recorderRef.current;
    if (!rec || rec.state === "inactive") return;
    rec.stop();
  }

  function cancel() {
    discardRef.current = true;
    const rec = recorderRef.current;
    if (!rec || rec.state === "inactive") {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      return onCancel();
    }
    rec.stop();
  }

  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 dark:border-red-900/60 dark:bg-red-950/30">
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
      </span>
      <span className="text-sm font-medium text-red-700 dark:text-red-300">{ready ? "Gravando" : "Preparando o microfone…"}</span>
      <span className="font-mono text-sm tabular-nums text-red-700 dark:text-red-300" data-testid="recording-time">{formatDuration(seconds)}</span>
      <span className="hidden text-xs text-red-600/80 dark:text-red-300/70 sm:inline">· máx. {formatDuration(MAX_RECORDING_SECONDS)}</span>
      <span className="flex-1" />
      <Button type="button" size="sm" variant="ghost" onClick={cancel} aria-label="Cancelar gravação" title="Cancelar gravação">
        <X className="h-4 w-4" /> <span className="hidden sm:inline">Cancelar</span>
      </Button>
      <Button type="button" size="sm" onClick={finish} disabled={!ready} aria-label="Concluir gravação" title="Concluir e revisar antes de enviar">
        <Check className="h-4 w-4" /> Concluir
      </Button>
    </div>
  );
}
