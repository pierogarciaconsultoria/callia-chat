import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Copy, KeyRound, RefreshCcw, ShieldCheck, Trash2 } from "lucide-react";
import { useApiKeys } from "@/hooks/use-api-keys";
import {
  buildPublicApiBaseUrl,
  getApiKeyStatusLabel,
  getApiKeyStatusTone,
  maskStoredApiKey,
} from "@/lib/public-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Nunca";

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function ApiKeysPage() {
  const {
    currentWorkspace,
    canEdit,
    loading,
    submitting,
    keys,
    revealedKey,
    setRevealedKey,
    createKey,
    rotateKey,
    revokeKey,
  } = useApiKeys();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const baseUrl = buildPublicApiBaseUrl();

  const curlExample = useMemo(() => {
    const sampleKey = revealedKey || "ah_live_SUA_CHAVE_AQUI";
    return `curl -X POST "${baseUrl}/messages" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: ${sampleKey}" \\
  -d '{
    "phoneNumber": "5511999999999",
    "text": "Olá! Esta é uma mensagem proativa via API pública.",
    "idempotencyKey": "msg-demo-001"
  }'`;
  }, [baseUrl, revealedKey]);

  const copyText = async (value: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(successMessage);
    } catch {
      toast.error("Nao foi possivel copiar para a area de transferencia.");
    }
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error("Informe um nome para a chave.");
      return;
    }

    try {
      await createKey({
        name: name.trim(),
        description: description.trim() || undefined,
      });
      setName("");
      setDescription("");
      toast.success("Chave criada com sucesso.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel criar a chave.");
    }
  };

  const handleRotate = async (apiKeyId: string) => {
    try {
      await rotateKey(apiKeyId);
      toast.success("Chave rotacionada com sucesso.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel rotacionar a chave.");
    }
  };

  const handleRevoke = async (apiKeyId: string) => {
    try {
      await revokeKey(apiKeyId);
      toast.success("Chave revogada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel revogar a chave.");
    }
  };

  if (!currentWorkspace) {
    return <div className="p-8 text-sm text-muted-foreground">Selecione um workspace para continuar.</div>;
  }

  return (
    <div className="space-y-6 p-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">API Keys</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Gere e administre credenciais da API pública para envio proativo, eventos e leitura de conversas do workspace.
          </p>
        </div>
        <Badge variant="outline" className="w-fit gap-1">
          <ShieldCheck className="h-3.5 w-3.5" />
          Workspace: {currentWorkspace.name}
        </Badge>
      </div>

      {!canEdit && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Seu perfil atual pode visualizar esta area, mas apenas `owner` e `admin` podem gerar, rotacionar ou revogar chaves.
        </div>
      )}

      {revealedKey ? (
        <Card className="border-emerald-300 bg-emerald-50">
          <CardHeader>
            <CardTitle>Chave gerada</CardTitle>
            <CardDescription>
              Esta chave aparece apenas agora. Copie e armazene em local seguro antes de sair desta tela.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea value={revealedKey} readOnly className="min-h-[100px] font-mono text-sm" />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => copyText(revealedKey, "Chave copiada.")}>
                <Copy className="h-4 w-4" />
                Copiar chave
              </Button>
              <Button variant="outline" onClick={() => setRevealedKey(null)}>
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
              <KeyRound className="h-5 w-5 text-primary" />
              <div>
                <CardTitle>Nova chave</CardTitle>
                <CardDescription>Crie uma credencial para integrar sistemas externos ao workspace.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="apiKeyName">Nome da chave</Label>
              <Input
                id="apiKeyName"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={!canEdit || submitting}
                placeholder="ERP principal"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="apiKeyDescription">Descricao</Label>
              <Textarea
                id="apiKeyDescription"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={!canEdit || submitting}
                placeholder="Uso em mensagens proativas do CRM"
              />
            </div>
            <Button onClick={handleCreate} disabled={!canEdit || submitting || !name.trim()}>
              <KeyRound className="h-4 w-4" />
              Criar chave
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Endpoint base</CardTitle>
            <CardDescription>
              Use este endpoint para `POST /messages`, `POST /events`, `GET /conversations` e `GET /conversations/:id/messages`.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input value={baseUrl} readOnly className="font-mono text-xs" />
              <Button variant="outline" onClick={() => copyText(baseUrl, "Endpoint copiado.")}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-2">
              <Label>Exemplo de envio proativo</Label>
              <Textarea value={curlExample} readOnly className="min-h-[180px] font-mono text-xs" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Chaves do workspace</CardTitle>
          <CardDescription>Monitore status, ultimo uso e gerencie rotacao/revogacao das chaves publicas.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="text-sm text-muted-foreground">Carregando chaves...</div>
          ) : keys.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              Nenhuma chave cadastrada ainda. Gere a primeira credencial para liberar a API pública.
            </div>
          ) : (
            keys.map((key) => (
              <div key={key.id} className="rounded-xl border p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-medium">{key.name}</div>
                      <Badge variant="outline" className={getApiKeyStatusTone(key)}>
                        {getApiKeyStatusLabel(key)}
                      </Badge>
                    </div>
                    <div className="font-mono text-sm text-muted-foreground">{maskStoredApiKey(key)}</div>
                    <div className="grid gap-2 text-sm text-muted-foreground lg:grid-cols-2">
                      <div>Criada em: {formatDateTime(key.created_at)}</div>
                      <div>Ultimo uso: {formatDateTime(key.last_used_at)}</div>
                      <div>IP mais recente: {key.last_used_ip || "Nao registrado"}</div>
                      <div>
                        Descricao: {typeof key.metadata?.description === "string" ? key.metadata.description : "Sem descricao"}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={() => handleRotate(key.id)}
                      disabled={!canEdit || submitting || Boolean(key.revoked_at)}
                    >
                      <RefreshCcw className="h-4 w-4" />
                      Rotacionar
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleRevoke(key.id)}
                      disabled={!canEdit || submitting || Boolean(key.revoked_at)}
                    >
                      <Trash2 className="h-4 w-4" />
                      Revogar
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
