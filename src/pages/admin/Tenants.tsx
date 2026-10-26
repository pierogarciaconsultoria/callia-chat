import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus, Search } from "lucide-react";
import { platformAdmin } from "@/lib/platform-admin";
import { formatDateTime } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/entitlements";
import type { EffectiveTenantStatus, PlatformTenant } from "@/lib/database.types";
import { UsageBar } from "@/components/UsageBar";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  PageHeader,
  PageLoader,
  Select,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from "@/components/ui";
import { adminKeys, TenantStatusBadge } from "./shared";

const STATUS_FILTERS: (EffectiveTenantStatus | "all")[] = ["all", "active", "trial", "trial_expired", "suspended", "canceled"];

export default function Tenants() {
  const tenants = useQuery({ queryKey: adminKeys.tenants, queryFn: platformAdmin.listTenants });
  const plans = useQuery({ queryKey: adminKeys.plans, queryFn: platformAdmin.listPlans });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<EffectiveTenantStatus | "all">("all");
  const [planId, setPlanId] = useState<string>("all");
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (tenants.data?.tenants ?? []).filter(
      (t) =>
        (status === "all" || t.effective_status === status) &&
        (planId === "all" || (planId === "none" ? !t.plan_id : t.plan_id === planId)) &&
        (!term || [t.name, t.slug, t.owner_email ?? ""].some((v) => v.toLowerCase().includes(term))),
    );
  }, [tenants.data, search, status, planId]);

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Cada cliente é um workspace isolado, com plano, limites e status próprios."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Novo cliente
          </Button>
        }
      />

      <Card>
        <div className="grid gap-3 border-b border-slate-200 p-4 dark:border-slate-800 sm:grid-cols-[1fr_180px_180px] sm:px-5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input aria-label="Buscar" placeholder="Buscar por nome ou e-mail do dono" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as EffectiveTenantStatus | "all")}>
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {s === "all" ? "Todos os status" : STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
          <Select aria-label="Plano" value={planId} onChange={(e) => setPlanId(e.target.value)}>
            <option value="all">Todos os planos</option>
            <option value="none">Sem plano (ilimitado)</option>
            {plans.data?.plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>

        {tenants.isLoading ? (
          <PageLoader />
        ) : tenants.error ? (
          <div className="p-4"><ErrorState error={tenants.error} onRetry={() => void tenants.refetch()} /></div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={Building2} title="Nenhum cliente encontrado" description={tenants.data?.tenants.length ? "Ajuste os filtros." : "Crie o primeiro cliente."} />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Cliente</TH>
                <TH>Status</TH>
                <TH>Plano</TH>
                <TH className="w-44">Mensagens no mês</TH>
                <TH>WhatsApp</TH>
                <TH>Última mensagem</TH>
              </tr>
            </THead>
            <TBody>
              {filtered.map((t) => (
                <TenantRow key={t.id} tenant={t} limit={plans.data?.plans.find((p) => p.id === t.plan_id)?.max_monthly_messages ?? null} />
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {creating && <CreateTenantModal onClose={() => setCreating(false)} />}
    </>
  );
}

function TenantRow({ tenant: t, limit }: { tenant: PlatformTenant; limit: number | null }) {
  // Override do cliente vence o limite do plano.
  const override = t.limit_overrides?.max_monthly_messages;
  const effective = override !== undefined ? override : t.plan_id ? limit : null;
  return (
    <TR>
      <TD>
        <Link to={`/admin/tenants/${t.id}`} className="font-medium text-slate-900 hover:text-brand dark:text-slate-100">
          {t.name}
        </Link>
        <p className="text-xs text-slate-500">{t.owner_email ?? "sem dono"}</p>
      </TD>
      <TD><TenantStatusBadge status={t.effective_status} /></TD>
      <TD>{t.plan_name ?? <span className="text-slate-400">Sem plano</span>}</TD>
      <TD><UsageBar compact used={t.usage?.monthly_messages ?? 0} limit={effective ?? null} /></TD>
      <TD className="tabular-nums">{t.instances_open}/{t.usage?.instances ?? 0}</TD>
      <TD className="whitespace-nowrap text-xs">{formatDateTime(t.last_message_at)}</TD>
    </TR>
  );
}

function CreateTenantModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const plans = useQuery({ queryKey: adminKeys.plans, queryFn: platformAdmin.listPlans });
  const [name, setName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [planId, setPlanId] = useState<string>("");
  const [status, setStatus] = useState<"trial" | "active">("active");
  const [trialDays, setTrialDays] = useState(14);

  const create = useMutation({
    mutationFn: () =>
      platformAdmin.createTenant({
        name: name.trim(),
        owner_email: ownerEmail.trim(),
        plan_id: planId || null,
        status,
        ...(status === "trial" ? { trial_days: trialDays } : {}),
      }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["admin"] });
      toast.success(
        res.owner_invited
          ? `Cliente criado. Enviamos um convite por e-mail para ${ownerEmail.trim()}.`
          : `Cliente criado. ${ownerEmail.trim()} já tinha acesso e virou proprietário.`,
      );
      onClose();
      navigate(`/admin/tenants/${res.workspace_id}`);
    },
    onError: (e) => toast.error(e),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Novo cliente"
      description="Cria o workspace e define o proprietário. Se o e-mail ainda não tiver acesso, a pessoa recebe um convite."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" form="create-tenant" loading={create.isPending}>Criar cliente</Button>
        </>
      }
    >
      <form id="create-tenant" onSubmit={submit} className="space-y-4">
        <Input label="Nome da empresa" required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        <Input label="E-mail do proprietário" type="email" required value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} />
        <Select label="Plano" value={planId} onChange={(e) => setPlanId(e.target.value)} hint="Sem plano = sem limites (uso interno).">
          <option value="">Sem plano (ilimitado)</option>
          {plans.data?.plans
            .filter((p) => p.active)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </Select>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Status inicial" value={status} onChange={(e) => setStatus(e.target.value as "trial" | "active")}>
            <option value="active">Ativo</option>
            <option value="trial">Avaliação</option>
          </Select>
          {status === "trial" && (
            <Input label="Dias de avaliação" type="number" min={1} max={365} value={trialDays} onChange={(e) => setTrialDays(Number(e.target.value))} />
          )}
        </div>
      </form>
    </Modal>
  );
}
