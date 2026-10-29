import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Users } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useRequiredWorkspace } from "@/lib/workspace";
import { supabase } from "@/lib/supabase";
import { errorMessage, invokeFunction, unwrap } from "@/lib/functions";
import { createGate } from "@/lib/entitlements";
import { invalidateEntitlements, useEntitlements } from "@/hooks/use-entitlements";
import { formatDateTime } from "@/lib/format";
import type { MemberWithEmail, WorkspaceRole } from "@/lib/database.types";
import { ContactAssignmentsCard, RoutingSettingsCard } from "@/components/team/RoutingCards";
import { useRouting } from "@/hooks/use-routing";
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
  const { user } = useAuth();
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
  const [role, setRole] = useState<WorkspaceRole>("agent");
  const routing = useRouting(isAdmin ? workspaceId : null);

  const add = useMutation({
    mutationFn: (vars: { email: string; role: WorkspaceRole }) =>
      invokeFunction<{ user_id: string; invited: boolean }>("team", { action: "invite", workspace_id: workspaceId, email: vars.email, role: vars.role }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key });
      invalidateEntitlements(qc, workspaceId);
    },
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
      const result = await add.mutateAsync({ email: email.trim(), role });
      toast.success(result.invited ? `Convite enviado para ${email.trim()}. A pessoa define a senha pelo link do e-mail e já entra na equipe.` : "Membro adicionado.");
      setEmail("");
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
              <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_180px_auto] sm:items-end">
                <Input label="E-mail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
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
                    <p className="truncate text-sm font-medium">
                      {m.email} {m.user_id === user?.id && <span className="text-xs font-normal text-slate-400">(você)</span>}
                    </p>
                    <p className="text-xs text-slate-500">
                      {m.is_support ? "Acesso de suporte da plataforma desde " : "Desde "}
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
    </>
  );
}
