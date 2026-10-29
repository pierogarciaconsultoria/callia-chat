import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/functions";
import type { QuickReply } from "@/lib/database.types";

export const quickRepliesKey = (ws: string) => ["quick-replies", ws] as const;

export function useQuickReplies(workspaceId: string | null) {
  return useQuery({
    queryKey: quickRepliesKey(workspaceId ?? ""),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
    queryFn: async () => unwrap(await supabase.from("quick_replies").select("*").eq("workspace_id", workspaceId!).order("shortcut")) as QuickReply[],
  });
}

export type QuickReplyInput = Pick<QuickReply, "shortcut" | "title" | "content"> & Partial<Pick<QuickReply, "media_path" | "media_name" | "media_mime">>;

export function useQuickReplyActions(workspaceId: string) {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: quickRepliesKey(workspaceId) });
  const save = useMutation({
    mutationFn: async ({ id, ...input }: QuickReplyInput & { id?: string }) => {
      const row = { workspace_id: workspaceId, media_path: null, media_name: null, media_mime: null, ...input };
      const q = id
        ? supabase.from("quick_replies").update(row).eq("id", id)
        : supabase.from("quick_replies").insert(row);
      return unwrap(await q.select("*").single()) as QuickReply;
    },
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from("quick_replies").delete().eq("id", id)),
    onSuccess: refresh,
  });
  return { save, remove };
}
