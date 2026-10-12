import { useState } from "react";
import { toast } from "sonner";
import { Webhook, PlugZap, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { AgentConfigRecord } from "@/hooks/use-workspace-admin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type TestResult = {
  ok: boolean;
  error: string | null;
  status: number | null;
  durationMs?: number;
  body?: string | null;
};

type Props = {
  workspaceId: string;
  form: AgentConfigRecord;
  canEdit: boolean;
  saving: boolean;
  onChange: <K extends keyof AgentConfigRecord>(field: K, value: AgentConfigRecord[K]) => void;
  onSave: () => void;
};

const SECRET_REF_PATTERN = /^EXTERNAL_AGENT_[A-Z0-9_]{1,200}$/;

export function ExternalAgentSection({ workspaceId, form, canEdit, saving, onChange, onSave }: Props) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const secretRef = form.external_agent_secret_ref ?? "";
  const secretRefInvalid = secretRef.length > 0 && !SECRET_REF_PATTERN.test(secretRef);

  const runTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("test-external-agent", {
        body: {
          workspaceId,
          url: form.external_agent_url ?? "",
          secretRef: secretRef || null,
          timeoutMs: form.external_agent_timeout_ms,
        },
      });
      if (error) throw error;
      setResult(data as TestResult);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao testar a conexão.");
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <Webhook className="h-5 w-5 text-primary" />
          <div>
            <CardTitle>Agente externo (webhook)</CardTitle>
            <CardDescription>
              Delegue a resposta da IA a um webhook (ex.: n8n). Em caso de falha, o agente interno responde.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5 lg:grid-cols-2">
        <div className="flex items-center justify-between rounded-lg border p-4 lg:col-span-2">
          <div>
            <div className="font-medium">Usar agente externo</div>
            <div className="text-sm text-muted-foreground">Desligado, nada muda no atendimento atual.</div>
          </div>
          <Switch
            checked={form.external_agent_enabled}
            onCheckedChange={(v) => onChange("external_agent_enabled", v)}
            disabled={!canEdit}
          />
        </div>

        <div className="space-y-2 lg:col-span-2">
          <Label htmlFor="external_agent_url">URL do webhook (https)</Label>
          <Input
            id="external_agent_url"
            value={form.external_agent_url ?? ""}
            onChange={(e) => onChange("external_agent_url", e.target.value || null)}
            placeholder="https://seu-n8n.com/webhook/callia"
            disabled={!canEdit}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="external_agent_secret_ref">Nome do segredo</Label>
          <Input
            id="external_agent_secret_ref"
            value={secretRef}
            onChange={(e) => onChange("external_agent_secret_ref", e.target.value.toUpperCase() || null)}
            placeholder="EXTERNAL_AGENT_N8N"
            autoComplete="off"
            disabled={!canEdit}
          />
          <p className="text-xs text-muted-foreground">
            O valor do segredo nunca é salvo aqui nem exibido. Ele fica guardado com segurança no backend e é enviado no
            cabeçalho x-callia-secret. O nome deve começar com EXTERNAL_AGENT_.
          </p>
          {secretRefInvalid ? (
            <p className="text-xs text-destructive">Use apenas maiúsculas, números e _, começando com EXTERNAL_AGENT_.</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="external_agent_timeout_ms">Tempo limite (ms)</Label>
          <Input
            id="external_agent_timeout_ms"
            type="number"
            min={1000}
            max={60000}
            step={1000}
            value={form.external_agent_timeout_ms}
            onChange={(e) => onChange("external_agent_timeout_ms", Number(e.target.value) || 25000)}
            disabled={!canEdit}
          />
          <p className="text-xs text-muted-foreground">Entre 1.000 e 60.000 ms. Padrão: 25.000.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:col-span-2">
          <Button
            variant="outline"
            onClick={runTest}
            disabled={!canEdit || testing || !form.external_agent_url || secretRefInvalid}
          >
            <PlugZap className="h-4 w-4" />
            {testing ? "Testando..." : "Testar conexão"}
          </Button>
          <Button onClick={onSave} disabled={!canEdit || saving || secretRefInvalid}>
            <Save className="h-4 w-4" />
            Salvar
          </Button>
        </div>

        {result ? (
          <div
            className={
              "space-y-2 rounded-lg border p-4 text-sm lg:col-span-2 " +
              (result.ok ? "border-primary/40" : "border-destructive/50")
            }
          >
            <div className="font-medium">
              {result.ok ? "Conexão OK" : `Falha: ${result.error}`}
              {result.status ? ` · HTTP ${result.status}` : ""}
              {typeof result.durationMs === "number" ? ` · ${result.durationMs} ms` : ""}
            </div>
            {result.body ? (
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-3 font-mono text-xs">
                {result.body}
              </pre>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
