// Lista flutuante de respostas rápidas acima do campo de mensagem; setas e Enter escolhem, Esc fecha.
import { useEffect, useState } from "react";
import { Paperclip } from "lucide-react";
import { cn } from "@/lib/cn";
import { filterQuickReplies } from "@/lib/quick-replies";
import type { QuickReply } from "@/lib/database.types";

export function QuickReplyPicker({ replies, query, onPick, onClose, manageHint, onCreate }: {
  replies: QuickReply[];
  query: string;
  onPick: (reply: QuickReply) => void;
  onClose: () => void;
  /** Mostrado quando não há nada cadastrado (admin vê onde cadastrar). */
  manageHint?: string;
  /** Admin: cria uma resposta nova a partir do texto escrito (também Ctrl+Shift+S no campo). */
  onCreate?: () => void;
}) {
  const items = filterQuickReplies(replies, query);
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [query, items.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, Math.max(items.length - 1, 0))); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
      else if (e.key === "Enter" && items[active]) { e.preventDefault(); e.stopPropagation(); onPick(items[active]); }
      else if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [items, active, onPick, onClose]);

  return (
    <div role="listbox" aria-label="Respostas rápidas" className="mb-2 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
      {replies.length === 0 ? (
        <p className="px-3 py-3 text-sm text-slate-500">{manageHint ?? "Nenhuma resposta rápida cadastrada. Peça a um administrador para criar em Equipe → Respostas rápidas (ou Ctrl+Shift+S com o texto escrito)."}</p>
      ) : items.length === 0 ? (
        <p className="px-3 py-3 text-sm text-slate-500">Nada encontrado para “/{query}”.</p>
      ) : (
        items.map((r, i) => (
          <button
            key={r.id}
            type="button"
            role="option"
            aria-selected={i === active}
            onMouseEnter={() => setActive(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(r)}
            className={cn("flex w-full items-start gap-3 px-3 py-2 text-left text-sm", i === active ? "bg-brand/10" : "hover:bg-slate-50 dark:hover:bg-slate-800/50")}
          >
            <code className="mt-0.5 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">/{r.shortcut}</code>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{r.title}</span>
              <span className="line-clamp-1 text-xs text-slate-500">{r.content}</span>
            </span>
            {r.media_name && <Paperclip className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-400" aria-label="com anexo" />}
          </button>
        ))
      )}
      {onCreate && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onCreate}
          className="flex w-full items-center justify-between gap-2 border-t border-slate-100 px-3 py-2 text-left text-xs text-brand hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800"
        >
          <span>+ Salvar o texto escrito como resposta rápida</span>
          <kbd className="rounded border border-slate-200 px-1 font-mono text-[10px] text-slate-500 dark:border-slate-700">Ctrl+Shift+S</kbd>
        </button>
      )}
    </div>
  );
}
