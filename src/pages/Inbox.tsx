import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRightLeft,
  Bot,
  Image as ImageIcon,
  Inbox as InboxIcon,
  Lock,
  MessageSquarePlus,
  Mic,
  Paperclip,
  Search,
  Send,
  UserRound,
  XCircle,
  Zap,
} from "lucide-react";
import { invokeFunction } from "@/lib/functions";
import { cn } from "@/lib/cn";
import { JourneyCard } from "@/components/onboarding/Journey";
import { MessageBubble } from "@/components/inbox/MessageBubble";
import { ForwardDialog } from "@/components/inbox/ForwardDialog";
import { NewConversationDialog } from "@/components/inbox/NewConversationDialog";
import { PhotoPickerDialog } from "@/components/inbox/PhotoPickerDialog";
import { QuickReplyPicker } from "@/components/inbox/QuickReplyPicker";
import { QuickReplyModal } from "@/components/QuickRepliesCard";
import { TransferDialog } from "@/components/inbox/TransferDialog";
import { VoiceRecorder } from "@/components/inbox/VoiceRecorder";
import { departmentName, useDepartments } from "@/hooks/use-departments";
import { useQuickReplies } from "@/hooks/use-quick-replies";
import { renderQuickReply, slashQuery } from "@/lib/quick-replies";
import { addAttachments, canForward, MAX_FILES_PER_SEND, mediaTypeFor, uploadAttachment, type UploadedAttachment } from "@/lib/inbox-send";
import { ACTION_COPY, canDeleteForEveryone, type MessageAction } from "@/lib/message-moderation";
import { useAuth } from "@/lib/auth";
import { useRequiredWorkspace } from "@/lib/workspace";
import { formatPhone, formatRelativeShort, initials } from "@/lib/format";
import type { Conversation, ConversationMode, Message, QuickReply } from "@/lib/database.types";
import {
  useConversations,
  useInboxRealtime,
  useMessageAction,
  useMessages,
  useSendMessage,
  useUpdateConversation,
  type ConversationFilters,
} from "@/hooks/use-inbox";
import { useWhatsAppInstances } from "@/hooks/use-whatsapp-instances";
import { memberLabel, normalizePhone, useClaimConversation, useContactAssignmentActions, useContactAssignments, useMembers } from "@/hooks/use-routing";
import { Badge, Button, EmptyState, ErrorState, Modal, Notice, Spinner, useToast } from "@/components/ui";

const MODE_LABEL: Record<ConversationMode, string> = { bot: "Bot", human: "Humano", closed: "Encerrada" };
const MODE_TONE = { bot: "brand", human: "violet", closed: "neutral" } as const;

const isExternal = (c: Conversation) => c.channel !== "whatsapp";

export default function Inbox() {
  const { workspaceId } = useRequiredWorkspace();
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const [filters, setFilters] = useState<ConversationFilters>({ instanceId: "all", mode: "all" });
  const [owner, setOwner] = useState<"all" | "mine" | "unassigned">("all");
  const [department, setDepartment] = useState<"all" | "none" | string>("all");
  const [search, setSearch] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const { user } = useAuth();

  useInboxRealtime(workspaceId);
  const conversations = useConversations(workspaceId);
  const instances = useWhatsAppInstances(workspaceId);
  const members = useMembers(workspaceId);
  const departments = useDepartments(workspaceId);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (conversations.data ?? []).filter((c) => {
      if (filters.mode !== "all" && c.mode !== filters.mode) return false;
      if (owner === "mine" && c.assigned_user_id !== user?.id) return false;
      if (owner === "unassigned" && c.assigned_user_id) return false;
      if (department === "none" ? c.department_id : department !== "all" && c.department_id !== department) return false;
      if (filters.instanceId !== "all") {
        if (filters.instanceId === "external" ? !isExternal(c) : c.instance_id !== filters.instanceId) return false;
      }
      if (q && !`${c.contact_name ?? ""} ${c.contact_phone}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [conversations.data, filters, owner, department, search, user?.id]);

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
          {(departments.data?.departments.length ?? 0) > 0 && (
            <select
              aria-label="Filtrar por setor"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              className="h-8 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900"
            >
              <option value="all">Todos os setores</option>
              <option value="none">Sem setor</option>
              {departments.data!.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
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
                        {c.department_id && <Badge tone="blue">{departmentName(departments.data, c.department_id)}</Badge>}
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
  const { isAdmin } = useRequiredWorkspace();
  const toast = useToast();
  const navigate = useNavigate();
  const messages = useMessages(conversation.id);
  const update = useUpdateConversation(workspaceId);
  const send = useSendMessage();
  const [text, setText] = useState("");
  /** Arquivos escolhidos pelo clipe (vários de uma vez) ou gravados pelo microfone; cada um vira uma mensagem. */
  const [attachments, setAttachments] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  /** Gravando voz pelo microfone: a barra de gravação toma o lugar do campo de texto. */
  const [recording, setRecording] = useState(false);
  /** Pré-escuta quando o único anexo é um áudio (gravado ou escolhido no clipe). */
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null);
  const [forwardOf, setForwardOf] = useState<Message | null>(null);
  /** Ação de moderação aguardando confirmação (apagar para todos, ocultar, restaurar). */
  const [pendingAction, setPendingAction] = useState<{ action: MessageAction; message: Message } | null>(null);
  const messageAction = useMessageAction();
  const [photosOpen, setPhotosOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [newQuickOpen, setNewQuickOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const departments = useDepartments(workspaceId);
  /** Anexo que veio de uma resposta rápida (já guardado no bucket). */
  const [quickMedia, setQuickMedia] = useState<UploadedAttachment | null>(null);
  const quickReplies = useQuickReplies(workspaceId);
  const slash = slashQuery(text);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const external = isExternal(conversation);
  useEffect(() => {
    const only = attachments.length === 1 ? attachments[0] : null;
    if (!only || !only.type.startsWith("audio/") || typeof URL.createObjectURL !== "function") {
      setAttachmentUrl(null);
      return;
    }
    const url = URL.createObjectURL(only);
    setAttachmentUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [attachments]);
  // Trocar de conversa no meio de uma gravação descarta a gravação.
  useEffect(() => setRecording(false), [conversation.id]);
  const members = useMembers(workspaceId);
  const claim = useClaimConversation(workspaceId);
  const assignments = useContactAssignments(workspaceId);
  const { claimContact } = useContactAssignmentActions(workspaceId);
  const [conflictWith, setConflictWith] = useState<string | null>(null);
  const attendedBy = conversation.mode === "human" ? memberLabel(members.data, conversation.assigned_user_id) : null;
  const contactOwner = assignments.data?.find((a) => a.phone === normalizePhone(conversation.contact_phone)) ?? null;

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

  // Clipe ou microfone: os arquivos válidos entram na lista (somando aos já escolhidos); os inválidos viram aviso.
  function pickFiles(files: File[]) {
    const { list, problems } = addAttachments(attachments, files);
    for (const problem of problems) toast.error(problem);
    if (list.length === attachments.length) return;
    setAttachments(list);
    setQuickMedia(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function removeAttachment(index: number) {
    setAttachments((cur) => cur.filter((_, i) => i !== index));
  }

  // Resposta rápida escolhida: o texto entra no campo (ainda editável) e o anexo dela vira o anexo da mensagem.
  function pickQuickReply(r: QuickReply) {
    setText(renderQuickReply(r.content, { name: conversation.contact_name }));
    if (r.media_path) {
      setQuickMedia({ mediaPath: r.media_path, fileName: r.media_name ?? "anexo", mimetype: r.media_mime ?? "application/octet-stream", type: mediaTypeFor(r.media_mime ?? "") });
      setAttachments([]);
      if (fileRef.current) fileRef.current.value = "";
    }
    setQuickOpen(false);
    textRef.current?.focus();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body && attachments.length === 0 && !quickMedia) return;
    try {
      if (quickMedia) {
        await send.mutateAsync({ conversationId: conversation.id, text: body || undefined, mediaPath: quickMedia.mediaPath, fileName: quickMedia.fileName, mimetype: quickMedia.mimetype, type: quickMedia.type });
        setQuickMedia(null);
      } else if (attachments.length > 0) {
        // Um arquivo por mensagem, na ordem da lista; a legenda vai com o primeiro. O que já saiu sai da lista,
        // então um erro no meio deixa só o restante para tentar de novo.
        setUploading(true);
        try {
          for (const [i, file] of attachments.entries()) {
            const up = await uploadAttachment(workspaceId, file);
            await send.mutateAsync({ conversationId: conversation.id, text: i === 0 ? body || undefined : undefined, mediaPath: up.mediaPath, fileName: up.fileName, mimetype: up.mimetype, type: up.type });
            setAttachments((cur) => cur.filter((f) => f !== file));
            if (i === 0) setText("");
          }
        } finally {
          setUploading(false);
        }
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
          {conversation.department_id && <Badge tone="blue">{departmentName(departments.data, conversation.department_id)}</Badge>}
          {conversation.mode === "human" && conversation.assigned_user_id !== user?.id && (
            <Button size="sm" variant="secondary" onClick={() => void takeOver()} disabled={claim.isPending}>
              <UserRound className="h-4 w-4" /> Assumir
            </Button>
          )}
          {conversation.mode === "human" && (!contactOwner || contactOwner.user_id !== user?.id) && (
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
          {!external && (
            <Button size="sm" variant="secondary" onClick={() => setTransferOpen(true)} title="Transferir para outro operador ou setor">
              <ArrowRightLeft className="h-4 w-4" /> Transferir
            </Button>
          )}
          {conversation.mode !== "closed" && (
            <Button size="sm" variant="ghost" onClick={() => setMode("closed")} disabled={update.isPending}>
              <XCircle className="h-4 w-4" /> Encerrar
            </Button>
          )}
        </div>
      </header>
      <TransferDialog workspaceId={workspaceId} conversation={conversation} open={transferOpen} onClose={() => setTransferOpen(false)} />
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
            {messages.data?.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                isAdmin={isAdmin}
                onForward={canForward(m) ? () => setForwardOf(m) : undefined}
                onDelete={canDeleteForEveryone(m) ? () => setPendingAction({ action: "delete_for_everyone", message: m }) : undefined}
                onHide={isAdmin && !m.hidden_at ? () => setPendingAction({ action: "hide", message: m }) : undefined}
                onUnhide={isAdmin && m.hidden_at ? () => setPendingAction({ action: "unhide", message: m }) : undefined}
              />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
      <ForwardDialog workspaceId={workspaceId} message={forwardOf} onClose={() => setForwardOf(null)} />
      {pendingAction && (
        <Modal
          open
          size="sm"
          onClose={() => !messageAction.isPending && setPendingAction(null)}
          title={ACTION_COPY[pendingAction.action].title}
          footer={
            <>
              <Button variant="secondary" onClick={() => setPendingAction(null)} disabled={messageAction.isPending}>Cancelar</Button>
              <Button
                variant={pendingAction.action === "unhide" ? "primary" : "danger"}
                loading={messageAction.isPending}
                onClick={async () => {
                  const { action, message } = pendingAction;
                  try {
                    await messageAction.mutateAsync({ action, messageId: message.id });
                    toast.success(ACTION_COPY[action].success);
                    setPendingAction(null);
                  } catch (err) {
                    toast.error(err);
                  }
                }}
              >
                {ACTION_COPY[pendingAction.action].confirm}
              </Button>
            </>
          }
        >
          <p className="text-sm text-slate-600 dark:text-slate-300">{ACTION_COPY[pendingAction.action].description}</p>
          {pendingAction.message.content && (
            <p className="mt-2 line-clamp-3 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">{pendingAction.message.content}</p>
          )}
        </Modal>
      )}
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
                onCreate={isAdmin ? () => { setQuickOpen(false); setNewQuickOpen(true); } : undefined}
              />
            )}
            {quickMedia && (
              <div className="mb-2 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800">
                <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1 truncate">{quickMedia.fileName}</span>
                <button type="button" className="underline" onClick={() => setQuickMedia(null)}>Remover</button>
              </div>
            )}
            {attachments.length > 0 && (
              <ul aria-label="Anexos" className="mb-2 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800">
                {attachments.map((file, i) => (
                  <li key={`${file.name}-${file.size}-${i}`} className="flex items-center gap-2">
                    {attachmentUrl ? <Mic className="h-3.5 w-3.5 shrink-0 text-slate-400" /> : <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
                    {attachmentUrl ? (
                      <audio controls src={attachmentUrl} aria-label="Ouvir o áudio antes de enviar" className="h-8 min-w-0 flex-1" />
                    ) : (
                      <span className="min-w-0 flex-1 truncate">{file.name}</span>
                    )}
                    <button type="button" className="underline" onClick={() => removeAttachment(i)} aria-label={`Remover ${file.name}`}>Remover</button>
                  </li>
                ))}
                {attachments.length > 1 && (
                  <li className="flex items-center justify-between gap-2 pt-1 text-slate-500">
                    <span>{attachments.length} arquivos, um por mensagem, na ordem acima.</span>
                    <button type="button" className="underline" onClick={() => setAttachments([])}>Remover todos</button>
                  </li>
                )}
              </ul>
            )}
            {recording ? (
              <VoiceRecorder
                onRecorded={(file) => { setRecording(false); pickFiles([file]); textRef.current?.focus(); }}
                onCancel={() => { setRecording(false); textRef.current?.focus(); }}
              />
            ) : (
            <div className="flex items-end gap-2">
            <input ref={fileRef} type="file" multiple className="hidden" aria-label="Anexar arquivos" onChange={(e) => pickFiles(Array.from(e.target.files ?? []))} accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip" />
            <Button type="button" variant="ghost" onClick={() => fileRef.current?.click()} aria-label="Anexar" title={`Anexar arquivos (até ${MAX_FILES_PER_SEND} por vez, 20 MB cada)`}>
              <Paperclip className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" onClick={() => setPhotosOpen(true)} aria-label="Fotos" title="Enviar fotos da galeria">
              <ImageIcon className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" onClick={() => setQuickOpen((v) => !v)} aria-label="Respostas rápidas" title="Respostas rápidas (ou digite /)">
              <Zap className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" onClick={() => { setQuickOpen(false); setRecording(true); }} aria-label="Gravar áudio" title="Gravar mensagem de voz (até 5 min)">
              <Mic className="h-4 w-4" />
            </Button>
            <textarea
              ref={textRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "s") {
                  // Salvar o texto escrito como resposta rápida (admin).
                  e.preventDefault();
                  if (isAdmin) setNewQuickOpen(true);
                  else toast.error("Só administradores criam respostas rápidas. Peça em Equipe → Respostas rápidas.");
                }
              }}
              rows={1}
              placeholder={attachmentUrl ? "Texto junto com o áudio (opcional)…" : attachments.length > 1 ? "Legenda do primeiro arquivo (opcional)…" : attachments.length > 0 || quickMedia ? "Legenda (opcional)…" : conversation.mode === "bot" ? "Responder (assume a conversa do bot)…" : "Escreva uma mensagem… (/ para respostas rápidas)"}
              className="max-h-40 min-h-[2.5rem] min-w-0 flex-1 resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 dark:border-slate-700 dark:bg-slate-900"
            />
            <Button type="submit" loading={send.isPending || uploading} disabled={!text.trim() && attachments.length === 0 && !quickMedia} aria-label="Enviar">
              <Send className="h-4 w-4" />
              <span className="hidden sm:inline">Enviar</span>
            </Button>
            </div>
            )}
            {newQuickOpen && (
              <QuickReplyModal workspaceId={workspaceId} reply={null} existing={quickReplies.data ?? []} initialContent={text} onClose={() => { setNewQuickOpen(false); textRef.current?.focus(); }} />
            )}
          </form>
        )}
      </footer>
    </>
  );
}
