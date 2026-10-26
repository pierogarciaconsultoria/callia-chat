import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Building2, CheckCircle2 } from "lucide-react";
import { platformAdmin } from "@/lib/platform-admin";
import type { AttentionKind } from "@/lib/database.types";
import { Badge, Card, CardHeader, EmptyState, ErrorState, PageHeader, PageLoader, type BadgeTone } from "@/components/ui";
import { adminKeys, formatNumber } from "./shared";

const ATTENTION: Record<AttentionKind, { label: string; tone: BadgeTone }> = {
  instance_down: { label: "WhatsApp desconectado", tone: "red" },
  quota_exceeded: { label: "Cota esgotada", tone: "red" },
  quota_near: { label: "Cota quase no fim", tone: "amber" },
  trial_ending: { label: "Avaliação terminando", tone: "amber" },
  trial_expired: { label: "Avaliação vencida", tone: "red" },
  agent_failures: { label: "Falhas do agente", tone: "red" },
  webhook_failures: { label: "Falhas de webhook", tone: "amber" },
};

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </Card>
  );
}

export default function Overview() {
  const q = useQuery({ queryKey: adminKeys.overview, queryFn: platformAdmin.overview, refetchInterval: 60_000 });

  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const { totals, attention } = q.data!;

  return (
    <>
      <PageHeader
        title="Visão geral da plataforma"
        description="Clientes, uso do mês e o que precisa de atenção."
        actions={
          <Link to="/admin/tenants" className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-medium text-brand-fg shadow-sm hover:bg-brand/90">
            <Building2 className="h-4 w-4" /> Clientes
          </Link>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Clientes" value={formatNumber(totals.tenants)} hint={`${formatNumber(totals.active)} ativos · ${formatNumber(totals.trial)} em avaliação`} />
        <Tile
          label="Inativos"
          value={formatNumber(totals.suspended + totals.canceled + totals.trial_expired)}
          hint={`${formatNumber(totals.suspended)} suspensos · ${formatNumber(totals.trial_expired)} avaliação vencida · ${formatNumber(totals.canceled)} cancelados`}
        />
        <Tile label="Usuários" value={formatNumber(totals.users)} />
        <Tile label="WhatsApp online" value={formatNumber(totals.instances_open)} hint="instâncias conectadas" />
        <Tile label="Mensagens automáticas" value={formatNumber(totals.monthly_messages)} hint="neste mês (bot e API)" />
        <Tile label="Execuções da IA" value={formatNumber(totals.monthly_ai_runs)} hint="neste mês" />
        <Tile label="Tokens de IA" value={formatNumber(totals.monthly_ai_tokens)} hint="neste mês" />
      </div>

      <Card className="mt-6">
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" /> Atenção
            </span>
          }
          description="Situações que costumam virar chamado de suporte."
        />
        {attention.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="Tudo em ordem" description="Nenhum cliente com alerta no momento." />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {attention.map((a, i) => (
              <li key={`${a.workspace_id}-${a.kind}-${i}`}>
                <Link
                  to={`/admin/tenants/${a.workspace_id}`}
                  className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 sm:px-5"
                >
                  <Badge tone={ATTENTION[a.kind]?.tone ?? "neutral"}>{ATTENTION[a.kind]?.label ?? a.kind}</Badge>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{a.workspace_name}</span>
                  <span className="w-full text-sm text-slate-500 dark:text-slate-400 sm:w-auto">{a.detail}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
