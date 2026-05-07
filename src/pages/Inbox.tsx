import { FormEvent, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Bot,
  MessageSquare,
  Phone,
  RefreshCcw,
  Send,
  UserRound,
  Wifi,
} from "lucide-react";
import { useInbox } from "@/hooks/use-inbox";
import {
  formatPhoneLabel,
  getConversationPreviewFromConversation,
  getConversationSecondaryLabel,
  getConversationTitle,
  getMessageActorLabel,
  getMessageContent,
  getMessageTypeLabel,
  getModeBadgeLabel,
  getModeBadgeTone,
} from "@/lib/inbox";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Sem data";

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatTime(value: string | null | undefined) {
  if (!value) return "--:--";

  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function InboxPage() {
  const {
    currentWorkspace,
    loading,
    messagesLoading,
    actionLoading,
    instances,
    conversations,
    selectedConversation,
    messages,
    query,
    instanceFilter,
    modeFilter,
    setQuery,
    setInstanceFilter,
    setModeFilter,
    setSelectedConversationId,
    refreshConversations,
    assumeConversation,
    returnToBot,
    sendManualMessage,
  } = useInbox();
  const [draft, setDraft] = useState("");

  const canSendManual = selectedConversation?.mode === "human";
  const conversationSummary = useMemo(() => {
    const totalUnread = conversations.reduce((total, item) => total + (item.unread_count ?? 0), 0);
    return {
      count: conversations.length,
      unread: totalUnread,
    };
  }, [conversations]);

  const handleRefresh = async () => {
    try {
      await refreshConversations();
      toast.success("Inbox atualizada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel atualizar a inbox.");
    }
  };

  const handleAssumeConversation = async () => {
    try {
      await assumeConversation();
      toast.success("Conversa assumida pelo atendimento humano.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel assumir a conversa.");
    }
  };

  const handleReturnToBot = async () => {
    try {
      await returnToBot();
      toast.success("Conversa devolvida ao bot.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel devolver a conversa ao bot.");
    }
  };

  const handleSend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.trim()) return;

    try {
      await sendManualMessage(draft);
      setDraft("");
      toast.success("Mensagem enviada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel enviar a mensagem.");
    }
  };

  if (!currentWorkspace) {
    return (
      <div className="p-8">
        <Card>
          <CardHeader>
            <CardTitle>Inbox</CardTitle>
            <CardDescription>Selecione um workspace para abrir as conversas.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <div className="border-b bg-background/95 px-6 py-4 backdrop-blur">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Inbox</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Operacao humana em tempo real com fila por workspace, filtro por instancia e transicao entre bot e atendente.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="gap-1">
              <MessageSquare className="h-3.5 w-3.5" />
              {conversationSummary.count} conversas
            </Badge>
            <Badge variant="outline">{conversationSummary.unread} nao lidas</Badge>
            <Badge variant="outline" className="gap-1 text-emerald-700">
              <Wifi className="h-3.5 w-3.5" />
              Realtime ativo
            </Badge>
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={loading || actionLoading}>
              <RefreshCcw className="h-4 w-4" />
              Atualizar
            </Button>
          </div>
        </div>
      </div>

      <div className="grid flex-1 overflow-hidden lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="border-r bg-card/40">
          <div className="space-y-4 border-b p-4">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por nome, telefone ou instancia"
            />
            <div className="grid grid-cols-2 gap-3">
              <Select value={instanceFilter} onValueChange={setInstanceFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Instancia" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {instances.map((instance) => (
                    <SelectItem key={instance.id} value={instance.id}>
                      {instance.display_name || instance.instance_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={modeFilter} onValueChange={(value) => setModeFilter(value as "all" | "bot" | "human")}>
                <SelectTrigger>
                  <SelectValue placeholder="Modo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="bot">Bot</SelectItem>
                  <SelectItem value="human">Humano</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <ScrollArea className="h-[calc(100vh-220px)]">
            <div className="divide-y">
              {loading ? (
                <div className="p-4 text-sm text-muted-foreground">Carregando conversas...</div>
              ) : conversations.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">
                  Nenhuma conversa encontrada com os filtros atuais.
                </div>
              ) : (
                conversations.map((conversation) => {
                  const isActive = selectedConversation?.id === conversation.id;

                  return (
                    <button
                      key={conversation.id}
                      type="button"
                      onClick={() => setSelectedConversationId(conversation.id)}
                      className={cn(
                        "w-full px-4 py-3 text-left transition-colors hover:bg-accent/60",
                        isActive && "bg-accent",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate font-medium">{getConversationTitle(conversation)}</div>
                          <div className="mt-1 truncate text-xs text-muted-foreground">
                            {getConversationSecondaryLabel(conversation)}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <div className="text-xs text-muted-foreground">
                            {formatTime(conversation.last_message_at)}
                          </div>
                          {conversation.unread_count > 0 ? (
                            <Badge className="bg-primary text-primary-foreground">
                              {conversation.unread_count}
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        <Badge variant="outline" className={getModeBadgeTone(conversation.mode)}>
                          {getModeBadgeLabel(conversation.mode)}
                        </Badge>
                        {conversation.assigned_agent_id ? (
                          <Badge variant="outline">Assumida</Badge>
                        ) : null}
                      </div>
                      <div className="mt-3 line-clamp-2 text-sm text-muted-foreground">
                        {getConversationPreviewFromConversation(conversation)}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </aside>

        <section className="flex min-h-0 flex-col">
          {!selectedConversation ? (
            <div className="flex h-full items-center justify-center p-8">
              <Card className="max-w-xl">
                <CardHeader>
                  <CardTitle>Nenhuma conversa selecionada</CardTitle>
                  <CardDescription>
                    Escolha uma conversa na fila para ver o historico, assumir o atendimento humano e enviar respostas manuais.
                  </CardDescription>
                </CardHeader>
              </Card>
            </div>
          ) : (
            <>
              <div className="border-b p-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                  <div className="flex items-start gap-3">
                    <Avatar className="h-11 w-11">
                      <AvatarFallback>
                        {(selectedConversation.customer_name?.[0] || selectedConversation.customer_phone?.[0] || "?").toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-xl font-semibold">{getConversationTitle(selectedConversation)}</h2>
                        <Badge variant="outline" className={getModeBadgeTone(selectedConversation.mode)}>
                          {getModeBadgeLabel(selectedConversation.mode)}
                        </Badge>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Phone className="h-3.5 w-3.5" />
                          {formatPhoneLabel(selectedConversation.customer_phone)}
                        </span>
                        <span>
                          Instancia:{" "}
                          {selectedConversation.whatsapp_instance?.display_name ||
                            selectedConversation.whatsapp_instance?.instance_name ||
                            "Sem instancia"}
                        </span>
                        <span>Ultima atividade: {formatDateTime(selectedConversation.last_message_at)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {selectedConversation.mode === "bot" ? (
                      <Button onClick={handleAssumeConversation} disabled={actionLoading}>
                        <UserRound className="h-4 w-4" />
                        Assumir conversa
                      </Button>
                    ) : (
                      <Button variant="outline" onClick={handleReturnToBot} disabled={actionLoading}>
                        <Bot className="h-4 w-4" />
                        Devolver ao bot
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              <ScrollArea className="flex-1 bg-muted/20">
                <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-5">
                  {messagesLoading ? (
                    <div className="text-sm text-muted-foreground">Carregando historico...</div>
                  ) : messages.length === 0 ? (
                    <Card>
                      <CardHeader>
                        <CardTitle>Sem mensagens ainda</CardTitle>
                        <CardDescription>A thread ficara disponivel assim que houver trafego nessa conversa.</CardDescription>
                      </CardHeader>
                    </Card>
                  ) : (
                    messages.map((message) => {
                      const outbound = message.direction === "outbound";
                      const content = getMessageContent(message);

                      return (
                        <div
                          key={message.id}
                          className={cn("flex", outbound ? "justify-end" : "justify-start")}
                        >
                          <div
                            className={cn(
                              "max-w-[82%] rounded-2xl border px-4 py-3 shadow-sm",
                              outbound
                                ? "border-primary/20 bg-primary text-primary-foreground"
                                : "border-border bg-background",
                            )}
                          >
                            <div className="mb-2 flex items-center gap-2 text-xs opacity-80">
                              <span>{getMessageActorLabel(message)}</span>
                              <span>•</span>
                              <span>{getMessageTypeLabel(message)}</span>
                              <span>•</span>
                              <span>{formatDateTime(message.created_at)}</span>
                            </div>
                            <div className="whitespace-pre-wrap break-words text-sm">
                              {content || "Mensagem sem conteudo textual"}
                            </div>
                            {message.media_url ? (
                              <div className="mt-2 text-xs opacity-80">
                                Midia:{" "}
                                <a
                                  href={message.media_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="underline underline-offset-2"
                                >
                                  abrir anexo
                                </a>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </ScrollArea>

              <div className="border-t bg-background p-5">
                {selectedConversation.mode !== "human" ? (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    Esta conversa esta em modo `bot`. Assuma a conversa para liberar o envio manual do atendente.
                  </div>
                ) : null}

                <form onSubmit={handleSend} className="mt-4 space-y-3">
                  <Textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    disabled={!canSendManual || actionLoading}
                    placeholder={
                      canSendManual
                        ? "Digite a resposta do atendente..."
                        : "Assuma a conversa para responder manualmente"
                    }
                    className="min-h-[110px]"
                  />
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-muted-foreground">
                      {canSendManual
                        ? "O envio manual usa o mesmo pipeline outbound da plataforma."
                        : "Modo bot ativo. O atendimento manual fica bloqueado ate a conversa ser assumida."}
                    </div>
                    <Button type="submit" disabled={!canSendManual || !draft.trim() || actionLoading}>
                      <Send className="h-4 w-4" />
                      Enviar mensagem
                    </Button>
                  </div>
                </form>
              </div>
            </>
          )}
        </section>
      </div>
      <Separator />
    </div>
  );
}
