import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, RefreshCcw, Save, Trash2, Webhook } from "lucide-react";
import { useWebhooks } from "@/hooks/use-webhooks";
import { formatWebhookEvents, supportedWebhookEvents } from "@/lib/webhooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

type FormState = {
  webhookId?: string;
  name: string;
  description: string;
  url: string;
  events: string[];
  headersText: string;
  isActive: boolean;
};

const emptyForm: FormState = {
  name: "",
  description: "",
  url: "",
  events: ["message.received"],
  headersText: "{}",
  isActive: true,
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Sem data";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function WebhooksPage() {
  const {
    currentWorkspace,
    canEdit,
    loading,
    submitting,
    webhooks,
    revealedSecret,
    setRevealedSecret,
    saveWebhook,
    deleteWebhook,
    rotateSecret,
    processPending,
  } = useWebhooks();
  const [form, setForm] = useState<FormState>(emptyForm);

  useEffect(() => {
    if (webhooks.length === 0) return;
    if (form.webhookId) return;
    const first = webhooks[0];
    setForm({
      webhookId: first.id,
      name: first.name,
      description: first.description ?? "",
      url: first.url,
      events: first.events,
      headersText: JSON.stringify(first.headers ?? {}, null, 2),
      isActive: first.is_active,
    });
  }, [form.webhookId, webhooks]);

  const selectWebhook = (webhookId?: string) => {
    if (!webhookId) {
      setForm(emptyForm);
      return;
    }

    const webhook = webhooks.find((item) => item.id === webhookId);
    if (!webhook) return;
    setForm({
      webhookId: webhook.id,
      name: webhook.name,
      description: webhook.description ?? "",
      url: webhook.url,
      events: webhook.events,
      headersText: JSON.stringify(webhook.headers ?? {}, null, 2),
      isActive: webhook.is_active,
    });
  };

  const parseHeaders = () => {
    try {
      const parsed = JSON.parse(form.headersText || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Headers invalidos");
      }
      return parsed as Record<string, string>;
    } catch {
      throw new Error("Headers devem ser um JSON valido.");
    }
  };

  const handleSave = async () => {
    try {
      await saveWebhook({
        webhookId: form.webhookId,
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        url: form.url.trim(),
        events: form.events,
        headers: parseHeaders(),
        isActive: form.isActive,
      });
      toast.success(form.webhookId ? "Webhook atualizado." : "Webhook criado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel salvar o webhook.");
    }
  };

  const handleDelete = async () => {
    if (!form.webhookId) return;
    try {
      await deleteWebhook(form.webhookId);
      setForm(emptyForm);
      toast.success("Webhook removido.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel remover o webhook.");
    }
  };

  const handleRotateSecret = async () => {
    if (!form.webhookId) return;
    try {
      await rotateSecret(form.webhookId);
      toast.success("Segredo do webhook rotacionado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel rotacionar o segredo.");
    }
  };

  const handleProcessPending = async () => {
    try {
      const result = await processPending();
      toast.success(`Processamento disparado. Pendentes avaliados: ${result?.processed ?? 0}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel processar entregas pendentes.");
    }
  };

  if (!currentWorkspace) {
    return <div className="p-8 text-sm text-muted-foreground">Selecione um workspace para continuar.</div>;
  }

  return (
    <div className="space-y-6 p-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Webhooks</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Configure callbacks externos com assinatura HMAC, escolha eventos e acompanhe retries e entregas pelo painel.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => selectWebhook(undefined)}>
            Novo webhook
          </Button>
          <Button variant="outline" onClick={handleProcessPending} disabled={submitting}>
            <RefreshCcw className="h-4 w-4" />
            Processar pendentes
          </Button>
        </div>
      </div>

      {revealedSecret ? (
        <Card className="border-emerald-300 bg-emerald-50">
          <CardHeader>
            <CardTitle>Segredo do webhook</CardTitle>
            <CardDescription>Copie este segredo agora. Ele aparece integralmente apenas neste momento.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea value={revealedSecret} readOnly className="min-h-[100px] font-mono text-sm" />
            <div className="flex gap-2">
              <Button onClick={() => navigator.clipboard.writeText(revealedSecret).then(() => toast.success("Segredo copiado."))}>
                <Copy className="h-4 w-4" />
                Copiar segredo
              </Button>
              <Button variant="outline" onClick={() => setRevealedSecret(null)}>
                Fechar
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <Webhook className="h-5 w-5 text-primary" />
              <div>
                <CardTitle>Configuração</CardTitle>
                <CardDescription>Crie ou edite endpoints externos habilitados para receber eventos do workspace.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="wh-name">Nome</Label>
              <Input
                id="wh-name"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                disabled={!canEdit || submitting}
                placeholder="CRM Principal"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wh-url">URL</Label>
              <Input
                id="wh-url"
                value={form.url}
                onChange={(e) => setForm((prev) => ({ ...prev, url: e.target.value }))}
                disabled={!canEdit || submitting}
                placeholder="https://crm.exemplo.com/webhooks/callia"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wh-description">Descricao</Label>
              <Textarea
                id="wh-description"
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                disabled={!canEdit || submitting}
              />
            </div>
            <div className="space-y-3">
              <Label>Eventos</Label>
              <div className="grid gap-2">
                {supportedWebhookEvents.map((event) => (
                  <label key={event} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                    <span>{event}</span>
                    <Switch
                      checked={form.events.includes(event)}
                      onCheckedChange={(checked) =>
                        setForm((prev) => ({
                          ...prev,
                          events: checked
                            ? Array.from(new Set([...prev.events, event]))
                            : prev.events.filter((item) => item !== event),
                        }))
                      }
                      disabled={!canEdit || submitting}
                    />
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="wh-headers">Headers extras</Label>
              <Textarea
                id="wh-headers"
                value={form.headersText}
                onChange={(e) => setForm((prev) => ({ ...prev, headersText: e.target.value }))}
                disabled={!canEdit || submitting}
                className="min-h-[120px] font-mono text-xs"
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border px-4 py-3">
              <div>
                <div className="font-medium">Webhook ativo</div>
                <div className="text-sm text-muted-foreground">Desative para interromper novas entregas.</div>
              </div>
              <Switch
                checked={form.isActive}
                onCheckedChange={(checked) => setForm((prev) => ({ ...prev, isActive: checked }))}
                disabled={!canEdit || submitting}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={handleSave} disabled={!canEdit || submitting || !form.name || !form.url || form.events.length === 0}>
                <Save className="h-4 w-4" />
                Salvar webhook
              </Button>
              <Button variant="outline" onClick={handleRotateSecret} disabled={!canEdit || submitting || !form.webhookId}>
                <RefreshCcw className="h-4 w-4" />
                Rotacionar segredo
              </Button>
              <Button variant="outline" onClick={handleDelete} disabled={!canEdit || submitting || !form.webhookId}>
                <Trash2 className="h-4 w-4" />
                Remover
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Webhooks do workspace</CardTitle>
            <CardDescription>Lista ativa do tenant com eventos assinados e segredos mascarados.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <div className="text-sm text-muted-foreground">Carregando webhooks...</div>
            ) : webhooks.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                Nenhum webhook configurado ainda.
              </div>
            ) : (
              webhooks.map((webhook) => (
                <button
                  key={webhook.id}
                  type="button"
                  onClick={() => selectWebhook(webhook.id)}
                  className="w-full rounded-xl border p-4 text-left transition-colors hover:bg-accent/40"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-medium">{webhook.name}</div>
                        <Badge variant="outline" className={webhook.is_active ? "border-emerald-300 bg-emerald-100 text-emerald-800" : "border-slate-300 bg-slate-100 text-slate-700"}>
                          {webhook.is_active ? "Ativo" : "Inativo"}
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">{webhook.url}</div>
                      <div className="text-xs text-muted-foreground">Segredo: {webhook.secret_masked}</div>
                      <div className="text-xs text-muted-foreground">Eventos: {formatWebhookEvents(webhook.events)}</div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Atualizado em {formatDateTime(webhook.updated_at)}
                    </div>
                  </div>
                </button>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
