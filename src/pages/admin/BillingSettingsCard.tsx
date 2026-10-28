// Cobrança (Mercado Pago) no console: credenciais cifradas, teste de conexão e criação dos planos de assinatura.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CreditCard, Link2, XCircle } from "lucide-react";
import { platformAdmin } from "@/lib/platform-admin";
import { formatDateTime } from "@/lib/format";
import type { PlatformSecretStatus } from "@/lib/database.types";
import { Button, Card, CardBody, CardHeader, CopyButton, ErrorState, Input, Spinner, useToast } from "@/components/ui";

const billingKey = ["admin", "billing"] as const;

function SecretLine({ label, status }: { label: string; status: PlatformSecretStatus }) {
  return (
    <p className="flex items-center gap-2 text-sm">
      {status.configured ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-slate-400" />}
      <span className="font-medium">{label}:</span>
      {status.configured
        ? <span className="text-slate-600 dark:text-slate-400">configurado (…{status.hint}){status.source === "env" ? ", pela variável de ambiente" : status.updated_at ? `, em ${formatDateTime(status.updated_at)}` : ""}</span>
        : <span className="text-slate-500">não configurado</span>}
    </p>
  );
}

export function BillingSettingsCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: billingKey, queryFn: platformAdmin.getBilling });
  const [token, setToken] = useState("");
  const [secret, setSecret] = useState("");
  const invalidate = () => void qc.invalidateQueries({ queryKey: billingKey });

  const save = useMutation({
    mutationFn: () => platformAdmin.setBillingSecrets({ ...(token.trim() ? { mercadopago_access_token: token } : {}), ...(secret.trim() ? { mercadopago_webhook_secret: secret } : {}) }),
    onSuccess: () => {
      setToken("");
      setSecret("");
      toast.success("Credenciais gravadas (cifradas).");
      invalidate();
    },
    onError: (e) => toast.error(e),
  });
  const test = useMutation({
    mutationFn: platformAdmin.testBilling,
    onSuccess: (r) => toast.success(`Conectado ao Mercado Pago: ${r.account.nickname ?? r.account.email ?? r.account.id} (${r.account.site_id ?? "?"}).`),
    onError: (e) => toast.error(e),
  });
  const sync = useMutation({
    mutationFn: platformAdmin.syncMpPlans,
    onSuccess: (r) => {
      toast.success(r.created.length ? `${r.created.length} plano(s) criado(s) no Mercado Pago.` : "Todos os planos com preço já existem no Mercado Pago.");
      invalidate();
      void qc.invalidateQueries({ queryKey: ["admin", "plans"] });
    },
    onError: (e) => toast.error(e),
  });

  return (
    <Card>
      <CardHeader title="Cobrança (Mercado Pago)" description="Assinatura mensal no cartão. As credenciais ficam cifradas no banco; cole aqui, nunca em chats ou telas de clientes." />
      <CardBody className="space-y-5">
        {q.isLoading ? (
          <div className="flex justify-center"><Spinner /></div>
        ) : q.error || !q.data ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <>
            <div className="space-y-1.5">
              <SecretLine label="Access Token" status={q.data.secrets.mercadopago_access_token} />
              <SecretLine label="Assinatura secreta do webhook" status={q.data.secrets.mercadopago_webhook_secret} />
            </div>
            <form
              className="grid gap-4 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!token.trim() && !secret.trim()) return toast.error("Cole pelo menos uma credencial.");
                save.mutate();
              }}
            >
              <Input label="Novo Access Token (produção)" type="password" autoComplete="off" placeholder="APP_USR-…" value={token} onChange={(e) => setToken(e.target.value)} hint="Suas integrações → aplicação → Credenciais de produção → Access Token (o longo; a Public Key, curta, não serve)." />
              <Input label="Nova assinatura secreta do webhook" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} hint="Webhooks → Configurar notificações → Assinatura secreta." />
              <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
                <Button type="submit" loading={save.isPending}>Gravar credenciais</Button>
                <Button type="button" variant="secondary" onClick={() => test.mutate()} loading={test.isPending} disabled={!q.data.secrets.mercadopago_access_token.configured}>Testar conexão</Button>
              </div>
            </form>

            <div className="rounded-lg border border-slate-200 p-4 text-sm dark:border-slate-700">
              <p className="flex flex-wrap items-center gap-2 font-medium"><Link2 className="h-4 w-4 text-brand" /> URL do webhook para cadastrar no Mercado Pago</p>
              <p className="mt-1 flex items-center gap-2 break-all font-mono text-xs text-slate-600 dark:text-slate-400">{q.data.webhook_url} <CopyButton value={q.data.webhook_url} /></p>
              <p className="mt-1 text-xs text-slate-500">Eventos: Planos e assinaturas (subscription_preapproval, subscription_authorized_payment).</p>
            </div>

            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-2 font-medium"><CreditCard className="h-4 w-4 text-brand" /> Planos de assinatura no Mercado Pago <span className="text-xs font-normal text-slate-500">(opcional: referência no painel do MP; a cobrança usa o preço do plano do Callia)</span></p>
                <Button size="sm" variant="secondary" onClick={() => sync.mutate()} loading={sync.isPending} disabled={!q.data.secrets.mercadopago_access_token.configured}>Criar planos que faltam</Button>
              </div>
              <ul className="mt-2 space-y-1 text-sm">
                {q.data.plans.filter((p) => p.active && p.code !== "trial").map((p) => (
                  <li key={p.code} className="flex flex-wrap items-center gap-2">
                    {p.mp_preapproval_plan_id ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-slate-400" />}
                    <span>{p.name}</span>
                    <span className="text-slate-500">{p.price_cents === null ? "sob consulta (não assina pelo site)" : p.mp_preapproval_plan_id ? <span className="font-mono text-xs">{p.mp_preapproval_plan_id}</span> : "ainda não criado"}</span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
