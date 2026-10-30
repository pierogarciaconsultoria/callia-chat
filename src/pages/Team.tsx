import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, UserPlus, Users } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useRequiredWorkspace } from "@/lib/workspace";
import { supabase } from "@/lib/supabase";
import { errorMessage, invokeFunction, unwrap } from "@/lib/functions";
import { createGate } from "@/lib/entitlements";
import { invalidateEntitlements, useEntitlements } from "@/hooks/use-entitlements";
import { formatDateTime } from "@/lib/format";
import type { MemberWithEmail, WorkspaceRole } from "@/lib/database.types";
import { ContactAssignmentsCard, RoutingSettingsCard } from "@/components/team/RoutingCards";
import { DepartmentsCard } from "@/components/team/DepartmentsCard";
import { memberName, useRouting } from "@/hooks/use-routing";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmButton,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  Notice,
  PageHeader,
  Select,
  Spinner,
  useToast,
} from "@/components/ui";

const ROLE_LABEL: Record<WorkspaceRole, string> = { owner: "Proprietário", admin: "Administrador", agent: "Atendente" };
const ROLE_TONE = { owner: "violet", admin: "brand", agent: "neutral" } as const;

function friendly(err: unknown): string {
  const message = (err as Error)?.message ?? String(err);
  if (message.includes("user_not_found")) return "Nenhum usuário com este e-mail. Tente de novo: o convite por e-mail é enviado automaticamente.";
  if (message.includes("only_owner_can_grant_owner")) return "Só um proprietário pode adicionar outro proprietário.";
  if (message.includes("last_owner")) return "O workspace precisa de pelo menos um proprietário.";
  if (message.includes("forbidden")) return "Você não tem permissão para gerenciar a equipe.";
  // Limites e status do plano (member_limit_reached, tenant_inactive).
  return errorMessage(err);
}

export default function Team() {
  const { workspaceId, isAdmin, isOwner } = useRequiredWorkspace();
  const { user, updateProfile } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const key = ["members", workspaceId];
  const members = useQuery({
    queryKey: key,
    queryFn: async () => unwrap(await supabase.rpc("list_workspace_members", { p_workspace_id: workspaceId })) as MemberWithEmail[],
  });
  const { data: entitlements } = useEntitlements();
  const gate = createGate(entitlements, "max_members");
  const [email, setEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("agent");
  const [renaming, setRenaming] = useState<{ user_id: string; name: string } | null>(null);
  const routing = useRouting(isAdmin ? workspaceId : null);

  const add = useMutation({
    mutationFn: (vars: { email: string; role: WorkspaceRole; full_name?: string }) =>
      invokeFunction<{ user_id: string; invited: boolean }>("team", { action: "invite", workspace_id: workspaceId, email: vars.email, role: vars.role, ...(vars.full_name ? { full_name: vars.full_name } : {}) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key });
      invalidateEntitlements(qc, workspaceId);
    },
  });
  const rename = useMutation({
    mutationFn: async (vars: { user_id: string; name: string }) => {
      if (vars.user_id === user?.id) await updateProfile(vars.name);
      else await invokeFunction("team", { action: "rename", workspace_id: workspaceId, user_id: vars.user_id, full_name: vars.name });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
  });
  const remove = useMutation({
    mutationFn: async (userId: string) =>
      unwrap(await supabase.rpc("remove_workspace_member", { p_workspace_id: workspaceId, p_user_id: userId })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key });
      invalidateEntitlements(qc, workspaceId);
    },
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const result = await add.mutateAsync({ email: email.trim(), role, ...(inviteName.trim() ? { full_name: inviteName.trim() } : {}) });
      toast.success(result.invited ? `Convite enviado para ${email.trim()}. A pessoa define a senha pelo link do e-mail e já entra na equipe.` : "Membro adicionado.");
      setEmail("");
      setInviteName("");
    } catch (err) {
      toast.error(friendly(err));
    }
  }

  return (
    <>
      <PageHeader title="Equipe" description="Quem acessa este workspace. Atendentes usam a inbox; administradores configuram o restante." />
      <div className="space-y-6">
        {isAdmin && (
          <Card>
            <CardHeader title="Adicionar membro" description="Quem já tem usuário entra na hora; quem não tem recebe um convite por e-mail para definir a senha." />
            <CardBody className="space-y-3">
              {gate.reason && <Notice tone="warn">{gate.reason}</Notice>}
              <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_1fr_180px_auto] sm:items-end">
                <Input label="E-mail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                <Input label="Nome (opcional)" value={inviteName} onChange={(e) => setInviteName(e.target.value)} maxLength={80} autoComplete="off" />
                <Select label="Papel" value={role} onChange={(e) => setRole(e.target.value as WorkspaceRole)}>
                  <option value="agent">Atendente</option>
                  <option value="admin">Administrador</option>
                  {isOwner && <option value="owner">Proprietário</option>}
                </Select>
                <Button type="submit" loading={add.isPending} disabled={!gate.allowed} title={gate.reason ?? undefined}><UserPlus className="h-4 w-4" /> Adicionar</Button>
              </form>
            </CardBody>
          </Card>
        )}

        {isAdmin && <RoutingSettingsCard workspaceId={workspaceId} />}
        {isAdmin && routing.data?.assignment_mode === "portfolio" && <ContactAssignmentsCard workspaceId={workspaceId} />}
        {isAdmin && <DepartmentsCard workspaceId={workspaceId} />}

        <Card>
          <CardHeader title="Membros" />
          {members.isLoading ? (
            <CardBody className="flex justify-center"><Spinner /></CardBody>
          ) : members.error ? (
            <CardBody><ErrorState error={members.error} onRetry={() => void members.refetch()} /></CardBody>
          ) : members.data?.length === 0 ? (
            <EmptyState icon={Users} title="Nenhum membro" />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {members.data?.map((m) => (
                <li key={m.user_id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                      {memberName(m)} {m.user_id === user?.id && <span className="text-xs font-normal text-slate-400">(você)</span>}
                      {(m.user_id === user?.id || isAdmin) && (
                        <button type="button" onClick={() => setRenaming({ user_id: m.user_id, name: m.display_name ?? "" })} className="rounded p-0.5 text-slate-400 hover:text-brand" aria-label={`Editar nome de ${m.email}`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {m.email} · {m.is_support ? "acesso de suporte da plataforma desde " : "desde "}
                      {formatDateTime(m.created_at)}
                    </p>
                  </div>
                  {m.is_support && <Badge tone="amber">Suporte</Badge>}
                  <Badge tone={ROLE_TONE[m.role]}>{ROLE_LABEL[m.role]}</Badge>
                  {isAdmin && m.user_id !== user?.id && (m.role !== "owner" || isOwner) && (
                    <ConfirmButton
                      size="sm"
                      variant="ghost"
                      title="Remover membro?"
                      description={`${m.email} perde o acesso a este workspace.`}
                      confirmLabel="Remover"
                      onConfirm={() =>
                        remove.mutateAsync(m.user_id).then(
                          () => toast.success("Membro removido."),
                          (e) => toast.error(friendly(e)),
                        )
                      }
                    >
                      Remover
                    </ConfirmButton>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Modal
        open={Boolean(renaming)}
        onClose={() => setRenaming(null)}
        title="Nome de exibição"
        description="É como a pessoa aparece na inbox, nas transferências e para o resto da equipe."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRenaming(null)}>Cancelar</Button>
            <Button
              loading={rename.isPending}
              disabled={!renaming || renaming.name.trim().length < 2}
              onClick={() => renaming && rename.mutateAsync(renaming).then(() => { toast.success("Nome salvo."); setRenaming(null); }, (e) => toast.error(friendly(e)))}
            >
              Salvar
            </Button>
          </>
        }
      >
        <Input label="Nome" value={renaming?.name ?? ""} onChange={(e) => setRenaming((r) => (r ? { ...r, name: e.target.value } : r))} maxLength={80} autoFocus />
      </Modal>
    </>
  );
}
