// Encaminhar uma mensagem da inbox para outra conversa ou para um número novo.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Forward, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatPhone, initials } from "@/lib/format";
import { forwardPreview } from "@/lib/inbox-send";
import type { Conversation, Message } from "@/lib/database.types";
import { useConversations, useSendMessage } from "@/hooks/use-inbox";
import { Button, Input, Modal, useToast } from "@/components/ui";

export function ForwardDialog({ workspaceId, message, onClose }: { workspaceId: string; message: Message | null; onClose: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const conversations = useConversations(workspaceId);
  const send = useSendMessage();
  const [search, setSearch] = useState("");
  const [phone, setPhone] = useState("");
  const [target, setTarget] = useState<Conversation | null>(null);

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (conversations.data ?? [])
      .filter((c) => c.channel === "whatsapp" && c.id !== message?.conversation_id)
      .filter((c) => !q || `${c.contact_name ?? ""} ${c.contact_phone}`.toLowerCase().includes(q))
      .slice(0, 30);
  }, [conversations.data, search, message?.conversation_id]);

  const newNumber = phone.replace(/\D/g, "");
  const ready = Boolean(message) && (Boolean(target) || newNumber.length >= 10);

  async function confirm() {
    if (!message) return;
    try {
      const res = target
        ? await send.mutateAsync({ conversationId: target.id, forwardMessageId: message.id })
        : await send.mutateAsync({ workspaceId, toPhone: newNumber, forwardMessageId: message.id });
      toast.success(target ? `Encaminhado para ${target.contact_name || formatPhone(target.contact_phone)}.` : `Encaminhado para ${formatPhone(newNumber)}.`);
      onClose();
      navigate(`/inbox/${res.conversation_id}`);
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <Modal
      open={Boolean(message)}
      onClose={onClose}
      title="Encaminhar mensagem"
      description={message ? forwardPreview(message) : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => void confirm()} disabled={!ready} loading={send.isPending}><Forward className="h-4 w-4" /> Encaminhar</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <p className="mb-1.5 text-sm font-medium">Para uma conversa</p>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar nome ou telefone"
              aria-label="Buscar conversa"
              className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-8 pr-3 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 dark:border-slate-700 dark:bg-slate-900"
            />
          </div>
          <ul className="mt-2 max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
            {candidates.length === 0 && <li className="px-3 py-3 text-sm text-slate-500">Nenhuma conversa encontrada.</li>}
            {candidates.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => { setTarget(target?.id === c.id ? null : c); setPhone(""); }}
                  aria-pressed={target?.id === c.id}
                  className={cn("flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50", target?.id === c.id && "bg-brand/10")}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-200">{initials(c.contact_name ?? c.contact_phone)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{c.contact_name || formatPhone(c.contact_phone)}</span>
                    {c.contact_name && <span className="block truncate text-xs text-slate-500">{formatPhone(c.contact_phone)}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <Input
          label="Ou para um número novo"
          placeholder="(48) 99999-0000"
          inputMode="tel"
          value={phone}
          onChange={(e) => { setPhone(e.target.value); if (e.target.value.trim()) setTarget(null); }}
          hint="Com DDD. Se o número já tiver conversa, a mensagem vai para ela."
        />
      </div>
    </Modal>
  );
}
