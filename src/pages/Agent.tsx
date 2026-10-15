import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Save, Bot, Library } from "lucide-react";
import { useWorkspaceAdmin, type AgentConfigRecord } from "@/hooks/use-workspace-admin";
import { parseFollowUpRules, parsePaymentLinks, serializeFollowUpRules, serializePaymentLinks } from "@/lib/agent-settings";
import { useWorkspace } from "@/lib/workspace";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ExternalAgentSection } from "@/components/agent/ExternalAgentSection";

export default function AgentPage() {
  const { canManage: canEdit } = useWorkspace();
  const { currentWorkspace, loading, agentConfig, saveAgentConfig } = useWorkspaceAdmin();

  const [form, setForm] = useState<AgentConfigRecord | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [followUpDraft, setFollowUpDraft] = useState("[]");
  const [followUpError, setFollowUpError] = useState<string | null>(null);

  useEffect(() => {
    if (agentConfig) {
      setForm(agentConfig);
    }
  }, [agentConfig]);

  const handoffKeywords = useMemo(
    () => form?.handoff_keywords.join(", ") ?? "",
    [form],
  );
  const paymentLinksText = useMemo(
    () => serializePaymentLinks(form?.payment_links ?? []),
    [form],
  );
  const followUpRulesText = useMemo(
    () => serializeFollowUpRules(form?.follow_up_rules ?? []),
    [form],
  );

  useEffect(() => {
    setFollowUpDraft(followUpRulesText);
  }, [followUpRulesText]);

  if (loading || !form) {
    return <div className="p-8 text-sm text-muted-foreground">Carregando configuracoes do agente...</div>;
  }

  if (!currentWorkspace) {
    return <div className="p-8 text-sm text-muted-foreground">Selecione um workspace para configurar o agente.</div>;
  }

  const updateForm = <K extends keyof AgentConfigRecord>(field: K, value: AgentConfigRecord[K]) => {
    setForm((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const saveConfig = async () => {
    if (followUpError) {
      toast.error("Corrija o JSON de follow-up antes de salvar.");
      return;
    }

    try {
      setSavingConfig(true);
      await saveAgentConfig(form);
      toast.success("Configuracoes do agente salvas.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel salvar o agente.");
    } finally {
      setSavingConfig(false);
    }
  };

  return (
    <div className="space-y-6 p-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Agente IA</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Configure o comportamento do agente e os dados que o bot usa para responder, vender e fazer handoff.
          </p>
        </div>
        <Button onClick={saveConfig} disabled={!canEdit || savingConfig}>
          <Save className="h-4 w-4" />
          {savingConfig ? "Salvando..." : "Salvar configuracoes"}
        </Button>
      </div>

      {!canEdit && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Seu perfil atual pode visualizar as configuracoes, mas apenas `owner` e `admin` podem editar esta area.
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Bot className="h-5 w-5 text-primary" />
            <div>
              <CardTitle>Comportamento do agente</CardTitle>
              <CardDescription>Persona, modelo, voz, website e regras basicas de handoff.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-2 lg:col-span-2">
            <Label htmlFor="persona">Prompt de sistema</Label>
            <Textarea
              id="persona"
              value={form.persona_prompt}
              onChange={(e) => updateForm("persona_prompt", e.target.value)}
              disabled={!canEdit}
              className="min-h-[180px]"
            />
            <p className="text-xs text-muted-foreground">
              Persona e limites do atendimento. O conteudo a que o agente responde vem da base de conhecimento.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="language">Idioma</Label>
            <Input
              id="language"
              value={form.language}
              onChange={(e) => updateForm("language", e.target.value)}
              disabled={!canEdit}
            />
            <p className="text-xs text-muted-foreground">
              Idioma da resposta, no formato de codigo. Ex.: pt-BR, en, es.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ai_model">Modelo</Label>
            <Input
              id="ai_model"
              value={form.ai_model}
              onChange={(e) => updateForm("ai_model", e.target.value)}
              disabled={!canEdit}
            />
            <p className="text-xs text-muted-foreground">
              Nome do modelo enviado ao provedor de IA configurado no ambiente.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="website_url">Website da empresa</Label>
            <Input
              id="website_url"
              value={form.website_url ?? ""}
              onChange={(e) => updateForm("website_url", e.target.value || null)}
              disabled={!canEdit}
              placeholder="https://empresa.com.br"
            />
            <p className="text-xs text-muted-foreground">
              Endereco oficial que o agente pode citar. Nao confunde com as fontes indexadas.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="voice_id">Voice ID</Label>
            <Input
              id="voice_id"
              value={form.voice_id ?? ""}
              onChange={(e) => updateForm("voice_id", e.target.value || null)}
              disabled={!canEdit || !form.voice_enabled}
              placeholder="alloy"
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <div className="font-medium">Respostas em audio</div>
              <div className="text-sm text-muted-foreground">Ativa o uso futuro do TTS nas respostas do agente.</div>
            </div>
            <Switch
              checked={form.voice_enabled}
              onCheckedChange={(checked) => updateForm("voice_enabled", checked)}
              disabled={!canEdit}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <div className="font-medium">Horario comercial</div>
              <div className="text-sm text-muted-foreground">Marca se o bot deve considerar restricoes de horario.</div>
            </div>
            <Switch
              checked={Boolean(form.business_hours.enabled)}
              onCheckedChange={(checked) =>
                updateForm("business_hours", { ...form.business_hours, enabled: checked })
              }
              disabled={!canEdit}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="timezone">Timezone</Label>
            <Input
              id="timezone"
              value={form.business_hours.timezone ?? ""}
              onChange={(e) =>
                updateForm("business_hours", { ...form.business_hours, timezone: e.target.value })
              }
              disabled={!canEdit}
              placeholder="America/Sao_Paulo"
            />
            <p className="text-xs text-muted-foreground">
              Fuso usado para interpretar o horario de atendimento.
            </p>
          </div>

          <div className="space-y-2 lg:col-span-2">
            <Label htmlFor="handoff_keywords">Palavras de handoff</Label>
            <Input
              id="handoff_keywords"
              value={handoffKeywords}
              onChange={(e) =>
                updateForm(
                  "handoff_keywords",
                  e.target.value
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean),
                )
              }
              disabled={!canEdit}
              placeholder="atendente, humano, urgente"
            />
            <p className="text-xs text-muted-foreground">
              Separadas por virgula. Quando o cliente escreve uma delas, a conversa sai do bot.
            </p>
          </div>

          <div className="space-y-2 lg:col-span-2">
            <Label htmlFor="business_notes">Observacoes de horario</Label>
            <Textarea
              id="business_notes"
              value={(form.business_hours.notes as string | undefined) ?? ""}
              onChange={(e) =>
                updateForm("business_hours", { ...form.business_hours, notes: e.target.value })
              }
              disabled={!canEdit}
              placeholder="Ex.: Segunda a sexta das 9h as 18h"
            />
          </div>

          <div className="space-y-2 lg:col-span-2">
            <Label htmlFor="payment_links">Links de pagamento</Label>
            <Textarea
              id="payment_links"
              value={paymentLinksText}
              onChange={(e) => updateForm("payment_links", parsePaymentLinks(e.target.value))}
              disabled={!canEdit}
              placeholder={"PIX principal | https://pagamento.exemplo/pix\nCheckout | https://pagamento.exemplo/checkout"}
            />
            <p className="text-xs text-muted-foreground">
              Use uma linha por link no formato `rotulo | url`. O pipeline de mensagens vai consumir essa estrutura nas proximas fases.
            </p>
          </div>

          <div className="space-y-2 lg:col-span-2">
            <Label htmlFor="follow_up_rules">Follow-up preparado</Label>
            <Textarea
              id="follow_up_rules"
              value={followUpDraft}
              onChange={(e) => {
                setFollowUpDraft(e.target.value);
                try {
                  updateForm("follow_up_rules", parseFollowUpRules(e.target.value));
                  setFollowUpError(null);
                } catch {
                  setFollowUpError("JSON invalido. Use uma lista como [] ou [{...}].");
                }
              }}
              disabled={!canEdit}
              className="min-h-[140px] font-mono text-xs"
              placeholder={'[\n  { "delay_minutes": 15, "message_template": "Oi, ainda posso te ajudar?" }\n]'}
            />
            <p className="text-xs text-muted-foreground">
              Esta fase prepara a configuracao. A automacao real do follow-up entra em fase posterior.
            </p>
            {followUpError ? (
              <p className="text-xs text-destructive">{followUpError}</p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <ExternalAgentSection
        workspaceId={currentWorkspace.id}
        form={form}
        canEdit={canEdit}
        onChange={updateForm}
        onSave={saveConfig}
        saving={savingConfig}
      />

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Library className="h-5 w-5 text-primary" />
            <div>
              <CardTitle>Base de conhecimento</CardTitle>
              <CardDescription>
                Perguntas frequentes, documentos, textos e catalogo ficam em uma tela propria.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Button variant="outline" asChild>
            <Link to="/knowledge-base">Gerenciar base de conhecimento</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
