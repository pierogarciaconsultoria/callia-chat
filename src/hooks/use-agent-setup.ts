import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invokeFunction } from "@/lib/functions";
import type { AgentSetupContent, AgentSetupDraft, KnowledgeSource, SetupApplyResult, SetupSections } from "@/lib/database.types";
import { agentConfigKey } from "./use-agent-config";
import { faqsKey, productsKey, sourcesKey } from "./use-knowledge";
import { invalidateEntitlements } from "./use-entitlements";

export const setupDraftsKey = (ws: string) => ["agent_setup_drafts", ws] as const;

export function useSetupDrafts(workspaceId: string) {
  return useQuery({
    queryKey: setupDraftsKey(workspaceId),
    queryFn: async () =>
      (await invokeFunction<{ drafts: AgentSetupDraft[] }>("agent-setup", { action: "list_drafts", workspace_id: workspaceId })).drafts ?? [],
  });
}

export function useAgentSetupActions(workspaceId: string) {
  const qc = useQueryClient();
  const sourcesChanged = () => {
    void qc.invalidateQueries({ queryKey: sourcesKey(workspaceId) });
    invalidateEntitlements(qc, workspaceId);
  };

  const importSite = useMutation({
    mutationFn: (vars: { url: string; max_pages: number }) =>
      invokeFunction<{ source: KnowledgeSource }>("agent-setup", { action: "import_site", workspace_id: workspaceId, ...vars }),
    onSuccess: sourcesChanged,
  });

  const importInstagram = useMutation({
    mutationFn: (vars: { profile: string; pasted_text?: string }) =>
      invokeFunction<{ source: KnowledgeSource; fetched: boolean; note: string | null }>("agent-setup", {
        action: "import_instagram",
        workspace_id: workspaceId,
        ...vars,
      }),
    onSuccess: sourcesChanged,
  });

  const generate = useMutation({
    mutationFn: (vars: { source_ids: string[]; extra_text?: string }) =>
      invokeFunction<{ draft: AgentSetupDraft }>("agent-setup", { action: "generate", workspace_id: workspaceId, ...vars }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: setupDraftsKey(workspaceId) }),
  });

  const apply = useMutation({
    mutationFn: (vars: { draft_id: string; draft: AgentSetupContent; sections: SetupSections }) =>
      invokeFunction<SetupApplyResult>("agent-setup", { action: "apply", ...vars }),
    onSuccess: () => {
      for (const key of [agentConfigKey(workspaceId), faqsKey(workspaceId), productsKey(workspaceId), sourcesKey(workspaceId), setupDraftsKey(workspaceId)]) {
        void qc.invalidateQueries({ queryKey: key });
      }
    },
  });

  const discard = useMutation({
    mutationFn: (draftId: string) => invokeFunction<{ ok: true }>("agent-setup", { action: "discard", draft_id: draftId }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: setupDraftsKey(workspaceId) }),
  });

  return { importSite, importInstagram, generate, apply, discard };
}
