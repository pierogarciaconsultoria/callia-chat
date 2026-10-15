import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/lib/workspace";
import type { WhatsAppInstanceForm, WhatsAppInstanceRecord } from "@/lib/whatsapp-instances";

type EvolutionConnectAction =
  | "create_instance"
  | "connect_instance"
  | "refresh_status"
  | "disconnect_instance";

async function invokeEvolutionConnect(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("evolution-connect", { body });
  if (error) throw error;
  return data as Record<string, unknown>;
}

export function useWhatsAppInstances() {
  const { currentWorkspace, canManage: canEdit } = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [instances, setInstances] = useState<WhatsAppInstanceRecord[]>([]);

  const refresh = useCallback(async () => {
    if (!currentWorkspace) {
      setInstances([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("whatsapp_instances")
      .select("*")
      .eq("workspace_id", currentWorkspace.id)
      .order("created_at", { ascending: true });

    if (error) throw error;
    setInstances((data ?? []) as WhatsAppInstanceRecord[]);
    setLoading(false);
  }, [currentWorkspace]);

  useEffect(() => {
    refresh().catch(() => setLoading(false));
  }, [refresh]);

  const saveInstance = useCallback(
    async (instanceId: string | null, form: WhatsAppInstanceForm) => {
      if (!currentWorkspace) return null;

      const payload = {
        instance_name: form.instance_name.trim(),
        display_name: form.display_name.trim() || null,
        evolution_base_url: form.evolution_base_url.trim() || null,
        provider_secret_ref: form.provider_secret_ref.trim() || null,
        phone_number: form.phone_number.trim() || null,
        provider_type: "evolution",
      };

      const builder = instanceId
        ? (supabase as any).from("whatsapp_instances").update(payload).eq("id", instanceId)
        : (supabase as any)
            .from("whatsapp_instances")
            .insert({
              ...payload,
              workspace_id: currentWorkspace.id,
            });

      const { data, error } = await builder.select("*").single();

      if (error) throw error;

      if (form.is_default) {
        await (supabase as any).rpc("set_default_whatsapp_instance", {
          p_workspace_id: currentWorkspace.id,
          p_instance_id: data.id,
        });
      }

      await refresh();
      return data as WhatsAppInstanceRecord;
    },
    [currentWorkspace, refresh],
  );

  const deleteInstance = useCallback(
    async (instanceId: string) => {
      await (supabase as any).from("whatsapp_instances").delete().eq("id", instanceId);
      await refresh();
    },
    [refresh],
  );

  const setDefaultInstance = useCallback(
    async (instanceId: string) => {
      if (!currentWorkspace) return;
      const { error } = await (supabase as any).rpc("set_default_whatsapp_instance", {
        p_workspace_id: currentWorkspace.id,
        p_instance_id: instanceId,
      });
      if (error) throw error;
      await refresh();
    },
    [currentWorkspace, refresh],
  );

  const rotateWebhookToken = useCallback(
    async (instanceId: string) => {
      if (!currentWorkspace) return null;
      const { data, error } = await (supabase as any).rpc("rotate_whatsapp_webhook_token", {
        p_workspace_id: currentWorkspace.id,
        p_instance_id: instanceId,
      });
      if (error) throw error;
      await refresh();
      return data as string;
    },
    [currentWorkspace, refresh],
  );

  const syncWithEvolution = useCallback(
    async (action: EvolutionConnectAction, instanceId: string, form?: Partial<WhatsAppInstanceForm>) => {
      if (!currentWorkspace) return null;
      const data = await invokeEvolutionConnect({
        action,
        workspaceId: currentWorkspace.id,
        instanceId,
        payload: form,
      });
      await refresh();
      return data;
    },
    [currentWorkspace, refresh],
  );

  const bootstrapInstance = useCallback(
    async (form: WhatsAppInstanceForm) => {
      if (!currentWorkspace) return null;
      const data = await invokeEvolutionConnect({
        action: "create_instance",
        workspaceId: currentWorkspace.id,
        payload: form,
      });
      await refresh();
      return data;
    },
    [currentWorkspace, refresh],
  );

  return {
    currentWorkspace,
    instances,
    loading,
    canEdit,
    refresh,
    saveInstance,
    deleteInstance,
    setDefaultInstance,
    rotateWebhookToken,
    syncWithEvolution,
    bootstrapInstance,
  };
}
