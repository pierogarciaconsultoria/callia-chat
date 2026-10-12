import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Save, Plus, Trash2, Bot, BookOpen, Package2 } from "lucide-react";
import { useWorkspaceAdmin, type AgentConfigRecord, type FaqRecord, type ProductRecord } from "@/hooks/use-workspace-admin";
import { parseFollowUpRules, parsePaymentLinks, serializeFollowUpRules, serializePaymentLinks } from "@/lib/agent-settings";
import { useWorkspace } from "@/lib/workspace";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ExternalAgentSection } from "@/components/agent/ExternalAgentSection";

type EditableFaq = Pick<FaqRecord, "id" | "question" | "answer" | "is_active">;
type EditableProduct = Pick<
  ProductRecord,
  "id" | "name" | "description" | "price" | "currency" | "link" | "image_url" | "is_active"
>;

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
      <div className="font-medium text-foreground">{title}</div>
      <div className="mt-1">{description}</div>
    </div>
  );
}

export default function AgentPage() {
  const { role } = useWorkspace();
  const {
    currentWorkspace,
    loading,
    agentConfig,
    faqs,
    products,
    saveAgentConfig,
    upsertFaq,
    removeFaq,
    upsertProduct,
    removeProduct,
  } = useWorkspaceAdmin();

  const canEdit = role === "owner" || role === "admin";

  const [form, setForm] = useState<AgentConfigRecord | null>(null);
  const [faqDrafts, setFaqDrafts] = useState<EditableFaq[]>([]);
  const [productDrafts, setProductDrafts] = useState<EditableProduct[]>([]);
  const [savingConfig, setSavingConfig] = useState(false);
  const [followUpDraft, setFollowUpDraft] = useState("[]");
  const [followUpError, setFollowUpError] = useState<string | null>(null);

  useEffect(() => {
    if (agentConfig) {
      setForm(agentConfig);
    }
  }, [agentConfig]);

  useEffect(() => {
    setFaqDrafts(
      faqs.map((faq) => ({
        id: faq.id,
        question: faq.question,
        answer: faq.answer,
        is_active: faq.is_active,
      })),
    );
  }, [faqs]);

  useEffect(() => {
    setProductDrafts(
      products.map((product) => ({
        id: product.id,
        name: product.name,
        description: product.description,
        price: product.price,
        currency: product.currency,
        link: product.link,
        image_url: product.image_url,
        is_active: product.is_active,
      })),
    );
  }, [products]);

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

  const addFaqDraft = () => {
    setFaqDrafts((prev) => [...prev, { id: `new-faq-${Date.now()}`, question: "", answer: "", is_active: true }]);
  };

  const saveFaqDraft = async (draft: EditableFaq) => {
    try {
      await upsertFaq({
        id: draft.id.startsWith("new-faq-") ? undefined : draft.id,
        question: draft.question,
        answer: draft.answer,
        is_active: draft.is_active,
      });
      toast.success("FAQ salva.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel salvar a FAQ.");
    }
  };

  const deleteFaqDraft = async (draft: EditableFaq) => {
    if (draft.id.startsWith("new-faq-")) {
      setFaqDrafts((prev) => prev.filter((item) => item.id !== draft.id));
      return;
    }

    try {
      await removeFaq(draft.id);
      toast.success("FAQ removida.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel remover a FAQ.");
    }
  };

  const addProductDraft = () => {
    setProductDrafts((prev) => [
      ...prev,
      {
        id: `new-product-${Date.now()}`,
        name: "",
        description: "",
        price: null,
        currency: "BRL",
        link: "",
        image_url: "",
        is_active: true,
      },
    ]);
  };

  const saveProductDraft = async (draft: EditableProduct) => {
    try {
      await upsertProduct({
        id: draft.id.startsWith("new-product-") ? undefined : draft.id,
        name: draft.name,
        description: draft.description ?? null,
        price: draft.price ?? null,
        currency: draft.currency || "BRL",
        link: draft.link ?? null,
        image_url: draft.image_url ?? null,
        is_active: draft.is_active,
      });
      toast.success("Produto salvo.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel salvar o produto.");
    }
  };

  const deleteProductDraft = async (draft: EditableProduct) => {
    if (draft.id.startsWith("new-product-")) {
      setProductDrafts((prev) => prev.filter((item) => item.id !== draft.id));
      return;
    }

    try {
      await removeProduct(draft.id);
      toast.success("Produto removido.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel remover o produto.");
    }
  };

  return (
    <div className="space-y-6 p-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Agente IA</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Configure o comportamento do agente, a base de conhecimento e os dados que o bot usa para vender e fazer handoff.
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
          </div>

          <div className="space-y-2">
            <Label htmlFor="language">Idioma</Label>
            <Input
              id="language"
              value={form.language}
              onChange={(e) => updateForm("language", e.target.value)}
              disabled={!canEdit}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ai_model">Modelo</Label>
            <Input
              id="ai_model"
              value={form.ai_model}
              onChange={(e) => updateForm("ai_model", e.target.value)}
              disabled={!canEdit}
            />
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
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-3">
            <BookOpen className="h-5 w-5 text-primary" />
            <div>
              <CardTitle>FAQ</CardTitle>
              <CardDescription>Perguntas e respostas que alimentam a base de conhecimento do agente.</CardDescription>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={addFaqDraft} disabled={!canEdit}>
            <Plus className="h-4 w-4" />
            Nova FAQ
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {faqDrafts.length === 0 && (
            <EmptyState title="Nenhuma FAQ cadastrada" description="Crie perguntas frequentes para orientar o agente nas respostas." />
          )}

          {faqDrafts.map((faq, index) => (
            <div key={faq.id} className="rounded-xl border p-4">
              <div className="mb-4 flex items-center justify-between">
                <div className="font-medium">FAQ {index + 1}</div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    Ativa
                    <Switch
                      checked={faq.is_active}
                      onCheckedChange={(checked) =>
                        setFaqDrafts((prev) =>
                          prev.map((item) => (item.id === faq.id ? { ...item, is_active: checked } : item)),
                        )
                      }
                      disabled={!canEdit}
                    />
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => deleteFaqDraft(faq)} disabled={!canEdit}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="grid gap-3">
                <div className="space-y-2">
                  <Label>Pergunta</Label>
                  <Input
                    value={faq.question}
                    onChange={(e) =>
                      setFaqDrafts((prev) =>
                        prev.map((item) => (item.id === faq.id ? { ...item, question: e.target.value } : item)),
                      )
                    }
                    disabled={!canEdit}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Resposta</Label>
                  <Textarea
                    value={faq.answer}
                    onChange={(e) =>
                      setFaqDrafts((prev) =>
                        prev.map((item) => (item.id === faq.id ? { ...item, answer: e.target.value } : item)),
                      )
                    }
                    disabled={!canEdit}
                  />
                </div>
                <div className="flex justify-end">
                  <Button onClick={() => saveFaqDraft(faq)} disabled={!canEdit || !faq.question || !faq.answer}>
                    Salvar FAQ
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-3">
            <Package2 className="h-5 w-5 text-primary" />
            <div>
              <CardTitle>Catalogo de produtos</CardTitle>
              <CardDescription>Produtos e servicos que o agente pode sugerir durante o atendimento.</CardDescription>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={addProductDraft} disabled={!canEdit}>
            <Plus className="h-4 w-4" />
            Novo produto
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {productDrafts.length === 0 && (
            <EmptyState title="Nenhum produto cadastrado" description="Adicione itens para o agente usar em recomendacoes, links e contexto comercial." />
          )}

          {productDrafts.map((product, index) => (
            <div key={product.id} className="rounded-xl border p-4">
              <div className="mb-4 flex items-center justify-between">
                <div className="font-medium">Produto {index + 1}</div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    Ativo
                    <Switch
                      checked={product.is_active}
                      onCheckedChange={(checked) =>
                        setProductDrafts((prev) =>
                          prev.map((item) => (item.id === product.id ? { ...item, is_active: checked } : item)),
                        )
                      }
                      disabled={!canEdit}
                    />
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => deleteProductDraft(product)} disabled={!canEdit}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="space-y-2">
                  <Label>Nome</Label>
                  <Input
                    value={product.name}
                    onChange={(e) =>
                      setProductDrafts((prev) =>
                        prev.map((item) => (item.id === product.id ? { ...item, name: e.target.value } : item)),
                      )
                    }
                    disabled={!canEdit}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Preco</Label>
                  <Input
                    type="number"
                    value={product.price ?? ""}
                    onChange={(e) =>
                      setProductDrafts((prev) =>
                        prev.map((item) => ({
                          ...item,
                          ...(item.id === product.id
                            ? { price: e.target.value ? Number(e.target.value) : null }
                            : {}),
                        })),
                      )
                    }
                    disabled={!canEdit}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Moeda</Label>
                  <Input
                    value={product.currency}
                    onChange={(e) =>
                      setProductDrafts((prev) =>
                        prev.map((item) => (item.id === product.id ? { ...item, currency: e.target.value } : item)),
                      )
                    }
                    disabled={!canEdit}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Link</Label>
                  <Input
                    value={product.link ?? ""}
                    onChange={(e) =>
                      setProductDrafts((prev) =>
                        prev.map((item) => (item.id === product.id ? { ...item, link: e.target.value } : item)),
                      )
                    }
                    disabled={!canEdit}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Imagem</Label>
                  <Input
                    value={product.image_url ?? ""}
                    onChange={(e) =>
                      setProductDrafts((prev) =>
                        prev.map((item) => (item.id === product.id ? { ...item, image_url: e.target.value } : item)),
                      )
                    }
                    disabled={!canEdit}
                  />
                </div>
                <div className="space-y-2 lg:col-span-2">
                  <Label>Descricao</Label>
                  <Textarea
                    value={product.description ?? ""}
                    onChange={(e) =>
                      setProductDrafts((prev) =>
                        prev.map((item) => (item.id === product.id ? { ...item, description: e.target.value } : item)),
                      )
                    }
                    disabled={!canEdit}
                  />
                </div>
                <div className="flex justify-end lg:col-span-2">
                  <Button onClick={() => saveProductDraft(product)} disabled={!canEdit || !product.name}>
                    Salvar produto
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
