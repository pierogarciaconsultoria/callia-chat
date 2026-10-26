import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, KeyRound, Pencil, Plus, RotateCw, Send, Trash2, Webhook as WebhookIcon } from "lucide-react";
import { useRequiredWorkspace } from "@/lib/workspace";
import { supabase } from "@/lib/supabase";
import { invokeFunction, unwrap } from "@/lib/functions";
import { formatDateTime } from "@/lib/format";
import { WEBHOOK_EVENTS, type Webhook, type WebhookDelivery } from "@/lib/database.types";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  CodeBlock,
  ConfirmButton,
  CopyButton,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  PageHeader,
  Spinner,
  Switch,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  statusTone,
  useToast,
} from "@/components/ui";

const COLUMNS = "id, workspace_id, name, url, events, active, secret_last4, max_attempts, created_by, created_at, updated_at";

const EVENT_LABEL: Record<string, string> = {
  "message.received": "Mensagem recebida",
  "message.sent": "Mensagem enviada",
  "conversation.handoff": "Transferência para humano",
  "public_api.event.received": "Evento recebido pela API",
};

interface Draft {
  id?: string;
  name: string;
  url: string;
  events: string[];
  active: boolean;
  max_attempts: number;
}

const emptyDraft: Draft = { name: "", url: "", events: [...WEBHOOK_EVENTS], active: true, max_attempts: 6 };

export default function Webhooks() {
  const { workspaceId } = useRequiredWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  const hooksKey = ["webhooks", workspaceId];
  const deliveriesKey = ["webhook_deliveries", workspaceId];

  const webhooks = useQuery({
    queryKey: hooksKey,
    queryFn: async () =>
      unwrap(
        await supabase.from("webhooks").select(COLUMNS).eq("workspace_id", workspaceId).order("created_at"),
      ) as unknown as Webhook[],
  });
  const deliveries = useQuery({
    queryKey: deliveriesKey,
    refetchInterval: 15000,
    queryFn: async () =>
      unwrap(
        await supabase
          .from("webhook_deliveries")
          .select("*")
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false })
          .limit(30),
      ) as WebhookDelivery[],
  });

  const mutate = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      invokeFunction<{ webhook?: Webhook; secret?: string; delivery?: WebhookDelivery; deleted?: boolean }>("manage-webhooks", body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: hooksKey });
      void qc.invalidateQueries({ queryKey: deliveriesKey });
    },
  });

  const [draft, setDraft] = useState<Draft | null>(null);
  const [secret, setSecret] = useState<{ name: string; value: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    if (draft.events.length === 0) {
      toast.error("Escolha ao menos um evento.");
      return;
    }
    try {
      const body = { name: draft.name.trim(), url: draft.url.trim(), events: draft.events, max_attempts: draft.max_attempts };
      const res = draft.id
        ? await mutate.mutateAsync({ action: "update", webhook_id: draft.id, ...body, active: draft.active })
        : await mutate.mutateAsync({ action: "create", workspace_id: workspaceId, ...body });
      setDraft(null);
      if (res.secret) setSecret({ name: body.name, value: res.secret });
      else toast.success("Webhook atualizado.");
    } catch (err) {
      toast.error(err);
    }
  }

  const call = async (body: Record<string, unknown>, ok: string) => {
    try {
      const res = await mutate.mutateAsync(body);
      if (res.secret) setSecret({ name: res.webhook?.name ?? "", value: res.secret });
      else toast.success(ok);
    } catch (err) {
      toast.error(err);
    }
  };

  const hookName = (id: string) => webhooks.data?.find((w) => w.id === id)?.name ?? "—";

  return (
    <>
      <PageHeader
        title="Webhooks"
        description="Avise seus sistemas quando algo acontece no atendimento. Entregas são assinadas e retentadas em caso de falha."
        actions={<Button onClick={() => setDraft({ ...emptyDraft })}><Plus className="h-4 w-4" /> Novo webhook</Button>}
      />

      <div className="space-y-6">
        <Card>
          {webhooks.isLoading ? (
            <CardBody className="flex justify-center"><Spinner /></CardBody>
          ) : webhooks.error ? (
            <CardBody><ErrorState error={webhooks.error} onRetry={() => void webhooks.refetch()} /></CardBody>
          ) : webhooks.data?.length === 0 ? (
            <EmptyState icon={WebhookIcon} title="Nenhum webhook" description="Cadastre a URL do seu sistema para receber eventos em tempo real." />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {webhooks.data?.map((w) => (
                <li key={w.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:px-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{w.name}</p>
                      <Badge tone={w.active ? "green" : "neutral"}>{w.active ? "Ativo" : "Pausado"}</Badge>
                    </div>
                    <p className="mt-0.5 break-all text-sm text-slate-500">{w.url}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {w.events.map((ev) => <Badge key={ev} tone="blue">{ev}</Badge>)}
                    </div>
                    <p className="mt-2 text-xs text-slate-400">Segredo …{w.secret_last4} · até {w.max_attempts} tentativas</p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Button size="sm" variant="secondary" onClick={() => void call({ action: "test", webhook_id: w.id }, "Evento de teste enviado.")}>
                      <Send className="h-4 w-4" /> Testar
                    </Button>
                    <Button size="sm" variant="ghost" aria-label="Editar" onClick={() => setDraft({ id: w.id, name: w.name, url: w.url, events: w.events, active: w.active, max_attempts: w.max_attempts })}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <ConfirmButton
                      size="sm"
                      variant="ghost"
                      danger={false}
                      title="Rotacionar segredo?"
                      description="O segredo atual deixa de assinar as próximas entregas. Atualize o sistema que valida a assinatura."
                      confirmLabel="Rotacionar"
                      onConfirm={() => call({ action: "rotate_secret", webhook_id: w.id }, "Segredo rotacionado.")}
                      aria-label="Rotacionar segredo"
                    >
                      <KeyRound className="h-4 w-4" />
                    </ConfirmButton>
                    <ConfirmButton
                      size="sm"
                      variant="ghost"
                      title="Excluir webhook?"
                      description="O histórico de entregas deste webhook também é removido."
                      confirmLabel="Excluir"
                      onConfirm={() => call({ action: "delete", webhook_id: w.id }, "Webhook excluído.")}
                      aria-label="Excluir"
                    >
                      <Trash2 className="h-4 w-4" />
                    </ConfirmButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Entregas recentes" description="Atualiza a cada 15 segundos. O histórico completo fica em Logs." />
          {deliveries.isLoading ? (
            <CardBody className="flex justify-center"><Spinner /></CardBody>
          ) : deliveries.error ? (
            <CardBody><ErrorState error={deliveries.error} /></CardBody>
          ) : deliveries.data?.length === 0 ? (
            <EmptyState title="Nenhuma entrega ainda" />
          ) : (
            <Table>
              <THead><tr><TH>Quando</TH><TH>Webhook</TH><TH>Evento</TH><TH>Status</TH><TH>Tentativas</TH><TH>HTTP</TH><TH className="text-right" /></tr></THead>
              <TBody>
                {deliveries.data?.map((d) => (
                  <TR key={d.id}>
                    <TD className="whitespace-nowrap">{formatDateTime(d.created_at)}</TD>
                    <TD>{hookName(d.webhook_id)}</TD>
                    <TD><code className="text-xs">{d.event}</code></TD>
                    <TD>
                      <Badge tone={statusTone(d.status)}>{d.status}</Badge>
                      {d.last_error && <p className="mt-1 max-w-[220px] truncate text-xs text-red-600" title={d.last_error}>{d.last_error}</p>}
                    </TD>
                    <TD>{d.attempts}</TD>
                    <TD>{d.last_status_code ?? "—"}</TD>
                    <TD className="text-right">
                      {(d.status === "failed" || d.status === "retrying") && (
                        <Button size="sm" variant="ghost" onClick={() => void call({ action: "retry", delivery_id: d.id }, "Reenvio solicitado.")}>
                          <RotateCw className="h-4 w-4" /> Reenviar
                        </Button>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title="Verificando a assinatura" />
          <CardBody className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
            <p>
              Cada entrega traz os headers <code>x-callia-event</code>, <code>x-callia-delivery-id</code>, <code>x-callia-correlation-id</code>,{" "}
              <code>x-callia-attempt</code>, <code>x-callia-timestamp</code> e <code>x-callia-signature</code>.
            </p>
            <p>
              A assinatura é <code>sha256=&lt;hex&gt;</code>, um HMAC-SHA256 com o segredo do webhook sobre{" "}
              <code>{"`${x-callia-timestamp}.${corpo bruto}`"}</code>. Compare em tempo constante e recuse timestamps com mais de 5 minutos.
            </p>
            <CodeBlock
              code={`import crypto from "node:crypto";

function isValid(req, rawBody, secret) {
  const ts = req.headers["x-callia-timestamp"];
  const sig = req.headers["x-callia-signature"] ?? "";
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(\`\${ts}.\${rawBody}\`).digest("hex");
  const fresh = Math.abs(Date.now() / 1000 - Number(ts)) < 300;
  return fresh && sig.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}`}
            />
            <p className="text-xs text-slate-500">Responda com HTTP 2xx em até 10 segundos; qualquer outro status conta como falha e gera nova tentativa.</p>
          </CardBody>
        </Card>
      </div>

      <Modal
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft?.id ? "Editar webhook" : "Novo webhook"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDraft(null)}>Cancelar</Button>
            <Button type="submit" form="webhook-form" loading={mutate.isPending}>Salvar</Button>
          </>
        }
      >
        {draft && (
          <form id="webhook-form" onSubmit={submit} className="space-y-4">
            <Input label="Nome" required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <Input label="URL" type="url" required value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="https://" />
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-300">Eventos</legend>
              {WEBHOOK_EVENTS.map((ev) => (
                <Checkbox
                  key={ev}
                  checked={draft.events.includes(ev)}
                  onChange={(on) => setDraft({ ...draft, events: on ? [...draft.events, ev] : draft.events.filter((x) => x !== ev) })}
                  label={<span>{EVENT_LABEL[ev]} <code className="text-xs text-slate-400">{ev}</code></span>}
                />
              ))}
            </fieldset>
            <Input
              label="Máximo de tentativas"
              type="number"
              min={1}
              max={12}
              value={draft.max_attempts}
              onChange={(e) => setDraft({ ...draft, max_attempts: Number(e.target.value) })}
            />
            {draft.id && <Switch checked={draft.active} onChange={(v) => setDraft({ ...draft, active: v })} label="Ativo" />}
          </form>
        )}
      </Modal>

      <Modal open={Boolean(secret)} onClose={() => setSecret(null)} title="Segredo de assinatura" footer={<Button onClick={() => setSecret(null)}>Já copiei</Button>}>
        {secret && (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Guarde este segredo no sistema que recebe "{secret.name}". Ele não será exibido de novo.
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className="min-w-0 flex-1 break-all rounded-lg bg-slate-100 px-3 py-2 text-sm dark:bg-slate-800">{secret.value}</code>
              <CopyButton value={secret.value} />
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
