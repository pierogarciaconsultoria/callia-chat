import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useWorkspace } from "@/lib/workspace";
import type { InboxConversation, InboxInstance, MessageRow } from "@/lib/inbox";
import { buildInboxClaimMetadata } from "@/lib/inbox-handoff";

type ModeFilter = "all" | "bot" | "human";

function asInboxInstances(data: any[]): InboxInstance[] {
  return (data ?? []).map((item) => ({
    id: item.id,
    instance_name: item.instance_name,
    display_name: item.display_name ?? null,
    phone_number: item.phone_number ?? null,
    status: item.status ?? null,
    is_default: Boolean(item.is_default),
  }));
}

function asInboxConversations(data: any[]): InboxConversation[] {
  return (data ?? []).map((item) => ({
    ...item,
    metadata:
      item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
        ? item.metadata
        : {},
    whatsapp_instance: item.whatsapp_instance
      ? {
          id: item.whatsapp_instance.id,
          instance_name: item.whatsapp_instance.instance_name,
          display_name: item.whatsapp_instance.display_name ?? null,
          phone_number: item.whatsapp_instance.phone_number ?? null,
          status: item.whatsapp_instance.status ?? null,
          is_default: Boolean(item.whatsapp_instance.is_default),
        }
      : null,
  }));
}

function asMessages(data: any[]): MessageRow[] {
  return (data ?? []).map((item) => ({
    ...item,
    metadata:
      item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
        ? item.metadata
        : {},
  }));
}

export function useInbox() {
  const { user } = useAuth();
  const { currentWorkspace, role } = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [instances, setInstances] = useState<InboxInstance[]>([]);
  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [instanceFilter, setInstanceFilter] = useState<string>("all");
  const [modeFilter, setModeFilter] = useState<ModeFilter>("all");
  const selectedConversationIdRef = useRef<string | null>(null);

  useEffect(() => {
    selectedConversationIdRef.current = selectedConversationId;
  }, [selectedConversationId]);

  const refreshInstances = useCallback(async () => {
    if (!currentWorkspace) {
      setInstances([]);
      return;
    }

    const { data, error } = await (supabase as any)
      .from("whatsapp_instances")
      .select("id, instance_name, display_name, phone_number, status, is_default")
      .eq("workspace_id", currentWorkspace.id)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true });

    if (error) throw error;
    setInstances(asInboxInstances(data ?? []));
  }, [currentWorkspace]);

  const refreshConversations = useCallback(async () => {
    if (!currentWorkspace) {
      setConversations([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const builder = (supabase as any)
      .from("conversations")
      .select(`
        *,
        whatsapp_instance:whatsapp_instances(
          id,
          instance_name,
          display_name,
          phone_number,
          status,
          is_default
        )
      `)
      .eq("workspace_id", currentWorkspace.id)
      .eq("is_closed", false)
      .order("last_message_at", { ascending: false });

    if (instanceFilter !== "all") {
      builder.eq("whatsapp_instance_id", instanceFilter);
    }

    if (modeFilter !== "all") {
      builder.eq("mode", modeFilter);
    }

    const { data, error } = await builder;
    if (error) throw error;

    setConversations(asInboxConversations(data ?? []));
    setLoading(false);
  }, [currentWorkspace, instanceFilter, modeFilter]);

  const refreshMessages = useCallback(async (conversationId: string | null) => {
    if (!currentWorkspace || !conversationId) {
      setMessages([]);
      setMessagesLoading(false);
      return;
    }

    setMessagesLoading(true);
    const { data, error } = await (supabase as any)
      .from("messages")
      .select("*")
      .eq("workspace_id", currentWorkspace.id)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    setMessages(asMessages(data ?? []));
    setMessagesLoading(false);
  }, [currentWorkspace]);

  useEffect(() => {
    refreshInstances().catch(() => setInstances([]));
  }, [refreshInstances]);

  useEffect(() => {
    refreshConversations().catch(() => {
      setConversations([]);
      setLoading(false);
    });
  }, [refreshConversations]);

  useEffect(() => {
    if (!currentWorkspace) {
      setSelectedConversationId(null);
      setMessages([]);
      return;
    }

    if (conversations.length === 0) {
      setSelectedConversationId(null);
      setMessages([]);
      return;
    }

    const selectedExists = conversations.some((conversation) => conversation.id === selectedConversationId);
    if (!selectedExists) {
      setSelectedConversationId(conversations[0].id);
    }
  }, [currentWorkspace, conversations, selectedConversationId]);

  useEffect(() => {
    refreshMessages(selectedConversationId).catch(() => {
      setMessages([]);
      setMessagesLoading(false);
    });
  }, [refreshMessages, selectedConversationId]);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId],
  );

  const filteredConversations = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return conversations;

    return conversations.filter((conversation) => {
      const haystack = [
        conversation.customer_name ?? "",
        conversation.customer_phone ?? "",
        conversation.whatsapp_instance?.display_name ?? "",
        conversation.whatsapp_instance?.instance_name ?? "",
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [conversations, query]);

  const patchConversation = useCallback(
    async (conversationId: string, patch: Record<string, unknown>) => {
      if (!currentWorkspace) return;

      const { error } = await (supabase as any)
        .from("conversations")
        .update(patch)
        .eq("workspace_id", currentWorkspace.id)
        .eq("id", conversationId);

      if (error) throw error;
      await refreshConversations();
    },
    [currentWorkspace, refreshConversations],
  );

  const markAsRead = useCallback(
    async (conversationId: string) => {
      const conversation = conversations.find((item) => item.id === conversationId);
      if (!conversation || conversation.unread_count === 0) return;

      await patchConversation(conversationId, { unread_count: 0 });
    },
    [conversations, patchConversation],
  );

  useEffect(() => {
    if (!selectedConversationId) return;
    markAsRead(selectedConversationId).catch(() => null);
  }, [markAsRead, selectedConversationId]);

  const assumeConversation = useCallback(async () => {
    if (!currentWorkspace || !selectedConversation || !user) return;

    setActionLoading(true);
    try {
      const { data: agentConfig } = await (supabase as any)
        .from("agent_configs")
        .select("human_pause_hours")
        .eq("workspace_id", currentWorkspace.id)
        .maybeSingle();
      const pauseHours =
        Number.isInteger(agentConfig?.human_pause_hours) && agentConfig.human_pause_hours > 0
          ? agentConfig.human_pause_hours
          : 12;

      await patchConversation(selectedConversation.id, {
        mode: "human",
        assigned_agent_id: user.id,
        unread_count: 0,
        metadata: buildInboxClaimMetadata(
          selectedConversation.metadata,
          user.id,
          pauseHours,
        ),
      });
    } finally {
      setActionLoading(false);
    }
  }, [currentWorkspace, patchConversation, selectedConversation, user]);

  const returnToBot = useCallback(async () => {
    if (!selectedConversation) return;

    setActionLoading(true);
    try {
      await patchConversation(selectedConversation.id, {
        mode: "bot",
        assigned_agent_id: null,
        metadata: {
          ...(selectedConversation.metadata ?? {}),
          returned_to_bot_at: new Date().toISOString(),
          returned_to_bot_by: user?.id ?? null,
          human_until: null,
        },
      });
    } finally {
      setActionLoading(false);
    }
  }, [patchConversation, selectedConversation, user?.id]);

  const sendManualMessage = useCallback(
    async (text: string) => {
      if (!currentWorkspace || !selectedConversation || !text.trim()) return;

      setActionLoading(true);
      try {
        const { error } = await supabase.functions.invoke("send-message", {
          body: {
            workspaceId: currentWorkspace.id,
            conversationId: selectedConversation.id,
            instanceId: selectedConversation.whatsapp_instance_id,
            phoneNumber: selectedConversation.customer_phone,
            text: text.trim(),
            sender: "agent",
            metadata: {
              sent_from: "inbox",
            },
          },
        });

        if (error) throw error;
        await Promise.all([
          refreshMessages(selectedConversation.id),
          patchConversation(selectedConversation.id, {
            unread_count: 0,
            mode: "human",
            assigned_agent_id: selectedConversation.assigned_agent_id ?? user?.id ?? null,
          }),
        ]);
      } finally {
        setActionLoading(false);
      }
    },
    [currentWorkspace, patchConversation, refreshMessages, selectedConversation, user?.id],
  );

  useEffect(() => {
    if (!currentWorkspace) return;

    const channel = supabase
      .channel(`inbox-${currentWorkspace.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversations",
          filter: `workspace_id=eq.${currentWorkspace.id}`,
        },
        () => {
          refreshConversations().catch(() => null);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `workspace_id=eq.${currentWorkspace.id}`,
        },
        (payload: any) => {
          const changedConversationId =
            payload.new?.conversation_id ?? payload.old?.conversation_id ?? null;

          refreshConversations().catch(() => null);
          if (changedConversationId && selectedConversationIdRef.current === changedConversationId) {
            refreshMessages(changedConversationId).catch(() => null);
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentWorkspace, refreshConversations, refreshMessages]);

  return {
    currentWorkspace,
    role,
    user,
    loading,
    messagesLoading,
    actionLoading,
    instances,
    conversations: filteredConversations,
    selectedConversation,
    selectedConversationId,
    messages,
    query,
    instanceFilter,
    modeFilter,
    setQuery,
    setInstanceFilter,
    setModeFilter,
    setSelectedConversationId,
    refreshConversations,
    markAsRead,
    assumeConversation,
    returnToBot,
    sendManualMessage,
  };
}
