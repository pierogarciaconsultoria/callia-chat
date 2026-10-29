import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { invokeFunction, unwrap } from "@/lib/functions";
import type { Conversation, ConversationMode, Message } from "@/lib/database.types";

export interface ConversationFilters {
  instanceId: string | "all";
  mode: ConversationMode | "all";
}

export const conversationsKey = (workspaceId: string) => ["conversations", workspaceId] as const;
export const messagesKey = (conversationId: string) => ["messages", conversationId] as const;

const PAGE = 200;

export function useConversations(workspaceId: string) {
  return useQuery({
    queryKey: conversationsKey(workspaceId),
    queryFn: async () =>
      unwrap(
        await supabase
          .from("conversations")
          .select("*")
          .eq("workspace_id", workspaceId)
          .order("last_message_at", { ascending: false, nullsFirst: false })
          .limit(PAGE),
      ) as Conversation[],
  });
}

export function useMessages(conversationId: string | null) {
  return useQuery({
    queryKey: messagesKey(conversationId ?? "none"),
    enabled: Boolean(conversationId),
    // As 500 mais recentes, exibidas em ordem cronológica.
    queryFn: async () =>
      (unwrap(
        await supabase
          .from("messages")
          .select("*")
          .eq("conversation_id", conversationId!)
          .order("created_at", { ascending: false })
          .order("seq", { ascending: false })
          .limit(500),
      ) as Message[]).reverse(),
  });
}

function sortConversations(list: Conversation[]) {
  return [...list].sort((a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? ""));
}

export function upsertConversationInCache(qc: QueryClient, workspaceId: string, row: Conversation) {
  qc.setQueryData<Conversation[]>(conversationsKey(workspaceId), (prev) => {
    if (!prev) return prev;
    const rest = prev.filter((c) => c.id !== row.id);
    return sortConversations([row, ...rest]);
  });
}

function upsertMessageInCache(qc: QueryClient, row: Message) {
  qc.setQueryData<Message[]>(messagesKey(row.conversation_id), (prev) => {
    if (!prev) return prev;
    const idx = prev.findIndex((m) => m.id === row.id);
    if (idx >= 0) {
      const next = [...prev];
      next[idx] = row;
      return next;
    }
    return [...prev, row].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.seq - b.seq);
  });
}

// Realtime: conversas e mensagens do workspace atualizam os caches do TanStack Query.
export function useInboxRealtime(workspaceId: string) {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel(`inbox:${workspaceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations", filter: `workspace_id=eq.${workspaceId}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const oldId = (payload.old as Partial<Conversation>).id;
            qc.setQueryData<Conversation[]>(conversationsKey(workspaceId), (prev) => prev?.filter((c) => c.id !== oldId));
            return;
          }
          upsertConversationInCache(qc, workspaceId, payload.new as Conversation);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `workspace_id=eq.${workspaceId}` },
        (payload) => {
          if (payload.eventType === "DELETE") return;
          upsertMessageInCache(qc, payload.new as Message);
        },
      )
      .subscribe((status) => {
        // Ao reconectar, recarrega para não perder eventos durante a queda.
        if (status === "SUBSCRIBED") void qc.invalidateQueries({ queryKey: conversationsKey(workspaceId) });
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [workspaceId, qc]);
}

export function useUpdateConversation(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<Pick<Conversation, "mode" | "unread_count" | "assigned_user_id" | "handoff_at">>;
    }) => unwrap(await supabase.from("conversations").update(patch).eq("id", id).select("*").single()) as Conversation,
    onSuccess: (row) => upsertConversationInCache(qc, workspaceId, row),
  });
}

export interface SendMessageVars {
  /** Conversa existente… */
  conversationId?: string;
  /** …ou número novo (com workspaceId): a conversa é criada ou reaproveitada pelo telefone. */
  workspaceId?: string;
  toPhone?: string;
  contactName?: string;
  text?: string;
  /** Anexo já gravado no bucket inbox-media (ver uploadAttachment). */
  mediaPath?: string;
  fileName?: string;
  mimetype?: string;
  type?: "text" | "image" | "video" | "audio" | "document";
  /** Reenvia o conteúdo de outra mensagem. */
  forwardMessageId?: string;
}

export interface SendMessageResult {
  message: Message;
  conversation_id: string;
  created: boolean;
}

export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: SendMessageVars) =>
      invokeFunction<SendMessageResult>("send-message", {
        conversation_id: vars.conversationId,
        workspace_id: vars.workspaceId,
        to_phone: vars.toPhone,
        contact_name: vars.contactName,
        type: vars.type ?? (vars.mediaPath || vars.forwardMessageId ? undefined : "text"),
        text: vars.text,
        media_path: vars.mediaPath,
        file_name: vars.fileName,
        mimetype: vars.mimetype,
        forward_message_id: vars.forwardMessageId,
      }),
    onSuccess: (res, vars) => {
      if (res?.message) upsertMessageInCache(qc, res.message);
      // Conversa nova ou de outro número: a lista precisa recarregar.
      if (res?.created || vars.toPhone || (vars.conversationId && res?.conversation_id !== vars.conversationId)) {
        void qc.invalidateQueries({ queryKey: ["conversations"] });
      }
    },
  });
}
