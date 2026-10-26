import { CheckCircle2, XCircle } from "lucide-react";
import { useEntitlements } from "@/hooks/use-entitlements";
import { FEATURE_LABEL, LIMIT_LABEL, limitState, STATUS_LABEL, statusToneOf } from "@/lib/entitlements";
import { formatDateTime } from "@/lib/format";
import type { FeatureKey, NumericLimitKey } from "@/lib/database.types";
import { Badge, Card, CardBody, CardHeader, ErrorState, Spinner } from "@/components/ui";
import { UsageBar } from "./UsageBar";

const LIMITS: NumericLimitKey[] = ["max_monthly_messages", "max_instances", "max_members", "max_knowledge_sources"];
const FEATURES: FeatureKey[] = ["ai_enabled", "external_agent_enabled", "connectors_enabled"];

// Plano contratado, status e consumo do mês (somente leitura para o tenant).
export function PlanUsageCard() {
  const { data, isLoading, error, refetch } = useEntitlements();
  return (
    <Card>
      <CardHeader
        title="Plano e uso"
        description="Mensagens automáticas (bot e API) contam para a cota mensal; respostas da equipe não contam."
        actions={
          data && (
            <>
              <Badge tone="brand">{data.plan?.name ?? "Sem plano (ilimitado)"}</Badge>
              <Badge tone={statusToneOf(data.effective_status)}>{STATUS_LABEL[data.effective_status]}</Badge>
            </>
          )
        }
      />
      <CardBody className="space-y-5">
        {isLoading ? (
          <div className="flex justify-center"><Spinner /></div>
        ) : error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : data ? (
          <>
            {data.trial_ends_at && data.status === "trial" && (
              <p className="text-sm text-slate-600 dark:text-slate-400">Avaliação até {formatDateTime(data.trial_ends_at)}.</p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              {LIMITS.map((k) => {
                const st = limitState(data, k);
                return <UsageBar key={k} label={LIMIT_LABEL[k]} used={st.used} limit={st.limit} />;
              })}
            </div>
            <ul className="grid gap-2 sm:grid-cols-3">
              {FEATURES.map((k) => {
                const on = data.limits[k] !== false;
                return (
                  <li key={k} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                    {on ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-slate-400" />}
                    <span className={on ? "" : "text-slate-400 line-through"}>{FEATURE_LABEL[k]}</span>
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-slate-500 dark:text-slate-400">Para mudar de plano ou ampliar limites, fale com o suporte.</p>
          </>
        ) : null}
      </CardBody>
    </Card>
  );
}
