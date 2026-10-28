// Assinatura do plano (Mercado Pago): só o dono assina, troca ou cancela. Volta do pagamento (?assinatura=ok) sincroniza.
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { CreditCard } from "lucide-react";
import { useWorkspace } from "@/lib/workspace";
import { useEntitlements } from "@/hooks/use-entitlements";
import { useBilling, useBillingActions } from "@/hooks/use-billing";
import { formatDateTime } from "@/lib/format";
import type { WorkspaceSubscription } from "@/lib/database.types";
import { Badge, Button, Card, CardBody, CardHeader, ConfirmButton, Spinner, useToast } from "@/components/ui";

const STATUS: Record<WorkspaceSubscription["status"], { label: string; tone: "green" | "amber" | "red" | "neutral" }> = {
  authorized: { label: "ativa", tone: "green" },
  pending: { label: "aguardando pagamento", tone: "amber" },
  paused: { label: "pausada", tone: "red" },
  cancelled: { label: "cancelada", tone: "neutral" },
};

export function formatPlanPrice(price_cents: number | null, currency = "BRL"): string {
  if (price_cents === null) return "Sob consulta";
  return `${(price_cents / 100).toLocaleString("pt-BR", { style: "currency", currency, maximumFractionDigits: price_cents % 100 ? 2 : 0 })}/mês`;
}

export function SubscriptionCard() {
  const { workspaceId, isOwner } = useWorkspace();
  const entitlements = useEntitlements();
  const billing = useBilling(workspaceId, isOwner);
  const { checkout, sync, cancel } = useBillingActions(workspaceId);
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const returned = params.get("assinatura") === "ok";
  const { mutate: runSync } = sync;

  // Voltou do Mercado Pago: confirma o status na API (o webhook também faz isso, mas sem esperar por ele).
  useEffect(() => {
    if (!returned || !workspaceId || !isOwner) return;
    runSync(undefined, {
      onSuccess: (r) => toast.success(r.subscription?.status === "authorized" ? "Assinatura ativa. Obrigado!" : "Pagamento em processamento; o status atualiza em instantes."),
      onError: (e) => toast.error(e),
      onSettled: () => setParams({}, { replace: true }),
    });
  }, [returned, workspaceId, isOwner, runSync, toast, setParams]);

  if (!isOwner) return null;
  const sub = billing.data?.subscription ?? null;
  const active = sub?.status === "authorized";
  const plans = billing.data?.plans ?? [];
  const currentPlanId = entitlements.data?.plan?.id ?? null;

  async function subscribe(code: string) {
    try {
      const { init_point } = await checkout.mutateAsync(code);
      window.location.assign(init_point);
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Assinatura"
        description="Cobrança mensal no cartão pelo Mercado Pago. O plano muda assim que o pagamento é aprovado."
        actions={sub && <Badge tone={STATUS[sub.status].tone}>{STATUS[sub.status].label}</Badge>}
      />
      <CardBody className="space-y-4">
        {billing.isLoading ? (
          <div className="flex justify-center"><Spinner /></div>
        ) : billing.data && !billing.data.configured ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">A cobrança automática ainda não está disponível. Para assinar, fale com a gente.</p>
        ) : (
          <>
            {sub && (
              <div className="text-sm text-slate-600 dark:text-slate-400">
                {active && sub.next_payment_at && <p>Próxima cobrança em {formatDateTime(sub.next_payment_at)}.</p>}
                {sub.last_payment_at && <p>Último pagamento aprovado em {formatDateTime(sub.last_payment_at)}.</p>}
                {sub.status === "pending" && sub.init_point && (
                  <p>Pagamento ainda não concluído. <a href={sub.init_point} className="font-medium text-brand underline">Continuar no Mercado Pago</a></p>
                )}
                {sub.status === "paused" && <p>A assinatura está pausada no Mercado Pago (cobrança não aprovada). Regularize por lá ou assine de novo.</p>}
              </div>
            )}
            {!active && (
              <div className="grid gap-3 sm:grid-cols-2">
                {plans.map((p) => (
                  <div key={p.code} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-4 py-3 dark:border-slate-700">
                    <div>
                      <p className="font-medium">{p.name}{p.id === currentPlanId && <span className="ml-2 text-xs text-slate-500">(atual)</span>}</p>
                      <p className="text-sm text-slate-500 dark:text-slate-400">{formatPlanPrice(p.price_cents, p.currency)}</p>
                    </div>
                    {p.subscribable ? (
                      <Button size="sm" onClick={() => void subscribe(p.code)} loading={checkout.isPending}>
                        <CreditCard className="h-4 w-4" /> Assinar
                      </Button>
                    ) : (
                      <span className="text-xs text-slate-500">{p.price_cents === null ? "Fale com a gente" : "Em breve"}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {active && (
              <div className="flex flex-wrap items-center gap-3">
                <Button size="sm" variant="secondary" onClick={() => sync.mutate(undefined, { onError: (e) => toast.error(e) })} loading={sync.isPending}>Atualizar status</Button>
                <ConfirmButton size="sm" variant="ghost" title="Cancelar a assinatura?" description="O acesso continua até o fim do período já pago; depois o workspace é suspenso." onConfirm={() => cancel.mutateAsync().then(() => toast.success("Assinatura cancelada.")).catch((e) => toast.error(e))}>
                  Cancelar assinatura
                </ConfirmButton>
              </div>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
