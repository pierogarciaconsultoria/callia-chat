import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight, Check, ChevronDown, ChevronUp, Clock, MapPin, Rocket, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { readLocal, writeLocal } from "@/lib/storage";
import { stepForPath, type Journey, type JourneyStep } from "@/lib/onboarding";
import { useJourney } from "@/hooks/use-journey";

const COLLAPSED_KEY = "callia:journey:collapsed";

/** Marcador da etapa: feito (check), atual (número com anel), pulado (tracejado) ou a fazer (número). */
function Dot({ step, index, here }: { step: JourneyStep; index: number; here: boolean }) {
  return (
    <span
      className={cn(
        "relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold",
        step.state === "done" && "border-emerald-500 bg-emerald-500 text-white",
        step.state === "current" && "border-brand bg-white text-brand ring-4 ring-brand/20 dark:bg-slate-900 dark:text-white dark:ring-brand/40",
        step.state === "todo" && "border-slate-300 bg-white text-slate-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-400",
        step.state === "skipped" && "border-dashed border-slate-300 bg-white text-slate-400 dark:border-slate-600 dark:bg-slate-900",
        here && step.state !== "current" && "ring-4 ring-slate-300/50 dark:ring-slate-600/50",
      )}
    >
      {step.state === "done" ? <Check className="h-4 w-4" aria-hidden /> : index + 1}
    </span>
  );
}

const resolvedState = (s: JourneyStep) => s.state === "done" || s.state === "skipped";

const STATE_LABEL: Record<JourneyStep["state"], string> = { done: "concluída", current: "próximo passo", todo: "a fazer", skipped: "pulada" };

/** Linha do tempo horizontal: cada etapa é um link; a linha fica verde até onde já foi feito. */
function Timeline({ journey, hereId }: { journey: Journey; hereId: string | null }) {
  return (
    <ol className="flex items-start" aria-label="Etapas da configuração">
      {journey.steps.map((s, i) => (
        <li key={s.id} className="relative flex min-w-0 flex-1 flex-col items-center">
          {i > 0 && (
            <span
              aria-hidden
              className={cn("absolute right-1/2 top-3.5 h-0.5 w-full -translate-y-1/2", resolvedState(journey.steps[i - 1]) ? "bg-emerald-400" : "bg-slate-200 dark:bg-slate-700")}
            />
          )}
          <Link
            to={s.to}
            title={`${s.title} (${STATE_LABEL[s.state]}${s.optional ? ", opcional" : ""})`}
            aria-current={hereId === s.id ? "step" : undefined}
            className="group flex min-w-0 flex-col items-center gap-1 rounded-md px-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <Dot step={s} index={i} here={hereId === s.id} />
            <span
              className={cn(
                "hidden max-w-full truncate text-[11px] leading-tight sm:block",
                s.state === "current" ? "font-semibold text-slate-900 dark:text-slate-100" : "text-slate-500 dark:text-slate-400",
                "group-hover:text-slate-900 dark:group-hover:text-slate-100",
              )}
            >
              {s.short}
            </span>
            {hereId === s.id && (
              <span className="hidden items-center gap-0.5 text-[10px] font-medium text-brand sm:flex">
                <MapPin className="h-3 w-3" aria-hidden /> aqui
              </span>
            )}
          </Link>
        </li>
      ))}
    </ol>
  );
}

function Progress({ journey }: { journey: Journey }) {
  const pct = Math.round((journey.resolved / journey.steps.length) * 100);
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso da configuração">
      <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * Barra no topo das telas de configuração enquanto a jornada não termina:
 * mostra onde o usuário está, o que fazer nesta tela e qual é o próximo passo.
 */
export function JourneyBar() {
  const { pathname } = useLocation();
  const { journey, hidden, setHidden, skip } = useJourney();
  const [collapsed, setCollapsed] = useState(() => readLocal(COLLAPSED_KEY) === "1");
  if (!journey || journey.complete || hidden || pathname === "/dashboard") return null;

  const here = stepForPath(journey, pathname);
  const next = journey.current;
  const onNextPage = next && here?.id === next.id;
  const toggle = () => {
    writeLocal(COLLAPSED_KEY, collapsed ? null : "1");
    setCollapsed(!collapsed);
  };

  return (
    <section aria-label="Jornada de configuração" className="border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Rocket className="h-4 w-4 text-brand" aria-hidden /> Configuração do atendimento
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400">{journey.resolved} de {journey.steps.length}</span>
          <div className="w-24"><Progress journey={journey} /></div>
          <div className="ml-auto flex items-center gap-1">
            {next && !onNextPage && (
              <Link to={next.to} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-xs font-medium text-brand-fg hover:opacity-90">
                Próximo passo: {next.title} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            )}
            <button type="button" onClick={toggle} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label={collapsed ? "Mostrar etapas" : "Recolher etapas"} aria-expanded={!collapsed}>
              {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </button>
            <button type="button" onClick={() => setHidden(true)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Ocultar a jornada" title="Ocultar (dá para mostrar de novo no Painel)">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {!collapsed && (
          <>
            <Timeline journey={journey} hereId={here?.id ?? null} />
            {here && here.state !== "done" && (
              <div className={cn("flex flex-wrap items-start gap-2 rounded-lg px-3 py-2 text-sm", here.state === "current" ? "bg-brand/10 text-slate-800 dark:text-slate-100" : "bg-slate-50 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300")}>
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
                <p className="min-w-0 flex-1">
                  <strong>Você está aqui: {here.title}.</strong> {here.tip}
                  {here.state !== "current" && next && <span className="text-slate-500 dark:text-slate-400"> (o próximo passo sugerido é {next.title}.)</span>}
                </p>
                {here.optional && here.state !== "skipped" && (
                  <button type="button" onClick={() => skip(here.id)} className="text-xs font-medium text-slate-500 underline hover:text-slate-700 dark:hover:text-slate-300">
                    Pular esta etapa
                  </button>
                )}
              </div>
            )}
            {here?.state === "done" && next && (
              <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
                <Check className="h-4 w-4" aria-hidden /> {here.title}: concluída. Siga para <Link to={next.to} className="font-medium underline">{next.title}</Link>.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/** Cartão completo (Painel e Inbox vazia): linha do tempo vertical com descrição, tempo e ação. */
export function JourneyCard({ className, compact = false }: { className?: string; compact?: boolean }) {
  const { journey, hidden, setHidden, skip } = useJourney();
  if (!journey || journey.complete) return null;
  if (hidden) {
    return compact ? null : (
      <button type="button" onClick={() => setHidden(false)} className={cn("inline-flex items-center gap-2 text-sm font-medium text-brand hover:underline", className)}>
        <Rocket className="h-4 w-4" aria-hidden /> Mostrar a jornada de configuração ({journey.resolved} de {journey.steps.length})
      </button>
    );
  }
  const next = journey.current;
  const left = journey.steps.filter((s) => s.state === "current" || s.state === "todo").reduce((m, s) => m + s.minutes, 0);

  return (
    <section aria-label="Jornada de configuração" className={cn("w-full rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-5", className)}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-base font-semibold"><Rocket className="h-4 w-4 text-brand" aria-hidden /> Configure seu atendimento</h2>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            {journey.resolved} de {journey.steps.length} etapas{left ? ` · cerca de ${left} min para terminar` : ""}
          </p>
        </div>
        <button type="button" onClick={() => setHidden(true)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800" aria-label="Ocultar a jornada">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3"><Progress journey={journey} /></div>

      {compact ? (
        next && (
          <Link to={next.to} className="mt-3 flex items-center gap-2 rounded-lg bg-brand/10 px-3 py-2 text-sm font-medium hover:bg-brand/15">
            Próximo passo: {next.title} <ArrowRight className="ml-auto h-4 w-4" aria-hidden />
          </Link>
        )
      ) : (
        <ol className="mt-4">
          {journey.steps.map((s, i) => (
            <li key={s.id} className="relative flex gap-3 pb-4 last:pb-0">
              {i < journey.steps.length - 1 && (
                <span aria-hidden className={cn("absolute left-3.5 top-7 h-[calc(100%-1.75rem)] w-0.5 -translate-x-1/2", resolvedState(s) ? "bg-emerald-400" : "bg-slate-200 dark:bg-slate-700")} />
              )}
              <Dot step={s} index={i} here={false} />
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Link to={s.to} className={cn("text-sm font-medium hover:underline", s.state === "done" && "text-slate-500 dark:text-slate-400", s.state === "skipped" && "text-slate-400 line-through")}>
                    {s.title}
                  </Link>
                  {s.optional && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400">opcional</span>}
                  {s.state === "current" && <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-brand dark:bg-brand/30 dark:text-slate-100">próximo passo</span>}
                  {s.state !== "done" && s.state !== "skipped" && (
                    <span className="flex items-center gap-1 text-xs text-slate-400"><Clock className="h-3 w-3" aria-hidden /> {s.minutes} min</span>
                  )}
                </div>
                {s.state === "current" && (
                  <>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{s.tip}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <Link to={s.to} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-sm font-medium text-brand-fg hover:opacity-90">
                        {journey.resolved ? "Continuar" : "Começar"} <ArrowRight className="h-4 w-4" aria-hidden />
                      </Link>
                      {s.optional && (
                        <button type="button" onClick={() => skip(s.id)} className="text-xs font-medium text-slate-500 underline hover:text-slate-700 dark:hover:text-slate-300">Pular</button>
                      )}
                    </div>
                  </>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
