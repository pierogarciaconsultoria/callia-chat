// Assistente do painel: chat flutuante para ajustar valores, datas, políticas, horário e regras, com confirmação.
// O botão não depende de provedores (QueryClient, Toast); só o painel aberto usa.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, MessageSquareText, Send, X } from "lucide-react";
import { useWorkspace } from "@/lib/workspace";
import { invokeFunction } from "@/lib/functions";
import { cn } from "@/lib/cn";
import { Button, Spinner, useToast } from "@/components/ui";

interface Proposal { id: string; kind: string; title: string; changes: string[]; status?: "applied" | "discarded" }
interface Msg { role: "user" | "assistant"; content: string; proposals?: Proposal[]; navigation?: { to: string; label: string } | null }
interface ChatResponse { reply: string; proposals: Proposal[]; navigation: { to: string; label: string } | null }

const SUGGESTIONS = ["A kitnet na alta temporada passa a 450", "Fechado de 21/06 a 22/09", "Onde mudo a mensagem fora do horário?", "A equipe atende das 8h às 22h todos os dias"];

export function AssistantDrawer() {
  const { workspaceId, isAdmin } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  if (!isAdmin || !workspaceId) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Fechar assistente" : "Abrir assistente"}
        className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-brand text-brand-fg shadow-lg hover:opacity-90"
      >
        {open ? <X className="h-5 w-5" /> : <MessageSquareText className="h-5 w-5" />}
      </button>
      {open && <AssistantPanel workspaceId={workspaceId} messages={messages} setMessages={setMessages} onClose={() => setOpen(false)} />}
    </>
  );
}

function AssistantPanel({ workspaceId, messages, setMessages, onClose }: { workspaceId: string; messages: Msg[]; setMessages: (fn: (ms: Msg[]) => Msg[]) => void; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    const next: Msg[] = [...messages, { role: "user", content }];
    setMessages(() => next);
    setInput("");
    setBusy(true);
    try {
      const r = await invokeFunction<ChatResponse>("assistant", { action: "chat", workspace_id: workspaceId, messages: next.map((m) => ({ role: m.role, content: m.content })) });
      setMessages(() => [...next, { role: "assistant", content: r.reply, proposals: r.proposals, navigation: r.navigation }]);
    } catch (err) {
      toast.error(err);
      setMessages(() => next);
    } finally {
      setBusy(false);
    }
  }

  async function decide(p: Proposal, action: "apply" | "discard") {
    try {
      await invokeFunction("assistant", { action, workspace_id: workspaceId, proposal_id: p.id });
      setMessages((ms) => ms.map((m) => ({ ...m, proposals: m.proposals?.map((x) => (x.id === p.id ? { ...x, status: action === "apply" ? "applied" : "discarded" } : x)) })));
      if (action === "apply") {
        toast.success("Alteração aplicada.");
        for (const key of ["price-table", "policies", "agent_config", "journey", "entitlements"]) void qc.invalidateQueries({ queryKey: [key] });
      }
    } catch (err) {
      toast.error(err);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }

  return (
    <section aria-label="Assistente do Callia" className="fixed bottom-20 right-5 z-40 flex h-[min(600px,calc(100vh-7rem))] w-[min(400px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
      <header className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <p className="text-sm font-semibold">Assistente do Callia</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">Peça uma mudança ou pergunte onde algo fica. Nada é gravado sem a sua confirmação.</p>
      </header>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {!messages.length && (
          <div className="space-y-2">
            <p className="text-sm text-slate-600 dark:text-slate-400">Exemplos:</p>
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => void send(s)} className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[90%] space-y-2 rounded-2xl px-3 py-2 text-sm", m.role === "user" ? "rounded-br-sm bg-brand/10" : "rounded-bl-sm bg-slate-100 dark:bg-slate-800")}>
              <p className="whitespace-pre-line">{m.content}</p>
              {m.navigation && (
                <Link to={m.navigation.to} onClick={onClose} className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
                  Abrir {m.navigation.label} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              )}
              {m.proposals?.map((p) => (
                <div key={p.id} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900" data-testid="proposal">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{p.title}</p>
                  <ul className="mt-1 space-y-0.5 text-sm">
                    {p.changes.map((c, j) => <li key={j}>• {c}</li>)}
                  </ul>
                  {p.status === "applied" ? (
                    <p className="mt-2 flex items-center gap-1 text-sm text-emerald-700 dark:text-emerald-400"><Check className="h-4 w-4" /> Aplicado</p>
                  ) : p.status === "discarded" ? (
                    <p className="mt-2 text-sm text-slate-500">Descartado</p>
                  ) : (
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" onClick={() => void decide(p, "apply")}>Confirmar</Button>
                      <Button size="sm" variant="secondary" onClick={() => void decide(p, "discard")}>Descartar</Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
        {busy && <div className="flex justify-start"><div className="rounded-2xl bg-slate-100 px-3 py-2 dark:bg-slate-800"><Spinner className="h-4 w-4" /></div></div>}
        <div ref={endRef} />
      </div>
      <form onSubmit={submit} className="flex items-center gap-2 border-t border-slate-200 p-3 dark:border-slate-800">
        <input
          aria-label="Mensagem para o assistente"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ex.: o check-out passa a ser 11h"
          className="h-10 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
        />
        <Button type="submit" size="sm" loading={busy} aria-label="Enviar"><Send className="h-4 w-4" /></Button>
      </form>
    </section>
  );
}
