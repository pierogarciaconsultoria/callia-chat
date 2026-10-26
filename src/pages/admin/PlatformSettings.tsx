import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { platformAdmin } from "@/lib/platform-admin";
import type { PlatformSettings as Settings } from "@/lib/database.types";
import { Button, Card, CardBody, CardHeader, ErrorState, Input, PageHeader, PageLoader, Select, Switch, useToast } from "@/components/ui";
import { adminKeys } from "./shared";

export default function PlatformSettings() {
  const q = useQuery({ queryKey: adminKeys.settings, queryFn: platformAdmin.getSettings });
  const plans = useQuery({ queryKey: adminKeys.plans, queryFn: platformAdmin.listPlans });
  const [draft, setDraft] = useState<Settings | null>(null);
  const qc = useQueryClient();
  const toast = useToast();

  useEffect(() => {
    if (q.data) setDraft(q.data.settings);
  }, [q.data]);

  const save = useMutation({
    mutationFn: () => {
      const trial = Number(draft!.trial_days);
      if (!Number.isInteger(trial) || trial < 1 || trial > 365) throw new Error("Dias de avaliação: entre 1 e 365.");
      return platformAdmin.updateSettings({
        ...draft!,
        trial_days: trial,
        platform_name: draft!.platform_name.trim() || "Callia Chat",
        support_email: draft!.support_email?.trim() || null,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.settings });
      void qc.invalidateQueries({ queryKey: ["platform-settings"] });
      toast.success("Configurações salvas.");
    },
    onError: (e) => toast.error(e),
  });

  if (q.isLoading || !draft) return q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : <PageLoader />;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setDraft((s) => (s ? { ...s, [k]: v } : s));

  return (
    <>
      <PageHeader
        title="Configurações da plataforma"
        actions={
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            <Save className="h-4 w-4" /> Salvar
          </Button>
        }
      />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Novos clientes" description="Como os workspaces são criados." />
          <CardBody className="space-y-4">
            <Switch
              label="Permitir que usuários criem o próprio workspace"
              description="Desligado: só administradores da plataforma criam clientes (recomendado). Ligado: quem tiver conta cria um workspace em avaliação."
              checked={draft.allow_self_service_workspaces}
              onChange={(v) => set("allow_self_service_workspaces", v)}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label="Plano da avaliação"
                value={draft.self_service_plan_code ?? ""}
                onChange={(e) => set("self_service_plan_code", e.target.value || null)}
                hint="Usado nos workspaces criados por autoatendimento."
              >
                <option value="">Sem plano (ilimitado)</option>
                {plans.data?.plans.map((p) => (
                  <option key={p.id} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </Select>
              <Input
                label="Dias de avaliação"
                type="number"
                min={1}
                max={365}
                value={draft.trial_days}
                onChange={(e) => set("trial_days", Number(e.target.value))}
              />
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Identidade e suporte" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Input label="Nome da plataforma" value={draft.platform_name} onChange={(e) => set("platform_name", e.target.value)} />
            <Input
              label="E-mail de suporte"
              type="email"
              value={draft.support_email ?? ""}
              onChange={(e) => set("support_email", e.target.value)}
              hint="Mostrado a usuários sem workspace e em avisos de suspensão."
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
