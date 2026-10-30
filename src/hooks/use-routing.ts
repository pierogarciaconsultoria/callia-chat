// Distribuição de conversas: configuração por workspace, carteira de clientes e membros (para nomes na inbox).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/functions";
import type { ContactAssignment, MemberWithEmail, RoutingSettings } from "@/lib/database.types";

export const routingKey = (ws: string) => ["routing", ws] as const;
export const assignmentsKey = (ws: string) => ["contact-assignments", ws] as const;
export const membersKey = (ws: string) => ["members", ws] as const;

export const ROUTING_DEFAULTS: Omit<RoutingSettings, "workspace_id" | "updated_at"> = { assignment_mode: "shared", agent_visibility: "all", sticky_claim: false };

/** Só os dígitos; "+55 (48) 99999-0000" → "5548999990000". */
export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

export function useRouting(workspaceId: string | null) {
  return useQuery({
    queryKey: routingKey(workspaceId ?? ""),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
    queryFn: async () => {
      const row = unwrap(await supabase.from("workspace_routing").select("*").eq("workspace_id", workspaceId!).maybeSingle()) as RoutingSettings | null;
      return row ?? { workspace_id: workspaceId!, ...ROUTING_DEFAULTS, updated_at: "" };
    },
  });
}

export function useUpdateRouting(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Omit<RoutingSettings, "workspace_id" | "updated_at">>) =>
      unwrap(await supabase.from("workspace_routing").upsert({ workspace_id: workspaceId, ...patch }, { onConflict: "workspace_id" }).select("*").single()) as RoutingSettings,
    onSuccess: (row) => {
      qc.setQueryData(routingKey(workspaceId), row);
      void qc.invalidateQueries({ queryKey: ["conversations", workspaceId] });
    },
  });
}

export function useMembers(workspaceId: string | null) {
  return useQuery({
    queryKey: membersKey(workspaceId ?? ""),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
    queryFn: async () => unwrap(await supabase.rpc("list_workspace_members", { p_workspace_id: workspaceId })) as MemberWithEmail[],
  });
}

/** Nome de exibição do membro; sem nome, o trecho do e-mail antes do @ ("ana" para ana@pousada.com). */
export function memberName(m: Pick<MemberWithEmail, "email" | "display_name">): string {
  return m.display_name?.trim() || m.email.split("@")[0];
}

/** Rótulo pelo id; null sem id, "outro operador" quando não está na lista. */
export function memberLabel(members: MemberWithEmail[] | undefined, userId: string | null | undefined): string | null {
  if (!userId) return null;
  const m = members?.find((x) => x.user_id === userId);
  return m ? memberName(m) : "outro operador";
}

export function useContactAssignments(workspaceId: string | null, enabled = true) {
  return useQuery({
    queryKey: assignmentsKey(workspaceId ?? ""),
    enabled: enabled && Boolean(workspaceId),
    queryFn: async () => unwrap(await supabase.from("contact_assignments").select("*").eq("workspace_id", workspaceId!).order("created_at", { ascending: false })) as ContactAssignment[],
  });
}

export function useContactAssignmentActions(workspaceId: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: assignmentsKey(workspaceId) });
    void qc.invalidateQueries({ queryKey: ["conversations", workspaceId] });
  };
  const add = useMutation({
    mutationFn: async (vars: { phone: string; user_id: string; note?: string }) => {
      const phone = normalizePhone(vars.phone);
      if (phone.length < 8) throw new Error("Telefone inválido: use o número com DDD (e DDI, se não for Brasil).");
      return unwrap(await supabase.from("contact_assignments").upsert({ workspace_id: workspaceId, phone, user_id: vars.user_id, note: vars.note ?? null }, { onConflict: "workspace_id,phone" }).select("*").single()) as ContactAssignment;
    },
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => { unwrap(await supabase.from("contact_assignments").delete().eq("id", id)); },
    onSuccess: invalidate,
  });
  const claimContact = useMutation({
    mutationFn: async (conversationId: string) => { unwrap(await supabase.rpc("claim_contact", { p_conversation_id: conversationId })); },
    onSuccess: invalidate,
  });
  return { add, remove, claimContact };
}

export interface ClaimResult { claimed: boolean; conflict: boolean; assigned_user_id: string | null }

export function useClaimConversation(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { conversationId: string; force?: boolean }) =>
      unwrap(await supabase.rpc("claim_conversation", { p_conversation_id: vars.conversationId, p_force: vars.force ?? false })) as ClaimResult,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["conversations", workspaceId] }),
  });
}
