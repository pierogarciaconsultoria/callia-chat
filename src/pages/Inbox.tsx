import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Bot,
  CheckCheck,
  FileText,
  Forward,
  Image as ImageIcon,
  Inbox as InboxIcon,
  Lock,
  MapPin,
  MessageSquarePlus,
  Mic,
  Paperclip,
  Search,
  Send,
  UserRound,
  Video,
  XCircle,
  Zap,
} from "lucide-react";
import { invokeFunction } from "@/lib/functions";
import { cn } from "@/lib/cn";
import { JourneyCard } from "@/components/onboarding/Journey";
import { PaymentProofBadge, ReceivedMedia, receivedMediaPath } from "@/components/inbox/ReceivedMedia";
import { ForwardDialog } from "@/components/inbox/ForwardDialog";
import { NewConversationDialog } from "@/components/inbox/NewConversationDialog";
import { PhotoPickerDialog } from "@/components/inbox/PhotoPickerDialog";
import { QuickReplyPicker } from "@/components/inbox/QuickReplyPicker";
import { useQuickReplies } from "@/hooks/use-quick-replies";
import { renderQuickReply, slashQuery } from "@/lib/quick-replies";
import { canForward, mediaTypeFor, uploadAttachment, validateUpload, type UploadedAttachment } from "@/lib/inbox-send";
import { useAuth } from "@/lib/auth";
import { useRequiredWorkspace } from "@/lib/workspace";
import { formatPhone, formatRelativeShort, initials } from "@/lib/format";
import type { Conversation, ConversationMode, Message, QuickReply } from "@/lib/database.types";
import {
  useConversations,
  useInboxRealtime,
  useMessages,
  useSendMessage,
  useUpdateConversation,
  type ConversationFilters,
} from "@/hooks/use-inbox";
import { useWhatsAppInstances } from "@/hooks/use-whatsapp-instances";
import { memberLabel, normalizePhone, useClaimConversation, useContactAssignmentActions, useContactAssignments, useMembers, useRouting } from "@/hooks/use-routing";
import { Badge, Button, EmptyState, ErrorState, Notice, Spinner, useToast } from "@/components/ui";

const MODE_LABEL: Record<ConversationMode, string> = { bot: "Bot", human: "Humano", closed: "Encerrada" };
const MODE_TONE = { bot: "brand", human: "violet", closed: "neutral" } as const;

const isExternal = (c: Conversation) => c.channel !== "whatsapp";

export default function Inbox() {
  const { workspaceId } = useRequiredWorkspace();
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const [filters, setFilters] = useState<ConversationFilters>({ instanceId: "all", mode: "all" });
  const [owner, setOwner] = useState<"all" | "mine" | "unassigned">("all");
  const [search, setSearch] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const { user } = useAuth();

  useInboxRealtime(workspaceId);
  const conversations = useConversations(workspaceId);
  const instances = useWhatsAppInstances(workspaceId);
  const members = useMembers(workspaceId);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (conversations.data ?? []).filter((c) => {
      if (filters.mode !== "all" && c.mode !== filters.mode) return false;
      if (owner === "mine" && c.assigned_user_id !== user?.id) return false;
      if (owner === "unassigned" && c.assigned_user_id) return false;
      if (filters.instanceId !== "all") {
        if (filters.instanceId === "external" ? !isExternal(c) : c.instance_id !== filters.instanceId) return false;
      }
      if (q && !`${c.contact_name ?? ""} ${c.contact_phone}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [conversations.data, filters, owner, search, user?.id]);

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
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar nome ou telefone"
                className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-8 pr-3 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 dark:border-slate-700 dark:bg-slate-900"
              />
            </div>
            <Button size="sm" variant="secondary" onClick={() => setNewOpen(true)} aria-label="Nova conversa" title="Iniciar conversa com um número">
              <MessageSquarePlus className="h-4 w-4" />
            </Button>
          </div>
          <NewConversationDialog workspaceId={workspaceId} open={newOpen} onClose={() => setNewOpen(false)} />
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
          <select
            aria-label="Filtrar por operador"
            value={owner}
            onChange={(e) => setOwner(e.target.value as typeof owner)}
            className="h-8 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900"
          >
            <option value="all">Todas as conversas</option>
            <option value="mine">Minhas</option>
            <option value="unassigned">Sem operador</option>
          </select>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* No celular o painel da direita não aparece: a jornada de configuração fica no topo da lista. */}
          <div className="p-3 empty:hidden md:hidden">
            <JourneyCard key={workspaceId} compact />
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
                        {c.assigned_user_id && c.mode === "human" && (
                          <Badge tone={c.assigned_user_id === user?.id ? "brand" : "neutral"}>{c.assigned_user_id === user?.id ? "você" : memberLabel(members.data, c.assigned_user_id)}</Badge>
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
            <JourneyCard key={workspaceId} compact className="mx-auto mt-4 max-w-md" />
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
  const [attachment, setAttachment] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [forwardOf, setForwardOf] = useState<Message | null>(null);
  const [photosOpen, setPhotosOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  /** Anexo que veio de uma resposta rápida (já guardado no bucket). */
  const [quickMedia, setQuickMedia] = useState<UploadedAttachment | null>(null);
  const quickReplies = useQuickReplies(workspaceId);
  const slash = slashQuery(text);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const external = isExternal(conversation);
  const members = useMembers(workspaceId);
  const routing = useRouting(workspaceId);
  const claim = useClaimConversation(workspaceId);
  const portfolio = routing.data?.assignment_mode === "portfolio";
  const assignments = useContactAssignments(workspaceId, portfolio);
  const { claimContact } = useContactAssignmentActions(workspaceId);
  const [conflictWith, setConflictWith] = useState<string | null>(null);
  const attendedBy = conversation.mode === "human" ? memberLabel(members.data, conversation.assigned_user_id) : null;
  const contactOwner = portfolio ? assignments.data?.find((a) => a.phone === normalizePhone(conversation.contact_phone)) ?? null : null;

  // Assumir: se outro operador já atende, avisa e só assume com "mesmo assim" (fica na auditoria).
  async function takeOver(force = false) {
    try {
      const r = await claim.mutateAsync({ conversationId: conversation.id, force });
      if (r.conflict) {
        setConflictWith(memberLabel(members.data, r.assigned_user_id));
        return;
      }
      setConflictWith(null);
      toast.success("Você assumiu a conversa.");
    } catch (e) {
      toast.error(e);
    }
  }

  // Abrir a conversa zera as não lidas.
  useEffect(() => {
    if (conversation.unread_count > 0) update.mutate({ id: conversation.id, patch: { unread_count: 0 } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id, conversation.unread_count]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.data?.length]);

  const setMode = (mode: ConversationMode) => {
    if (mode === "human") return void takeOver();
    update.mutate(
      {
        id: conversation.id,
        patch: { mode },
      },
      {
        onSuccess: () => {
          toast.success(mode === "bot" ? "Conversa devolvida ao bot." : "Conversa encerrada.");
          // Mensagens do cliente que ficaram sem resposta enquanto estava com a equipe: a IA responde agora.
          if (mode === "bot") {
            invokeFunction("process-message", { action: "resume", workspace_id: conversation.workspace_id, conversation_id: conversation.id })
              .catch((e) => toast.error(e));
          }
        },
        onError: (e) => toast.error(e),
      },
    );
  };

  function pickFile(file: File | null) {
    if (!file) return setAttachment(null);
    const problem = validateUpload(file);
    if (problem) return toast.error(problem);
    setAttachment(file);
    setQuickMedia(null);
  }

  // Resposta rápida escolhida: o texto entra no campo (ainda editável) e o anexo dela vira o anexo da mensagem.
  function pickQuickReply(r: QuickReply) {
    setText(renderQuickReply(r.content, { name: conversation.contact_name }));
    if (r.media_path) {
      setQuickMedia({ mediaPath: r.media_path, fileName: r.media_name ?? "anexo", mimetype: r.media_mime ?? "application/octet-stream", type: mediaTypeFor(r.media_mime ?? "") });
      setAttachment(null);
      if (fileRef.current) fileRef.current.value = "";
    }
    setQuickOpen(false);
    textRef.current?.focus();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body && !attachment && !quickMedia) return;
    try {
      if (attachment || quickMedia) {
        let up = quickMedia!;
        if (attachment) {
          setUploading(true);
          up = await uploadAttachment(workspaceId, attachment).finally(() => setUploading(false));
        }
        await send.mutateAsync({ conversationId: conversation.id, text: body || undefined, mediaPath: up.mediaPath, fileName: up.fileName, mimetype: up.mimetype, type: up.type });
        setAttachment(null);
        setQuickMedia(null);
        if (fileRef.current) fileRef.current.value = "";
      } else {
        await send.mutateAsync({ conversationId: conversation.id, text: body });
      }
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
          {attendedBy && <Badge tone={conversation.assigned_user_id === user?.id ? "brand" : "neutral"}>atendendo: {conversation.assigned_user_id === user?.id ? "você" : attendedBy}</Badge>}
          {conversation.mode === "human" && conversation.assigned_user_id !== user?.id && (
            <Button size="sm" variant="secondary" onClick={() => void takeOver()} disabled={claim.isPending}>
              <UserRound className="h-4 w-4" /> Assumir
            </Button>
          )}
          {portfolio && (!contactOwner || contactOwner.user_id !== user?.id) && (
            <Button size="sm" variant="ghost" onClick={() => claimContact.mutate(conversation.id, { onSuccess: () => toast.success("Cliente vinculado a você."), onError: (e) => toast.error(e) })} disabled={claimContact.isPending} title={contactOwner ? `Hoje este cliente é de ${memberLabel(members.data, contactOwner.user_id)}` : "Este cliente ainda não tem operador"}>
              Ficar com este cliente
            </Button>
          )}
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
      {conflictWith && (
        <div className="px-3 pt-3 sm:px-4">
          <Notice tone="warn">
            <span className="mr-3">{conflictWith} já está atendendo esta conversa.</span>
            <Button size="sm" variant="secondary" onClick={() => void takeOver(true)} loading={claim.isPending}>Assumir mesmo assim</Button>
            <button type="button" className="ml-3 text-sm underline" onClick={() => setConflictWith(null)}>Deixar com {conflictWith}</button>
          </Notice>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6">
        {messages.isLoading ? (
          <div className="flex justify-center p-8 text-slate-400">
            <Spinner />
          </div>
        ) : messages.error ? (
          <ErrorState error={messages.error} onRetry={() => void messages.refetch()} />
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-2">
            {messages.data?.map((m) => <Bubble key={m.id} message={m} onForward={canForward(m) ? () => setForwardOf(m) : undefined} />)}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
      <ForwardDialog workspaceId={workspaceId} message={forwardOf} onClose={() => setForwardOf(null)} />
      <PhotoPickerDialog
        workspaceId={workspaceId}
        conversationId={conversation.id}
        open={photosOpen}
        onClose={() => setPhotosOpen(false)}
        onSent={() => { if (conversation.mode === "bot") setMode("human"); }}
      />

      <footer className="border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        {external ? (
          <p className="mx-auto flex max-w-3xl items-start gap-2 text-sm text-slate-500 dark:text-slate-400">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" />
            Esta conversa veio de uma integração externa ({conversation.channel}). A resposta manual fica bloqueada até existir um
            adaptador de envio para esse canal — responda pelo sistema de origem.
          </p>
        ) : (
          <form onSubmit={submit} className="mx-auto max-w-3xl">
            {(quickOpen || slash !== null) && (
              <QuickReplyPicker
                replies={quickReplies.data ?? []}
                query={slash ?? ""}
                onPick={pickQuickReply}
                onClose={() => { setQuickOpen(false); if (slash !== null) setText(""); }}
              />
            )}
            {(attachment || quickMedia) && (
              <div className="mb-2 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800">
                <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1 truncate">{attachment?.name ?? quickMedia?.fileName}</span>
                <button type="button" className="underline" onClick={() => { pickFile(null); setQuickMedia(null); }}>Remover</button>
              </div>
            )}
            <div className="flex items-end gap-2">
            <input ref={fileRef} type="file" className="hidden" aria-label="Anexar arquivo" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip" />
            <Button type="button" variant="ghost" onClick={() => fileRef.current?.click()} aria-label="Anexar" title="Anexar arquivo (até 20 MB)">
              <Paperclip className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" onClick={() => setPhotosOpen(true)} aria-label="Fotos" title="Enviar fotos da galeria">
              <ImageIcon className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" onClick={() => setQuickOpen((v) => !v)} aria-label="Respostas rápidas" title="Respostas rápidas (ou digite /)">
              <Zap className="h-4 w-4" />
            </Button>
            <textarea
              ref={textRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              rows={1}
              placeholder={attachment || quickMedia ? "Legenda (opcional)…" : conversation.mode === "bot" ? "Responder (assume a conversa do bot)…" : "Escreva uma mensagem… (/ para respostas rápidas)"}
              className="max-h-40 min-h-[2.5rem] min-w-0 flex-1 resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 dark:border-slate-700 dark:bg-slate-900"
            />
            <Button type="submit" loading={send.isPending || uploading} disabled={!text.trim() && !attachment && !quickMedia} aria-label="Enviar">
              <Send className="h-4 w-4" />
              <span className="hidden sm:inline">Enviar</span>
            </Button>
            </div>
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

function Bubble({ message: m, onForward }: { message: Message; onForward?: () => void }) {
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
      <div className="mt-0.5 flex items-center gap-1 px-1 text-[11px] text-slate-400">
        <span>{SENDER_LABEL[m.sender]}</span>
        <span>·</span>
        <span>{formatRelativeShort(m.created_at)}</span>
        {outbound && m.status === "failed" && <span className="font-medium text-red-500">· falhou</span>}
        {outbound && m.status === "pending" && <span>· enviando</span>}
        {outbound && (m.status === "sent" || m.status === "delivered" || m.status === "read") && <CheckCheck className="h-3 w-3" />}
        {m.metadata?.forwarded_from ? <span>· encaminhada</span> : null}
        {onForward && (
          <button type="button" onClick={onForward} className="ml-1 inline-flex items-center gap-0.5 rounded px-1 hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-800" aria-label="Encaminhar mensagem" title="Encaminhar">
            <Forward className="h-3 w-3" /> encaminhar
          </button>
        )}
      </div>
    </div>
  );
}
