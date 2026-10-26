import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, KeyRound, Plus, RotateCw, Ban } from "lucide-react";
import { useRequiredWorkspace } from "@/lib/workspace";
import { supabase, PUBLIC_API_BASE } from "@/lib/supabase";
import { invokeFunction, unwrap } from "@/lib/functions";
import { formatDateTime } from "@/lib/format";
import type { ApiKey } from "@/lib/database.types";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CodeBlock,
  ConfirmButton,
  CopyButton,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  PageHeader,
  Spinner,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from "@/components/ui";

const COLUMNS = "id, workspace_id, name, prefix, last4, scopes, created_by, created_at, last_used_at, expires_at, revoked_at";

function keyState(k: ApiKey): { label: string; tone: "green" | "red" | "neutral" } {
  if (k.revoked_at) return { label: "Revogada", tone: "red" };
  if (k.expires_at && new Date(k.expires_at) < new Date()) return { label: "Expirada", tone: "neutral" };
  return { label: "Ativa", tone: "green" };
}

export default function ApiKeys() {
  const { workspaceId } = useRequiredWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  const key = ["api_keys", workspaceId];
  const keys = useQuery({
    queryKey: key,
    queryFn: async () =>
      unwrap(
        await supabase.from("api_keys").select(COLUMNS).eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
      ) as unknown as ApiKey[],
  });
  const mutate = useMutation({
    mutationFn: (body: Record<string, unknown>) => invokeFunction<{ api_key: ApiKey; raw_key?: string }>("manage-api-keys", body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
  });

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [expires, setExpires] = useState("");
  const [revealed, setRevealed] = useState<{ name: string; raw: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const res = await mutate.mutateAsync({
        action: "create",
        workspace_id: workspaceId,
        name: name.trim(),
        expires_at: expires ? new Date(`${expires}T23:59:59`).toISOString() : undefined,
      });
      setCreating(false);
      setName("");
      setExpires("");
      if (res.raw_key) setRevealed({ name: res.api_key.name, raw: res.raw_key });
    } catch (err) {
      toast.error(err);
    }
  }

  async function rotate(k: ApiKey) {
    try {
      const res = await mutate.mutateAsync({ action: "rotate", key_id: k.id });
      if (res.raw_key) setRevealed({ name: res.api_key.name, raw: res.raw_key });
    } catch (err) {
      toast.error(err);
    }
  }

  const base = PUBLIC_API_BASE;

  return (
    <>
      <PageHeader
        title="Chaves de API"
        description="Autenticam sistemas externos (ERP, CRM, n8n) na API pública. Cada chave só acessa este workspace."
        actions={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Nova chave</Button>}
      />

      <div className="space-y-6">
        <Card>
          {keys.isLoading ? (
            <CardBody className="flex justify-center"><Spinner /></CardBody>
          ) : keys.error ? (
            <CardBody><ErrorState error={keys.error} onRetry={() => void keys.refetch()} /></CardBody>
          ) : keys.data?.length === 0 ? (
            <EmptyState icon={KeyRound} title="Nenhuma chave criada" description="Crie uma chave para integrar seu sistema à API pública." />
          ) : (
            <Table>
              <THead><tr><TH>Nome</TH><TH>Chave</TH><TH>Status</TH><TH>Criada</TH><TH>Último uso</TH><TH>Expira</TH><TH className="text-right">Ações</TH></tr></THead>
              <TBody>
                {keys.data?.map((k) => {
                  const st = keyState(k);
                  const active = st.label === "Ativa";
                  return (
                    <TR key={k.id}>
                      <TD className="font-medium text-slate-900 dark:text-slate-100">{k.name}</TD>
                      <TD><code className="whitespace-nowrap text-xs">{k.prefix}…{k.last4}</code></TD>
                      <TD><Badge tone={st.tone}>{st.label}</Badge></TD>
                      <TD className="whitespace-nowrap">{formatDateTime(k.created_at)}</TD>
                      <TD className="whitespace-nowrap">{formatDateTime(k.last_used_at)}</TD>
                      <TD className="whitespace-nowrap">{k.expires_at ? formatDateTime(k.expires_at) : "Nunca"}</TD>
                      <TD className="text-right">
                        {active && (
                          <div className="flex justify-end gap-1">
                            <ConfirmButton
                              size="sm"
                              variant="ghost"
                              danger={false}
                              title="Rotacionar chave?"
                              description="A chave atual é revogada na hora e uma nova é gerada com o mesmo nome. Atualize o sistema que a usa."
                              confirmLabel="Rotacionar"
                              onConfirm={() => rotate(k)}
                            >
                              <RotateCw className="h-4 w-4" /> Rotacionar
                            </ConfirmButton>
                            <ConfirmButton
                              size="sm"
                              variant="ghost"
                              title="Revogar chave?"
                              description="Chamadas com esta chave passam a receber 403 imediatamente."
                              confirmLabel="Revogar"
                              onConfirm={() =>
                                mutate.mutateAsync({ action: "revoke", key_id: k.id }).then(
                                  () => toast.success("Chave revogada."),
                                  (e) => toast.error(e),
                                )
                              }
                            >
                              <Ban className="h-4 w-4" /> Revogar
                            </ConfirmButton>
                          </div>
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title="Como usar" description="Envie a chave no header x-api-key. O workspace é sempre o da chave." />
          <CardBody className="space-y-4">
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Enviar mensagem (usa a instância padrão se não informar instanceId)</p>
              <CodeBlock
                code={`curl -X POST "${base}/messages" \\
  -H "x-api-key: ck_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": { "phone": "+5511999999999", "name": "Ana" },
    "type": "text",
    "text": "Sua reserva está confirmada!",
    "externalId": "pedido-123"
  }'`}
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Espelhar conversa de outro canal na inbox (não envia nada)</p>
              <CodeBlock
                code={`curl -X POST "${base}/messages/ingest" \\
  -H "x-api-key: ck_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "externalId": "wamid.HBgN...",
    "channel": "whatsapp_cloud",
    "direction": "inbound",
    "sender": "customer",
    "contact": { "phone": "+5511999999999", "name": "Ana" },
    "type": "text",
    "content": "Oi, qual o horário de vocês?",
    "timestamp": "2026-10-12T12:00:00Z"
  }'`}
              />
            </div>
            <p className="text-xs text-slate-500">
              Outros endpoints: <code>GET /conversations</code>, <code>GET /conversations/:id/messages</code>, <code>POST /events</code>,{" "}
              <code>GET /knowledge/search?q=</code>, <code>GET /agent/context</code>, <code>GET /connectors/hbook/availability</code>.
            </p>
          </CardBody>
        </Card>
      </div>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Nova chave de API"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>Cancelar</Button>
            <Button type="submit" form="key-form" loading={mutate.isPending}>Gerar chave</Button>
          </>
        }
      >
        <form id="key-form" onSubmit={submit} className="space-y-4">
          <Input label="Nome" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: ERP produção" />
          <Input
            label="Expira em (opcional)"
            type="date"
            value={expires}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setExpires(e.target.value)}
          />
        </form>
      </Modal>

      <Modal
        open={Boolean(revealed)}
        onClose={() => setRevealed(null)}
        title={`Chave "${revealed?.name ?? ""}"`}
        footer={<Button onClick={() => setRevealed(null)}>Já copiei</Button>}
      >
        {revealed && (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Esta é a única vez que a chave aparece. Guardamos apenas o hash — se perder, rotacione.
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className="min-w-0 flex-1 break-all rounded-lg bg-slate-100 px-3 py-2 text-sm dark:bg-slate-800">{revealed.raw}</code>
              <CopyButton value={revealed.raw} />
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
