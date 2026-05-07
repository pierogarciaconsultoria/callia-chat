import { toast } from "sonner";
import { RefreshCcw } from "lucide-react";
import { useLogs } from "@/hooks/use-logs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Sem data";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function JsonPreview({ value }: { value: unknown }) {
  return (
    <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">
      {JSON.stringify(value ?? {}, null, 2)}
    </pre>
  );
}

export default function LogsPage() {
  const {
    currentWorkspace,
    canView,
    loading,
    auditLogs,
    webhookDeliveries,
    publicApiRequests,
    outboundMessages,
    refresh,
  } = useLogs();

  const handleRefresh = async () => {
    try {
      await refresh();
      toast.success("Logs atualizados.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel atualizar os logs.");
    }
  };

  if (!currentWorkspace) {
    return <div className="p-8 text-sm text-muted-foreground">Selecione um workspace para continuar.</div>;
  }

  if (!canView) {
    return (
      <div className="p-8">
        <Card>
          <CardHeader>
            <CardTitle>Logs</CardTitle>
            <CardDescription>Apenas `owner` e `admin` podem acessar auditoria e rastros operacionais.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Logs</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Auditoria operacional do workspace com requests da API pública, entregas de webhooks, outbound e trilha administrativa.
          </p>
        </div>
        <Button variant="outline" onClick={handleRefresh} disabled={loading}>
          <RefreshCcw className="h-4 w-4" />
          Atualizar
        </Button>
      </div>

      <Tabs defaultValue="webhooks" className="space-y-4">
        <TabsList>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          <TabsTrigger value="api">API Pública</TabsTrigger>
          <TabsTrigger value="outbound">Outbound</TabsTrigger>
          <TabsTrigger value="audit">Auditoria</TabsTrigger>
        </TabsList>

        <TabsContent value="webhooks">
          <Card>
            <CardHeader>
              <CardTitle>Entregas de webhooks</CardTitle>
              <CardDescription>Histórico de callbacks externos, status, retries e respostas recebidas.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {loading ? (
                <div className="text-sm text-muted-foreground">Carregando entregas...</div>
              ) : webhookDeliveries.length === 0 ? (
                <div className="text-sm text-muted-foreground">Nenhuma entrega registrada ainda.</div>
              ) : (
                webhookDeliveries.map((delivery) => (
                  <div key={delivery.id} className="rounded-xl border p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="font-medium">{delivery.event}</div>
                          <Badge variant="outline">{delivery.delivery_status}</Badge>
                          <Badge variant="outline">Tentativa {delivery.attempt_number}</Badge>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {delivery.webhook?.name || "Webhook"} • {delivery.webhook_url || delivery.webhook?.url || "URL nao registrada"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Ultima tentativa: {formatDateTime(delivery.last_attempt_at || delivery.attempted_at)}
                        </div>
                        {delivery.error ? (
                          <div className="text-xs text-rose-700">Erro: {delivery.error}</div>
                        ) : null}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        HTTP {delivery.response_status ?? "--"} • entregue em {formatDateTime(delivery.delivered_at)}
                      </div>
                    </div>
                    <div className="mt-3 grid gap-3 lg:grid-cols-2">
                      <JsonPreview value={delivery.payload} />
                      <JsonPreview
                        value={{
                          request_headers: delivery.request_headers,
                          response_headers: delivery.response_headers,
                          response_body: delivery.response_body,
                          next_retry_at: delivery.next_retry_at,
                        }}
                      />
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="api">
          <Card>
            <CardHeader>
              <CardTitle>Requests da API pública</CardTitle>
              <CardDescription>Rastro autenticado por chave com endpoint, status e payloads.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {loading ? (
                <div className="text-sm text-muted-foreground">Carregando requests...</div>
              ) : publicApiRequests.length === 0 ? (
                <div className="text-sm text-muted-foreground">Nenhum request da API pública registrado.</div>
              ) : (
                publicApiRequests.map((item) => (
                  <div key={item.id} className="rounded-xl border p-4">
                    <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="font-medium">{item.method} {item.endpoint}</div>
                        <div className="text-sm text-muted-foreground">
                          Status {item.status_code} • {formatDateTime(item.created_at)}
                        </div>
                      </div>
                      {item.error_code ? <Badge variant="outline">{item.error_code}</Badge> : null}
                    </div>
                    <div className="mt-3 grid gap-3 lg:grid-cols-2">
                      <JsonPreview value={item.request_body} />
                      <JsonPreview value={item.response_body} />
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="outbound">
          <Card>
            <CardHeader>
              <CardTitle>Outbound</CardTitle>
              <CardDescription>Mensagens enviadas ao provedor com status, retries e payload do provider.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {loading ? (
                <div className="text-sm text-muted-foreground">Carregando outbound...</div>
              ) : outboundMessages.length === 0 ? (
                <div className="text-sm text-muted-foreground">Nenhum outbound registrado ainda.</div>
              ) : (
                outboundMessages.map((item) => (
                  <div key={item.id} className="rounded-xl border p-4">
                    <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="font-medium">{item.message?.content || item.payload?.text || "Mensagem sem texto"}</div>
                        <div className="text-sm text-muted-foreground">
                          {item.message?.sender || "bot"} • {item.delivery_status} • {formatDateTime(item.queued_at)}
                        </div>
                      </div>
                      <Badge variant="outline">Retries {item.retry_count ?? 0}</Badge>
                    </div>
                    <div className="mt-3 grid gap-3 lg:grid-cols-2">
                      <JsonPreview value={item.payload} />
                      <JsonPreview
                        value={{
                          provider_message_id: item.provider_message_id,
                          last_error: item.last_error,
                          sent_at: item.sent_at,
                          delivered_at: item.delivered_at,
                        }}
                      />
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit">
          <Card>
            <CardHeader>
              <CardTitle>Auditoria administrativa</CardTitle>
              <CardDescription>Alterações operacionais como criação, rotação e remoção de chaves e webhooks.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {loading ? (
                <div className="text-sm text-muted-foreground">Carregando auditoria...</div>
              ) : auditLogs.length === 0 ? (
                <div className="text-sm text-muted-foreground">Nenhum evento de auditoria registrado.</div>
              ) : (
                auditLogs.map((item) => (
                  <div key={item.id} className="rounded-xl border p-4">
                    <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="font-medium">{item.action}</div>
                        <div className="text-sm text-muted-foreground">
                          {item.actor_type} • alvo {item.target || "n/a"} • {formatDateTime(item.created_at)}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3">
                      <JsonPreview value={item.metadata} />
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
