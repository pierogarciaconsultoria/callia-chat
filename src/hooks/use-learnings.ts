// Aprendizados do atendimento: sugestões geradas das conversas, aprovação/descarte e análise a pedido.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { invokeFunction, unwrap } from "@/lib/functions";
import type { LearningRun, LearningStatus, LearningSuggestion } from "@/lib/database.types";

export const learningsKey = (ws: string, status: LearningStatus) => ["learnings", ws, status] as const;
export const learningRunsKey = (ws: string) => ["learning_runs", ws] as const;

export function useLearningSuggestions(workspaceId: string, status: LearningStatus) {
  return useQuery({
    queryKey: learningsKey(workspaceId, status),
    queryFn: async () =>
      unwrap(
        await supabase.from("learning_suggestions").select("*").eq("workspace_id", workspaceId).eq("status", status)
          .order(status === "pending" ? "occurrences" : "decided_at", { ascending: false }).order("created_at", { ascending: false }).limit(100),
      ) as LearningSuggestion[],
  });
}

/** Últimas análises (a mais recente primeiro). */
export function useLearningRuns(workspaceId: string, limit = 5) {
  return useQuery({
    queryKey: learningRunsKey(workspaceId),
    queryFn: async () =>
      unwrap(await supabase.from("learning_runs").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(limit)) as LearningRun[],
  });
}

/** Quantidade de sugestões aguardando decisão (para o selo no menu). */
export function usePendingLearningsCount(workspaceId: string | null) {
  return useQuery({
    queryKey: ["learnings_pending_count", workspaceId ?? ""],
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
    queryFn: async () => {
      const { count, error } = await supabase.from("learning_suggestions").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId!).eq("status", "pending");
      if (error) throw error;
      return count ?? 0;
    },
  });
}

export interface RunResult { run_id: string; conversations_analyzed: number; suggestions_created: number }

export function useLearningActions(workspaceId: string) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["learnings", workspaceId] });
    void qc.invalidateQueries({ queryKey: ["learnings_pending_count", workspaceId] });
    void qc.invalidateQueries({ queryKey: learningRunsKey(workspaceId) });
  };
  const run = useMutation({
    mutationFn: () => invokeFunction<RunResult>("learnings", { action: "run", workspace_id: workspaceId }),
    onSettled: refresh,
  });
  const apply = useMutation({
    mutationFn: (vars: { id: string; payload?: Record<string, unknown> }) =>
      invokeFunction<{ status: "applied"; kind: string }>("learnings", { action: "apply", workspace_id: workspaceId, suggestion_id: vars.id, ...(vars.payload ? { payload: vars.payload } : {}) }),
    onSuccess: () => {
      refresh();
      for (const key of ["faqs", "policies", "agent_config", "knowledge_sources"]) void qc.invalidateQueries({ queryKey: [key] });
    },
  });
  const dismiss = useMutation({
    mutationFn: (id: string) => invokeFunction<{ status: "dismissed" }>("learnings", { action: "dismiss", workspace_id: workspaceId, suggestion_id: id }),
    onSuccess: refresh,
  });
  return { run, apply, dismiss };
}
