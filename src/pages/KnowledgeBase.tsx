import { useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMedia } from "@/hooks/use-media";
import { PriceTableCard } from "@/components/PriceTableCard";
import { PoliciesCard } from "@/components/PoliciesCard";
import { PhotosTab } from "@/components/media/PhotosTab";
import { BookOpen, FileUp, Globe, Package, Pencil, Pin, PinOff, Plus, RefreshCw, Search, Sparkles, Trash2, Type } from "lucide-react";
import { useRequiredWorkspace } from "@/lib/workspace";
import { useEntitlements } from "@/hooks/use-entitlements";
import { createGate } from "@/lib/entitlements";
import { formatDateTime, formatMoney } from "@/lib/format";
import { KNOWLEDGE_ACCEPT, uploadKnowledgeDocument } from "@/lib/knowledge-upload";
import { useQueryClient } from "@tanstack/react-query";
import { sourcesKey } from "@/hooks/use-knowledge";
import { supabase } from "@/lib/supabase";
import { invalidateEntitlements } from "@/hooks/use-entitlements";
import type { Faq, KnowledgeSource, Product } from "@/lib/database.types";
import {
  useFaqs,
  useKnowledgeActions,
  useKnowledgeSources,
  useProducts,
  useSearchPreview,
  useTableCrud,
} from "@/hooks/use-knowledge";
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
  Select,
  Spinner,
  Switch,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Tabs,
  Textarea,
  statusTone,
  useToast,
} from "@/components/ui";

type Tab = "faq" | "politicas" | "docs" | "catalog" | "fotos" | "search";
const TAB_IDS: Tab[] = ["faq", "politicas", "docs", "catalog", "fotos", "search"];

export default function KnowledgeBase() {
  // A aba fica na URL (?tab=fotos) para poder ser linkada.
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get("tab") as Tab | null;
  const tab: Tab = fromUrl && TAB_IDS.includes(fromUrl) ? fromUrl : "faq";
  const setTab = (next: Tab) => setParams(next === "faq" ? {} : { tab: next }, { replace: true });
  return (
    <>
      <PageHeader
        title="Base de conhecimento"
        description="O que o agente sabe sobre o seu negócio. Também fica disponível para sistemas externos em GET /knowledge/search."
        actions={
          <Link
            to="/agent/setup"
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            <Sparkles className="h-4 w-4" /> Importar site e Instagram
          </Link>
        }
      />
      <Tabs<Tab>
        className="mb-5"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "faq", label: "Perguntas e respostas" },
          { id: "politicas", label: "Políticas" },
          { id: "docs", label: "Documentos e textos" },
          { id: "catalog", label: "Catálogo" },
          { id: "fotos", label: "Fotos" },
          { id: "search", label: "Teste de busca" },
        ]}
      />
      {tab === "faq" && <FaqTab />}
      {tab === "politicas" && <PoliciesTab />}
      {tab === "docs" && <DocsTab />}
      {tab === "catalog" && <CatalogTab />}
      {tab === "fotos" && <PhotosTab />}
      {tab === "search" && <SearchTab />}
    </>
  );
}

// ---------------------------------------------------------------- FAQ
function FaqTab() {
  const { workspaceId } = useRequiredWorkspace();
  const faqs = useFaqs(workspaceId);
  const { save, remove } = useTableCrud<Faq>("faqs", workspaceId);
  const toast = useToast();
  const [editing, setEditing] = useState<Partial<Faq> | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    try {
      await save.mutateAsync({
        id: editing.id,
        question: editing.question?.trim(),
        answer: editing.answer?.trim(),
        active: editing.active ?? true,
        position: editing.position ?? (faqs.data?.length ?? 0),
      });
      toast.success("Pergunta salva.");
      setEditing(null);
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Perguntas e respostas"
        description="Cada item vira um trecho pesquisável imediatamente."
        actions={
          <Button size="sm" onClick={() => setEditing({ question: "", answer: "", active: true })}>
            <Plus className="h-4 w-4" /> Nova pergunta
          </Button>
        }
      />
      {faqs.isLoading ? (
        <CardBody className="flex justify-center"><Spinner /></CardBody>
      ) : faqs.error ? (
        <CardBody><ErrorState error={faqs.error} onRetry={() => void faqs.refetch()} /></CardBody>
      ) : faqs.data?.length === 0 ? (
        <EmptyState icon={BookOpen} title="Nenhuma pergunta cadastrada" description="Comece pelas dúvidas mais comuns dos seus clientes: horário, endereço, formas de pagamento." />
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {faqs.data?.map((f) => (
            <li key={f.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {f.question} {!f.active && <Badge>inativa</Badge>}
                </p>
                <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-sm text-slate-500 dark:text-slate-400">{f.answer}</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setEditing(f)} aria-label="Editar">
                <Pencil className="h-4 w-4" />
              </Button>
              <ConfirmButton
                size="sm"
                variant="ghost"
                title="Excluir pergunta?"
                onConfirm={() => remove.mutateAsync(f.id).catch((e) => toast.error(e))}
                aria-label="Excluir"
              >
                <Trash2 className="h-4 w-4" />
              </ConfirmButton>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? "Editar pergunta" : "Nova pergunta"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button type="submit" form="faq-form" loading={save.isPending}>Salvar</Button>
          </>
        }
      >
        {editing && (
          <form id="faq-form" onSubmit={submit} className="space-y-4">
            <Input label="Pergunta" value={editing.question ?? ""} onChange={(e) => setEditing({ ...editing, question: e.target.value })} required />
            <Textarea label="Resposta" rows={5} value={editing.answer ?? ""} onChange={(e) => setEditing({ ...editing, answer: e.target.value })} required />
            <Switch checked={editing.active ?? true} onChange={(v) => setEditing({ ...editing, active: v })} label="Ativa" description="Inativas saem da busca do agente." />
          </form>
        )}
      </Modal>
    </Card>
  );
}

function PoliciesTab() {
  const { workspaceId } = useRequiredWorkspace();
  return <PoliciesCard workspaceId={workspaceId} />;
}

// ---------------------------------------------------------------- Documentos
const KIND_LABEL: Record<KnowledgeSource["kind"], string> = {
  faq: "Pergunta",
  product: "Produto",
  text: "Texto",
  url: "URL",
  document: "Documento",
  site: "Site",
  social: "Instagram",
};
const STATUS_LABEL: Record<KnowledgeSource["status"], string> = {
  pending: "Na fila",
  indexing: "Indexando",
  indexed: "Indexado",
  failed: "Falhou",
};

function DocsTab() {
  const { workspaceId } = useRequiredWorkspace();
  const toast = useToast();
  const sources = useKnowledgeSources(workspaceId);
  const actions = useKnowledgeActions(workspaceId);
  const [dialog, setDialog] = useState<"text" | "url" | "edit" | null>(null);
  const [draft, setDraft] = useState({ title: "", content: "", url: "" });
  const [editing, setEditing] = useState<KnowledgeSource | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const { data: entitlements } = useEntitlements();
  const gate = createGate(entitlements, "max_knowledge_sources");
  const list = (sources.data ?? []).filter((s) => s.kind !== "faq" && s.kind !== "product");
  const mirrored = (sources.data ?? []).length - list.length;
  const pendingEmbeddings = (sources.data ?? []).filter((s) => s.status === "indexed" && !s.embedded).length;

  async function run(body: Record<string, unknown>, ok: string) {
    try {
      const res = await actions.mutateAsync(body);
      toast.success(typeof res?.embedded === "number" ? `${res.embedded} trecho(s) com embedding gerado.` : ok);
      return true;
    } catch (err) {
      toast.error(err);
      return false;
    }
  }

  function closeDialog() {
    setDialog(null);
    if (editing) {
      setEditing(null);
      setDraft({ title: "", content: "", url: "" });
    }
  }

  // O conteúdo não vem na lista (pode ser grande): busca só ao abrir a edição.
  async function openEdit(source: KnowledgeSource) {
    setEditing(source);
    setDraft({ title: source.title, content: "", url: "" });
    setDialog("edit");
    setLoadingContent(true);
    const { data, error } = await supabase.from("knowledge_sources").select("content").eq("id", source.id).single();
    setLoadingContent(false);
    if (error) {
      toast.error(error);
      closeDialog();
      return;
    }
    setDraft({ title: source.title, content: (data as { content: string | null }).content ?? "", url: "" });
  }

  async function submitDialog(e: FormEvent) {
    e.preventDefault();
    const ok =
      dialog === "edit" && editing
        ? await run({ action: "update_text", source_id: editing.id, title: draft.title.trim(), content: draft.content }, "Texto atualizado; reindexando.")
        : dialog === "text"
        ? await run({ action: "create_text", workspace_id: workspaceId, title: draft.title.trim(), content: draft.content }, "Texto adicionado.")
        : await run({ action: "create_url", workspace_id: workspaceId, url: draft.url.trim(), title: draft.title.trim() || undefined }, "URL adicionada para indexação.");
    if (ok) {
      setDialog(null);
      setEditing(null);
      setDraft({ title: "", content: "", url: "" });
    }
  }

  async function upload(file: File) {
    setUploading(true);
    try {
      await uploadKnowledgeDocument(workspaceId, file);
      toast.success("Documento enviado para indexação.");
      void qc.invalidateQueries({ queryKey: sourcesKey(workspaceId) });
      invalidateEntitlements(qc, workspaceId);
    } catch (err) {
      toast.error(err);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-4">
      {pendingEmbeddings > 0 && (
        <Notice>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {pendingEmbeddings} fonte(s) ainda só com busca por palavra-chave. Gere os embeddings para ativar a busca semântica.
            </span>
            <Button size="sm" variant="secondary" loading={actions.isPending} onClick={() => void run({ action: "embed_pending", workspace_id: workspaceId }, "Embeddings gerados.")}>
              <Sparkles className="h-4 w-4" /> Gerar embeddings pendentes
            </Button>
          </div>
        </Notice>
      )}
      {gate.reason && <Notice tone="warn">{gate.reason}</Notice>}
      <Card>
        <CardHeader
          title="Documentos e textos"
          description={`PDF, DOCX, TXT, MD, páginas web e textos livres. ${mirrored > 0 ? `${mirrored} item(ns) de FAQ e catálogo também estão indexados.` : ""}`}
          actions={
            <>
              <Button size="sm" variant="secondary" disabled={!gate.allowed} title={gate.reason ?? undefined} onClick={() => setDialog("text")}><Type className="h-4 w-4" /> Texto</Button>
              <Button size="sm" variant="secondary" disabled={!gate.allowed} title={gate.reason ?? undefined} onClick={() => setDialog("url")}><Globe className="h-4 w-4" /> URL</Button>
              <Button size="sm" loading={uploading} disabled={!gate.allowed} title={gate.reason ?? undefined} onClick={() => fileRef.current?.click()}><FileUp className="h-4 w-4" /> Enviar arquivo</Button>
              <input
                ref={fileRef}
                type="file"
                accept={KNOWLEDGE_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                }}
              />
            </>
          }
        />
        {sources.isLoading ? (
          <CardBody className="flex justify-center"><Spinner /></CardBody>
        ) : sources.error ? (
          <CardBody><ErrorState error={sources.error} onRetry={() => void sources.refetch()} /></CardBody>
        ) : list.length === 0 ? (
          <EmptyState icon={FileUp} title="Nenhum documento" description="Envie manuais, tabelas de preço, políticas ou cole textos que o agente deve conhecer." />
        ) : (
          <Table>
            <THead>
              <tr><TH>Fonte</TH><TH>Tipo</TH><TH>Status</TH><TH>Trechos</TH><TH>Atualizado</TH><TH className="text-right">Ações</TH></tr>
            </THead>
            <TBody>
              {list.map((s) => (
                <TR key={s.id}>
                  <TD className="max-w-[260px]">
                    <p className="truncate font-medium text-slate-900 dark:text-slate-100">{s.title}</p>
                    {s.url && <p className="truncate text-xs text-slate-500">{s.url}</p>}
                    {s.kind === "site" && (s.metadata?.pages?.length ?? 0) > 0 && (
                      <p className="text-xs text-slate-500">{s.metadata!.pages!.length} página(s) lida(s)</p>
                    )}
                    {s.error && <p className="mt-0.5 break-words text-xs text-red-600">{s.error}</p>}
                  </TD>
                  <TD><Badge>{KIND_LABEL[s.kind]}</Badge></TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={statusTone(s.status)}>{STATUS_LABEL[s.status]}</Badge>
                      {s.embedded && <Badge tone="blue">semântica</Badge>}
                      {s.metadata?.pinned && <Badge tone="brand">fixa no agente</Badge>}
                    </div>
                  </TD>
                  <TD>{s.chunk_count}</TD>
                  <TD className="whitespace-nowrap">{formatDateTime(s.indexed_at ?? s.updated_at)}</TD>
                  <TD className="text-right">
                    <div className="flex justify-end gap-1">
                      {s.kind === "text" && (
                        <Button size="sm" variant="ghost" aria-label="Editar" title="Editar texto" onClick={() => void openEdit(s)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      {/* Fixa: a IA lê sempre esta fonte (tabela de preços, políticas), sem depender da busca. */}
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={s.metadata?.pinned ? "Desafixar do agente" : "Fixar no agente"}
                        title={s.metadata?.pinned ? "Desafixar do agente" : "Fixar no agente (a IA lê sempre)"}
                        onClick={() => void run({ action: "set_pinned", source_id: s.id, pinned: !s.metadata?.pinned }, s.metadata?.pinned ? "Fonte desafixada." : "Fonte fixada no agente.")}
                      >
                        {s.metadata?.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                      </Button>
                      <Button size="sm" variant="ghost" aria-label="Reindexar" onClick={() => void run({ action: "reindex", source_id: s.id }, "Reindexação iniciada.")}>
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                      <ConfirmButton
                        size="sm"
                        variant="ghost"
                        aria-label="Excluir"
                        title="Excluir fonte?"
                        description="Os trechos indexados deixam de ser usados pelo agente."
                        onConfirm={() => run({ action: "delete", source_id: s.id }, "Fonte excluída.")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </ConfirmButton>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <Modal
        open={dialog !== null}
        onClose={closeDialog}
        title={dialog === "edit" ? "Editar texto" : dialog === "text" ? "Adicionar texto" : "Adicionar página web"}
        size={dialog === "url" ? "md" : "lg"}
        footer={
          <>
            <Button variant="secondary" onClick={closeDialog}>Cancelar</Button>
            <Button type="submit" form="source-form" loading={actions.isPending} disabled={loadingContent}>{dialog === "edit" ? "Salvar" : "Adicionar"}</Button>
          </>
        }
      >
        <form id="source-form" onSubmit={submitDialog} className="space-y-4">
          {dialog === "url" && (
            <Input label="URL pública" type="url" required value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="https://suaempresa.com/politicas" />
          )}
          <Input
            label={dialog === "url" ? "Título (opcional)" : "Título"}
            required={dialog !== "url"}
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
          {dialog === "edit" && editing?.metadata?.pinned && (
            <Notice>Fixado no agente: a IA lê este texto sempre (máx. 12 mil caracteres). Ao salvar, os trechos são reindexados.</Notice>
          )}
          {dialog !== "url" && (
            loadingContent
              ? <div className="flex justify-center py-8"><Spinner /></div>
              : <Textarea label="Conteúdo" rows={dialog === "edit" ? 18 : 12} required value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
          )}
        </form>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------- Catálogo
function CatalogTab() {
  const { workspaceId } = useRequiredWorkspace();
  const products = useProducts(workspaceId);
  const media = useMedia(workspaceId);
  const [, setParams] = useSearchParams();
  // Fotos de cada item: álbuns ligados ao produto (o catálogo é a fonte única do nome).
  const photosOf = (productId: string) => {
    const albums = (media.data?.albums ?? []).filter((a) => a.product_id === productId);
    return { count: albums.reduce((n, a) => n + a.count, 0), cover: albums[0]?.cover_url ?? null, album: albums[0]?.name ?? null };
  };
  const openPhotos = (album: string | null) => setParams(album ? { tab: "fotos", album } : { tab: "fotos" }, { replace: true });
  const { save, remove } = useTableCrud<Product>("products", workspaceId);
  const toast = useToast();
  const [editing, setEditing] = useState<(Partial<Product> & { priceText?: string }) | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const priceText = (editing.priceText ?? "").replace(/\./g, "").replace(",", ".").trim();
    const price = priceText === "" ? null : Number(priceText);
    if (price !== null && Number.isNaN(price)) {
      toast.error("Preço inválido.");
      return;
    }
    try {
      await save.mutateAsync({
        id: editing.id,
        name: editing.name?.trim(),
        description: editing.description?.trim() || null,
        price,
        currency: editing.currency ?? "BRL",
        url: editing.url?.trim() || null,
        active: editing.active ?? true,
      });
      toast.success("Produto salvo.");
      setEditing(null);
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <div className="space-y-4">
    <Card>
      <CardHeader
        title="Catálogo"
        description="Produtos e serviços que o agente pode apresentar, com preço e link."
        actions={
          <Button size="sm" onClick={() => setEditing({ name: "", currency: "BRL", active: true, priceText: "" })}>
            <Plus className="h-4 w-4" /> Novo item
          </Button>
        }
      />
      {products.isLoading ? (
        <CardBody className="flex justify-center"><Spinner /></CardBody>
      ) : products.error ? (
        <CardBody><ErrorState error={products.error} onRetry={() => void products.refetch()} /></CardBody>
      ) : products.data?.length === 0 ? (
        <EmptyState icon={Package} title="Catálogo vazio" description="Cadastre produtos, quartos, planos ou serviços." />
      ) : (
        <Table>
          <THead><tr><TH>Item</TH><TH>Fotos</TH><TH>Preço</TH><TH>Link</TH><TH className="text-right">Ações</TH></tr></THead>
          <TBody>
            {products.data?.map((p) => (
              <TR key={p.id}>
                <TD className="max-w-[280px]">
                  <p className="font-medium text-slate-900 dark:text-slate-100">{p.name} {!p.active && <Badge>inativo</Badge>}</p>
                  {p.description && <p className="line-clamp-2 text-xs text-slate-500">{p.description}</p>}
                </TD>
                <TD className="whitespace-nowrap">
                  {(() => {
                    const ph = photosOf(p.id);
                    return ph.count ? (
                      <button type="button" className="flex items-center gap-2 text-left text-xs text-brand hover:underline" onClick={() => openPhotos(ph.album)}>
                        {ph.cover && <img src={ph.cover} alt="" loading="lazy" className="h-9 w-12 rounded object-cover" />}
                        {ph.count} foto(s)
                      </button>
                    ) : (
                      <button type="button" className="text-left text-xs text-slate-400 hover:text-brand hover:underline" onClick={() => openPhotos(null)}>
                        Sem fotos · Adicionar
                      </button>
                    );
                  })()}
                </TD>
                <TD className="whitespace-nowrap">{formatMoney(p.price, p.currency)}</TD>
                <TD className="max-w-[200px] truncate">{p.url ? <a className="text-brand underline" href={p.url} target="_blank" rel="noreferrer">{p.url}</a> : "—"}</TD>
                <TD className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" aria-label="Editar" onClick={() => setEditing({ ...p, priceText: p.price != null ? String(p.price).replace(".", ",") : "" })}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <ConfirmButton size="sm" variant="ghost" aria-label="Excluir" title="Excluir item?" onConfirm={() => remove.mutateAsync(p.id).catch((e) => toast.error(e))}>
                      <Trash2 className="h-4 w-4" />
                    </ConfirmButton>
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? "Editar item" : "Novo item"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button type="submit" form="product-form" loading={save.isPending}>Salvar</Button>
          </>
        }
      >
        {editing && (
          <form id="product-form" onSubmit={submit} className="space-y-4">
            <Input label="Nome" required value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            <Textarea label="Descrição" rows={3} value={editing.description ?? ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
              <Input label="Preço" inputMode="decimal" placeholder="0,00" value={editing.priceText ?? ""} onChange={(e) => setEditing({ ...editing, priceText: e.target.value })} />
              <Select label="Moeda" value={editing.currency ?? "BRL"} onChange={(e) => setEditing({ ...editing, currency: e.target.value })}>
                <option value="BRL">BRL</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </Select>
            </div>
            <Input label="Link" type="url" placeholder="https://" value={editing.url ?? ""} onChange={(e) => setEditing({ ...editing, url: e.target.value })} />
            <Switch checked={editing.active ?? true} onChange={(v) => setEditing({ ...editing, active: v })} label="Ativo" />
          </form>
        )}
      </Modal>
    </Card>
    <PriceTableCard workspaceId={workspaceId} />
    </div>
  );
}

// ---------------------------------------------------------------- Busca
function SearchTab() {
  const { workspaceId } = useRequiredWorkspace();
  const search = useSearchPreview(workspaceId);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(5);

  return (
    <Card>
      <CardHeader title="Teste de busca" description="Veja quais trechos o agente receberia para uma pergunta." />
      <CardBody className="space-y-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (query.trim()) search.mutate({ query: query.trim(), limit });
          }}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ex.: qual o horário do café da manhã?"
            className="h-10 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
          />
          <div className="flex gap-2">
            <select
              aria-label="Quantidade de resultados"
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            >
              {[3, 5, 10].map((n) => <option key={n} value={n}>{n} resultados</option>)}
            </select>
            <Button type="submit" loading={search.isPending} disabled={!query.trim()}>
              <Search className="h-4 w-4" /> Buscar
            </Button>
          </div>
        </form>

        {search.error && <ErrorState error={search.error} />}
        {search.data && (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              Modo: <Badge tone={search.data.mode === "hybrid" ? "blue" : "neutral"}>{search.data.mode === "hybrid" ? "híbrido (palavra-chave + semântica)" : "palavra-chave"}</Badge>
            </p>
            {search.data.results.length === 0 ? (
              <EmptyState icon={Search} title="Nada encontrado" description="Cadastre uma pergunta ou documento que responda a isso." />
            ) : (
              search.data.results.map((r) => (
                <div key={r.chunk_id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{r.source_title}</p>
                    <Badge>{KIND_LABEL[r.source_kind as KnowledgeSource["kind"]] ?? r.source_kind}</Badge>
                    <span className="ml-auto text-xs tabular-nums text-slate-500">
                      score {Number(r.score).toFixed(4)}
                      {r.keyword_rank != null && ` · palavra-chave ${Number(r.keyword_rank).toFixed(3)}`}
                      {r.similarity != null && ` · similaridade ${Number(r.similarity).toFixed(3)}`}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm text-slate-600 dark:text-slate-300">{r.content}</p>
                </div>
              ))
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
