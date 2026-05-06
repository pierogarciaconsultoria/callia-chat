import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./auth";

export type Workspace = { id: string; name: string; slug: string; owner_id: string };
export type Role = "owner" | "admin" | "agent";

interface WorkspaceCtx {
  workspaces: Workspace[];
  currentWorkspace: Workspace | null;
  role: Role | null;
  loading: boolean;
  setCurrentWorkspaceId: (id: string) => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<WorkspaceCtx>({
  workspaces: [],
  currentWorkspace: null,
  role: null,
  loading: true,
  setCurrentWorkspaceId: () => {},
  refresh: async () => {},
});

const STORAGE_KEY = "aih.currentWorkspaceId";

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setWorkspaces([]);
      setRole(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data: members } = await (supabase as any)
      .from("workspace_members")
      .select("role, workspace:workspaces(id, name, slug, owner_id)")
      .eq("user_id", user.id);
    const list: Workspace[] = (members ?? [])
      .map((m: any) => m.workspace)
      .filter(Boolean);
    setWorkspaces(list);
    let active = currentId && list.find((w) => w.id === currentId) ? currentId : list[0]?.id ?? null;
    if (active && active !== currentId) {
      setCurrentId(active);
      localStorage.setItem(STORAGE_KEY, active);
    }
    const m = (members ?? []).find((mm: any) => mm.workspace?.id === active);
    setRole((m?.role as Role) ?? null);
    setLoading(false);
  }, [user, currentId]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (!currentId) return;
    localStorage.setItem(STORAGE_KEY, currentId);
    // refresh role for new ws
    if (!user) return;
    (supabase as any)
      .from("workspace_members")
      .select("role")
      .eq("user_id", user.id)
      .eq("workspace_id", currentId)
      .maybeSingle()
      .then((res: any) => setRole((res?.data?.role as Role) ?? null));
  }, [currentId, user]);

  const currentWorkspace = workspaces.find((w) => w.id === currentId) ?? null;

  return (
    <Ctx.Provider
      value={{
        workspaces,
        currentWorkspace,
        role,
        loading,
        setCurrentWorkspaceId: setCurrentId,
        refresh,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useWorkspace = () => useContext(Ctx);