import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/functions";
import type { AgentConfig } from "@/lib/database.types";

export const agentConfigKey = (workspaceId: string) => ["agent_config", workspaceId] as const;

export function useAgentConfig(workspaceId: string) {
  return useQuery({
    queryKey: agentConfigKey(workspaceId),
    queryFn: async () =>
      unwrap(await supabase.from("agent_configs").select("*").eq("workspace_id", workspaceId).maybeSingle()) as AgentConfig | null,
  });
}

export type AgentConfigPatch = Omit<AgentConfig, "workspace_id" | "updated_at">;

export function useSaveAgentConfig(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: AgentConfigPatch) =>
      unwrap(
        await supabase.from("agent_configs").update(patch).eq("workspace_id", workspaceId).select("*").single(),
      ) as AgentConfig,
    onSuccess: (row) => qc.setQueryData(agentConfigKey(workspaceId), row),
  });
}
