import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, LifeBuoy, LogIn, LogOut, Save } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useWorkspace } from "@/lib/workspace";
import { platformAdmin } from "@/lib/platform-admin";
import { formatDateTime, formatPhone } from "@/lib/format";
import { FEATURE_LABEL, LIMIT_LABEL, limitState } from "@/lib/entitlements";
import type { FeatureKey, NumericLimitKey, Plan, PlanLimits, PlatformTenantDetail, TenantStatus } from "@/lib/database.types";
import { UsageBar } from "@/components/UsageBar";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmButton,
  ErrorState,
  Input,
  Modal,
  Notice,
  PageHeader,
  PageLoader,
  Select,
  statusTone,
  Table,
  TBody,
  TD,
  Textarea,
  TH,
  THead,
  TR,
  useToast,
} from "@/components/ui";
import { adminKeys, formatNumber, TenantStatusBadge } from "./shared";

const NUMERIC_LIMITS: NumericLimitKey[] = ["max_instances", "max_members", "max_monthly_messages", "max_knowledge_sources"];
const FEATURES: FeatureKey[] = ["ai_enabled", "external_agent_enabled", "connectors_enabled"];
const ROLE_LABEL = { owner: "Proprietário", admin: "Administrador", agent: "Atendente" } as const;

type LimitMode = "plan" | "custom" | "unlimited";
interface LimitDraft {
  mode: LimitMode;
  value: string;
}
type FeatureDraft = "plan" | "yes" | "no";

function toDateInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

export default function TenantDetail() {
  const { id = "" } = useParams();
  const q = useQuery({ queryKey: adminKeys.tenant(id), queryFn: () => platformAdmin.getTenant(id), enabled: Boolean(id) });
  const plans = useQuery({ queryKey: adminKeys.plans, queryFn: platformAdmin.listPlans });

  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return <Detail detail={q.data!} plans={plans.data?.plans ?? []} />;
}

function Detail({ detail, plans }: { detail: PlatformTenantDetail; plans: Plan[] }) {
  const { tenant, entitlements, members, instances, counts, audit } = detail;
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
  const ws = useWorkspace();
  const [statusDialog, setStatusDialog] = useState<"suspended" | "canceled" | null>(null);
  const [reason, setReason] = useState("");

  const me = members.find((m) => m.user_id === user?.id);
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["admin"] });

  const setStatus = useMutation({
    mutationFn: (vars: { status: TenantStatus; reason?: string }) => platformAdmin.setStatus(tenant.id, vars.status, vars.reason),
    onSuccess: (_d, vars) => {
      invalidate();
      toast.success(vars.status === "active" ? "Cliente ativo." : vars.status === "suspended" ? "Cliente suspenso." : "Cliente cancelado.");
      setStatusDialog(null);
      setReason("");
    },
    onError: (e) => toast.error(e),
  });

  const support = useMutation({
    mutationFn: (enable: boolean) => platformAdmin.supportAccess(tenant.id, enable),
    onSuccess: async (_d, enable) => {
      invalidate();
      await ws.refresh();
      toast.success(enable ? "Acesso de suporte liberado e registrado na auditoria." : "Você saiu do workspace.");
    },
    onError: (e) => toast.error(e),
  });

  const inactive = tenant.status === "suspended" || tenant.status === "canceled" || tenant.effective_status === "trial_expired";

  return (
    <>
      <Link to="/admin/tenants" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
        <ArrowLeft className="h-4 w-4" /> Clientes
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {tenant.name} <TenantStatusBadge status={tenant.effective_status} />
          </span>
        }
        description={`${tenant.owner_email ?? "sem proprietário"} · criado em ${formatDateTime(tenant.created_at)} · ${tenant.slug}`}
        actions={
          <>
            {tenant.status === "trial" && (
              <Button variant="secondary" loading={setStatus.isPending} onClick={() => setStatus.mutate({ status: "active" })}>
                Encerrar avaliação (ativar)
              </Button>
            )}
            {inactive && tenant.status !== "trial" && (
              <ConfirmButton
                danger={false}
                title="Reativar cliente?"
                description="O bot, os envios e a API voltam a funcionar imediatamente."
                confirmLabel="Reativar"
                onConfirm={() => setStatus.mutateAsync({ status: "active" }).catch(() => undefined)}
              >
                Reativar
              </ConfirmButton>
            )}
            {tenant.status !== "suspended" && tenant.status !== "canceled" && (
              <Button variant="secondary" onClick={() => setStatusDialog("suspended")}>Suspender</Button>
            )}
            {tenant.status !== "canceled" && (
              <Button variant="danger" onClick={() => setStatusDialog("canceled")}>Cancelar</Button>
            )}
          </>
        }
      />

      {tenant.suspended_reason && inactive && (
        <div className="mb-4">
          <Notice tone="warn">Motivo registrado: {tenant.suspended_reason}</Notice>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Uso no mês" description={`Desde ${formatDateTime(entitlements.usage.period_start)}`} />
            <CardBody className="grid gap-4 sm:grid-cols-2">
              {NUMERIC_LIMITS.map((k) => {
                const st = limitState(entitlements, k);
                return <UsageBar key={k} label={LIMIT_LABEL[k]} used={st.used} limit={st.limit} />;
              })}
              <div className="text-sm text-slate-600 dark:text-slate-400 sm:col-span-2">
                {formatNumber(entitlements.usage.monthly_inbound)} mensagens recebidas · {formatNumber(entitlements.usage.monthly_ai_runs)} execuções da IA ·{" "}
                {formatNumber(entitlements.usage.monthly_ai_tokens)} tokens · {formatNumber(counts.conversations)} conversas · {counts.api_keys} chaves de API ·{" "}
                {counts.webhooks} webhooks
              </div>
            </CardBody>
          </Card>

          <PlanEditor detail={detail} plans={plans} onSaved={invalidate} />

          <Card>
            <CardHeader title="Auditoria recente" />
            {audit.length === 0 ? (
              <CardBody className="text-sm text-slate-500">Sem registros.</CardBody>
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>Quando</TH>
                    <TH>Ação</TH>
                    <TH>Origem</TH>
                    <TH>Entidade</TH>
                  </tr>
                </THead>
                <TBody>
                  {audit.map((a) => (
                    <TR key={a.id}>
                      <TD className="whitespace-nowrap text-xs">{formatDateTime(a.created_at)}</TD>
                      <TD className="font-mono text-xs">{a.action}</TD>
                      <TD className="text-xs">{a.actor_type}</TD>
                      <TD className="text-xs">{a.entity ?? "—"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <LifeBuoy className="h-4 w-4" /> Suporte
                </span>
              }
            />
            <CardBody className="space-y-3 text-sm">
              {me && !me.is_support ? (
                <>
                  <p className="text-slate-600 dark:text-slate-400">Você já é membro deste workspace ({ROLE_LABEL[me.role]}).</p>
                  <Button
                    className="w-full"
                    variant="secondary"
                    onClick={() => {
                      ws.selectWorkspace(tenant.id);
                      navigate("/inbox");
                    }}
                  >
                    <LogIn className="h-4 w-4" /> Abrir workspace
                  </Button>
                </>
              ) : me?.is_support ? (
                <>
                  <p className="text-slate-600 dark:text-slate-400">Você está dentro deste workspace como suporte (administrador). O acesso fica registrado.</p>
                  <Button
                    className="w-full"
                    onClick={() => {
                      ws.selectWorkspace(tenant.id);
                      navigate("/inbox");
                    }}
                  >
                    <LogIn className="h-4 w-4" /> Abrir workspace
                  </Button>
                  <Button className="w-full" variant="secondary" loading={support.isPending} onClick={() => support.mutate(false)}>
                    <LogOut className="h-4 w-4" /> Sair do suporte
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-slate-600 dark:text-slate-400">
                    Entre como administrador de suporte para ver conversas e configurações do cliente. A entrada e a saída ficam na auditoria do cliente.
                  </p>
                  <ConfirmButton
                    className="w-full"
                    danger={false}
                    title="Acessar como suporte?"
                    description={`Você vai entrar em "${tenant.name}" como administrador de suporte. O cliente vê o acesso na auditoria e na lista da equipe.`}
                    confirmLabel="Acessar"
                    onConfirm={() => support.mutateAsync(true).catch(() => undefined)}
                  >
                    <LifeBuoy className="h-4 w-4" /> Acessar como suporte
                  </ConfirmButton>
                </>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Equipe" description={`${members.filter((m) => !m.is_support).length} membro(s)`} />
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {members.map((m) => (
                <li key={m.user_id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm sm:px-5">
                  <span className="min-w-0 flex-1 truncate">{m.email}</span>
                  {m.is_support && <Badge tone="amber">Suporte</Badge>}
                  <Badge tone={m.role === "owner" ? "violet" : m.role === "admin" ? "brand" : "neutral"}>{ROLE_LABEL[m.role]}</Badge>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader title="WhatsApp" description={`${instances.length} instância(s)`} />
            {instances.length === 0 ? (
              <CardBody className="text-sm text-slate-500">Nenhuma instância criada.</CardBody>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {instances.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm sm:px-5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{i.name}{i.is_default ? " ★" : ""}</span>
                      <span className="text-xs text-slate-500">{formatPhone(i.phone_number) || "sem número"}</span>
                    </span>
                    <Badge tone={statusTone(i.status)}>{i.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Modal
        open={statusDialog !== null}
        onClose={() => !setStatus.isPending && setStatusDialog(null)}
        title={statusDialog === "suspended" ? "Suspender cliente" : "Cancelar cliente"}
        description={
          statusDialog === "suspended"
            ? "O bot, os envios e a API param. As mensagens recebidas continuam sendo guardadas e a equipe ainda acessa o painel."
            : "Encerra o contrato. O workspace para como na suspensão e fica marcado como cancelado."
        }
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setStatusDialog(null)} disabled={setStatus.isPending}>Voltar</Button>
            <Button
              variant="danger"
              loading={setStatus.isPending}
              disabled={reason.trim().length < 3}
              onClick={() => statusDialog && setStatus.mutate({ status: statusDialog, reason: reason.trim() })}
            >
              {statusDialog === "suspended" ? "Suspender" : "Cancelar cliente"}
            </Button>
          </>
        }
      >
        <Textarea
          label="Motivo"
          required
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          hint="Aparece para o cliente no aviso do painel."
          placeholder="Ex.: pagamento em atraso"
        />
      </Modal>
    </>
  );
}

function draftFromOverrides(overrides: Partial<PlanLimits>) {
  const limits = {} as Record<NumericLimitKey, LimitDraft>;
  for (const k of NUMERIC_LIMITS) {
    if (!(k in overrides)) limits[k] = { mode: "plan", value: "" };
    else if (overrides[k] === null) limits[k] = { mode: "unlimited", value: "" };
    else limits[k] = { mode: "custom", value: String(overrides[k]) };
  }
  const features = {} as Record<FeatureKey, FeatureDraft>;
  for (const k of FEATURES) features[k] = !(k in overrides) ? "plan" : overrides[k] ? "yes" : "no";
  return { limits, features };
}

function PlanEditor({ detail, plans, onSaved }: { detail: PlatformTenantDetail; plans: Plan[]; onSaved: () => void }) {
  const { tenant } = detail;
  const toast = useToast();
  const [name, setName] = useState(tenant.name);
  const [planId, setPlanId] = useState(tenant.plan_id ?? "");
  const [notes, setNotes] = useState(tenant.notes ?? "");
  const [trialEnd, setTrialEnd] = useState(toDateInput(tenant.trial_ends_at));
  const [draft, setDraft] = useState(() => draftFromOverrides(tenant.limit_overrides ?? {}));

  useEffect(() => {
    setName(tenant.name);
    setPlanId(tenant.plan_id ?? "");
    setNotes(tenant.notes ?? "");
    setTrialEnd(toDateInput(tenant.trial_ends_at));
    setDraft(draftFromOverrides(tenant.limit_overrides ?? {}));
  }, [tenant]);

  const plan = plans.find((p) => p.id === planId) ?? null;
  const planValue = (k: NumericLimitKey) => (plan ? (plan[k] === null ? "ilimitado" : String(plan[k])) : "ilimitado");
  const planFeature = (k: FeatureKey) => (plan ? (plan[k] ? "sim" : "não") : "sim");

  const save = useMutation({
    mutationFn: () => {
      const overrides: Partial<PlanLimits> = {};
      for (const k of NUMERIC_LIMITS) {
        const d = draft.limits[k];
        if (d.mode === "unlimited") overrides[k] = null;
        else if (d.mode === "custom") {
          const n = Number(d.value);
          if (!Number.isInteger(n) || n < 0) throw new Error(`${LIMIT_LABEL[k]}: informe um número inteiro.`);
          overrides[k] = n;
        }
      }
      for (const k of FEATURES) if (draft.features[k] !== "plan") overrides[k] = draft.features[k] === "yes";
      return platformAdmin.updateTenant({
        workspace_id: tenant.id,
        name: name.trim(),
        plan_id: planId || null,
        limit_overrides: overrides,
        notes: notes.trim() || null,
        ...(tenant.status === "trial" ? { trial_ends_at: trialEnd ? new Date(`${trialEnd}T23:59:59`).toISOString() : null } : {}),
      });
    },
    onSuccess: () => {
      onSaved();
      toast.success("Cliente atualizado.");
    },
    onError: (e) => toast.error(e),
  });

  return (
    <Card>
      <CardHeader
        title="Plano e limites"
        description="Limites personalizados valem só para este cliente e vencem os do plano."
        actions={
          <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>
            <Save className="h-4 w-4" /> Salvar
          </Button>
        }
      />
      <CardBody className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Nome" value={name} onChange={(e) => setName(e.target.value)} />
          <Select label="Plano" value={planId} onChange={(e) => setPlanId(e.target.value)}>
            <option value="">Sem plano (ilimitado)</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.active ? "" : " (inativo)"}
              </option>
            ))}
          </Select>
          {tenant.status === "trial" && (
            <Input label="Fim da avaliação" type="date" value={trialEnd} onChange={(e) => setTrialEnd(e.target.value)} />
          )}
        </div>

        <div className="space-y-3">
          {NUMERIC_LIMITS.map((k) => {
            const d = draft.limits[k];
            return (
              <div key={k} className="grid gap-2 sm:grid-cols-[1fr_170px_120px] sm:items-end">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300 sm:pb-2.5">{LIMIT_LABEL[k]}</p>
                <Select
                  aria-label={`${LIMIT_LABEL[k]}: origem`}
                  value={d.mode}
                  onChange={(e) => setDraft((s) => ({ ...s, limits: { ...s.limits, [k]: { ...d, mode: e.target.value as LimitMode } } }))}
                >
                  <option value="plan">Do plano ({planValue(k)})</option>
                  <option value="custom">Personalizado</option>
                  <option value="unlimited">Ilimitado</option>
                </Select>
                <Input
                  aria-label={`${LIMIT_LABEL[k]}: valor`}
                  type="number"
                  min={0}
                  disabled={d.mode !== "custom"}
                  placeholder={d.mode === "plan" ? planValue(k) : "—"}
                  value={d.mode === "custom" ? d.value : ""}
                  onChange={(e) => setDraft((s) => ({ ...s, limits: { ...s.limits, [k]: { ...d, value: e.target.value } } }))}
                />
              </div>
            );
          })}
          {FEATURES.map((k) => (
            <div key={k} className="grid gap-2 sm:grid-cols-[1fr_170px_120px] sm:items-end">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300 sm:pb-2.5">{FEATURE_LABEL[k]}</p>
              <Select
                aria-label={FEATURE_LABEL[k]}
                value={draft.features[k]}
                onChange={(e) => setDraft((s) => ({ ...s, features: { ...s.features, [k]: e.target.value as FeatureDraft } }))}
              >
                <option value="plan">Do plano ({planFeature(k)})</option>
                <option value="yes">Liberado</option>
                <option value="no">Bloqueado</option>
              </Select>
            </div>
          ))}
        </div>

        <Textarea label="Notas internas" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} hint="Visível só no console da plataforma." />
      </CardBody>
    </Card>
  );
}
