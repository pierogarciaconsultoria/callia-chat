// Arquivo que o cliente mandou (foto, PDF, áudio, vídeo), guardado no bucket privado "inbox-media": abre por URL assinada.
import { useQuery } from "@tanstack/react-query";
import { Download, FileText, ReceiptText } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/cn";
import type { Message } from "@/lib/database.types";

const SIGNED_SECONDS = 3600;

function formatSize(bytes: unknown): string | null {
  if (typeof bytes !== "number" || bytes <= 0) return null;
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

export function receivedMediaPath(m: Pick<Message, "metadata">): string | null {
  const path = m.metadata?.media_path;
  return typeof path === "string" && path ? path : null;
}

function useSignedUrl(path: string | null) {
  return useQuery({
    queryKey: ["inbox-media", path],
    enabled: Boolean(path),
    staleTime: (SIGNED_SECONDS - 300) * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from("inbox-media").createSignedUrl(path!, SIGNED_SECONDS);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}

export function PaymentProofBadge({ className }: { className?: string }) {
  return (
    <span className={cn("mb-1 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200", className)}>
      <ReceiptText className="h-3 w-3" /> Comprovante de pagamento: confira
    </span>
  );
}

/** Pré-visualização do arquivo recebido; null se ele não foi guardado (mensagens antigas). */
export function ReceivedMedia({ message: m }: { message: Message }) {
  const path = receivedMediaPath(m);
  const url = useSignedUrl(path);
  if (!path) return null;
  const mime = m.media_mime ?? "";
  const fileName = typeof m.metadata?.file_name === "string" ? m.metadata.file_name : null;
  const isPicture = m.type === "image" || (m.type === "document" && mime.startsWith("image/"));

  if (url.isError) return <p className="mb-1 text-xs opacity-80">Não foi possível abrir o arquivo.</p>;
  if (!url.data) return <div className="mb-1 h-10 w-48 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-700" aria-label="Carregando arquivo" />;

  if (isPicture) {
    return (
      <a href={url.data} target="_blank" rel="noreferrer" className="-mx-1 -mt-0.5 mb-1 block overflow-hidden rounded-xl">
        <img src={url.data} alt={m.content ?? fileName ?? "Imagem enviada pelo cliente"} loading="lazy" className="max-h-64 w-full max-w-xs object-cover" />
      </a>
    );
  }
  if (m.type === "audio") return <audio controls src={url.data} className="mb-1 h-10 w-64 max-w-full" />;
  if (m.type === "video") return <video controls src={url.data} className="mb-1 max-h-64 w-full max-w-xs rounded-xl" />;
  return (
    <a
      href={url.data}
      target="_blank"
      rel="noreferrer"
      className="mb-1 flex max-w-xs items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-950"
    >
      <FileText className="h-5 w-5 shrink-0 text-red-500" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{fileName ?? "Documento"}</span>
        <span className="block text-xs text-slate-500 dark:text-slate-400">{[mime === "application/pdf" ? "PDF" : null, formatSize(m.metadata?.media_size)].filter(Boolean).join(" · ") || "Abrir"}</span>
      </span>
      <Download className="h-4 w-4 shrink-0 text-slate-400" />
    </a>
  );
}
