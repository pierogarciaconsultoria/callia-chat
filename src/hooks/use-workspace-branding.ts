import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/lib/workspace";

type WorkspaceBranding = {
  workspace_id: string;
  display_name: string | null;
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  custom_domain: string | null;
  support_email: string | null;
};

export function useWorkspaceBranding() {
  const { currentWorkspace } = useWorkspace();
  const [branding, setBranding] = useState<WorkspaceBranding | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadBranding() {
      if (!currentWorkspace) {
        if (!cancelled) {
          setBranding(null);
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      const { data } = await (supabase as any)
        .from("workspace_branding")
        .select("*")
        .eq("workspace_id", currentWorkspace.id)
        .maybeSingle();

      if (!cancelled) {
        setBranding((data ?? null) as WorkspaceBranding | null);
        setLoading(false);
      }
    }

    loadBranding();
    return () => {
      cancelled = true;
    };
  }, [currentWorkspace]);

  const displayName = useMemo(
    () => branding?.display_name || currentWorkspace?.name || "Agent Hub",
    [branding, currentWorkspace],
  );

  return {
    branding,
    displayName,
    loading,
  };
}
