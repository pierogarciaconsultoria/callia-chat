import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, ScrollText } from "lucide-react";
import { useRequiredWorkspace } from "@/lib/workspace";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/functions";
import { formatDateTime, formatPhone } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Modal,
  PageHeader,
  Spinner,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Tabs,
  statusTone,
} from "@/components/ui";

type TabId = "webhooks" | "api" | "outbound" | "agent" | "inbound" | "audit";
type Row = Record<string, unknown> & { id: string; created_at: string };

interface Column {
  label: string;
  render: (r: Row) => ReactNode;
  className?: string;
}

interface TabDef {
  label: string;
  table: string;
  statusField?: string;
  statuses?: string[];
  columns: Column[];
}

const s = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
const status = (v: unknown) => <Badge tone={statusTone(String(v))}>{s(v)}</Badge>;
const code = (v: unknown) => <code className="text-xs">{s(v)}</code>;

const TABS: Record<TabId, TabDef> = {
  webhooks: {
    label: "Webhooks",
    table: "webhook_deliveries",
    statusField: "status",
    statuses: ["pending", "retrying", "success", "failed"],
    columns: [
      { label: "Evento", render: (r) => code(r.event) },
      { label: "Status", render: (r) => status(r.status) },
      { label: "Tentativas", render: (r) => s(r.attempts) },
      { label: "HTTP", render: (r) => s(r.last_status_code) },
      { label: "Erro", render: (r) => <span className="block max-w-[240px] truncate">{s(r.last_error)}</span> },
    ],
  },
  api: {
    label: "API pública",
    table: "public_api_requests",
    statusField: "status_code",
    statuses: ["200", "201", "202", "400", "401", "403", "404", "409", "422", "429", "500", "502"],
    columns: [
      { label: "Requisição", render: (r) => <code className="whitespace-nowrap text-xs">{s(r.method)} {s(r.path)}</code> },
      {
        label: "Status",
        render: (r) => {
          const c = Number(r.status_code);
          return <Badge tone={c < 300 ? "green" : c < 500 ? "amber" : "red"}>{c}</Badge>;
        },
      },
      { label: "Erro", render: (r) => code(r.error_code) },
      { label: "Duração", render: (r) => (r.duration_ms != null ? `${r.duration_ms} ms` : "—") },
      { label: "IP", render: (r) => s(r.ip) },
    ],
  },
  outbound: {
    label: "Envios",
    table: "outbound_messages",
    statusField: "status",
    statuses: ["queued", "sent", "failed"],
    columns: [
      { label: "Para", render: (r) => <span className="whitespace-nowrap">{formatPhone(String(r.to_phone ?? ""))}</span> },
      { label: "Origem", render: (r) => <Badge>{s(r.origin)}</Badge> },
      { label: "Tipo", render: (r) => s(r.type) },
      { label: "Status", render: (r) => status(r.status) },
      { label: "Erro", render: (r) => <span className="block max-w-[240px] truncate">{s(r.error)}</span> },
    ],
  },
  agent: {
    label: "Agente",
    table: "agent_runs",
    statusField: "status",
    statuses: ["running", "replied", "handoff", "skipped", "superseded", "failed"],
    columns: [
      { label: "Status", render: (r) => status(r.status) },
      { label: "Motor", render: (r) => s(r.engine) },
      { label: "Motivo", render: (r) => <span className="block max-w-[220px] truncate">{s(r.reason)}</span> },
      { label: "Latência", render: (r) => (r.latency_ms != null ? `${r.latency_ms} ms` : "—") },
      { label: "Erro", render: (r) => <span className="block max-w-[220px] truncate">{s(r.error)}</span> },
    ],
  },
  inbound: {
    label: "Eventos recebidos",
    table: "inbound_events",
    statusField: "status",
    statuses: ["received", "processed", "ignored", "failed"],
    columns: [
      { label: "Evento", render: (r) => code(r.event_type) },
      { label: "Provedor", render: (r) => s(r.provider) },
      { label: "Status", render: (r) => status(r.status) },
      { label: "Erro", render: (r) => <span className="block max-w-[240px] truncate">{s(r.error)}</span> },
    ],
  },
  audit: {
    label: "Auditoria",
    table: "audit_logs",
    columns: [
      { label: "Ação", render: (r) => code(r.action) },
      { label: "Ator", render: (r) => <Badge>{s(r.actor_type)}</Badge> },
      { label: "Entidade", render: (r) => <span className="whitespace-nowrap">{s(r.entity)} {r.entity_id ? <code className="text-xs text-slate-400">{String(r.entity_id).slice(0, 8)}</code> : null}</span> },
    ],
  },
};

export default function Logs() {
  const { workspaceId } = useRequiredWorkspace();
  const [tab, setTab] = useState<TabId>("webhooks");
  const [filter, setFilter] = useState("all");
  const [detail, setDetail] = useState<Row | null>(null);
  const def = TABS[tab];

  const query = useQuery({
    queryKey: ["logs", workspaceId, tab, filter],
    queryFn: async () => {
      let q = supabase.from(def.table).select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(100);
      if (filter !== "all" && def.statusField) q = q.eq(def.statusField, def.statusField === "status_code" ? Number(filter) : filter);
      return unwrap(await q) as Row[];
    },
  });

  return (
    <>
      <PageHeader title="Logs" description="As 100 entradas mais recentes de cada trilha operacional." />
      <Tabs<TabId>
        className="mb-4"
        value={tab}
        onChange={(t) => {
          setTab(t);
          setFilter("all");
        }}
        tabs={(Object.keys(TABS) as TabId[]).map((id) => ({ id, label: TABS[id].label }))}
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          {def.statuses && (
            <select
              aria-label="Filtrar por status"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            >
              <option value="all">Todos os status</option>
              {def.statuses.map((st) => <option key={st} value={st}>{st}</option>)}
            </select>
          )}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void query.refetch()} loading={query.isFetching}>
            <RefreshCw className="h-4 w-4" /> Atualizar
          </Button>
        </div>
        {query.isLoading ? (
          <div className="flex justify-center p-8"><Spinner /></div>
        ) : query.error ? (
          <div className="p-4"><ErrorState error={query.error} onRetry={() => void query.refetch()} /></div>
        ) : query.data?.length === 0 ? (
          <EmptyState icon={ScrollText} title="Nada registrado" description="Os eventos aparecem aqui conforme o sistema é usado." />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Quando</TH>
                {def.columns.map((c) => <TH key={c.label}>{c.label}</TH>)}
              </tr>
            </THead>
            <TBody>
              {query.data?.map((r) => (
                <TR key={r.id} className="cursor-pointer" onClick={() => setDetail(r)}>
                  <TD className="whitespace-nowrap">{formatDateTime(r.created_at)}</TD>
                  {def.columns.map((c) => <TD key={c.label}>{c.render(r)}</TD>)}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title="Detalhes" description={detail ? formatDateTime(detail.created_at) : undefined} side="right">
        {detail && (
          <pre className="whitespace-pre-wrap break-all rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">
            {JSON.stringify(detail, null, 2)}
          </pre>
        )}
      </Modal>
    </>
  );
}
