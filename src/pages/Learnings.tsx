// Aprendizados do atendimento: sugestões geradas das conversas (o que a IA ficou devendo, o que a equipe respondeu,
// perguntas que se repetem). O admin revisa, edita se quiser e aprova; só então vira FAQ, política ou regra.
import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronDown, ChevronUp, GraduationCap, MessageSquareText, RefreshCw, X } from "lucide-react";
import { useRequiredWorkspace } from "@/lib/workspace";
import { useLearningActions, useLearningRuns, useLearningSuggestions } from "@/hooks/use-learnings";
import { POLICY_TOPICS, policyTopicLabel } from "@/lib/policies";
import { formatDateTime } from "@/lib/format";
import type { LearningKind, LearningRun, LearningStatus, LearningSuggestion } from "@/lib/database.types";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Input, Notice, PageHeader, Select, Spinner, Tabs, Textarea, useToast } from "@/components/ui";

const KIND_LABEL: Record<LearningKind, string> = { faq: "Pergunta e resposta", policy: "Política", guardrail: "Regra do agente" };
const KIND_TONE = { faq: "brand", policy: "blue", guardrail: "violet" } as const;
const WHO_LABEL = { cliente: "Cliente", ia: "IA", equipe: "Equipe" } as const;
const TABS: Array<{ id: LearningStatus; label: string }> = [
  { id: "pending", label: "Pendentes" },
  { id: "applied", label: "Aplicadas" },
  { id: "dismissed", label: "Descartadas" },
];

export default function Learnings() {
  const { workspaceId } = useRequiredWorkspace();
  const [tab, setTab] = useState<LearningStatus>("pending");
  const list = useLearningSuggestions(workspaceId, tab);
  const runs = useLearningRuns(workspaceId);
  const { run } = useLearningActions(workspaceId);
  const toast = useToast();

  async function analyzeNow() {
    try {
      const r = await run.mutateAsync();
      toast.success(
        r.conversations_analyzed === 0
          ? "Nenhuma conversa nova para analisar."
          : r.suggestions_created === 0
            ? `${r.conversations_analyzed} conversa(s) analisada(s); nada novo a sugerir.`
            : `${r.conversations_analyzed} conversa(s) analisada(s): ${r.suggestions_created} sugestão(ões) nova(s).`,
      );
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <>
      <PageHeader
        title="Aprendizados"
        description="Todo dia a Callia relê as conversas e sugere o que cadastrar para atender melhor: perguntas sem resposta, fatos que a equipe informou, regras de comportamento. Nada muda sem a sua aprovação."
        actions={
          <Button onClick={analyzeNow} loading={run.isPending} variant="secondary">
            <RefreshCw className="h-4 w-4" /> Analisar agora
          </Button>
        }
      />
      <LastRun runs={runs.data} />
      <Tabs<LearningStatus> className="mb-4" tabs={TABS} value={tab} onChange={setTab} />
      {list.isLoading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data?.length ? (
        <Card>
          <EmptyState
            icon={GraduationCap}
            title={tab === "pending" ? "Nenhuma sugestão aguardando" : tab === "applied" ? "Nenhuma sugestão aplicada ainda" : "Nenhuma sugestão descartada"}
            description={tab === "pending" ? "A análise roda de madrugada, sobre as conversas do dia. Se quiser antecipar, use \"Analisar agora\"." : undefined}
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {list.data.map((s) => (tab === "pending" ? <PendingCard key={s.id} workspaceId={workspaceId} suggestion={s} /> : <DecidedRow key={s.id} suggestion={s} />))}
        </div>
      )}
    </>
  );
}

function LastRun({ runs }: { runs: LearningRun[] | undefined }) {
  const last = runs?.[0];
  if (!last) {
    return <Notice>Nenhuma análise ainda. A primeira acontece automaticamente de madrugada, com as conversas do dia; ou clique em "Analisar agora".</Notice>;
  }
  if (last.status === "failed") return <Notice tone="warn">A última análise ({formatDateTime(last.created_at)}) falhou: {last.error ?? "erro desconhecido"}. A próxima roda de madrugada.</Notice>;
  if (last.status === "running") return <Notice>Análise em andamento desde {formatDateTime(last.created_at)}…</Notice>;
  return (
    <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
      Última análise: {formatDateTime(last.finished_at ?? last.created_at)} · {last.conversations_analyzed} conversa(s) · {last.suggestions_created} sugestão(ões) nova(s)
      {last.trigger === "manual" ? " · a pedido" : ""}
    </p>
  );
}

type Draft = Record<string, string>;

function draftFor(s: LearningSuggestion): Draft {
  const p = s.payload as Record<string, string | null>;
  if (s.kind === "faq") return { question: p.question ?? "", answer: p.answer ?? "" };
  if (s.kind === "policy") return { topic: p.topic ?? "outro", title: p.title ?? "", content: p.content ?? "" };
  return { text: p.text ?? "" };
}

function PendingCard({ workspaceId, suggestion: s }: { workspaceId: string; suggestion: LearningSuggestion }) {
  const { apply, dismiss } = useLearningActions(workspaceId);
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(() => draftFor(s));
  const [showEvidence, setShowEvidence] = useState(false);
  const set = (k: string) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const missingAnswer = s.kind === "faq" && !(s.payload as { answer: string | null }).answer;
  const existingPolicy = s.kind === "policy" && Boolean((s.payload as { id: string | null }).id);
  const topicKnown = POLICY_TOPICS.some((t) => t.id === draft.topic);

  async function approve() {
    try {
      await apply.mutateAsync({ id: s.id, payload: draft });
      toast.success(s.kind === "faq" ? "Pergunta adicionada à base." : s.kind === "policy" ? (existingPolicy ? "Política atualizada." : "Política criada.") : "Regra adicionada ao agente.");
    } catch (err) {
      toast.error(err);
    }
  }
  async function discard() {
    try {
      await dismiss.mutateAsync(s.id);
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <Card>
      <CardHeader
        title={<span className="flex flex-wrap items-center gap-2">{s.title}<Badge tone={KIND_TONE[s.kind]}>{KIND_LABEL[s.kind]}</Badge>{existingPolicy && <Badge>altera política existente</Badge>}</span>}
        description={<>{s.rationale} <span className="whitespace-nowrap text-slate-400">· em {s.occurrences} conversa{s.occurrences > 1 ? "s" : ""}</span></>}
      />
      <CardBody className="space-y-3">
        {s.kind === "faq" && (
          <>
            <Input label="Pergunta" value={draft.question} onChange={set("question")} maxLength={300} />
            <Textarea
              label="Resposta"
              value={draft.answer}
              onChange={set("answer")}
              rows={3}
              maxLength={2000}
              placeholder={missingAnswer ? "A equipe não respondeu isso nas conversas. Escreva a resposta para aprovar." : undefined}
              hint={missingAnswer ? "Sem resposta registrada: complete antes de aprovar." : "Revise o texto; é o que o agente vai responder."}
            />
          </>
        )}
        {s.kind === "policy" && (
          <>
            <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
              <Select label="Assunto" value={topicKnown ? draft.topic : "outro"} onChange={set("topic")}>
                {POLICY_TOPICS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </Select>
              <Input label="Título" value={draft.title} onChange={set("title")} maxLength={120} />
            </div>
            <Textarea label="Texto da política" value={draft.content} onChange={set("content")} rows={3} maxLength={4000} hint="Entra no prompt do agente em toda resposta." />
          </>
        )}
        {s.kind === "guardrail" && (
          <Textarea label="Regra" value={draft.text} onChange={set("text")} rows={2} maxLength={600} hint="Vai para as regras de comportamento do agente, como um item novo." />
        )}

        <button type="button" onClick={() => setShowEvidence((v) => !v)} className="flex items-center gap-1 text-sm font-medium text-brand hover:underline">
          <MessageSquareText className="h-4 w-4" /> {showEvidence ? "Ocultar trechos" : "Ver trechos das conversas"} ({s.evidence.length})
          {showEvidence ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {showEvidence && (
          <ul className="space-y-3">
            {s.evidence.map((e) => (
              <li key={e.conversation_id} className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="font-medium">{e.contact}</span>
                  <Link to={`/inbox/${e.conversation_id}`} className="text-xs text-brand hover:underline">Abrir conversa</Link>
                </div>
                {e.excerpts.length ? (
                  <ul className="space-y-1">
                    {e.excerpts.map((x, i) => (
                      <li key={i} className="text-slate-700 dark:text-slate-300">
                        <span className="mr-1 text-xs font-semibold uppercase text-slate-400">{WHO_LABEL[x.who] ?? x.who}</span> {x.text}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-slate-500">Sem trecho destacado.</p>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={discard} loading={dismiss.isPending} disabled={apply.isPending}>
            <X className="h-4 w-4" /> Descartar
          </Button>
          <Button onClick={approve} loading={apply.isPending} disabled={dismiss.isPending || (s.kind === "faq" && draft.answer.trim().length < 2)}>
            <Check className="h-4 w-4" /> Aprovar
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function summary(s: LearningSuggestion): string {
  const p = (s.applied_payload ?? s.payload) as Record<string, string | null>;
  if (s.kind === "faq") return `${p.question ?? ""}${p.answer ? ` — ${p.answer}` : ""}`;
  if (s.kind === "policy") return `${policyTopicLabel(p.topic ?? "outro")} · ${p.title ?? ""}: ${p.content ?? ""}`;
  return p.text ?? "";
}

function DecidedRow({ suggestion: s }: { suggestion: LearningSuggestion }) {
  return (
    <Card>
      <CardBody className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{s.title}</span>
          <Badge tone={KIND_TONE[s.kind]}>{KIND_LABEL[s.kind]}</Badge>
          <span className="text-xs text-slate-400">{s.status === "applied" ? "aplicada" : "descartada"} em {formatDateTime(s.decided_at)}</span>
        </div>
        <p className="line-clamp-3 text-sm text-slate-600 dark:text-slate-400">{summary(s)}</p>
      </CardBody>
    </Card>
  );
}
