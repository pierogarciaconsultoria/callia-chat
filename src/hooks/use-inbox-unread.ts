// Quantas conversas têm mensagens não lidas, para o selo ao lado de "Inbox" no menu (vale em qualquer tela).
// Conversas encerradas não contam. Atualiza por realtime na tabela conversations e, por garantia, a cada minuto.
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export const inboxUnreadKey = (workspaceId: string) => ["inbox_unread_count", workspaceId] as const;

export function useInboxUnreadCount(workspaceId: string | null) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: inboxUnreadKey(workspaceId ?? ""),
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId!)
        .gt("unread_count", 0)
        .neq("mode", "closed");
      if (error) throw error;
      return count ?? 0;
    },
  });

  useEffect(() => {
    if (!workspaceId) return;
    const channel = supabase
      .channel(`inbox-unread:${workspaceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter: `workspace_id=eq.${workspaceId}` }, () => {
        void qc.invalidateQueries({ queryKey: inboxUnreadKey(workspaceId) });
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void qc.invalidateQueries({ queryKey: inboxUnreadKey(workspaceId) });
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [workspaceId, qc]);

  return query;
}
