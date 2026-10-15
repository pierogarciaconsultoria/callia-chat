import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/lib/workspace";
import type { WebhookRecord } from "@/lib/webhooks";

type SaveWebhookInput = {
  webhookId?: string;
  name: string;
  description?: string;
  url: string;
  events: string[];
  headers?: Record<string, string>;
  isActive: boolean;
};

export function useWebhooks() {
  const { currentWorkspace, canManage: canEdit } = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [webhooks, setWebhooks] = useState<WebhookRecord[]>([]);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);

  const invoke = useCallback(
    async (body: Record<string, unknown>) => {
      const { data, error } = await supabase.functions.invoke("manage-webhooks", {
        body,
      });

      if (error) throw error;
      return data as Record<string, unknown>;
    },
    [],
  );

  const refresh = useCallback(async () => {
    if (!currentWorkspace) {
      setWebhooks([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const data = await invoke({
      action: "list",
      workspaceId: currentWorkspace.id,
    });

    setWebhooks((data.webhooks ?? []) as WebhookRecord[]);
    setLoading(false);
  }, [currentWorkspace, invoke]);

  useEffect(() => {
    refresh().catch(() => {
      setWebhooks([]);
      setLoading(false);
    });
  }, [refresh]);

  const saveWebhook = useCallback(
    async (input: SaveWebhookInput) => {
      if (!currentWorkspace) return null;
      setSubmitting(true);

      try {
        const data = await invoke({
          action: "save",
          workspaceId: currentWorkspace.id,
          webhookId: input.webhookId,
          name: input.name,
          description: input.description ?? null,
          url: input.url,
          events: input.events,
          headers: input.headers ?? {},
          isActive: input.isActive,
        });

        if (typeof data.secret === "string" && data.secret) {
          setRevealedSecret(data.secret);
        }

        await refresh();
        return data;
      } finally {
        setSubmitting(false);
      }
    },
    [currentWorkspace, invoke, refresh],
  );

  const deleteWebhook = useCallback(
    async (webhookId: string) => {
      if (!currentWorkspace) return;
      setSubmitting(true);

      try {
        await invoke({
          action: "delete",
          workspaceId: currentWorkspace.id,
          webhookId,
        });
        await refresh();
      } finally {
        setSubmitting(false);
      }
    },
    [currentWorkspace, invoke, refresh],
  );

  const rotateSecret = useCallback(
    async (webhookId: string) => {
      if (!currentWorkspace) return null;
      setSubmitting(true);

      try {
        const data = await invoke({
          action: "rotate_secret",
          workspaceId: currentWorkspace.id,
          webhookId,
        });

        if (typeof data.secret === "string" && data.secret) {
          setRevealedSecret(data.secret);
        }

        await refresh();
        return data;
      } finally {
        setSubmitting(false);
      }
    },
    [currentWorkspace, invoke, refresh],
  );

  const processPending = useCallback(async () => {
    if (!currentWorkspace) return null;
    setSubmitting(true);

    try {
      const data = await invoke({
        action: "process_pending",
        workspaceId: currentWorkspace.id,
      });

      return data;
    } finally {
      setSubmitting(false);
    }
  }, [currentWorkspace, invoke]);

  return {
    currentWorkspace,
    canEdit,
    loading,
    submitting,
    webhooks,
    revealedSecret,
    setRevealedSecret,
    refresh,
    saveWebhook,
    deleteWebhook,
    rotateSecret,
    processPending,
  };
}
