import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  BookOpen,
  FileText,
  Link2,
  Package2,
  Plus,
  RefreshCcw,
  Save,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { useKnowledge } from "@/hooks/use-knowledge";
import {
  CATEGORY_EXAMPLES,
  UPLOADABLE_EXTENSIONS,
  getStatusBadgeTone,
  getStatusLabel,
  getStatusLabelForSource,
  type FaqRecord,
  type KnowledgeSearchHit,
  type KnowledgeSourceRecord,
  type ProductRecord,
} from "@/lib/knowledge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type EditableFaq = Pick<FaqRecord, "id" | "question" | "answer" | "is_active">;
type EditableProduct = Pick<
  ProductRecord,
  "id" | "name" | "description" | "price" | "currency" | "link" | "image_url" | "is_active"
>;
type EditableSource = {
  id?: string;
  title: string;
  content: string;
  url: string;
  category: string;
};

const blankSource: EditableSource = { title: "", content: "", url: "", category: "" };

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
      <div className="font-medium text-foreground">{title}</div>
      <div className="mt-1">{description}</div>
    </div>
  );
}

function StatusBadge({ source }: { source: KnowledgeSourceRecord | undefined }) {
  if (!source) {
    return <Badge variant="outline">Nao indexado</Badge>;
  }

  return (
    <Badge variant="outline" className={getStatusBadgeTone(source.index_status)} title={source.index_error ?? undefined}>
      {getStatusLabel(source.index_status)}
    </Badge>
  );
}

function CategoryField({
  value,
  onChange,
  disabled,
  id,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
  id: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Categoria</Label>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        placeholder={CATEGORY_EXAMPLES.join(", ")}
      />
      <p className="text-xs text-muted-foreground">
        Texto livre. Use para agrupar o conteudo do jeito que os seus clientes perguntam.
      </p>
    </div>
  );
}

export default function KnowledgeBasePage() {
  const {
    currentWorkspace,
    canEdit,
    loading,
    loadError,
    submitting,
    faqs,
    products,
    sources,
    reindexPending,
    upsertFaq,
    removeFaq,
    upsertProduct,
    removeProduct,
    saveSource,
    uploadSource,
    removeSource,
    toggleSource,
    search,
  } = useKnowledge();

  const [faqDrafts, setFaqDrafts] = useState<EditableFaq[]>([]);
  const [productDrafts, setProductDrafts] = useState<EditableProduct[]>([]);
  const [textDraft, setTextDraft] = useState<EditableSource>(blankSource);
  const [urlDraft, setUrlDraft] = useState<EditableSource>(blankSource);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [fileTitle, setFileTitle] = useState("");
  const [fileCategory, setFileCategory] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<KnowledgeSearchHit[] | null>(null);

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

  const mirroredByRecord = useMemo(() => {
    const map = new Map<string, KnowledgeSourceRecord>();
    for (const source of sources) {
      if (source.record_id) map.set(source.record_id, source);
    }
    return map;
  }, [sources]);

  const ownedSources = useMemo(
    () => sources.filter((source) => source.type === "text" || source.type === "file" || source.type === "url"),
    [sources],
  );

  const pendingCount = useMemo(
    () => sources.filter((source) => source.index_status === "pending").length,
    [sources],
  );

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Carregando base de conhecimento...</div>;
  }

  if (!currentWorkspace) {
    return <div className="p-8 text-sm text-muted-foreground">Selecione um workspace para gerenciar a base de conhecimento.</div>;
  }

  const runIndexation = async (message: string) => {
    toast.success(message);
    try {
      const result = await reindexPending();
      const failed = (result?.failed ?? []) as Array<{ title?: string; error?: string }>;
      if (failed.length) {
        toast.error(
          `${failed.length} ${failed.length === 1 ? "fonte nao pode ser indexada" : "fontes nao puderam ser indexadas"}: ${
            failed.map((item) => item.error).join(", ")
          }`,
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel indexar o conteudo.");
    }
  };

  const saveFaqDraft = async (draft: EditableFaq) => {
    try {
      await upsertFaq({
        id: draft.id.startsWith("new-faq-") ? undefined : draft.id,
        question: draft.question,
        answer: draft.answer,
        is_active: draft.is_active,
      });
      await runIndexation("FAQ salva.");
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
      await runIndexation("Produto salvo.");
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

  const saveTextSource = async () => {
    if (!textDraft.title.trim() || !textDraft.content.trim()) {
      toast.error("Informe um titulo e o texto que o agente deve consultar.");
      return;
    }

    try {
      await saveSource({
        title: textDraft.title.trim(),
        type: "text",
        content: textDraft.content,
        category: textDraft.category.trim() || null,
      });
      setTextDraft(blankSource);
      await runIndexation("Texto salvo.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel salvar o texto.");
    }
  };

  const saveUrlSource = async () => {
    const url = urlDraft.url.trim();
    if (!urlDraft.title.trim() || !url) {
      toast.error("Informe um titulo e o endereco da pagina.");
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      toast.error("O endereco precisa comecar com http:// ou https://");
      return;
    }

    try {
      await saveSource({
        title: urlDraft.title.trim(),
        type: "url",
        source_url: url,
        category: urlDraft.category.trim() || null,
      });
      setUrlDraft(blankSource);
      await runIndexation("Endereco salvo.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel salvar o endereco.");
    }
  };

  const uploadFileSource = async () => {
    if (!pendingFile) {
      toast.error("Selecione um arquivo para enviar.");
      return;
    }

    try {
      await uploadSource(pendingFile, fileTitle.trim() || pendingFile.name, fileCategory.trim() || null);
      setPendingFile(null);
      setFileTitle("");
      setFileCategory("");
      await runIndexation("Arquivo enviado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel enviar o arquivo.");
    }
  };

  const deleteSource = async (source: KnowledgeSourceRecord) => {
    try {
      await removeSource(source);
      toast.success("Fonte removida.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel remover a fonte.");
    }
  };

  const changeSourceActive = async (source: KnowledgeSourceRecord, isActive: boolean) => {
    try {
      await toggleSource(source, isActive);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel atualizar a fonte.");
    }
  };

  const runSearch = async () => {
    if (!searchQuery.trim()) {
      toast.error("Digite uma pergunta para testar a busca.");
      return;
    }

    try {
      setSearching(true);
      setSearchResults(await search(searchQuery.trim(), 5));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel executar a busca.");
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="space-y-6 p-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Base de conhecimento</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Conteudo que o agente usa para responder: perguntas frequentes, documentos, textos e catalogo. Tudo fica
            isolado por workspace.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => runIndexation("Reindexando conteudos pendentes.")}
          disabled={!canEdit || submitting || pendingCount === 0}
        >
          <RefreshCcw className="h-4 w-4" />
          {submitting ? "Indexando..." : `Reindexar pendentes${pendingCount ? ` (${pendingCount})` : ""}`}
        </Button>
      </div>

      {loadError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {loadError} Se a base ainda nao existe neste banco, aplique a migracao da Fase 10.
        </div>
      )}

      {!canEdit && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Seu perfil atual pode visualizar a base de conhecimento, mas apenas `owner` e `admin` podem editar.
        </div>
      )}

      <Tabs defaultValue="faqs">
        <TabsList>
          <TabsTrigger value="faqs">Perguntas e respostas</TabsTrigger>
          <TabsTrigger value="sources">Documentos e textos</TabsTrigger>
          <TabsTrigger value="catalog">Catalogo</TabsTrigger>
          <TabsTrigger value="search">Testar busca</TabsTrigger>
        </TabsList>

        <TabsContent value="faqs" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div className="flex items-center gap-3">
                <BookOpen className="h-5 w-5 text-primary" />
                <div>
                  <CardTitle>Perguntas e respostas</CardTitle>
                  <CardDescription>
                    Cada FAQ vira uma fonte indexada. Use perguntas escritas como o cliente falaria.
                  </CardDescription>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setFaqDrafts((prev) => [
                    ...prev,
                    { id: `new-faq-${Date.now()}`, question: "", answer: "", is_active: true },
                  ])
                }
                disabled={!canEdit}
              >
                <Plus className="h-4 w-4" />
                Nova FAQ
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {faqDrafts.length === 0 && (
                <EmptyState
                  title="Nenhuma pergunta cadastrada"
                  description="Cadastre duvidas recorrentes e a resposta que o agente deve dar."
                />
              )}

              {faqDrafts.map((faq, index) => (
                <div key={faq.id} className="rounded-xl border p-4">
                  <div className="mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="font-medium">Pergunta {index + 1}</div>
                      <StatusBadge source={mirroredByRecord.get(faq.id)} />
                    </div>
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
                        onChange={(event) =>
                          setFaqDrafts((prev) =>
                            prev.map((item) =>
                              item.id === faq.id ? { ...item, question: event.target.value } : item,
                            ),
                          )
                        }
                        disabled={!canEdit}
                        placeholder="Como funciona o cancelamento?"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Resposta</Label>
                      <Textarea
                        value={faq.answer}
                        onChange={(event) =>
                          setFaqDrafts((prev) =>
                            prev.map((item) =>
                              item.id === faq.id ? { ...item, answer: event.target.value } : item,
                            ),
                          )
                        }
                        disabled={!canEdit}
                        placeholder="Explique o procedimento em uma resposta curta e objetiva."
                      />
                    </div>
                    <div className="flex justify-end">
                      <Button onClick={() => saveFaqDraft(faq)} disabled={!canEdit || !faq.question || !faq.answer}>
                        Salvar pergunta
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sources" className="space-y-4">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-primary" />
                  <div>
                    <CardTitle>Colar texto</CardTitle>
                    <CardDescription>Regulamentos, fichas e qualquer conteudo escrito a mao.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="textTitle">Titulo</Label>
                  <Input
                    id="textTitle"
                    value={textDraft.title}
                    onChange={(event) => setTextDraft((prev) => ({ ...prev, title: event.target.value }))}
                    disabled={!canEdit}
                    placeholder="Politica de cancelamento"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="textContent">Texto</Label>
                  <Textarea
                    id="textContent"
                    value={textDraft.content}
                    onChange={(event) => setTextDraft((prev) => ({ ...prev, content: event.target.value }))}
                    disabled={!canEdit}
                    className="min-h-[160px]"
                    placeholder="Cole aqui o conteudo completo. Ele sera dividido em trechos para a busca."
                  />
                </div>
                <CategoryField
                  id="textCategory"
                  value={textDraft.category}
                  onChange={(next) => setTextDraft((prev) => ({ ...prev, category: next }))}
                  disabled={!canEdit}
                />
                <div className="flex justify-end">
                  <Button onClick={saveTextSource} disabled={!canEdit || submitting}>
                    <Save className="h-4 w-4" />
                    Salvar e indexar
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <Link2 className="h-5 w-5 text-primary" />
                    <div>
                      <CardTitle>Endereco web</CardTitle>
                      <CardDescription>Le o conteudo publicado em uma pagina e indexa o texto.</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="urlTitle">Titulo</Label>
                    <Input
                      id="urlTitle"
                      value={urlDraft.title}
                      onChange={(event) => setUrlDraft((prev) => ({ ...prev, title: event.target.value }))}
                      disabled={!canEdit}
                      placeholder="Pagina de preços"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="urlValue">Endereco</Label>
                    <Input
                      id="urlValue"
                      value={urlDraft.url}
                      onChange={(event) => setUrlDraft((prev) => ({ ...prev, url: event.target.value }))}
                      disabled={!canEdit}
                      placeholder="https://empresa.com.br/precos"
                    />
                  </div>
                  <CategoryField
                    id="urlCategory"
                    value={urlDraft.category}
                    onChange={(next) => setUrlDraft((prev) => ({ ...prev, category: next }))}
                    disabled={!canEdit}
                  />
                  <div className="flex justify-end">
                    <Button onClick={saveUrlSource} variant="outline" disabled={!canEdit || submitting}>
                      Salvar e indexar
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <Upload className="h-5 w-5 text-primary" />
                    <div>
                      <CardTitle>Enviar arquivo</CardTitle>
                      <CardDescription>
                        {UPLOADABLE_EXTENSIONS.join(", ")} - o texto e extraido no servidor.
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="knowledgeFile">Arquivo</Label>
                    <Input
                      id="knowledgeFile"
                      type="file"
                      accept={UPLOADABLE_EXTENSIONS.join(",")}
                      disabled={!canEdit}
                      onChange={(event) => {
                        const file = event.target.files?.[0] ?? null;
                        setPendingFile(file);
                        if (file && !fileTitle) setFileTitle(file.name.replace(/\.[^.]+$/, ""));
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="fileTitle">Titulo</Label>
                    <Input
                      id="fileTitle"
                      value={fileTitle}
                      onChange={(event) => setFileTitle(event.target.value)}
                      disabled={!canEdit}
                      placeholder="Tabela de servicos"
                    />
                  </div>
                  <CategoryField
                    id="fileCategory"
                    value={fileCategory}
                    onChange={setFileCategory}
                    disabled={!canEdit}
                  />
                  <div className="flex justify-end">
                    <Button onClick={uploadFileSource} disabled={!canEdit || submitting || !pendingFile}>
                      <Upload className="h-4 w-4" />
                      Enviar e indexar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <Sparkles className="h-5 w-5 text-primary" />
                <div>
                  <CardTitle>Fontes cadastradas</CardTitle>
                  <CardDescription>Status de indexacao de cada texto, arquivo ou endereco do workspace.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {ownedSources.length === 0 && (
                <EmptyState
                  title="Nenhuma fonte propria cadastrada"
                  description="As perguntas e os itens do catalogo aparecem automaticamente aqui depois de salvos."
                />
              )}

              {ownedSources.map((source) => (
                <div key={source.id} className="rounded-xl border p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate font-medium">{source.title}</div>
                        <Badge variant="outline">{source.type}</Badge>
                        <StatusBadge source={source} />
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {source.category ? `${source.category} • ` : ""}
                        {getStatusLabelForSource(source)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        Ativa
                        <Switch
                          checked={source.is_active}
                          onCheckedChange={(checked) => changeSourceActive(source, checked)}
                          disabled={!canEdit}
                        />
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => deleteSource(source)} disabled={!canEdit}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="catalog" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div className="flex items-center gap-3">
                <Package2 className="h-5 w-5 text-primary" />
                <div>
                  <CardTitle>Catalogo</CardTitle>
                  <CardDescription>
                    Opcional. Produtos e servicos que o agente pode citar durante o atendimento.
                  </CardDescription>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
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
                  ])
                }
                disabled={!canEdit}
              >
                <Plus className="h-4 w-4" />
                Novo item
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {productDrafts.length === 0 && (
                <EmptyState
                  title="Nenhum item cadastrado"
                  description="Cadastre o que a empresa vende para o agente responder com preco e link."
                />
              )}

              {productDrafts.map((product, index) => (
                <div key={product.id} className="rounded-xl border p-4">
                  <div className="mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="font-medium">Item {index + 1}</div>
                      <StatusBadge source={mirroredByRecord.get(product.id)} />
                    </div>
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
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteProductDraft(product)}
                        disabled={!canEdit}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Nome</Label>
                      <Input
                        value={product.name}
                        onChange={(event) =>
                          setProductDrafts((prev) =>
                            prev.map((item) =>
                              item.id === product.id ? { ...item, name: event.target.value } : item,
                            ),
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
                        onChange={(event) =>
                          setProductDrafts((prev) =>
                            prev.map((item) => ({
                              ...item,
                              ...(item.id === product.id
                                ? { price: event.target.value ? Number(event.target.value) : null }
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
                        onChange={(event) =>
                          setProductDrafts((prev) =>
                            prev.map((item) =>
                              item.id === product.id ? { ...item, currency: event.target.value } : item,
                            ),
                          )
                        }
                        disabled={!canEdit}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Link</Label>
                      <Input
                        value={product.link ?? ""}
                        onChange={(event) =>
                          setProductDrafts((prev) =>
                            prev.map((item) =>
                              item.id === product.id ? { ...item, link: event.target.value } : item,
                            ),
                          )
                        }
                        disabled={!canEdit}
                      />
                    </div>
                    <div className="space-y-2 lg:col-span-2">
                      <Label>Descricao</Label>
                      <Textarea
                        value={product.description ?? ""}
                        onChange={(event) =>
                          setProductDrafts((prev) =>
                            prev.map((item) =>
                              item.id === product.id ? { ...item, description: event.target.value } : item,
                            ),
                          )
                        }
                        disabled={!canEdit}
                      />
                    </div>
                    <div className="flex justify-end lg:col-span-2">
                      <Button onClick={() => saveProductDraft(product)} disabled={!canEdit || !product.name}>
                        Salvar item
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="search" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <Search className="h-5 w-5 text-primary" />
                <div>
                  <CardTitle>Testar busca</CardTitle>
                  <CardDescription>
                    Pergunta como um cliente faria. Usa a mesma rotina da API publica, entao o resultado aqui e o
                    resultado que o agente externo recebe.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                <div className="flex-1 space-y-2">
                  <Label htmlFor="searchQuery">Pergunta</Label>
                  <Input
                    id="searchQuery"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") runSearch();
                    }}
                    placeholder="Quais sao as formas de pagamento?"
                  />
                </div>
                <Button onClick={runSearch} disabled={searching || !searchQuery.trim()}>
                  <Search className="h-4 w-4" />
                  {searching ? "Buscando..." : "Testar busca"}
                </Button>
              </div>

              {searchResults === null && (
                <EmptyState
                  title="Nenhuma busca executada"
                  description="Digite uma pergunta para ver quais trechos voltam e com qual pontuacao."
                />
              )}

              {searchResults !== null && searchResults.length === 0 && (
                <EmptyState
                  title="Nenhum trecho encontrado"
                  description="Cadastre conteudo ou reformule a pergunta. So o que esta ativo entra na busca."
                />
              )}

              {(searchResults ?? []).map((hit, index) => (
                <div key={`${hit.title}-${index}`} className="rounded-xl border p-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="min-w-0 truncate font-medium">{hit.title}</div>
                    <Badge variant="outline">{hit.score.toFixed(3)}</Badge>
                  </div>
                  {hit.category ? (
                    <div className="mb-2 text-xs text-muted-foreground">{hit.category}</div>
                  ) : null}
                  <div className="text-sm text-muted-foreground">{hit.content}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
