import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, UserPlus, Users as UsersIcon } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { platformAdmin } from "@/lib/platform-admin";
import { formatDateTime } from "@/lib/format";
import type { PlatformUser } from "@/lib/database.types";
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
  PageHeader,
  PageLoader,
  useToast,
} from "@/components/ui";
import { adminKeys } from "./shared";

const ROLE_LABEL = { owner: "Proprietário", admin: "Admin", agent: "Atendente" } as const;

export default function Users() {
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState("");
  // Busca no servidor depois de uma pausa na digitação.
  useEffect(() => {
    const t = window.setTimeout(() => setSearch(term.trim()), 350);
    return () => window.clearTimeout(t);
  }, [term]);

  const q = useQuery({ queryKey: adminKeys.users(search), queryFn: () => platformAdmin.listUsers(search || undefined) });

  return (
    <>
      <PageHeader title="Usuários" description="Todas as contas da plataforma. O cadastro aberto fica desligado: novos acessos entram por convite." />
      <div className="space-y-6">
        <InviteCard />
        <Card>
          <div className="border-b border-slate-200 p-4 dark:border-slate-800 sm:px-5">
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input aria-label="Buscar usuários" placeholder="Buscar por e-mail" value={term} onChange={(e) => setTerm(e.target.value)} className="pl-9" />
            </div>
          </div>
          {q.isLoading ? (
            <PageLoader />
          ) : q.error ? (
            <div className="p-4"><ErrorState error={q.error} onRetry={() => void q.refetch()} /></div>
          ) : !q.data?.users.length ? (
            <EmptyState icon={UsersIcon} title="Nenhum usuário encontrado" />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {q.data.users.map((u) => (
                <UserRow key={u.id} user={u} />
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function InviteCard() {
  const [email, setEmail] = useState("");
  const qc = useQueryClient();
  const toast = useToast();
  const invite = useMutation({
    mutationFn: () => platformAdmin.inviteUser(email.trim()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "users"] });
      toast.success(`Convite enviado para ${email.trim()}.`);
      setEmail("");
    },
    onError: (e) => toast.error(e),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    invite.mutate();
  }
  return (
    <Card>
      <CardHeader title="Convidar usuário" description="A pessoa recebe um e-mail para definir a senha. Depois, vincule-a a um cliente (como proprietária na criação do cliente ou pela equipe do workspace)." />
      <CardBody>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Input label="E-mail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" loading={invite.isPending}>
            <UserPlus className="h-4 w-4" /> Convidar
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

function UserRow({ user: u }: { user: PlatformUser }) {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const isMe = me?.id === u.id;
  const refresh = () => void qc.invalidateQueries({ queryKey: ["admin", "users"] });

  const admin = useMutation({
    mutationFn: (enabled: boolean) => platformAdmin.setPlatformAdmin(u.id, enabled),
    onSuccess: (_d, enabled) => {
      refresh();
      toast.success(enabled ? `${u.email} agora administra a plataforma.` : `${u.email} deixou de administrar a plataforma.`);
    },
    onError: (e) => toast.error(e),
  });
  const block = useMutation({
    mutationFn: (blocked: boolean) => platformAdmin.setUserBlocked(u.id, blocked),
    onSuccess: (_d, blocked) => {
      refresh();
      toast.success(blocked ? `${u.email} bloqueado.` : `${u.email} desbloqueado.`);
    },
    onError: (e) => toast.error(e),
  });

  return (
    <li className="flex flex-wrap items-start gap-3 px-4 py-3 sm:px-5">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <span className="truncate">{u.email}</span>
          {isMe && <span className="text-xs font-normal text-slate-400">(você)</span>}
          {u.platform_admin && <Badge tone="violet">Admin da plataforma</Badge>}
          {u.blocked && <Badge tone="red">Bloqueado</Badge>}
          {!u.confirmed && <Badge tone="amber">{u.invited_at ? "Convite pendente" : "Não confirmado"}</Badge>}
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          Criado em {formatDateTime(u.created_at)} · último acesso {formatDateTime(u.last_sign_in_at)}
        </p>
        {u.workspaces.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {u.workspaces.map((w) => (
              <Link key={w.id} to={`/admin/tenants/${w.id}`}>
                <Badge tone={w.is_support ? "amber" : "neutral"}>
                  {w.name} · {w.is_support ? "Suporte" : ROLE_LABEL[w.role]}
                </Badge>
              </Link>
            ))}
          </div>
        )}
      </div>
      {!isMe && (
        <div className="flex flex-wrap gap-2">
          <ConfirmButton
            size="sm"
            variant="secondary"
            danger={u.platform_admin}
            title={u.platform_admin ? "Remover administrador da plataforma?" : "Tornar administrador da plataforma?"}
            description={
              u.platform_admin
                ? `${u.email} perde acesso ao console central.`
                : `${u.email} passa a ver e gerenciar todos os clientes, planos e usuários.`
            }
            confirmLabel={u.platform_admin ? "Remover" : "Promover"}
            onConfirm={() => admin.mutateAsync(!u.platform_admin).catch(() => undefined)}
          >
            {u.platform_admin ? "Remover admin" : "Tornar admin"}
          </ConfirmButton>
          <ConfirmButton
            size="sm"
            variant={u.blocked ? "secondary" : "ghost"}
            danger={!u.blocked}
            title={u.blocked ? "Desbloquear usuário?" : "Bloquear usuário?"}
            description={u.blocked ? `${u.email} volta a conseguir entrar.` : `${u.email} não consegue mais entrar em nenhum workspace.`}
            confirmLabel={u.blocked ? "Desbloquear" : "Bloquear"}
            onConfirm={() => block.mutateAsync(!u.blocked).catch(() => undefined)}
          >
            {u.blocked ? "Desbloquear" : "Bloquear"}
          </ConfirmButton>
        </div>
      )}
    </li>
  );
}
