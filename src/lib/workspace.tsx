import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { useAuth } from "./auth";
import { unwrap } from "./functions";
import { readLocal, writeLocal } from "./storage";
import { applyBranding } from "./branding";
import type { Workspace, WorkspaceBranding, WorkspaceRole } from "./database.types";

const STORAGE_KEY = "callia.workspace";
// Consultas que não pertencem a um workspace e sobrevivem à troca.
const KEEP_ON_SWITCH = new Set(["workspaces", "platform-admin", "platform-settings", "admin"]);

export interface WorkspaceWithRole extends Workspace {
  role: WorkspaceRole;
}

interface WorkspaceState {
  workspaces: WorkspaceWithRole[];
  workspace: WorkspaceWithRole | null;
  workspaceId: string | null;
  role: WorkspaceRole | null;
  isAdmin: boolean;
  isOwner: boolean;
  /** Administrador da plataforma (user_roles.platform_admin), acima dos tenants. */
  isPlatformAdmin: boolean;
  platformAdminLoading: boolean;
  branding: WorkspaceBranding | null;
  loading: boolean;
  error: unknown;
  selectWorkspace: (id: string) => void;
  refresh: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceState | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(() => readLocal(STORAGE_KEY));

  const listQuery = useQuery({
    queryKey: ["workspaces", user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      // RLS já restringe aos workspaces do usuário; o papel vem de workspace_members.
      const members = unwrap(
        await supabase.from("workspace_members").select("workspace_id, role").eq("user_id", user!.id),
      ) as { workspace_id: string; role: WorkspaceRole }[];
      if (members.length === 0) return [] as WorkspaceWithRole[];
      const rows = unwrap(
        await supabase
          .from("workspaces")
          .select("*")
          .in(
            "id",
            members.map((m) => m.workspace_id),
          )
          .order("name"),
      ) as Workspace[];
      const roleById = new Map(members.map((m) => [m.workspace_id, m.role]));
      return rows.map((w) => ({ ...w, role: roleById.get(w.id) ?? "agent" }));
    },
  });

  const platformQuery = useQuery({
    queryKey: ["platform-admin", user?.id],
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
    queryFn: async () => Boolean(unwrap(await supabase.rpc("is_platform_admin"))),
  });

  const workspaces = listQuery.data ?? [];
  const workspace = workspaces.find((w) => w.id === selectedId) ?? workspaces[0] ?? null;
  const workspaceId = workspace?.id ?? null;

  useEffect(() => {
    if (workspaceId && workspaceId !== selectedId) {
      setSelectedId(workspaceId);
      writeLocal(STORAGE_KEY, workspaceId);
    }
  }, [workspaceId, selectedId]);

  const brandingQuery = useQuery({
    queryKey: ["branding", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () =>
      unwrap(
        await supabase.from("workspace_branding").select("*").eq("workspace_id", workspaceId!).maybeSingle(),
      ) as WorkspaceBranding | null,
  });

  const branding = brandingQuery.data ?? null;

  useEffect(() => {
    applyBranding(branding?.primary_color, branding?.secondary_color);
    const title = branding?.display_name || workspace?.name;
    document.title = title ? `${title} · Callia Chat` : "Callia Chat";
  }, [branding?.primary_color, branding?.secondary_color, branding?.display_name, workspace?.name]);

  const value = useMemo<WorkspaceState>(() => {
    const role = workspace?.role ?? null;
    return {
      workspaces,
      workspace,
      workspaceId,
      role,
      isAdmin: role === "owner" || role === "admin",
      isOwner: role === "owner",
      isPlatformAdmin: platformQuery.data === true,
      platformAdminLoading: platformQuery.isLoading,
      branding,
      loading: listQuery.isLoading,
      error: listQuery.error,
      selectWorkspace(id) {
        setSelectedId(id);
        writeLocal(STORAGE_KEY, id);
        // Dados de outro workspace não podem vazar para a tela nova.
        queryClient.removeQueries({ predicate: (q) => !KEEP_ON_SWITCH.has(String(q.queryKey[0])) });
      },
      async refresh() {
        await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      },
    };
  }, [workspaces, workspace, workspaceId, branding, listQuery.isLoading, listQuery.error, queryClient, platformQuery.data, platformQuery.isLoading]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceState {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace fora do WorkspaceProvider");
  return ctx;
}

// Para páginas dentro do shell, onde o workspace já foi garantido pelo ProtectedRoute.
export function useRequiredWorkspace() {
  const ctx = useWorkspace();
  if (!ctx.workspaceId) throw new Error("Nenhum workspace selecionado");
  return { ...ctx, workspaceId: ctx.workspaceId };
}
