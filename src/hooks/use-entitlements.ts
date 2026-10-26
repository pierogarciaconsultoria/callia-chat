import { useQuery, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/functions";
import { useWorkspace } from "@/lib/workspace";
import type { Entitlements, PlatformSettings } from "@/lib/database.types";

export const entitlementsKey = (workspaceId: string | null) => ["entitlements", workspaceId] as const;

/** Plano, limites, uso e status do workspace atual (rpc get_workspace_entitlements). */
export function useEntitlements() {
  const { workspaceId } = useWorkspace();
  return useQuery({
    queryKey: entitlementsKey(workspaceId),
    enabled: Boolean(workspaceId),
    refetchInterval: 60_000,
    queryFn: async () =>
      unwrap(await supabase.rpc("get_workspace_entitlements", { p_workspace_id: workspaceId })) as Entitlements,
  });
}

export function invalidateEntitlements(qc: QueryClient, workspaceId: string | null) {
  void qc.invalidateQueries({ queryKey: entitlementsKey(workspaceId) });
}

const SETTINGS_DEFAULTS: PlatformSettings = {
  allow_self_service_workspaces: false,
  self_service_plan_code: "trial",
  trial_days: 14,
  platform_name: "Callia Chat",
  support_email: null,
};

/** Configurações públicas da plataforma (tabela platform_settings, legível por usuários logados). */
export function usePlatformSettings(enabled = true) {
  return useQuery({
    queryKey: ["platform-settings"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const rows = unwrap(await supabase.from("platform_settings").select("key, value")) as { key: string; value: unknown }[];
      const out: Record<string, unknown> = { ...SETTINGS_DEFAULTS };
      for (const r of rows) out[r.key] = r.value;
      return out as unknown as PlatformSettings;
    },
  });
}
