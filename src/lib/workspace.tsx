import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./auth";

export type Workspace = { id: string; name: string; slug: string; owner_id: string };
export type Role = "owner" | "admin" | "agent";

interface WorkspaceCtx {
  workspaces: Workspace[];
  currentWorkspace: Workspace | null;
  role: Role | null;
  canManage: boolean;
  loading: boolean;
  setCurrentWorkspaceId: (id: string) => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<WorkspaceCtx>({
  workspaces: [],
  currentWorkspace: null,
  role: null,
  canManage: false,
  loading: true,
  setCurrentWorkspaceId: () => {},
  refresh: async () => {},
});

const STORAGE_KEY = "aih.currentWorkspaceId";

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [rolesById, setRolesById] = useState<Record<string, Role>>({});
  const [currentId, setCurrentId] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setWorkspaces([]);
      setRolesById({});
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data: members } = await (supabase as any)
      .from("workspace_members")
      .select("role, workspace:workspaces(id, name, slug, owner_id)")
      .eq("user_id", user.id);

    const rows = (members ?? []).filter((m: any) => m.workspace);
    setWorkspaces(rows.map((m: any) => m.workspace));
    setRolesById(
      rows.reduce((acc: Record<string, Role>, m: any) => {
        acc[m.workspace.id] = m.role as Role;
        return acc;
      }, {}),
    );
    setCurrentId((prev) => {
      const next = rows.some((m: any) => m.workspace.id === prev) ? prev : rows[0]?.workspace?.id ?? null;
      if (next) localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
    setLoading(false);
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const currentWorkspace = workspaces.find((w) => w.id === currentId) ?? null;

  // workspaces.owner_id is the database's own authority (policy ws_delete), so a
  // missing membership row must not silently downgrade the real owner to read-only.
  const role: Role | null = currentWorkspace
    ? rolesById[currentWorkspace.id] ?? (currentWorkspace.owner_id === user?.id ? "owner" : null)
    : null;

  return (
    <Ctx.Provider
      value={{
        workspaces,
        currentWorkspace,
        role,
        canManage: role === "owner" || role === "admin",
        loading,
        setCurrentWorkspaceId: (id: string) => {
          setCurrentId(id);
          localStorage.setItem(STORAGE_KEY, id);
        },
        refresh,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useWorkspace = () => useContext(Ctx);
