import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { platformAdmin } from "@/lib/platform-admin";
import { formatDateTime } from "@/lib/format";
import type { PlatformAuditEntry } from "@/lib/database.types";
import {
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
} from "@/components/ui";
import { adminKeys } from "./shared";

export default function Audit() {
  const tenants = useQuery({ queryKey: adminKeys.tenants, queryFn: platformAdmin.listTenants });
  const [workspaceId, setWorkspaceId] = useState("");
  const [prefixInput, setPrefixInput] = useState("");
  const [prefix, setPrefix] = useState("");
  const [selected, setSelected] = useState<PlatformAuditEntry | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setPrefix(prefixInput.trim()), 350);
    return () => window.clearTimeout(t);
  }, [prefixInput]);

  const filters = { ...(workspaceId ? { workspace_id: workspaceId } : {}), ...(prefix ? { action_prefix: prefix } : {}), limit: 200 };
  const q = useQuery({ queryKey: adminKeys.audit(filters), queryFn: () => platformAdmin.audit(filters) });

  return (
    <>
      <PageHeader title="Auditoria" description="Ações administrativas de todos os clientes e da plataforma (prefixo platform.)." />
      <Card>
        <div className="grid gap-3 border-b border-slate-200 p-4 dark:border-slate-800 sm:grid-cols-2 sm:px-5">
          <Select aria-label="Cliente" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
            <option value="">Todos os clientes</option>
            {tenants.data?.tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          <Input aria-label="Prefixo da ação" placeholder="Prefixo da ação (ex.: platform., member., api_key.)" value={prefixInput} onChange={(e) => setPrefixInput(e.target.value)} />
        </div>
        {q.isLoading ? (
          <PageLoader />
        ) : q.error ? (
          <div className="p-4"><ErrorState error={q.error} onRetry={() => void q.refetch()} /></div>
        ) : !q.data?.entries.length ? (
          <EmptyState icon={ScrollText} title="Nenhum registro" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Quando</TH>
                <TH>Ação</TH>
                <TH>Cliente</TH>
                <TH>Quem</TH>
                <TH>Entidade</TH>
              </tr>
            </THead>
            <TBody>
              {q.data.entries.map((a) => (
                <TR key={a.id} className="cursor-pointer" onClick={() => setSelected(a)}>
                  <TD className="whitespace-nowrap text-xs">{formatDateTime(a.created_at)}</TD>
                  <TD className="font-mono text-xs">{a.action}</TD>
                  <TD className="text-xs">{a.workspace_name ?? "Plataforma"}</TD>
                  <TD className="text-xs">{a.actor_email ?? a.actor_type}</TD>
                  <TD className="text-xs">{a.entity ?? "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <Modal open={selected !== null} onClose={() => setSelected(null)} title={selected?.action ?? ""} description={formatDateTime(selected?.created_at)} side="right">
        <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-950">
          {JSON.stringify(selected, null, 2)}
        </pre>
      </Modal>
    </>
  );
}
