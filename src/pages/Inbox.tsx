import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Bot,
  CheckCheck,
  FileText,
  Image as ImageIcon,
  Inbox as InboxIcon,
  Lock,
  MapPin,
  Mic,
  Search,
  Send,
  UserRound,
  Video,
  XCircle,
} from "lucide-react";
import { invokeFunction } from "@/lib/functions";
import { cn } from "@/lib/cn";
import { OnboardingChecklist } from "@/components/OnboardingChecklist";
import { useAuth } from "@/lib/auth";
import { useRequiredWorkspace } from "@/lib/workspace";
import { formatPhone, formatRelativeShort, initials } from "@/lib/format";
import type { Conversation, ConversationMode, Message } from "@/lib/database.types";
import {
  useConversations,
  useInboxRealtime,
  useMessages,
  useSendMessage,
  useUpdateConversation,
  type ConversationFilters,
} from "@/hooks/use-inbox";
import { useWhatsAppInstances } from "@/hooks/use-whatsapp-instances";
import { Badge, Button, EmptyState, ErrorState, Spinner, useToast } from "@/components/ui";

const MODE_LABEL: Record<ConversationMode, string> = { bot: "Bot", human: "Humano", closed: "Encerrada" };
const MODE_TONE = { bot: "brand", human: "violet", closed: "neutral" } as const;

const isExternal = (c: Conversation) => c.channel !== "whatsapp";

export default function Inbox() {
  const { workspaceId } = useRequiredWorkspace();
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const [filters, setFilters] = useState<ConversationFilters>({ instanceId: "all", mode: "all" });
  const [search, setSearch] = useState("");

  useInboxRealtime(workspaceId);
  const conversations = useConversations(workspaceId);
  const instances = useWhatsAppInstances(workspaceId);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (conversations.data ?? []).filter((c) => {
      if (filters.mode !== "all" && c.mode !== filters.mode) return false;
      if (filters.instanceId !== "all") {
        if (filters.instanceId === "external" ? !isExternal(c) : c.instance_id !== filters.instanceId) return false;
      }
      if (q && !`${c.contact_name ?? ""} ${c.contact_phone}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [conversations.data, filters, search]);

  const selected = conversations.data?.find((c) => c.id === conversationId) ?? null;
  const instanceName = (id: string | null) => instances.data?.find((i) => i.id === id)?.name;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-h-0 lg:h-screen">
      {/* Lista */}
      <section
        className={cn(
          "flex w-full min-w-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 md:w-80 md:shrink-0 xl:w-96",
          selected && "hidden md:flex",
        )}
      >
        <div className="space-y-2 border-b border-slate-200 p-3 dark:border-slate-800">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar nome ou telefone"
              className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-8 pr-3 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 dark:border-slate-700 dark:bg-slate-900"
            />
          </div>
          <div className="flex gap-2">
            <select
              aria-label="Filtrar por instância"
              value={filters.instanceId}
              onChange={(e) => setFilters((f) => ({ ...f, instanceId: e.target.value }))}
              className="h-8 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900"
            >
              <option value="all">Todas as instâncias</option>
              {instances.data?.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
              <option value="external">Via integração</option>
            </select>
            <select
              aria-label="Filtrar por modo"
              value={filters.mode}
              onChange={(e) => setFilters((f) => ({ ...f, mode: e.target.value as ConversationFilters["mode"] }))}
              className="h-8 w-28 shrink-0 rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900"
            >
              <option value="all">Todos</option>
              <option value="bot">Bot</option>
              <option value="human">Humano</option>
              <option value="closed">Encerradas</option>
            </select>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* No celular o painel da direita não aparece: os primeiros passos ficam no topo da lista. */}
          <div className="p-3 empty:hidden md:hidden">
            <OnboardingChecklist key={workspaceId} compact />
          </div>
          {conversations.isLoading ? (
            <div className="flex justify-center p-8 text-slate-400">
              <Spinner />
            </div>
          ) : conversations.error ? (
            <div className="p-3">
              <ErrorState error={conversations.error} onRetry={() => void conversations.refetch()} />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={InboxIcon}
              title="Nenhuma conversa"
              description={
                conversations.data?.length
                  ? "Nenhuma conversa corresponde aos filtros."
                  : "Quando um cliente mandar mensagem no WhatsApp conectado, ela aparece aqui."
              }
            />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/inbox/${c.id}`)}
                    className={cn(
                      "flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50",
                      c.id === conversationId && "bg-brand/5 dark:bg-brand/10",
                    )}
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-200">
                      {initials(c.contact_name ?? c.contact_phone)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className={cn("truncate text-sm", c.unread_count > 0 ? "font-semibold" : "font-medium")}>
                          {c.contact_name || formatPhone(c.contact_phone)}
                        </p>
                        <span className="shrink-0 text-xs text-slate-400">{formatRelativeShort(c.last_message_at)}</span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{c.last_message_preview || "—"}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <Badge tone={MODE_TONE[c.mode]}>{MODE_LABEL[c.mode]}</Badge>
                        {isExternal(c) ? (
                          <Badge tone="blue">via integração</Badge>
                        ) : (
                          instanceName(c.instance_id) && (instances.data?.length ?? 0) > 1 && <Badge>{instanceName(c.instance_id)}</Badge>
                        )}
                        {c.unread_count > 0 && (
                          <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-xs font-semibold text-brand-fg">
                            {c.unread_count > 99 ? "99+" : c.unread_count}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Thread */}
      <section className={cn("min-w-0 flex-1 flex-col bg-slate-50 dark:bg-slate-950", selected ? "flex" : "hidden md:flex")}>
        {selected ? (
          <Thread key={selected.id} conversation={selected} workspaceId={workspaceId} instanceName={instanceName(selected.instance_id)} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center p-4">
            <EmptyState icon={InboxIcon} title="Selecione uma conversa" description="Escolha uma conversa à esquerda para ver as mensagens." />
            <OnboardingChecklist key={workspaceId} className="mx-auto mt-4" />
          </div>
        )}
      </section>
    </div>
  );
}

function Thread({
  conversation,
  workspaceId,
  instanceName,
}: {
  conversation: Conversation;
  workspaceId: string;
  instanceName?: string;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const messages = useMessages(conversation.id);
  const update = useUpdateConversation(workspaceId);
  const send = useSendMessage();
  const [text, setText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const external = isExternal(conversation);

  // Abrir a conversa zera as não lidas.
  useEffect(() => {
    if (conversation.unread_count > 0) update.mutate({ id: conversation.id, patch: { unread_count: 0 } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id, conversation.unread_count]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.data?.length]);

  const setMode = (mode: ConversationMode) =>
    update.mutate(
      {
        id: conversation.id,
        patch:
          mode === "human"
            ? { mode, assigned_user_id: user?.id ?? null, handoff_at: new Date().toISOString() }
            : { mode },
      },
      {
        onSuccess: () => {
          toast.success(mode === "human" ? "Você assumiu a conversa." : mode === "bot" ? "Conversa devolvida ao bot." : "Conversa encerrada.");
          // Mensagens do cliente que ficaram sem resposta enquanto estava com a equipe: a IA responde agora.
          if (mode === "bot") {
            invokeFunction("process-message", { action: "resume", workspace_id: conversation.workspace_id, conversation_id: conversation.id })
              .catch((e) => toast.error(e));
          }
        },
        onError: (e) => toast.error(e),
      },
    );

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    try {
      await send.mutateAsync({ conversationId: conversation.id, text: body });
      setText("");
      // Responder manualmente com o bot ativo assume a conversa, para o bot não responder por cima.
      if (conversation.mode === "bot") setMode("human");
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <>
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900 sm:px-4">
        <button
          type="button"
          onClick={() => navigate("/inbox")}
          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 md:hidden"
          aria-label="Voltar para a lista"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{conversation.contact_name || formatPhone(conversation.contact_phone)}</p>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
            {formatPhone(conversation.contact_phone)}
            {external ? ` · via integração (${conversation.channel})` : instanceName ? ` · ${instanceName}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={MODE_TONE[conversation.mode]}>{MODE_LABEL[conversation.mode]}</Badge>
          {conversation.mode !== "human" && (
            <Button size="sm" onClick={() => setMode("human")} disabled={update.isPending}>
              <UserRound className="h-4 w-4" /> Assumir
            </Button>
          )}
          {conversation.mode !== "bot" && (
            <Button size="sm" variant="secondary" onClick={() => setMode("bot")} disabled={update.isPending}>
              <Bot className="h-4 w-4" /> Devolver ao bot
            </Button>
          )}
          {conversation.mode !== "closed" && (
            <Button size="sm" variant="ghost" onClick={() => setMode("closed")} disabled={update.isPending}>
              <XCircle className="h-4 w-4" /> Encerrar
            </Button>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6">
        {messages.isLoading ? (
          <div className="flex justify-center p-8 text-slate-400">
            <Spinner />
          </div>
        ) : messages.error ? (
          <ErrorState error={messages.error} onRetry={() => void messages.refetch()} />
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-2">
            {messages.data?.map((m) => <Bubble key={m.id} message={m} />)}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <footer className="border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        {external ? (
          <p className="mx-auto flex max-w-3xl items-start gap-2 text-sm text-slate-500 dark:text-slate-400">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" />
            Esta conversa veio de uma integração externa ({conversation.channel}). A resposta manual fica bloqueada até existir um
            adaptador de envio para esse canal — responda pelo sistema de origem.
          </p>
        ) : (
          <form onSubmit={submit} className="mx-auto flex max-w-3xl items-end gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              rows={1}
              placeholder={conversation.mode === "bot" ? "Responder (assume a conversa do bot)…" : "Escreva uma mensagem…"}
              className="max-h-40 min-h-[2.5rem] min-w-0 flex-1 resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 dark:border-slate-700 dark:bg-slate-900"
            />
            <Button type="submit" loading={send.isPending} disabled={!text.trim()} aria-label="Enviar">
              <Send className="h-4 w-4" />
              <span className="hidden sm:inline">Enviar</span>
            </Button>
          </form>
        )}
      </footer>
    </>
  );
}

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
const SENDER_LABEL = { customer: "Cliente", bot: "Bot", agent: "Atendente", system: "Sistema" } as const;

function Bubble({ message: m }: { message: Message }) {
  const outbound = m.direction === "outbound";
  if (m.sender === "system") {
    return (
      <div className="my-1 self-center rounded-full bg-slate-200 px-3 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        {m.content}
      </div>
    );
  }
  const transcript = typeof m.metadata?.transcript === "string" ? (m.metadata.transcript as string) : null;
  const description = typeof m.metadata?.image_description === "string" ? (m.metadata.image_description as string) : null;
  const Icon = MEDIA_ICON[m.type as keyof typeof MEDIA_ICON];
  const isMedia = m.type !== "text";

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
        )}
      >
        {m.type === "image" && m.media_url ? (
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
        {description && <p className="mt-1 break-words text-xs italic opacity-80">Imagem: {description}</p>}
      </div>
      <div className="mt-0.5 flex items-center gap-1 px-1 text-[11px] text-slate-400">
        <span>{SENDER_LABEL[m.sender]}</span>
        <span>·</span>
        <span>{formatRelativeShort(m.created_at)}</span>
        {outbound && m.status === "failed" && <span className="font-medium text-red-500">· falhou</span>}
        {outbound && m.status === "pending" && <span>· enviando</span>}
        {outbound && (m.status === "sent" || m.status === "delivered" || m.status === "read") && <CheckCheck className="h-3 w-3" />}
      </div>
    </div>
  );
}
