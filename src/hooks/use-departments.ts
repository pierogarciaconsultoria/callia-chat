// Setores (departamentos): cadastro, vínculo de membros e transferência de conversas.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/functions";
import type { Department, DepartmentMember } from "@/lib/database.types";

export const departmentsKey = (ws: string) => ["departments", ws] as const;

export interface DepartmentsData {
  departments: Department[];
  members: DepartmentMember[];
}

export function useDepartments(workspaceId: string | null) {
  return useQuery({
    queryKey: departmentsKey(workspaceId ?? ""),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
    queryFn: async (): Promise<DepartmentsData> => {
      const [departments, members] = await Promise.all([
        supabase.from("departments").select("*").eq("workspace_id", workspaceId!).order("position").order("name"),
        supabase.from("department_members").select("*").eq("workspace_id", workspaceId!),
      ]);
      return { departments: unwrap(departments) as Department[], members: unwrap(members) as DepartmentMember[] };
    },
  });
}

/** Nome do setor para selos; null quando a conversa não tem setor. */
export function departmentName(data: DepartmentsData | undefined, id: string | null | undefined): string | null {
  if (!id) return null;
  return data?.departments.find((d) => d.id === id)?.name ?? "setor";
}

export function useDepartmentActions(workspaceId: string) {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: departmentsKey(workspaceId) });
  const save = useMutation({
    mutationFn: async (vars: { id?: string; name: string }) => {
      const name = vars.name.trim();
      if (!name) throw new Error("Dê um nome ao setor.");
      const q = vars.id
        ? supabase.from("departments").update({ name }).eq("id", vars.id)
        : supabase.from("departments").insert({ workspace_id: workspaceId, name });
      return unwrap(await q.select("*").single()) as Department;
    },
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => { unwrap(await supabase.from("departments").delete().eq("id", id)); },
    onSuccess: () => { refresh(); void qc.invalidateQueries({ queryKey: ["conversations", workspaceId] }); },
  });
  const setMember = useMutation({
    mutationFn: async (vars: { department_id: string; user_id: string; member: boolean }) => {
      if (vars.member) {
        unwrap(await supabase.from("department_members").upsert({ department_id: vars.department_id, workspace_id: workspaceId, user_id: vars.user_id }, { onConflict: "department_id,user_id" }));
      } else {
        unwrap(await supabase.from("department_members").delete().eq("department_id", vars.department_id).eq("user_id", vars.user_id));
      }
    },
    onSuccess: refresh,
  });
  return { save, remove, setMember };
}

export interface TransferResult { assigned_user_id: string | null; department_id: string | null }

export function useTransferConversation(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { conversationId: string; userId?: string | null; departmentId?: string | null; note?: string }) =>
      unwrap(await supabase.rpc("transfer_conversation", {
        p_conversation_id: vars.conversationId,
        p_user_id: vars.userId ?? null,
        p_department_id: vars.departmentId ?? null,
        p_note: vars.note?.trim() || null,
      })) as TransferResult,
    onSuccess: (_r, vars) => {
      void qc.invalidateQueries({ queryKey: ["conversations", workspaceId] });
      void qc.invalidateQueries({ queryKey: ["messages", vars.conversationId] });
    },
  });
}
