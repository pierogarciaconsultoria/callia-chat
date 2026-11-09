// Bolha de uma mensagem na inbox: conteúdo, mídia, rodapé com remetente/hora e as ações (encaminhar, apagar para
// todos, ocultar). Mensagem apagada para todos fica riscada; oculta vira uma linha discreta (só admin revela/restaura).
import { useState } from "react";
import { CheckCheck, EyeOff, FileText, Forward, Image as ImageIcon, MapPin, Mic, Trash2, Video } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatRelativeShort } from "@/lib/format";
import { PaymentProofBadge, ReceivedMedia, receivedMediaPath } from "@/components/inbox/ReceivedMedia";
import type { Message } from "@/lib/database.types";

const MEDIA_ICON = { image: ImageIcon, audio: Mic, video: Video, document: FileText, location: MapPin } as const;
const MEDIA_LABEL: Record<string, string> = {
  image: "Imagem",
  audio: "Áudio",
  video: "Vídeo",
  document: "Documento",
  sticker: "Figurinha",
  location: "Localização",
  contact: "Contato",
  reaction: "Reação",
  unknown: "Mensagem não suportada",
};
export const SENDER_LABEL = { customer: "Cliente", bot: "Bot", agent: "Atendente", system: "Sistema" } as const;

export interface MessageBubbleProps {
  message: Message;
  /** Admin vê o conteúdo de mensagens ocultas (ao pedir) e pode restaurá-las. */
  isAdmin?: boolean;
  onForward?: () => void;
  /** "Apagar para todos" no WhatsApp do cliente (só mensagens nossas, dentro da janela). */
  onDelete?: () => void;
  onHide?: () => void;
  onUnhide?: () => void;
}

const ACTION = "ml-1 inline-flex items-center gap-0.5 rounded px-1 hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-800";

export function MessageBubble({ message: m, isAdmin = false, onForward, onDelete, onHide, onUnhide }: MessageBubbleProps) {
  const [revealed, setRevealed] = useState(false);
  const outbound = m.direction === "outbound";
  if (m.sender === "system") {
    return (
      <div className="my-1 self-center rounded-full bg-slate-200 px-3 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        {m.content}
      </div>
    );
  }
  if (m.hidden_at && !(isAdmin && revealed)) {
    return (
      <div role="note" className={cn("flex max-w-[85%] items-center gap-2 px-1 text-[11px] text-slate-400 sm:max-w-[70%]", outbound ? "self-end" : "self-start")}>
        <EyeOff className="h-3 w-3 shrink-0" />
        <span>{SENDER_LABEL[m.sender]} · {formatRelativeShort(m.created_at)} · mensagem oculta por um administrador</span>
        {isAdmin && (
          <>
            <button type="button" onClick={() => setRevealed(true)} className={ACTION}>mostrar</button>
            {onUnhide && <button type="button" onClick={onUnhide} className={ACTION} aria-label="Restaurar mensagem">restaurar</button>}
          </>
        )}
      </div>
    );
  }
  const deleted = Boolean(m.deleted_at);
  const transcript = typeof m.metadata?.transcript === "string" ? (m.metadata.transcript as string) : null;
  const description = typeof m.metadata?.image_description === "string" ? (m.metadata.image_description as string) : null;
  const Icon = MEDIA_ICON[m.type as keyof typeof MEDIA_ICON];
  const isMedia = m.type !== "text";
  const stored = receivedMediaPath(m) !== null;
  const proof = m.metadata?.payment_proof === true;
  const documentText = typeof m.metadata?.document_text === "string" ? (m.metadata.document_text as string) : null;

  return (
    <div className={cn("flex max-w-[85%] flex-col sm:max-w-[70%]", outbound ? "items-end self-end" : "items-start self-start")}>
      <div
        className={cn(
          "min-w-0 max-w-full rounded-2xl px-3 py-2 text-sm shadow-sm",
          outbound
            ? m.sender === "bot"
              ? "rounded-br-sm bg-brand/10 text-slate-900 dark:bg-brand/25 dark:text-slate-100"
              : "rounded-br-sm bg-brand text-brand-fg"
            : "rounded-bl-sm bg-white text-slate-900 dark:bg-slate-800 dark:text-slate-100",
          deleted && "opacity-60 line-through decoration-current/50",
        )}
      >
        {proof && <PaymentProofBadge />}
        {stored ? (
          <ReceivedMedia message={m} />
        ) : m.type === "image" && m.media_url ? (
          <a href={m.media_url} target="_blank" rel="noreferrer" className="-mx-1 -mt-0.5 mb-1 block overflow-hidden rounded-xl">
            <img src={m.media_url} alt={m.content ?? "Imagem"} loading="lazy" className="max-h-64 w-full max-w-xs object-cover" />
          </a>
        ) : (
          isMedia && (
            <div className="mb-1 flex items-center gap-1.5 text-xs opacity-80">
              {Icon && <Icon className="h-3.5 w-3.5" />}
              <span>{MEDIA_LABEL[m.type] ?? m.type}</span>
            </div>
          )
        )}
        {m.content && <p className="whitespace-pre-wrap break-words">{m.content}</p>}
        {transcript && transcript !== m.content && (
          <p className="mt-1 whitespace-pre-wrap break-words border-l-2 border-current/30 pl-2 text-xs italic opacity-80">
            Transcrição: {transcript}
          </p>
        )}
        {description && <p className="mt-1 break-words text-xs italic opacity-80">{m.type === "document" ? "Lido" : "Imagem"}: {description}</p>}
        {documentText && (
          <details className="mt-1 text-xs opacity-80">
            <summary className="cursor-pointer">Texto lido do documento</summary>
            <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-words">{documentText}</p>
          </details>
        )}
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-1 px-1 text-[11px] text-slate-400">
        <span>{SENDER_LABEL[m.sender]}</span>
        <span>·</span>
        <span>{formatRelativeShort(m.created_at)}</span>
        {deleted ? (
          <span className="font-medium" title={m.deleted_by ? "Apagada pelo painel" : "Apagada pelo celular conectado"}>· apagada para todos</span>
        ) : (
          <>
            {outbound && m.status === "failed" && <span className="font-medium text-red-500">· falhou</span>}
            {outbound && m.status === "pending" && <span>· enviando</span>}
            {outbound && (m.status === "sent" || m.status === "delivered" || m.status === "read") && <CheckCheck className="h-3 w-3" />}
          </>
        )}
        {m.metadata?.forwarded_from ? <span>· encaminhada</span> : null}
        {m.hidden_at && isAdmin && <span className="inline-flex items-center gap-0.5"><EyeOff className="h-3 w-3" /> oculta da equipe</span>}
        {onForward && (
          <button type="button" onClick={onForward} className={ACTION} aria-label="Encaminhar mensagem" title="Encaminhar">
            <Forward className="h-3 w-3" /> encaminhar
          </button>
        )}
        {onDelete && !deleted && (
          <button type="button" onClick={onDelete} className={ACTION} aria-label="Apagar para todos" title="Apagar no WhatsApp do cliente (até cerca de 2 dias após o envio)">
            <Trash2 className="h-3 w-3" /> apagar
          </button>
        )}
        {m.hidden_at ? (
          onUnhide && (
            <button type="button" onClick={onUnhide} className={ACTION} aria-label="Restaurar mensagem" title="Voltar a mostrar para a equipe">
              restaurar
            </button>
          )
        ) : (
          onHide && (
            <button type="button" onClick={onHide} className={ACTION} aria-label="Ocultar no painel" title="Esconder da equipe sem mexer no WhatsApp do cliente">
              <EyeOff className="h-3 w-3" /> ocultar
            </button>
          )
        )}
      </div>
    </div>
  );
}
