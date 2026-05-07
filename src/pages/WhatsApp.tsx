import { type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Copy,
  Link2,
  MessageSquare,
  Pencil,
  Plus,
  Power,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Star,
  Trash2,
} from "lucide-react";
import { useWhatsAppInstances } from "@/hooks/use-whatsapp-instances";
import {
  createEmptyWhatsAppInstanceForm,
  createWhatsAppInstanceForm,
  getQrCodeSrc,
  getWebhookUrl,
  getWhatsAppStatusMeta,
  type WhatsAppInstanceForm,
  type WhatsAppInstanceRecord,
} from "@/lib/whatsapp-instances";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type Mode = "create" | "edit";

const emptyBusyMap: Record<string, boolean> = {};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

export default function WhatsAppPage() {
  const {
    currentWorkspace,
    instances,
    loading,
    canEdit,
    refresh,
    saveInstance,
    deleteInstance,
    setDefaultInstance,
    rotateWebhookToken,
    syncWithEvolution,
    bootstrapInstance,
  } = useWhatsAppInstances();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<Mode>("create");
  const [editingInstance, setEditingInstance] = useState<WhatsAppInstanceRecord | null>(null);
  const [form, setForm] = useState<WhatsAppInstanceForm>(createEmptyWhatsAppInstanceForm());
  const [saving, setSaving] = useState(false);
  const [busyMap, setBusyMap] = useState<Record<string, boolean>>(emptyBusyMap);

  const hasDefaultInstance = useMemo(
    () => instances.some((instance) => instance.is_default),
    [instances],
  );

  const openCreateDialog = () => {
    setDialogMode("create");
    setEditingInstance(null);
    setForm(createEmptyWhatsAppInstanceForm());
    setDialogOpen(true);
  };

  const openEditDialog = (instance: WhatsAppInstanceRecord) => {
    setDialogMode("edit");
    setEditingInstance(instance);
    setForm(createWhatsAppInstanceForm(instance));
    setDialogOpen(true);
  };

  const updateForm = <K extends keyof WhatsAppInstanceForm>(field: K, value: WhatsAppInstanceForm[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const withBusy = async (key: string, action: () => Promise<void>) => {
    setBusyMap((prev) => ({ ...prev, [key]: true }));
    try {
      await action();
    } finally {
      setBusyMap((prev) => ({ ...prev, [key]: false }));
    }
  };

  const handleSave = async () => {
    if (!currentWorkspace) return;
    if (!form.instance_name || !form.evolution_base_url || !form.provider_secret_ref) {
      toast.error("Preencha nome da instância, base URL e provider secret ref.");
      return;
    }

    try {
      setSaving(true);
      if (dialogMode === "create") {
        await bootstrapInstance(form);
        toast.success("Instância criada e enviada para conexão.");
      } else {
        await saveInstance(editingInstance?.id ?? null, form);
        toast.success("Instância atualizada.");
      }
      setDialogOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar a instância.");
    } finally {
      setSaving(false);
    }
  };

  const copyText = async (value: string | null, successMessage: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success(successMessage);
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Carregando instâncias de WhatsApp...</div>;
  }

  if (!currentWorkspace) {
    return <div className="p-8 text-sm text-muted-foreground">Selecione um workspace para continuar.</div>;
  }

  return (
    <div className="space-y-6 p-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">WhatsApp</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Gerencie múltiplas instâncias por workspace, configure a Evolution API, escolha a instância padrão e acompanhe QR, status e webhook.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refresh()} disabled={loading}>
            <RefreshCw className="h-4 w-4" />
            Atualizar lista
          </Button>
          <Button onClick={openCreateDialog} disabled={!canEdit}>
            <Plus className="h-4 w-4" />
            Nova instância
          </Button>
        </div>
      </div>

      {!canEdit ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Seu perfil atual pode visualizar as instâncias, mas apenas `owner` e `admin` podem gerenciá-las.
        </div>
      ) : null}

      {!hasDefaultInstance ? (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          Ainda não existe uma instância padrão neste workspace. Isso é importante para o envio proativo da `POST /api/messages` na fase da API pública.
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Como configurar os segredos</CardTitle>
          <CardDescription>
            O campo `provider secret ref` deve apontar para uma secret do Supabase Edge Functions contendo a API key da Evolution.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm text-muted-foreground lg:grid-cols-2">
          <div className="rounded-lg border p-4">
            <div className="font-medium text-foreground">Exemplo de secret ref</div>
            <div className="mt-2 font-mono text-xs">EVOLUTION_API_KEY_CLIENTE_A</div>
          </div>
          <div className="rounded-lg border p-4">
            <div className="font-medium text-foreground">Exemplo de secret</div>
            <div className="mt-2 font-mono text-xs">supabase secrets set EVOLUTION_API_KEY_CLIENTE_A=seu-token</div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {instances.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-sm text-muted-foreground">
              Nenhuma instância cadastrada. Crie a primeira instância para iniciar a conexão com a Evolution API.
            </CardContent>
          </Card>
        ) : null}

        {instances.map((instance) => {
          const statusMeta = getWhatsAppStatusMeta(instance.status);
          const qrSrc = getQrCodeSrc(instance.qr_code);
          const webhookUrl = getWebhookUrl({
            supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
            instanceId: instance.id,
            token: instance.webhook_token,
          });

          return (
            <Card key={instance.id}>
              <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle>{instance.display_name || instance.instance_name}</CardTitle>
                    <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
                    {instance.is_default ? (
                      <Badge variant="secondary">
                        <Star className="mr-1 h-3 w-3" />
                        Padrão
                      </Badge>
                    ) : null}
                  </div>
                  <CardDescription className="space-y-1">
                    <div>Instância técnica: `{instance.instance_name}`</div>
                    <div>Base URL: `{instance.evolution_base_url || "não configurada"}`</div>
                    <div>Secret ref: `{instance.provider_secret_ref || "não configurada"}`</div>
                    <div>Telefone: `{instance.phone_number || "não informado"}`</div>
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => openEditDialog(instance)} disabled={!canEdit}>
                    <Pencil className="h-4 w-4" />
                    Editar
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      withBusy(`refresh:${instance.id}`, async () => {
                        await syncWithEvolution("refresh_status", instance.id);
                        toast.success("Status atualizado.");
                      })
                    }
                    disabled={!canEdit || busyMap[`refresh:${instance.id}`]}
                  >
                    <RefreshCw className="h-4 w-4" />
                    Atualizar status
                  </Button>
                  <Button
                    size="sm"
                    onClick={() =>
                      withBusy(`connect:${instance.id}`, async () => {
                        await syncWithEvolution("connect_instance", instance.id);
                        toast.success("Conexão iniciada.");
                      })
                    }
                    disabled={!canEdit || busyMap[`connect:${instance.id}`]}
                  >
                    <Power className="h-4 w-4" />
                    Conectar
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="grid gap-5 lg:grid-cols-[1.3fr_0.9fr]">
                <div className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-xl border p-4">
                      <div className="mb-2 flex items-center gap-2 font-medium">
                        <ShieldCheck className="h-4 w-4 text-primary" />
                        Webhook do workspace
                      </div>
                      <div className="break-all text-xs text-muted-foreground">{webhookUrl || "Indisponível"}</div>
                      <div className="mt-3 flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => copyText(webhookUrl, "Webhook copiado.")}
                        >
                          <Copy className="h-4 w-4" />
                          Copiar
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            withBusy(`token:${instance.id}`, async () => {
                              await rotateWebhookToken(instance.id);
                              toast.success("Webhook token rotacionado.");
                            })
                          }
                          disabled={!canEdit || busyMap[`token:${instance.id}`]}
                        >
                          <RefreshCw className="h-4 w-4" />
                          Rotacionar token
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-xl border p-4">
                      <div className="mb-2 flex items-center gap-2 font-medium">
                        <MessageSquare className="h-4 w-4 text-primary" />
                        Roteamento
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {instance.is_default
                          ? "Esta instância já é a padrão do workspace."
                          : "Você pode defini-la como padrão para envios proativos e fallback operacional."}
                      </div>
                      <div className="mt-3 flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            withBusy(`default:${instance.id}`, async () => {
                              await setDefaultInstance(instance.id);
                              toast.success("Instância padrão atualizada.");
                            })
                          }
                          disabled={!canEdit || instance.is_default || busyMap[`default:${instance.id}`]}
                        >
                          <Star className="h-4 w-4" />
                          Tornar padrão
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            withBusy(`disconnect:${instance.id}`, async () => {
                              await syncWithEvolution("disconnect_instance", instance.id);
                              toast.success("Instância desconectada.");
                            })
                          }
                          disabled={!canEdit || busyMap[`disconnect:${instance.id}`]}
                        >
                          <Power className="h-4 w-4" />
                          Desconectar
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-lg border p-4 text-sm">
                      <div className="text-muted-foreground">Último status</div>
                      <div className="mt-1 font-medium">{statusMeta.label}</div>
                    </div>
                    <div className="rounded-lg border p-4 text-sm">
                      <div className="text-muted-foreground">Última atividade</div>
                      <div className="mt-1 font-medium">{instance.last_seen_at || "Sem dados"}</div>
                    </div>
                    <div className="rounded-lg border p-4 text-sm">
                      <div className="text-muted-foreground">Provider</div>
                      <div className="mt-1 font-medium">{instance.provider_type}</div>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border p-4">
                  <div className="mb-3 flex items-center gap-2 font-medium">
                    <QrCode className="h-4 w-4 text-primary" />
                    QR Code da conexão
                  </div>
                  {qrSrc ? (
                    <div className="space-y-3">
                      <img src={qrSrc} alt="QR Code da instância" className="mx-auto max-h-72 rounded-lg border bg-white p-3" />
                      <div className="flex justify-center">
                        <Button variant="outline" size="sm" onClick={() => copyText(instance.qr_code, "QR copiado.")}>
                          <Copy className="h-4 w-4" />
                          Copiar QR bruto
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                      O QR aparecerá aqui quando a Evolution retornar a etapa de autenticação.
                    </div>
                  )}
                </div>
              </CardContent>
              <CardContent className="pt-0">
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      withBusy(`copy-secret:${instance.id}`, async () => {
                        await copyText(instance.provider_secret_ref, "Secret ref copiada.");
                      })
                    }
                  >
                    <Link2 className="h-4 w-4" />
                    Copiar secret ref
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() =>
                      withBusy(`delete:${instance.id}`, async () => {
                        await deleteInstance(instance.id);
                        toast.success("Instância removida.");
                      })
                    }
                    disabled={!canEdit || busyMap[`delete:${instance.id}`]}
                  >
                    <Trash2 className="h-4 w-4" />
                    Excluir
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogMode === "create" ? "Nova instância WhatsApp" : "Editar instância"}</DialogTitle>
            <DialogDescription>
              Configure os dados públicos da instância e a referência do segredo da Evolution.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <Field label="Nome exibido">
              <Input value={form.display_name} onChange={(e) => updateForm("display_name", e.target.value)} />
            </Field>
            <Field label="Instance name">
              <Input value={form.instance_name} onChange={(e) => updateForm("instance_name", e.target.value)} />
            </Field>
            <Field label="Evolution base URL">
              <Input
                value={form.evolution_base_url}
                onChange={(e) => updateForm("evolution_base_url", e.target.value)}
                placeholder="https://evolution.seudominio.com"
              />
            </Field>
            <Field label="Provider secret ref">
              <Input
                value={form.provider_secret_ref}
                onChange={(e) => updateForm("provider_secret_ref", e.target.value)}
                placeholder="EVOLUTION_API_KEY_CLIENTE_A"
              />
            </Field>
            <Field label="Telefone vinculado">
              <Input value={form.phone_number} onChange={(e) => updateForm("phone_number", e.target.value)} />
            </Field>
            <div className="flex items-center justify-between rounded-lg border px-4 py-3">
              <div>
                <div className="font-medium">Instância padrão</div>
                <div className="text-sm text-muted-foreground">
                  Define esta instância como padrão para o workspace.
                </div>
              </div>
              <Switch checked={form.is_default} onCheckedChange={(checked) => updateForm("is_default", checked)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={!canEdit || saving}>
              {saving ? "Salvando..." : dialogMode === "create" ? "Criar e conectar" : "Salvar alterações"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
