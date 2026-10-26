import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { invokeFunction, unwrap } from "@/lib/functions";
import type { WhatsAppInstance } from "@/lib/database.types";
import { invalidateEntitlements } from "./use-entitlements";

// Colunas liberadas por GRANT para authenticated (hash do token fica oculto).
const INSTANCE_COLUMNS =
  "id, workspace_id, name, instance_name, provider, status, qr_code, qr_updated_at, phone_number, profile_name, is_default, last_connected_at, last_error, webhook_token_rotated_at, created_at, updated_at";

export const instancesKey = (workspaceId: string) => ["whatsapp_instances", workspaceId] as const;

export function useWhatsAppInstances(workspaceId: string, opts?: { refetchInterval?: number | false }) {
  return useQuery({
    queryKey: instancesKey(workspaceId),
    refetchInterval: opts?.refetchInterval,
    queryFn: async () =>
      unwrap(
        await supabase
          .from("whatsapp_instances")
          .select(INSTANCE_COLUMNS)
          .eq("workspace_id", workspaceId)
          .order("created_at"),
      ) as unknown as WhatsAppInstance[],
  });
}

export type InstanceAction = "connect" | "refresh" | "disconnect" | "delete" | "set_default" | "rotate_token";

export interface InstanceResponse {
  instance?: WhatsAppInstance;
  qr_code?: string | null;
  pairing_code?: string | null;
  deleted?: boolean;
}

export function useInstanceMutations(workspaceId: string) {
  const qc = useQueryClient();
  const sync = (res: InstanceResponse) => {
    qc.setQueryData<WhatsAppInstance[]>(instancesKey(workspaceId), (prev) => {
      if (!prev || !res.instance) return prev;
      const inst = { ...res.instance, qr_code: res.qr_code ?? res.instance.qr_code };
      const others = prev.map((i) => (inst.is_default && i.id !== inst.id ? { ...i, is_default: false } : i));
      return others.some((i) => i.id === inst.id) ? others.map((i) => (i.id === inst.id ? inst : i)) : [...others, inst];
    });
  };

  const create = useMutation({
    // phone (com DDI) pede código de pareamento em vez de QR.
    mutationFn: (vars: { name: string; make_default: boolean; phone?: string }) =>
      invokeFunction<InstanceResponse>("evolution-connect", { action: "create", workspace_id: workspaceId, ...vars }),
    onSuccess: (res) => {
      sync(res);
      void qc.invalidateQueries({ queryKey: instancesKey(workspaceId) });
      invalidateEntitlements(qc, workspaceId);
    },
  });

  const action = useMutation({
    mutationFn: (vars: { action: InstanceAction; instance_id: string; phone?: string }) =>
      invokeFunction<InstanceResponse>("evolution-connect", { workspace_id: workspaceId, ...vars }),
    onSuccess: (res, vars) => {
      if (vars.action === "delete") {
        invalidateEntitlements(qc, workspaceId);
        qc.setQueryData<WhatsAppInstance[]>(instancesKey(workspaceId), (prev) => prev?.filter((i) => i.id !== vars.instance_id));
        return;
      }
      sync(res);
      if (vars.action === "set_default") void qc.invalidateQueries({ queryKey: instancesKey(workspaceId) });
    },
  });

  return { create, action };
}
