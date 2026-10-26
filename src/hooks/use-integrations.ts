import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invokeFunction } from "@/lib/functions";
import type { AvailabilityTest, Integration, IntegrationKind } from "@/lib/database.types";
import { productsKey } from "./use-knowledge";
import { invalidateEntitlements } from "./use-entitlements";

export const integrationsKey = (workspaceId: string) => ["integrations", workspaceId] as const;

export function useIntegrations(workspaceId: string | null, enabled = true) {
  return useQuery({
    queryKey: integrationsKey(workspaceId ?? "none"),
    enabled: Boolean(workspaceId) && enabled,
    queryFn: async () =>
      (await invokeFunction<{ integrations: Integration[] }>("integrations", { action: "list", workspace_id: workspaceId })).integrations ?? [],
    // Enquanto alguma integração está pendente (ex.: aguardando QR), atualiza sozinho.
    refetchInterval: (q) => (q.state.data?.some((i) => i.status === "pending") ? 5000 : false),
  });
}

export function findIntegration(list: Integration[] | undefined, kind: IntegrationKind): Integration | undefined {
  return list?.find((i) => i.kind === kind);
}

export interface TestVars {
  kind: "hospedin" | "hbook";
  checkin?: string;
  checkout?: string;
  adults?: number;
  children_ages?: number[];
}

export function useIntegrationActions(workspaceId: string) {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: integrationsKey(workspaceId) });
  const call = <T,>(action: string, vars: Record<string, unknown> = {}) =>
    invokeFunction<T>("integrations", { action, workspace_id: workspaceId, ...vars });

  const connectHospedin = useMutation({
    mutationFn: (vars: { email: string; password: string; account_id?: string }) =>
      call<{ integration: Integration; test: AvailabilityTest | null }>("connect_hospedin", vars),
    onSuccess: refresh,
  });
  const test = useMutation({
    mutationFn: (vars: TestVars) => call<{ test: AvailabilityTest }>("test", vars as unknown as Record<string, unknown>),
    onSettled: refresh,
  });
  const syncCatalog = useMutation({
    mutationFn: () => call<{ created: number; updated: number }>("sync_catalog"),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: productsKey(workspaceId) });
      invalidateEntitlements(qc, workspaceId);
    },
  });
  const setPriceUnit = useMutation({
    mutationFn: (unit: "reais" | "cents") => call<{ integration: Integration }>("set_price_unit", { unit }),
    onSuccess: refresh,
  });
  const saveBookingLink = useMutation({
    mutationFn: (booking_link: string) => call<{ integration: Integration }>("save_booking_link", { booking_link }),
    onSuccess: refresh,
  });
  const disconnect = useMutation({
    mutationFn: (kind: IntegrationKind) => call<{ ok: true }>("disconnect", { kind }),
    onSuccess: refresh,
  });

  return { connectHospedin, test, syncCatalog, setPriceUnit, saveBookingLink, disconnect, refresh };
}
