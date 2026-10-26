import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  AtSign,
  CheckCircle2,
  FileUp,
  Globe,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Type,
} from "lucide-react";
import { useRequiredWorkspace } from "@/lib/workspace";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import { errorMessage } from "@/lib/functions";
import { createGate, hasFeature, inactiveReason } from "@/lib/entitlements";
import { KNOWLEDGE_ACCEPT, uploadKnowledgeDocument } from "@/lib/knowledge-upload";
import {
  buildSections,
  cleanContent,
  defaultSelection,
  defaultToggles,
  duplicateFaqIndexes,
  duplicateProductIndexes,
  eligibleSources,
  instagramHandle,
  isBusy,
  nothingSelected,
  selectedSources,
  type SectionToggles,
} from "@/lib/agent-setup";
import type { AgentSetupContent, AgentSetupDraft, KnowledgeSource, SetupApplyResult } from "@/lib/database.types";
import { invalidateEntitlements, useEntitlements } from "@/hooks/use-entitlements";
import { useQueryClient } from "@tanstack/react-query";
import { sourcesKey, useFaqs, useKnowledgeActions, useKnowledgeSources, useProducts } from "@/hooks/use-knowledge";
import { useAgentConfig } from "@/hooks/use-agent-config";
import { useAgentSetupActions, useSetupDrafts } from "@/hooks/use-agent-setup";
import { BusinessHoursEditor, KeywordChips, PaymentLinksEditor } from "@/components/agent-editors";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmButton,
  ErrorState,
  Input,
  Notice,
  PageHeader,
  Select,
  Spinner,
  Textarea,
  statusTone,
  useToast,
} from "@/components/ui";

type Step = "sources" | "generate" | "review";

const STEPS: { id: Step; label: string }[] = [
  { id: "sources", label: "Fontes" },
  { id: "generate", label: "Gerar" },
  { id: "review", label: "Revisar e aplicar" },
];

const KIND_LABEL: Record<string, string> = { site: "Site", social: "Instagram", url: "Página", document: "Documento", text: "Texto" };
const STATUS_LABEL: Record<KnowledgeSource["status"], string> = { pending: "Na fila", indexing: "Lendo", indexed: "Pronto", failed: "Falhou" };

const linkButton =
  "inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800";

export default function AgentSetup() {
  const { workspaceId } = useRequiredWorkspace();
  const sources = useKnowledgeSources(workspaceId, 3000);
  const { data: entitlements } = useEntitlements();
  const [step, setStep] = useState<Step>("sources");
  const [extraText, setExtraText] = useState("");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<AgentSetupDraft | null>(null);

  const selected = selectedSources(sources.data, excluded);
  const canContinue = selected.length > 0 || extraText.trim().length > 0;
  const inactive = entitlements ? !entitlements.active : false;
  const aiOn = hasFeature(entitlements, "ai_enabled");

  return (
    <>
      <PageHeader
        title="Assistente de configuração"
        description="Monte a persona e as instruções do agente a partir do que a empresa já publicou: site, Instagram, documentos e textos. Você revisa tudo antes de aplicar."
        actions={
          <Link to="/agent" className={linkButton}>
            <ArrowLeft className="h-4 w-4" /> Voltar ao agente
          </Link>
        }
      />

      <ol className="mb-5 flex flex-wrap gap-2" aria-label="Etapas">
        {STEPS.map((s, i) => {
          const disabled = (s.id === "review" && !draft) || (s.id === "generate" && !canContinue);
          return (
            <li key={s.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => setStep(s.id)}
                aria-current={step === s.id ? "step" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                  step === s.id
                    ? "border-brand bg-brand/10 text-brand dark:bg-brand/20"
                    : "border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-800",
                )}
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-current/10 text-xs">{i + 1}</span>
                {s.label}
              </button>
            </li>
          );
        })}
      </ol>

      {entitlements && inactive && (
        <div className="mb-4">
          <Notice tone="warn">{inactiveReason(entitlements)} Importações e geração estão pausadas.</Notice>
        </div>
      )}

      {sources.error ? (
        <ErrorState error={sources.error} onRetry={() => void sources.refetch()} />
      ) : step === "sources" ? (
        <SourcesStep
          workspaceId={workspaceId}
          sources={sources.data ?? []}
          loading={sources.isLoading}
          extraText={extraText}
          onExtraText={setExtraText}
          excluded={excluded}
          onToggle={(id) =>
            setExcluded((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          canContinue={canContinue}
          onContinue={() => setStep("generate")}
        />
      ) : step === "generate" ? (
        <GenerateStep
          workspaceId={workspaceId}
          sources={sources.data ?? []}
          selected={selected}
          extraText={extraText}
          aiOn={aiOn}
          inactive={inactive}
          onBack={() => setStep("sources")}
          onDraft={(d) => {
            setDraft(d);
            setStep("review");
          }}
        />
      ) : draft ? (
        <ReviewStep
          key={draft.id}
          workspaceId={workspaceId}
          draft={draft}
          onBackToSources={() => setStep("sources")}
          onDiscarded={() => {
            setDraft(null);
            setStep("generate");
          }}
        />
      ) : null}
    </>
  );
}

// ================================================================ Etapa 1: fontes
function SourcesStep(props: {
  workspaceId: string;
  sources: KnowledgeSource[];
  loading: boolean;
  extraText: string;
  onExtraText: (v: string) => void;
  excluded: Set<string>;
  onToggle: (id: string) => void;
  canContinue: boolean;
  onContinue: () => void;
}) {
  const { data: entitlements } = useEntitlements();
  const gate = createGate(entitlements, "max_knowledge_sources");
  const byKind = (kinds: string[]) => props.sources.filter((s) => kinds.includes(s.kind));

  return (
    <div className="space-y-5">
      {gate.reason && <Notice tone="warn">{gate.reason}</Notice>}
      <div className="grid gap-5 lg:grid-cols-2">
        <SiteCard workspaceId={props.workspaceId} sources={byKind(["site"])} gateReason={gate.allowed ? null : gate.reason} />
        <InstagramCard workspaceId={props.workspaceId} sources={byKind(["social"])} gateReason={gate.allowed ? null : gate.reason} />
        <DocumentsCard workspaceId={props.workspaceId} sources={byKind(["document"])} gateReason={gate.allowed ? null : gate.reason} />
        <TextCard workspaceId={props.workspaceId} value={props.extraText} onChange={props.onExtraText} gateReason={gate.allowed ? null : gate.reason} />
      </div>
      <SourcePicker sources={props.sources} loading={props.loading} excluded={props.excluded} onToggle={props.onToggle} />
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
        {!props.canContinue && <p className="text-sm text-slate-500">Adicione ao menos uma fonte ou escreva algo no campo de texto.</p>}
        <Button onClick={props.onContinue} disabled={!props.canContinue}>
          Continuar <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function SourceList({ sources, empty }: { sources: KnowledgeSource[]; empty: string }) {
  const { workspaceId } = useRequiredWorkspace();
  const actions = useKnowledgeActions(workspaceId);
  const toast = useToast();
  if (sources.length === 0) return <p className="text-sm text-slate-400">{empty}</p>;
  return (
    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
      {sources.map((s) => {
        const pages = s.metadata?.pages?.length ?? 0;
        return (
          <li key={s.id} className="flex items-start gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{s.title}</p>
              {s.url && <p className="truncate text-xs text-slate-500">{s.url}</p>}
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Badge tone={statusTone(s.status)}>
                  {isBusy(s) && <Loader2 className="h-3 w-3 animate-spin" />}
                  {STATUS_LABEL[s.status]}
                </Badge>
                {s.kind === "site" && pages > 0 && <span className="text-xs text-slate-500">{pages} página(s)</span>}
                {s.kind === "social" && s.metadata?.fetched === false && <span className="text-xs text-slate-500">texto colado</span>}
                {s.status === "indexed" && <span className="text-xs text-slate-500">{s.chunk_count} trecho(s)</span>}
              </div>
              {s.error && <p className="mt-1 break-words text-xs text-red-600 dark:text-red-400">{s.error}</p>}
            </div>
            {s.kind !== "social" && s.kind !== "text" && (
              <Button
                size="sm"
                variant="ghost"
                aria-label="Ler de novo"
                title="Ler de novo"
                disabled={isBusy(s) || actions.isPending}
                onClick={() =>
                  actions.mutate(
                    { action: "reindex", source_id: s.id },
                    { onSuccess: () => toast.success("Leitura reiniciada."), onError: (e) => toast.error(e) },
                  )
                }
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function SiteCard({ workspaceId, sources, gateReason }: { workspaceId: string; sources: KnowledgeSource[]; gateReason: string | null }) {
  const { importSite } = useAgentSetupActions(workspaceId);
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [maxPages, setMaxPages] = useState(20);

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await importSite.mutateAsync({ url: url.trim(), max_pages: Math.min(40, Math.max(1, maxPages || 20)) });
      toast.success("Site na fila de leitura. As páginas aparecem aqui em instantes.");
      setUrl("");
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><Globe className="h-4 w-4 text-slate-400" /> Site</span>} description="Lemos as páginas públicas do domínio (sobre, serviços, preços, políticas, contato) respeitando o robots.txt." />
      <CardBody className="space-y-4">
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_110px_auto] sm:items-end">
          <Input label="Endereço do site" type="url" required placeholder="https://suaempresa.com.br" value={url} onChange={(e) => setUrl(e.target.value)} disabled={Boolean(gateReason)} />
          <Input label="Máx. páginas" type="number" min={1} max={40} value={maxPages} onChange={(e) => setMaxPages(Number(e.target.value))} disabled={Boolean(gateReason)} />
          <Button type="submit" loading={importSite.isPending} disabled={Boolean(gateReason) || !url.trim()} title={gateReason ?? undefined}>
            Ler site
          </Button>
        </form>
        <SourceList sources={sources} empty="Nenhum site importado ainda." />
      </CardBody>
    </Card>
  );
}

function InstagramCard({ workspaceId, sources, gateReason }: { workspaceId: string; sources: KnowledgeSource[]; gateReason: string | null }) {
  const { importInstagram } = useAgentSetupActions(workspaceId);
  const toast = useToast();
  const [profile, setProfile] = useState("");
  const [pasted, setPasted] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const handle = instagramHandle(profile);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setNote(null);
    try {
      const res = await importInstagram.mutateAsync({ profile: profile.trim(), pasted_text: pasted.trim() || undefined });
      setNote(res.note);
      toast.success(res.fetched ? "Perfil do Instagram importado." : "Instagram importado com o texto colado.");
      setPasted("");
    } catch (err) {
      setNote(errorMessage(err));
    }
  }

  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><AtSign className="h-4 w-4 text-slate-400" /> Instagram</span>} description="Usamos só o que é público. O Instagram costuma bloquear leitura automática, então colar a bio e os destaques dá o melhor resultado." />
      <CardBody className="space-y-4">
        <form onSubmit={submit} className="space-y-3">
          <Input
            label="Perfil"
            placeholder="@suaempresa ou https://instagram.com/suaempresa"
            required
            value={profile}
            onChange={(e) => setProfile(e.target.value)}
            error={profile.trim() && !handle ? "Informe um @perfil ou link válido." : undefined}
            disabled={Boolean(gateReason)}
          />
          <Textarea
            label="Bio, destaques e legendas importantes"
            rows={5}
            placeholder="Cole aqui a bio, destaques e legendas importantes (recomendado — o Instagram costuma bloquear leitura automática)"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            disabled={Boolean(gateReason)}
          />
          <div className="flex justify-end">
            <Button type="submit" loading={importInstagram.isPending} disabled={Boolean(gateReason) || !handle} title={gateReason ?? undefined}>
              Importar Instagram
            </Button>
          </div>
        </form>
        {note && <Notice>{note}</Notice>}
        <SourceList sources={sources} empty="Nenhum perfil importado ainda." />
      </CardBody>
    </Card>
  );
}

function DocumentsCard({ workspaceId, sources, gateReason }: { workspaceId: string; sources: KnowledgeSource[]; gateReason: string | null }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const qc = useQueryClient();

  async function upload(files: FileList) {
    const list = Array.from(files);
    setUploading(list.length);
    let ok = 0;
    for (const file of list) {
      try {
        await uploadKnowledgeDocument(workspaceId, file);
        ok++;
      } catch (err) {
        toast.error(`${file.name}: ${errorMessage(err)}`);
      }
      setUploading((n) => n - 1);
    }
    if (ok) toast.success(`${ok} documento(s) enviado(s) para leitura.`);
    void qc.invalidateQueries({ queryKey: sourcesKey(workspaceId) });
    invalidateEntitlements(qc, workspaceId);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><FileUp className="h-4 w-4 text-slate-400" /> Documentos</span>}
        description="Apresentações, tabelas de preço, regulamentos, cardápios, políticas. PDF, DOCX, TXT ou MD até 20 MB."
        actions={
          <>
            <Button size="sm" loading={uploading > 0} disabled={Boolean(gateReason)} title={gateReason ?? undefined} onClick={() => fileRef.current?.click()}>
              <Plus className="h-4 w-4" /> Enviar arquivos
            </Button>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={KNOWLEDGE_ACCEPT}
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) void upload(e.target.files);
              }}
            />
          </>
        }
      />
      <CardBody>
        <SourceList sources={sources} empty="Nenhum documento enviado ainda." />
      </CardBody>
    </Card>
  );
}

function TextCard({ workspaceId, value, onChange, gateReason }: { workspaceId: string; value: string; onChange: (v: string) => void; gateReason: string | null }) {
  const actions = useKnowledgeActions(workspaceId);
  const toast = useToast();
  const [saved, setSaved] = useState(false);

  async function save() {
    try {
      await actions.mutateAsync({ action: "create_text", workspace_id: workspaceId, title: "Informações adicionais", content: value.trim() });
      toast.success("Texto salvo na base de conhecimento.");
      setSaved(true);
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><Type className="h-4 w-4 text-slate-400" /> Texto</span>} description="O que não está publicado: regras da casa, políticas, diferenciais, como você quer que o agente fale." />
      <CardBody className="space-y-3">
        <Textarea
          label="Outras informações"
          rows={7}
          placeholder="Outras informações (regras da casa, políticas, diferenciais, tom de voz desejado…)"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setSaved(false);
          }}
          hint="Este texto sempre vai junto para a geração."
        />
        <div className="flex flex-wrap items-center justify-end gap-2">
          {saved && <span className="text-xs text-emerald-700 dark:text-emerald-400">Salvo como fonte.</span>}
          <Button
            size="sm"
            variant="secondary"
            loading={actions.isPending}
            disabled={value.trim().length < 20 || saved || Boolean(gateReason)}
            title={gateReason ?? (value.trim().length < 20 ? "Mínimo de 20 caracteres." : undefined)}
            onClick={() => void save()}
          >
            Salvar também na base de conhecimento
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function SourcePicker({ sources, loading, excluded, onToggle }: { sources: KnowledgeSource[]; loading: boolean; excluded: Set<string>; onToggle: (id: string) => void }) {
  const eligible = eligibleSources(sources);
  const failed = eligible.filter((s) => s.status === "failed");
  return (
    <Card>
      <CardHeader title="Fontes que a IA vai ler" description="Todas as fontes prontas entram por padrão. Desmarque o que não representa bem a empresa." />
      {loading ? (
        <CardBody className="flex justify-center"><Spinner /></CardBody>
      ) : eligible.length === 0 ? (
        <CardBody><p className="text-sm text-slate-400">Nenhuma fonte ainda. Importe o site, o Instagram ou envie documentos acima.</p></CardBody>
      ) : (
        <CardBody className="space-y-3">
          {failed.length > 0 && (
            <Notice tone="warn">{failed.length} fonte(s) falharam na leitura e ficam de fora. Veja o erro na lista e tente ler de novo.</Notice>
          )}
          <ul className="grid gap-2 sm:grid-cols-2">
            {eligible.map((s) => {
              const off = s.status === "failed";
              const checked = !off && !excluded.has(s.id);
              return (
                <li key={s.id}>
                  <label
                    className={cn(
                      "flex items-start gap-2 rounded-lg border border-slate-200 p-2.5 text-sm dark:border-slate-800",
                      off ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand dark:border-slate-600 dark:bg-slate-900"
                      checked={checked}
                      disabled={off}
                      onChange={() => onToggle(s.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{s.title}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <Badge>{KIND_LABEL[s.kind] ?? s.kind}</Badge>
                        <Badge tone={statusTone(s.status)}>
                          {isBusy(s) && <Loader2 className="h-3 w-3 animate-spin" />}
                          {STATUS_LABEL[s.status]}
                        </Badge>
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </CardBody>
      )}
    </Card>
  );
}

// ================================================================ Etapa 2: gerar
const PROGRESS = [
  "Lendo as fontes…",
  "Entendendo o negócio e o tom de voz…",
  "Escrevendo a persona e as regras…",
  "Montando perguntas frequentes e catálogo…",
  "Conferindo o que faltou nas fontes…",
];

function GenerateStep(props: {
  workspaceId: string;
  sources: KnowledgeSource[];
  selected: KnowledgeSource[];
  extraText: string;
  aiOn: boolean;
  inactive: boolean;
  onBack: () => void;
  onDraft: (d: AgentSetupDraft) => void;
}) {
  const { generate } = useAgentSetupActions(props.workspaceId);
  const drafts = useSetupDrafts(props.workspaceId);
  const [tick, setTick] = useState(0);
  const busy = props.selected.filter(isBusy);
  const failed = eligibleSources(props.sources).filter((s) => s.status === "failed");
  const ready = props.selected.filter((s) => s.status === "indexed");
  const blocked = !props.aiOn || props.inactive || busy.length > 0 || (ready.length === 0 && !props.extraText.trim());

  useEffect(() => {
    if (!generate.isPending) return;
    setTick(0);
    const t = window.setInterval(() => setTick((n) => n + 1), 7000);
    return () => window.clearInterval(t);
  }, [generate.isPending]);

  async function run() {
    try {
      const res = await generate.mutateAsync({ source_ids: ready.map((s) => s.id), extra_text: props.extraText.trim() || undefined });
      props.onDraft(res.draft);
    } catch {
      // O erro aparece no card abaixo.
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardHeader title="Gerar persona e instruções" description="A IA lê as fontes selecionadas e propõe a configuração completa do agente. Nada é aplicado sem a sua revisão." />
        <CardBody className="space-y-4">
          {!props.aiOn && <Notice tone="warn">IA desativada no plano: a geração automática não está disponível. Fale com o suporte para incluir IA.</Notice>}
          {busy.length > 0 && (
            <Notice>
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Aguardando a leitura de {busy.length} fonte(s). A geração libera quando terminar.
              </span>
            </Notice>
          )}
          {failed.length > 0 && <Notice tone="warn">{failed.length} fonte(s) com falha ficaram de fora.</Notice>}

          <div>
            <p className="text-sm font-medium">Vai ler</p>
            {ready.length === 0 && busy.length === 0 ? (
              <p className="mt-1 text-sm text-slate-500">Nenhuma fonte pronta selecionada{props.extraText.trim() ? "; só o texto informado." : "."}</p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {props.selected.map((s) => (
                  <li key={s.id}>
                    <Badge tone={s.status === "indexed" ? "neutral" : "amber"}>
                      {KIND_LABEL[s.kind] ?? s.kind}: {s.title.length > 40 ? `${s.title.slice(0, 40)}…` : s.title}
                    </Badge>
                  </li>
                ))}
                {props.extraText.trim() && (
                  <li><Badge tone="blue">Texto informado ({props.extraText.trim().length} caracteres)</Badge></li>
                )}
              </ul>
            )}
          </div>

          {generate.isPending && (
            <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-800 dark:bg-slate-900" role="status" aria-live="polite">
              <Loader2 className="h-5 w-5 shrink-0 animate-spin text-brand" />
              <div>
                <p className="font-medium">{PROGRESS[Math.min(tick, PROGRESS.length - 1)]}</p>
                <p className="text-xs text-slate-500">Costuma levar de 20 a 60 segundos. Não feche esta página.</p>
              </div>
            </div>
          )}
          {generate.error && <p className="text-sm text-red-600 dark:text-red-400">{errorMessage(generate.error)}</p>}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button variant="secondary" onClick={props.onBack} disabled={generate.isPending}>
              <ArrowLeft className="h-4 w-4" /> Fontes
            </Button>
            <Button onClick={() => void run()} loading={generate.isPending} disabled={blocked}>
              <Sparkles className="h-4 w-4" /> Gerar persona e instruções
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card className="self-start">
        <CardHeader title="Rascunhos anteriores" />
        {drafts.isLoading ? (
          <CardBody className="flex justify-center"><Spinner /></CardBody>
        ) : drafts.error ? (
          <CardBody><ErrorState error={drafts.error} onRetry={() => void drafts.refetch()} /></CardBody>
        ) : (drafts.data ?? []).length === 0 ? (
          <CardBody><p className="text-sm text-slate-400">Nenhum rascunho ainda.</p></CardBody>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {(drafts.data ?? []).map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{formatDateTime(d.created_at)}</p>
                  <p className="text-xs text-slate-500">
                    {d.draft?.faqs?.length ?? 0} pergunta(s) · {d.draft?.products?.length ?? 0} produto(s)
                    {(d.draft?.missing_information?.length ?? 0) > 0 && ` · ${d.draft.missing_information.length} pendência(s)`}
                  </p>
                  <div className="mt-1"><DraftStatus status={d.status} /></div>
                </div>
                <Button size="sm" variant="secondary" disabled={d.status === "discarded"} onClick={() => props.onDraft(d)}>
                  Abrir
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function DraftStatus({ status }: { status: AgentSetupDraft["status"] }) {
  if (status === "applied") return <Badge tone="green">aplicado</Badge>;
  if (status === "discarded") return <Badge>descartado</Badge>;
  return <Badge tone="blue">para revisar</Badge>;
}

// ================================================================ Etapa 3: revisar e aplicar
function normalizeContent(c: AgentSetupContent): AgentSetupContent {
  return {
    business: c.business ?? ({} as AgentSetupContent["business"]),
    agent: { agent_name: "", language: "pt-BR", persona_prompt: "", guardrails: "", ...((c.agent ?? {}) as Partial<AgentSetupContent["agent"]>) },
    business_hours: c.business_hours ?? null,
    handoff: { keywords: [], message: "", out_of_hours_message: null, ...((c.handoff ?? {}) as Partial<AgentSetupContent["handoff"]>) },
    payment_links: c.payment_links ?? [],
    faqs: c.faqs ?? [],
    products: c.products ?? [],
    missing_information: c.missing_information ?? [],
    sources_used: c.sources_used ?? [],
  };
}

function ReviewStep({ workspaceId, draft, onBackToSources, onDiscarded }: { workspaceId: string; draft: AgentSetupDraft; onBackToSources: () => void; onDiscarded: () => void }) {
  const toast = useToast();
  const { apply, discard } = useAgentSetupActions(workspaceId);
  const config = useAgentConfig(workspaceId);
  const faqs = useFaqs(workspaceId);
  const products = useProducts(workspaceId);
  const [content, setContent] = useState<AgentSetupContent>(() => normalizeContent(structuredClone(draft.draft)));
  const [toggles, setToggles] = useState<SectionToggles>(() => defaultToggles(normalizeContent(draft.draft)));
  const [faqSel, setFaqSel] = useState<Set<number>>(new Set());
  const [prodSel, setProdSel] = useState<Set<number>>(new Set());
  const [compare, setCompare] = useState(false);
  const [result, setResult] = useState<SetupApplyResult["applied"] | null>(null);
  const initialized = useRef({ faqs: false, products: false });

  const faqDupes = useMemo(() => duplicateFaqIndexes(content.faqs, faqs.data), [content.faqs, faqs.data]);
  const prodDupes = useMemo(() => duplicateProductIndexes(content.products, products.data), [content.products, products.data]);

  // Seleção inicial só depois de saber o que já existe (duplicados ficam desmarcados).
  useEffect(() => {
    if (!initialized.current.faqs && faqs.data) {
      initialized.current.faqs = true;
      setFaqSel(defaultSelection(content.faqs.length, duplicateFaqIndexes(content.faqs, faqs.data)));
    }
  }, [faqs.data, content.faqs]);
  useEffect(() => {
    if (!initialized.current.products && products.data) {
      initialized.current.products = true;
      setProdSel(defaultSelection(content.products.length, duplicateProductIndexes(content.products, products.data)));
    }
  }, [products.data, content.products]);

  const set = <K extends keyof AgentSetupContent>(key: K, value: AgentSetupContent[K]) => setContent((c) => ({ ...c, [key]: value }));
  const toggle = (key: keyof SectionToggles) => (v: boolean) => setToggles((t) => ({ ...t, [key]: v }));
  const flip = (setter: (fn: (s: Set<number>) => Set<number>) => void, i: number) =>
    setter((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const sections = buildSections(toggles, faqSel, prodSel);
  const summary = [
    toggles.profile && "perfil",
    toggles.guardrails && "regras",
    toggles.business_hours && "horário",
    toggles.handoff && "transferência",
    toggles.payment_links && "links de pagamento",
    faqSel.size > 0 && `${faqSel.size} pergunta(s)`,
    prodSel.size > 0 && `${prodSel.size} produto(s)`,
  ].filter(Boolean) as string[];
  const hours = content.business_hours ?? { timezone: config.data?.timezone ?? "America/Sao_Paulo", weekly: {} };

  async function submit() {
    if (toggles.profile && !content.agent.persona_prompt.trim()) {
      toast.error("A persona não pode ficar vazia.");
      return;
    }
    try {
      const res = await apply.mutateAsync({ draft_id: draft.id, draft: cleanContent(content), sections });
      setResult(res.applied);
      toast.success(`Configuração aplicada: ${summary.join(", ")}.`);
    } catch (err) {
      toast.error(err);
    }
  }

  function addMissingAsFaq(question: string) {
    const index = content.faqs.length;
    set("faqs", [...content.faqs, { question, answer: "", source: "Você" }]);
    setFaqSel((s) => new Set(s).add(index));
    toast.info("Pergunta adicionada ao fim da lista de perguntas frequentes. Escreva a resposta lá.");
  }

  if (result) {
    const items = [
      result.profile && "persona e perfil",
      result.guardrails && "regras",
      result.business_hours && "horário de atendimento",
      result.handoff && "transferência para a equipe",
      result.payment_links && "links de pagamento",
      result.faqs > 0 && `${result.faqs} pergunta(s) frequente(s)`,
      result.products > 0 && `${result.products} produto(s)`,
    ].filter(Boolean) as string[];
    return (
      <Card>
        <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
          <CheckCircle2 className="h-10 w-10 text-emerald-600" />
          <h2 className="text-lg font-semibold">Configuração aplicada</h2>
          <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">
            {items.length ? `Atualizado: ${items.join(", ")}.` : "Nenhuma alteração foi necessária."} Teste algumas perguntas reais antes de liberar para os clientes.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Link to="/agent" className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-medium text-brand-fg shadow-sm hover:bg-brand/90">
              Testar no simulador <ArrowRight className="h-4 w-4" />
            </Link>
            <Button variant="secondary" onClick={() => setResult(null)}>Voltar ao rascunho</Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-5 pb-24">
      {draft.status === "applied" && <Notice>Este rascunho já foi aplicado{draft.applied_at ? ` em ${formatDateTime(draft.applied_at)}` : ""}. Aplicar de novo substitui as seções marcadas.</Notice>}
      {draft.status === "discarded" && <Notice tone="warn">Este rascunho foi descartado.</Notice>}

      {content.missing_information.length > 0 && (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-900/70 dark:bg-amber-950/30">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">O que faltou nas fontes</h2>
              <p className="mt-0.5 text-sm text-amber-900/80 dark:text-amber-200/80">
                Sem estas informações o agente vai transferir para a equipe quando perguntarem. Responda no campo Texto (etapa Fontes) e gere de novo, ou cadastre a resposta direto nas perguntas frequentes.
              </p>
              <ul className="mt-3 space-y-2">
                {content.missing_information.map((m, i) => (
                  <li key={i} className="flex flex-col gap-2 rounded-lg bg-white/70 p-2.5 text-sm dark:bg-slate-900/60 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <span className="font-medium">{m.topic}</span>
                      <span className="text-slate-600 dark:text-slate-400"> — {m.question}</span>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => addMissingAsFaq(m.question)}>
                      <Plus className="h-4 w-4" /> Responder como pergunta
                    </Button>
                  </li>
                ))}
              </ul>
              <Button size="sm" variant="ghost" className="mt-2" onClick={onBackToSources}>
                <ArrowLeft className="h-4 w-4" /> Voltar às fontes
              </Button>
            </div>
          </div>
        </section>
      )}

      <BusinessCard content={content} />

      <SectionCard title="Perfil e persona" description="Nome, idioma e as instruções principais do agente." checked={toggles.profile} onCheck={toggle("profile")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Nome do agente" value={content.agent.agent_name} onChange={(e) => set("agent", { ...content.agent, agent_name: e.target.value })} />
          <Select label="Idioma" value={content.agent.language} onChange={(e) => set("agent", { ...content.agent, language: e.target.value })}>
            <option value="pt-BR">Português (Brasil)</option>
            <option value="en-US">Inglês</option>
            <option value="es-ES">Espanhol</option>
          </Select>
        </div>
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => setCompare((v) => !v)}>
            {compare ? "Ocultar a persona atual" : "Comparar com o atual"}
          </Button>
        </div>
        <div className={cn("grid gap-4", compare && "lg:grid-cols-2")}>
          {compare && (
            <div className="min-w-0">
              <p className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-300">Persona atual</p>
              <div className="max-h-[420px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                {config.data?.persona_prompt || "—"}
              </div>
            </div>
          )}
          <Textarea
            label={compare ? "Persona proposta" : "Persona e instruções"}
            rows={16}
            value={content.agent.persona_prompt}
            onChange={(e) => set("agent", { ...content.agent, persona_prompt: e.target.value })}
          />
        </div>
      </SectionCard>

      <SectionCard title="Regras" description="Limites do que o agente pode dizer ou prometer, além das regras de segurança da plataforma." checked={toggles.guardrails} onCheck={toggle("guardrails")}>
        <Textarea rows={8} aria-label="Regras" value={content.agent.guardrails} onChange={(e) => set("agent", { ...content.agent, guardrails: e.target.value })} />
      </SectionCard>

      <SectionCard
        title="Horário de atendimento"
        description={content.business_hours ? "Usado para avisar quando a equipe humana não está disponível." : "As fontes não informaram horário. Preencha se quiser aplicar."}
        checked={toggles.business_hours}
        onCheck={toggle("business_hours")}
      >
        <Input
          label="Fuso horário"
          value={hours.timezone}
          onChange={(e) => set("business_hours", { ...hours, timezone: e.target.value })}
          hint="Ex.: America/Sao_Paulo"
        />
        <BusinessHoursEditor value={hours.weekly ?? {}} onChange={(weekly) => set("business_hours", { ...hours, weekly })} />
      </SectionCard>

      <SectionCard title="Transferência para a equipe" description="Quando e como o agente passa a conversa para uma pessoa." checked={toggles.handoff} onCheck={toggle("handoff")}>
        <KeywordChips value={content.handoff.keywords} onChange={(keywords) => set("handoff", { ...content.handoff, keywords })} />
        <Textarea label="Mensagem ao transferir" rows={3} value={content.handoff.message} onChange={(e) => set("handoff", { ...content.handoff, message: e.target.value })} />
        <Textarea
          label="Mensagem fora do horário (opcional)"
          rows={3}
          value={content.handoff.out_of_hours_message ?? ""}
          onChange={(e) => set("handoff", { ...content.handoff, out_of_hours_message: e.target.value || null })}
        />
      </SectionCard>

      <SectionCard title="Links de pagamento" description="Enviados apenas quando o cliente quiser pagar." checked={toggles.payment_links} onCheck={toggle("payment_links")}>
        <PaymentLinksEditor
          value={content.payment_links.map((p) => ({ label: p.label, url: p.url, description: p.description ?? "" }))}
          onChange={(v) => set("payment_links", v.map((p) => ({ label: p.label, url: p.url, description: p.description || null })))}
        />
      </SectionCard>

      <ItemsCard
        title="Perguntas frequentes"
        description="Cada pergunta marcada vira uma FAQ do agente. As que já existem ficam desmarcadas."
        count={content.faqs.length}
        selected={faqSel}
        onAll={(all) => setFaqSel(all ? new Set(content.faqs.map((_, i) => i)) : new Set())}
        actions={
          <Button size="sm" variant="secondary" onClick={() => addMissingAsFaq("")}>
            <Plus className="h-4 w-4" /> Nova
          </Button>
        }
      >
        {content.faqs.map((f, i) => (
          <ItemRow key={i} checked={faqSel.has(i)} onToggle={() => flip(setFaqSel, i)} duplicate={faqDupes.has(i)} source={f.source}>
            <Input aria-label="Pergunta" value={f.question} onChange={(e) => set("faqs", content.faqs.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)))} />
            <Textarea aria-label="Resposta" rows={3} value={f.answer} onChange={(e) => set("faqs", content.faqs.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)))} />
          </ItemRow>
        ))}
      </ItemsCard>

      <ItemsCard
        title="Catálogo"
        description="Produtos, serviços ou acomodações encontrados nas fontes. Os que já existem ficam desmarcados."
        count={content.products.length}
        selected={prodSel}
        onAll={(all) => setProdSel(all ? new Set(content.products.map((_, i) => i)) : new Set())}
      >
        {content.products.map((p, i) => {
          const upd = (patch: Partial<AgentSetupContent["products"][number]>) =>
            set("products", content.products.map((x, j) => (j === i ? { ...x, ...patch } : x)));
          return (
            <ItemRow key={i} checked={prodSel.has(i)} onToggle={() => flip(setProdSel, i)} duplicate={prodDupes.has(i)}>
              <div className="grid gap-2 sm:grid-cols-[1fr_140px_90px]">
                <Input aria-label="Nome" value={p.name} onChange={(e) => upd({ name: e.target.value })} />
                <Input
                  aria-label="Preço"
                  type="number"
                  step="0.01"
                  min={0}
                  placeholder="Preço"
                  value={p.price ?? ""}
                  onChange={(e) => upd({ price: e.target.value === "" ? null : Number(e.target.value) })}
                />
                <Select aria-label="Moeda" value={p.currency || "BRL"} onChange={(e) => upd({ currency: e.target.value })}>
                  <option value="BRL">BRL</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </Select>
              </div>
              <Textarea aria-label="Descrição" rows={2} placeholder="Descrição" value={p.description ?? ""} onChange={(e) => upd({ description: e.target.value || null })} />
              <Input aria-label="Link" type="url" placeholder="https://" value={p.url ?? ""} onChange={(e) => upd({ url: e.target.value || null })} />
            </ItemRow>
          );
        })}
      </ItemsCard>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 lg:left-60">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-w-0 text-sm text-slate-600 dark:text-slate-400">
            {summary.length ? <>Vai aplicar: <span className="font-medium text-slate-900 dark:text-slate-100">{summary.join(", ")}</span></> : "Nada selecionado."}
          </p>
          <div className="flex gap-2">
            <ConfirmButton
              variant="ghost"
              title="Descartar rascunho?"
              description="A configuração atual do agente não muda. Você pode gerar outro rascunho quando quiser."
              confirmLabel="Descartar"
              disabled={draft.status === "discarded"}
              onConfirm={() =>
                discard
                  .mutateAsync(draft.id)
                  .then(() => {
                    toast.success("Rascunho descartado.");
                    onDiscarded();
                  })
                  .catch((e) => toast.error(e))
              }
            >
              Descartar rascunho
            </ConfirmButton>
            <Button onClick={() => void submit()} loading={apply.isPending} disabled={nothingSelected(sections) || draft.status === "discarded"} className="flex-1 sm:flex-none">
              Aplicar selecionados
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BusinessCard({ content }: { content: AgentSetupContent }) {
  const b = content.business;
  const facts: [string, string | null | undefined][] = [
    ["Segmento", b.segment],
    ["Cidade", b.city],
    ["Endereço", b.address],
    ["Telefone", b.phone],
    ["WhatsApp", b.whatsapp],
    ["E-mail", b.email],
    ["Site", b.website_url],
    ["Instagram", b.instagram],
    ["Tom observado", b.tone_observed],
  ];
  return (
    <Card>
      <CardHeader title={`Sobre a empresa${b.name ? `: ${b.name}` : ""}`} description="O que a IA entendeu das fontes. Serve para você conferir se a leitura foi correta." />
      <CardBody className="space-y-4">
        {b.summary && <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{b.summary}</p>}
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {facts
            .filter(([, v]) => v && String(v).trim())
            .map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-xs text-slate-500">{k}</dt>
                <dd className="break-words">{v}</dd>
              </div>
            ))}
        </dl>
        {content.sources_used.length > 0 && (
          <div>
            <p className="mb-1 text-xs text-slate-500">Fontes usadas</p>
            <div className="flex flex-wrap gap-1.5">
              {content.sources_used.map((s, i) => (
                <Badge key={i}>{KIND_LABEL[s.kind] ?? s.kind}: {s.title}</Badge>
              ))}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function ApplyToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm dark:border-slate-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-brand dark:border-slate-600 dark:bg-slate-900"
      />
      Aplicar esta seção
    </label>
  );
}

function SectionCard({ title, description, checked, onCheck, children }: { title: string; description?: string; checked: boolean; onCheck: (v: boolean) => void; children: ReactNode }) {
  return (
    <Card className={cn(!checked && "opacity-80")}>
      <CardHeader title={title} description={description} actions={<ApplyToggle checked={checked} onChange={onCheck} />} />
      <CardBody className={cn("space-y-4", !checked && "pointer-events-none select-none opacity-60")} aria-disabled={!checked}>
        {children}
      </CardBody>
    </Card>
  );
}

function ItemsCard({
  title,
  description,
  count,
  selected,
  onAll,
  actions,
  children,
}: {
  title: string;
  description: string;
  count: number;
  selected: Set<number>;
  onAll: (all: boolean) => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader
        title={`${title} (${selected.size} de ${count})`}
        description={description}
        actions={
          <>
            {count > 0 && (
              <>
                <Button size="sm" variant="ghost" onClick={() => onAll(true)}>Marcar todas</Button>
                <Button size="sm" variant="ghost" onClick={() => onAll(false)}>Desmarcar</Button>
              </>
            )}
            {actions}
          </>
        }
      />
      {count === 0 ? (
        <CardBody><p className="text-sm text-slate-400">Nada encontrado nas fontes.</p></CardBody>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">{children}</ul>
      )}
    </Card>
  );
}

function ItemRow({ checked, onToggle, duplicate, source, children }: { checked: boolean; onToggle: () => void; duplicate?: boolean; source?: string; children: ReactNode }) {
  return (
    <li className={cn("flex gap-3 px-4 py-3 sm:px-5", !checked && "bg-slate-50/60 dark:bg-slate-900/40")}>
      <input
        type="checkbox"
        aria-label="Importar este item"
        checked={checked}
        onChange={onToggle}
        className="mt-2.5 h-4 w-4 shrink-0 rounded border-slate-300 text-brand dark:border-slate-600 dark:bg-slate-900"
      />
      <div className={cn("min-w-0 flex-1 space-y-2", !checked && "opacity-60")}>
        {children}
        {(duplicate || source) && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            {duplicate && <Badge tone="amber">já existe</Badge>}
            {source && <span>Fonte: {source}</span>}
          </div>
        )}
      </div>
    </li>
  );
}
