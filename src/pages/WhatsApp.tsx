import { useEffect, useState, type FormEvent } from "react";
import { KeyRound, Plug, PlugZap, Plus, QrCode, RefreshCw, Smartphone, Star, Trash2 } from "lucide-react";
import { useRequiredWorkspace } from "@/lib/workspace";
import { formatDateTime, formatPhone } from "@/lib/format";
import type { InstanceStatus, WhatsAppInstance } from "@/lib/database.types";
import { useInstanceMutations, useWhatsAppInstances, type InstanceAction } from "@/hooks/use-whatsapp-instances";
import { useEntitlements } from "@/hooks/use-entitlements";
import { createGate } from "@/lib/entitlements";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmButton,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  Notice,
  PageHeader,
  PageLoader,
  Spinner,
  Switch,
  statusTone,
  useToast,
} from "@/components/ui";

const STATUS_LABEL: Record<InstanceStatus, string> = {
  created: "Criada",
  connecting: "Conectando",
  qr: "Aguardando QR",
  open: "Conectada",
  close: "Desconectada",
  error: "Erro",
};

const PENDING: InstanceStatus[] = ["qr", "connecting"];

export default function WhatsApp() {
  const { workspaceId } = useRequiredWorkspace();
  const instances = useWhatsAppInstances(workspaceId);
  const { create, action } = useInstanceMutations(workspaceId);
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [makeDefault, setMakeDefault] = useState(true);
  const [qrFor, setQrFor] = useState<string | null>(null);

  const { data: entitlements } = useEntitlements();
  const gate = createGate(entitlements, "max_instances");
  const list = instances.data ?? [];
  const qrInstance = list.find((i) => i.id === qrFor) ?? null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const res = await create.mutateAsync({ name: name.trim(), make_default: makeDefault || list.length === 0 });
      setCreating(false);
      setName("");
      if (res.instance) setQrFor(res.instance.id);
      toast.success("Instância criada. Escaneie o QR Code no celular.");
    } catch (err) {
      toast.error(err);
    }
  }

  async function run(act: InstanceAction, inst: WhatsAppInstance, ok?: string) {
    try {
      await action.mutateAsync({ action: act, instance_id: inst.id });
      if (act === "connect") setQrFor(inst.id);
      if (ok) toast.success(ok);
    } catch (err) {
      toast.error(err);
    }
  }

  if (instances.isLoading) return <PageLoader />;

  return (
    <>
      <PageHeader
        title="WhatsApp"
        description="Conecte os números da empresa pela Evolution API. A instância padrão é usada nos envios proativos da API."
        actions={
          <Button
            disabled={!gate.allowed}
            title={gate.reason ?? undefined}
            onClick={() => { setMakeDefault(list.length === 0); setCreating(true); }}
          >
            <Plus className="h-4 w-4" /> Nova instância
          </Button>
        }
      />
      {gate.reason && (
        <div className="mb-4">
          <Notice tone="warn">{gate.reason}</Notice>
        </div>
      )}

      {instances.error ? (
        <ErrorState error={instances.error} onRetry={() => void instances.refetch()} />
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            icon={Smartphone}
            title="Nenhum WhatsApp conectado"
            description="Crie uma instância e escaneie o QR Code com o WhatsApp do celular da empresa (Aparelhos conectados → Conectar um aparelho)."
            action={<Button onClick={() => { setMakeDefault(true); setCreating(true); }}><Plus className="h-4 w-4" /> Conectar número</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {list.map((inst) => (
            <Card key={inst.id}>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    {inst.name}
                    {inst.is_default && <Star className="h-4 w-4 fill-amber-400 text-amber-400" aria-label="Instância padrão" />}
                  </span>
                }
                description={inst.instance_name}
                actions={<Badge tone={statusTone(inst.status)}>{STATUS_LABEL[inst.status]}</Badge>}
              />
              <CardBody className="space-y-3">
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-slate-500">Número</dt>
                  <dd className="min-w-0 truncate">{inst.phone_number ? formatPhone(inst.phone_number) : "—"}</dd>
                  <dt className="text-slate-500">Perfil</dt>
                  <dd className="min-w-0 truncate">{inst.profile_name ?? "—"}</dd>
                  <dt className="text-slate-500">Última conexão</dt>
                  <dd>{formatDateTime(inst.last_connected_at)}</dd>
                </dl>
                {inst.last_error && <p className="break-words text-xs text-red-600">{inst.last_error}</p>}
                <div className="flex flex-wrap gap-2">
                  {inst.status !== "open" && (
                    <Button size="sm" onClick={() => void run("connect", inst)} loading={action.isPending && action.variables?.instance_id === inst.id && action.variables.action === "connect"}>
                      <QrCode className="h-4 w-4" /> Conectar
                    </Button>
                  )}
                  <Button size="sm" variant="secondary" onClick={() => void run("refresh", inst, "Status atualizado.")}>
                    <RefreshCw className="h-4 w-4" /> Atualizar
                  </Button>
                  {!inst.is_default && (
                    <Button size="sm" variant="secondary" onClick={() => void run("set_default", inst, "Instância padrão definida.")}>
                      <Star className="h-4 w-4" /> Tornar padrão
                    </Button>
                  )}
                  {inst.status === "open" && (
                    <ConfirmButton
                      size="sm"
                      variant="secondary"
                      title="Desconectar este número?"
                      description="O WhatsApp sai da sessão e o agente para de receber mensagens até reconectar com um novo QR Code."
                      confirmLabel="Desconectar"
                      onConfirm={() => run("disconnect", inst, "Instância desconectada.")}
                    >
                      <Plug className="h-4 w-4" /> Desconectar
                    </ConfirmButton>
                  )}
                  <ConfirmButton
                    size="sm"
                    variant="ghost"
                    title="Rotacionar token do webhook?"
                    description="Gera um novo token e reconfigura o webhook na Evolution. Eventos com o token antigo passam a ser recusados."
                    confirmLabel="Rotacionar"
                    danger={false}
                    onConfirm={() => run("rotate_token", inst, "Token rotacionado e webhook reconfigurado.")}
                  >
                    <KeyRound className="h-4 w-4" /> Token
                  </ConfirmButton>
                  <ConfirmButton
                    size="sm"
                    variant="ghost"
                    title="Excluir instância?"
                    description="Remove a instância da Evolution. As conversas existentes continuam na inbox."
                    confirmLabel="Excluir"
                    onConfirm={() => run("delete", inst, "Instância excluída.")}
                    aria-label="Excluir instância"
                  >
                    <Trash2 className="h-4 w-4" />
                  </ConfirmButton>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Nova instância"
        description="Cada instância é um número de WhatsApp conectado."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>Cancelar</Button>
            <Button type="submit" form="instance-form" loading={create.isPending} disabled={name.trim().length < 2}>Criar e gerar QR</Button>
          </>
        }
      >
        <form id="instance-form" onSubmit={submit} className="space-y-4">
          <Input label="Nome" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Recepção" required minLength={2} />
          <Switch
            checked={makeDefault || list.length === 0}
            onChange={setMakeDefault}
            disabled={list.length === 0}
            label="Instância padrão"
            description="Usada pela API pública quando o envio não informa a instância."
          />
        </form>
      </Modal>

      {qrInstance && <QrModal instance={qrInstance} workspaceId={workspaceId} onClose={() => setQrFor(null)} />}
    </>
  );
}

function QrModal({ instance, workspaceId, onClose }: { instance: WhatsAppInstance; workspaceId: string; onClose: () => void }) {
  const { action } = useInstanceMutations(workspaceId);
  const toast = useToast();
  const pending = PENDING.includes(instance.status) || instance.status === "created";
  const connected = instance.status === "open";

  // Polling do status enquanto aguarda a leitura do QR; para ao conectar.
  useEffect(() => {
    if (!pending) return;
    const id = window.setInterval(() => {
      action.mutate({ action: "refresh", instance_id: instance.id });
    }, 4000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, instance.id]);

  useEffect(() => {
    if (connected) toast.success(`${instance.name} conectada.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  return (
    <Modal open onClose={onClose} title={`Conectar ${instance.name}`} size="sm">
      {connected ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <div className="rounded-full bg-emerald-100 p-3 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            <PlugZap className="h-7 w-7" />
          </div>
          <p className="font-medium">WhatsApp conectado</p>
          <p className="text-sm text-slate-500">{instance.phone_number ? formatPhone(instance.phone_number) : instance.profile_name}</p>
          <Button onClick={onClose}>Concluir</Button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <div className="flex aspect-square w-full max-w-[280px] items-center justify-center rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-700">
            {instance.qr_code ? (
              <img src={instance.qr_code} alt="QR Code para conectar o WhatsApp" className="h-full w-full object-contain" />
            ) : (
              <div className="flex flex-col items-center gap-2 text-sm text-slate-500">
                <Spinner />
                Gerando QR Code…
              </div>
            )}
          </div>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
            <li>Abra o WhatsApp no celular da empresa.</li>
            <li>Toque em <b>Aparelhos conectados</b> → <b>Conectar um aparelho</b>.</li>
            <li>Aponte a câmera para este código.</li>
          </ol>
          <p className="text-xs text-slate-400">O código se renova sozinho. Status: {STATUS_LABEL[instance.status]}</p>
          <Button variant="secondary" size="sm" onClick={() => action.mutate({ action: "connect", instance_id: instance.id })} loading={action.isPending && action.variables?.action === "connect"}>
            <RefreshCw className="h-4 w-4" /> Gerar novo código
          </Button>
        </div>
      )}
    </Modal>
  );
}
