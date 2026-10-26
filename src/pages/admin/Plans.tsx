import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers, Pencil, Plus } from "lucide-react";
import { platformAdmin, type PlanInput } from "@/lib/platform-admin";
import { formatLimit } from "@/lib/entitlements";
import type { Plan } from "@/lib/database.types";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  PageHeader,
  PageLoader,
  Switch,
  Table,
  TBody,
  TD,
  Textarea,
  TH,
  THead,
  TR,
  useToast,
} from "@/components/ui";
import { adminKeys, formatPriceCents } from "./shared";

interface Draft {
  id?: string;
  code: string;
  name: string;
  description: string;
  price: string;
  currency: string;
  max_instances: string;
  max_members: string;
  max_monthly_messages: string;
  max_knowledge_sources: string;
  ai_enabled: boolean;
  external_agent_enabled: boolean;
  connectors_enabled: boolean;
  active: boolean;
  position: string;
}

const LIMIT_FIELDS = [
  { key: "max_instances", label: "Instâncias de WhatsApp" },
  { key: "max_members", label: "Membros da equipe" },
  { key: "max_monthly_messages", label: "Mensagens automáticas/mês" },
  { key: "max_knowledge_sources", label: "Fontes de conhecimento" },
] as const;

const str = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

function toDraft(p?: Plan): Draft {
  return {
    id: p?.id,
    code: p?.code ?? "",
    name: p?.name ?? "",
    description: p?.description ?? "",
    price: p?.price_cents === null || p?.price_cents === undefined ? "" : (p.price_cents / 100).toFixed(2).replace(".", ","),
    currency: p?.currency ?? "BRL",
    max_instances: str(p?.max_instances),
    max_members: str(p?.max_members),
    max_monthly_messages: str(p?.max_monthly_messages),
    max_knowledge_sources: str(p?.max_knowledge_sources),
    ai_enabled: p?.ai_enabled ?? true,
    external_agent_enabled: p?.external_agent_enabled ?? true,
    connectors_enabled: p?.connectors_enabled ?? true,
    active: p?.active ?? true,
    position: str(p?.position ?? 0),
  };
}

// Campo vazio = ilimitado.
function parseLimit(value: string, label: string, min = 0): number | null {
  if (!value.trim()) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) throw new Error(`${label}: use um número inteiro a partir de ${min} ou deixe em branco para ilimitado.`);
  return n;
}

function parsePriceCents(value: string): number | null {
  const v = value.trim();
  if (!v) return null;
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0) throw new Error("Preço inválido.");
  return Math.round(n * 100);
}

export default function Plans() {
  const q = useQuery({ queryKey: adminKeys.plans, queryFn: platformAdmin.listPlans });
  const [editing, setEditing] = useState<Draft | null>(null);
  const qc = useQueryClient();
  const toast = useToast();

  const toggle = useMutation({
    mutationFn: (p: Plan) => platformAdmin.upsertPlan({ ...p, active: !p.active }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: adminKeys.plans });
      toast.success(r.plan.active ? "Plano ativado." : "Plano desativado para novos clientes.");
    },
    onError: (e) => toast.error(e),
  });

  return (
    <>
      <PageHeader
        title="Planos"
        description="Limites e recursos de cada plano. Campos em branco são ilimitados. Desativar um plano só o esconde de novos clientes."
        actions={
          <Button onClick={() => setEditing(toDraft())}>
            <Plus className="h-4 w-4" /> Novo plano
          </Button>
        }
      />
      <Card>
        {q.isLoading ? (
          <PageLoader />
        ) : q.error ? (
          <div className="p-4"><ErrorState error={q.error} onRetry={() => void q.refetch()} /></div>
        ) : !q.data?.plans.length ? (
          <EmptyState icon={Layers} title="Nenhum plano" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Plano</TH>
                <TH>Preço</TH>
                <TH>WhatsApp</TH>
                <TH>Equipe</TH>
                <TH>Mensagens/mês</TH>
                <TH>Fontes</TH>
                <TH>Recursos</TH>
                <TH>Ativo</TH>
                <TH />
              </tr>
            </THead>
            <TBody>
              {q.data.plans.map((p) => (
                <TR key={p.id}>
                  <TD>
                    <p className="font-medium text-slate-900 dark:text-slate-100">{p.name}</p>
                    <p className="font-mono text-xs text-slate-500">{p.code}</p>
                  </TD>
                  <TD className="whitespace-nowrap">{formatPriceCents(p.price_cents, p.currency)}</TD>
                  <TD>{formatLimit(p.max_instances)}</TD>
                  <TD>{formatLimit(p.max_members)}</TD>
                  <TD>{formatLimit(p.max_monthly_messages)}</TD>
                  <TD>{formatLimit(p.max_knowledge_sources)}</TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={p.ai_enabled ? "green" : "neutral"}>IA</Badge>
                      <Badge tone={p.external_agent_enabled ? "green" : "neutral"}>Externo</Badge>
                      <Badge tone={p.connectors_enabled ? "green" : "neutral"}>Conectores</Badge>
                    </div>
                  </TD>
                  <TD>
                    <Switch checked={p.active} disabled={toggle.isPending} onChange={() => toggle.mutate(p)} />
                  </TD>
                  <TD>
                    <Button size="sm" variant="ghost" aria-label="Editar" onClick={() => setEditing(toDraft(p))}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      {editing && <PlanModal draft={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function PlanModal({ draft: initial, onClose }: { draft: Draft; onClose: () => void }) {
  const [d, setD] = useState(initial);
  const qc = useQueryClient();
  const toast = useToast();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((s) => ({ ...s, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const plan: PlanInput = {
        ...(d.id ? { id: d.id } : {}),
        code: d.code.trim(),
        name: d.name.trim(),
        description: d.description.trim() || null,
        price_cents: parsePriceCents(d.price),
        currency: d.currency.trim().toUpperCase() || "BRL",
        max_instances: parseLimit(d.max_instances, "Instâncias"),
        max_members: parseLimit(d.max_members, "Membros", 1),
        max_monthly_messages: parseLimit(d.max_monthly_messages, "Mensagens"),
        max_knowledge_sources: parseLimit(d.max_knowledge_sources, "Fontes"),
        ai_enabled: d.ai_enabled,
        external_agent_enabled: d.external_agent_enabled,
        connectors_enabled: d.connectors_enabled,
        active: d.active,
        position: Number(d.position) || 0,
      };
      return platformAdmin.upsertPlan(plan);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin"] });
      toast.success("Plano salvo.");
      onClose();
    },
    onError: (e) => toast.error(e),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={d.id ? "Editar plano" : "Novo plano"}
      description={d.id ? "Mudanças valem na hora para todos os clientes deste plano." : undefined}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" form="plan-form" loading={save.isPending}>Salvar</Button>
        </>
      }
    >
      <form id="plan-form" onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Nome" required value={d.name} onChange={(e) => set("name", e.target.value)} />
          <Input
            label="Código"
            required
            pattern="[a-z0-9_-]{2,40}"
            value={d.code}
            onChange={(e) => set("code", e.target.value.toLowerCase())}
            hint="Minúsculas, números, - e _. Ex.: profissional"
            disabled={Boolean(d.id)}
          />
        </div>
        <Textarea label="Descrição" rows={2} value={d.description} onChange={(e) => set("description", e.target.value)} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Preço mensal" inputMode="decimal" placeholder="Ex.: 199,90" value={d.price} onChange={(e) => set("price", e.target.value)} hint="Informativo; em branco = sob consulta." />
          <Input label="Moeda" maxLength={3} value={d.currency} onChange={(e) => set("currency", e.target.value)} />
          <Input label="Ordem" type="number" value={d.position} onChange={(e) => set("position", e.target.value)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {LIMIT_FIELDS.map((f) => (
            <Input
              key={f.key}
              label={f.label}
              type="number"
              min={f.key === "max_members" ? 1 : 0}
              placeholder="ilimitado"
              value={d[f.key]}
              onChange={(e) => set(f.key, e.target.value)}
            />
          ))}
        </div>
        <div className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
          <Switch label="IA" description="Respostas da IA, transcrição de áudio e leitura de imagens. Sem ela, o agente responde só com a FAQ." checked={d.ai_enabled} onChange={(v) => set("ai_enabled", v)} />
          <Switch label="Agente externo" description="Encaminhar mensagens para n8n, LangChain etc." checked={d.external_agent_enabled} onChange={(v) => set("external_agent_enabled", v)} />
          <Switch label="Conectores" description="Integrações como o motor de reservas hbook." checked={d.connectors_enabled} onChange={(v) => set("connectors_enabled", v)} />
          <Switch label="Ativo" description="Disponível para novos clientes." checked={d.active} onChange={(v) => set("active", v)} />
        </div>
      </form>
    </Modal>
  );
}
