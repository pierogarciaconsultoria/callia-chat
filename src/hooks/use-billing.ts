// Assinatura do plano (Mercado Pago): status, checkout, sincronização ao voltar do pagamento e cancelamento.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invokeFunction } from "@/lib/functions";
import type { BillingStatus } from "@/lib/database.types";
import { invalidateEntitlements } from "./use-entitlements";

export const billingKey = (ws: string | null) => ["billing", ws] as const;

export function useBilling(workspaceId: string | null, enabled = true) {
  return useQuery({
    queryKey: billingKey(workspaceId),
    enabled: enabled && Boolean(workspaceId),
    queryFn: () => invokeFunction<BillingStatus>("billing", { action: "status", workspace_id: workspaceId }),
  });
}

export function useBillingActions(workspaceId: string | null) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: billingKey(workspaceId) });
    invalidateEntitlements(qc, workspaceId);
  };
  const checkout = useMutation({
    mutationFn: (plan_code: string) => invokeFunction<{ init_point: string }>("billing", { action: "checkout", workspace_id: workspaceId, plan_code }),
    onSuccess: refresh,
  });
  const sync = useMutation({
    mutationFn: () => invokeFunction<{ subscription: BillingStatus["subscription"] }>("billing", { action: "sync", workspace_id: workspaceId }),
    onSuccess: refresh,
  });
  const cancel = useMutation({
    mutationFn: () => invokeFunction<{ subscription: BillingStatus["subscription"] }>("billing", { action: "cancel", workspace_id: workspaceId }),
    onSuccess: refresh,
  });
  return { checkout, sync, cancel };
}
