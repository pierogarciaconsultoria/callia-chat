import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/lib/workspace";
import type { ApiKeyRecord } from "@/lib/public-api";

type ApiKeysResponse = {
  ok: boolean;
  keys: ApiKeyRecord[];
};

type ApiKeyMutationResponse = {
  ok: boolean;
  key: ApiKeyRecord;
  rawKey?: string;
  rotatedFrom?: ApiKeyRecord;
};

async function invokeApiKeys(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("manage-api-keys", {
    body,
  });

  if (error) throw error;
  return data as Record<string, unknown>;
}

export function useApiKeys() {
  const { currentWorkspace, role } = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  const canEdit = role === "owner" || role === "admin";

  const refresh = useCallback(async () => {
    if (!currentWorkspace) {
      setKeys([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const response = (await invokeApiKeys({
      action: "list",
      workspaceId: currentWorkspace.id,
    })) as ApiKeysResponse;

    setKeys(response.keys ?? []);
    setLoading(false);
  }, [currentWorkspace]);

  useEffect(() => {
    refresh().catch(() => {
      setKeys([]);
      setLoading(false);
    });
  }, [refresh]);

  const createKey = useCallback(
    async (input: { name: string; description?: string }) => {
      if (!currentWorkspace) return null;

      setSubmitting(true);
      try {
        const response = (await invokeApiKeys({
          action: "create",
          workspaceId: currentWorkspace.id,
          name: input.name,
          metadata: input.description ? { description: input.description } : {},
        })) as ApiKeyMutationResponse;

        setRevealedKey(response.rawKey ?? null);
        await refresh();
        return response;
      } finally {
        setSubmitting(false);
      }
    },
    [currentWorkspace, refresh],
  );

  const rotateKey = useCallback(
    async (apiKeyId: string) => {
      if (!currentWorkspace) return null;

      setSubmitting(true);
      try {
        const response = (await invokeApiKeys({
          action: "rotate",
          workspaceId: currentWorkspace.id,
          apiKeyId,
        })) as ApiKeyMutationResponse;

        setRevealedKey(response.rawKey ?? null);
        await refresh();
        return response;
      } finally {
        setSubmitting(false);
      }
    },
    [currentWorkspace, refresh],
  );

  const revokeKey = useCallback(
    async (apiKeyId: string) => {
      if (!currentWorkspace) return null;

      setSubmitting(true);
      try {
        const response = (await invokeApiKeys({
          action: "revoke",
          workspaceId: currentWorkspace.id,
          apiKeyId,
        })) as ApiKeyMutationResponse;

        await refresh();
        return response;
      } finally {
        setSubmitting(false);
      }
    },
    [currentWorkspace, refresh],
  );

  return {
    currentWorkspace,
    canEdit,
    loading,
    submitting,
    keys,
    revealedKey,
    setRevealedKey,
    refresh,
    createKey,
    rotateKey,
    revokeKey,
  };
}
