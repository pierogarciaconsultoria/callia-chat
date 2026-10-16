import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/lib/workspace";

export type ReservationConnector = {
  id: string;
  company_id: string;
  currency: string;
  is_active: boolean;
};

export type ReservationConnectorInput = {
  company_id: string;
  currency: string;
  is_active: boolean;
};

function toConnector(row: Record<string, unknown>): ReservationConnector {
  const config = (row.config ?? {}) as Record<string, unknown>;
  return {
    id: String(row.id),
    company_id: String(config.company_id ?? ""),
    currency: String(config.currency ?? "BRL"),
    is_active: row.is_active !== false,
  };
}

// Own hook on purpose: the connector table arrives with its own migration, and a
// missing table must not take the whole knowledge base screen down with it.
export function useReservationConnector() {
  const { currentWorkspace, canManage: canEdit } = useWorkspace();
  const [connector, setConnector] = useState<ReservationConnector | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    if (!currentWorkspace) {
      setConnector(null);
      return;
    }

    const { data, error } = await (supabase as any)
      .from("workspace_connectors")
      .select("*")
      .eq("workspace_id", currentWorkspace.id)
      .eq("provider", "hbook")
      .maybeSingle();

    if (error) {
      setLoadError(error.message || "Nao foi possivel carregar o conector de reservas.");
      return;
    }

    setLoadError(null);
    setConnector(data ? toConnector(data) : null);
  }, [currentWorkspace]);

  useEffect(() => {
    refresh().catch(() => {
      setConnector(null);
    });
  }, [refresh]);

  const saveConnector = useCallback(
    async (input: ReservationConnectorInput) => {
      if (!currentWorkspace) return;
      setSaving(true);

      try {
        const payload = {
          workspace_id: currentWorkspace.id,
          provider: "hbook",
          config: { company_id: input.company_id, currency: input.currency },
          is_active: input.is_active,
        };

        const query = connector
          ? (supabase as any)
              .from("workspace_connectors")
              .update(payload)
              .eq("id", connector.id)
          : (supabase as any).from("workspace_connectors").insert(payload);

        const { data, error } = await query.select("*").single();
        if (error) throw new Error(error.message);

        setConnector(toConnector(data));
        return data as ReservationConnector;
      } finally {
        setSaving(false);
      }
    },
    [connector, currentWorkspace],
  );

  const removeConnector = useCallback(async () => {
    if (!connector) return;
    setSaving(true);

    try {
      const { error } = await (supabase as any)
        .from("workspace_connectors")
        .delete()
        .eq("id", connector.id);

      if (error) throw new Error(error.message);
      setConnector(null);
    } finally {
      setSaving(false);
    }
  }, [connector]);

  return { canEdit, loadError, connector, saving, refresh, saveConnector, removeConnector };
}
