// Boas-vindas (/bem-vindo): cria o workspace com os dados do cadastro e entrega na jornada de configuração.
import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { ArrowRight, CalendarClock, Check, Clock, Rocket } from "lucide-react";
import { useAuth, type SignupMetadata } from "@/lib/auth";
import { useWorkspace } from "@/lib/workspace";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/functions";
import { SEGMENT_LIST } from "@/lib/segments";
import { useJourney } from "@/hooks/use-journey";
import { Button, Card, Input, Notice, PageLoader, Select } from "@/components/ui";
import { Shell } from "./Login";

function friendlyError(err: unknown): string {
  // Código cru da RPC (errorMessage já o traduz para o texto genérico da plataforma; aqui o contexto é o cadastro).
  const raw = err instanceof Error ? err.message : String(err);
  if (/self_service_disabled/.test(raw)) return "O cadastro está disponível por convite no momento. Fale com a gente para liberar a sua conta.";
  if (/invalid_name/.test(raw)) return "Informe o nome da empresa (pelo menos 2 letras).";
  return errorMessage(err);
}

async function createFromSignup(params?: { name: string; segment: string | null }): Promise<string> {
  const { data, error } = await supabase.rpc("create_workspace_from_signup", params ? { p_name: params.name, p_segment: params.segment } : {});
  if (error) throw new Error(error.message);
  return String(data);
}

/** Sem workspace: cria com os metadados do cadastro; sem metadados (login social), pede o nome. */
function CreateWorkspace({ metadata, refresh }: { metadata: Partial<SignupMetadata>; refresh: () => Promise<void> }) {
  const auto = Boolean(metadata.company_name?.trim());
  const [name, setName] = useState(metadata.company_name ?? "");
  const [segment, setSegment] = useState(metadata.segment ?? "");
  const create = useMutation({
    mutationFn: (params?: { name: string; segment: string | null }) => createFromSignup(params),
    onSuccess: () => refresh(),
  });
  const { mutate } = create;
  useEffect(() => {
    if (auto) mutate(undefined);
  }, [auto, mutate]);

  if (auto && !create.isError) return <PageLoader label="Preparando o espaço da sua empresa…" />;

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate({ name: name.trim(), segment: segment || null });
  }

  return (
    <Shell subtitle="Só falta o nome da sua empresa">
      <Card className="p-5">
        {create.isError && (
          <div className="mb-4">
            <Notice tone="warn">{friendlyError(create.error)}</Notice>
          </div>
        )}
        <form onSubmit={submit} className="space-y-4">
          <Input label="Nome da empresa" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={120} />
          <Select label="Segmento" value={segment} onChange={(e) => setSegment(e.target.value)}>
            <option value="">Escolher depois</option>
            {SEGMENT_LIST.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </Select>
          <Button type="submit" className="w-full" loading={create.isPending}>Criar meu espaço</Button>
        </form>
      </Card>
    </Shell>
  );
}

function trialLabel(status: string, ends: string | null): string | null {
  if (status !== "trial" || !ends) return null;
  const date = new Date(ends).toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });
  return `Seu teste grátis vai até ${date}.`;
}

/** Workspace pronto: plano, o que vem agora e o primeiro passo da jornada. */
function WelcomeCard({ name, status, trialEndsAt }: { name: string; status: string; trialEndsAt: string | null }) {
  const { journey } = useJourney();
  const steps = journey?.steps ?? [];
  const next = journey?.current ?? null;
  const total = steps.filter((s) => s.state !== "done" && s.state !== "skipped").reduce((m, s) => m + s.minutes, 0);
  const trial = trialLabel(status, trialEndsAt);

  return (
    <Shell title={`Tudo pronto, ${name}!`} subtitle="Sua conta foi criada. Agora vamos colocar o agente para atender." wide>
      <Card className="p-5">
        {trial && (
          <p className="mb-4 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
            <CalendarClock className="h-4 w-4 shrink-0" aria-hidden /> {trial} Sem cartão de crédito.
          </p>
        )}
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Rocket className="h-4 w-4 text-brand" aria-hidden /> O que vem agora
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {steps.length ? `${steps.length} etapas guiadas${total ? `, cerca de ${total} min no total` : ""}. Dá para parar e continuar quando quiser.` : "Carregando a sua jornada de configuração…"}
        </p>
        <ol className="mt-4 space-y-2">
          {steps.map((s, i) => (
            <li key={s.id} className="flex items-start gap-3 text-sm">
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${s.state === "done" ? "bg-emerald-500 text-white" : s.state === "current" ? "bg-brand text-brand-fg" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"}`}>
                {s.state === "done" ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{s.title}</span>
                {s.optional && <span className="ml-1 text-xs text-slate-400">(opcional)</span>}
                <span className="ml-2 inline-flex items-center gap-1 text-xs text-slate-400"><Clock className="h-3 w-3" aria-hidden /> {s.minutes} min</span>
              </span>
            </li>
          ))}
        </ol>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Link to={next?.to ?? "/dashboard"} className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-medium text-brand-fg hover:opacity-90">
            {next ? `Começar: ${next.title}` : "Ir para o painel"} <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <Link to="/dashboard" className="text-sm font-medium text-slate-500 hover:underline">Ir para o painel</Link>
        </div>
      </Card>
    </Shell>
  );
}

export default function Welcome() {
  const { user, loading } = useAuth();
  const ws = useWorkspace();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/entrar" replace />;
  if (ws.loading) return <PageLoader label="Carregando…" />;
  if (!ws.workspace) return <CreateWorkspace metadata={(user.user_metadata ?? {}) as Partial<SignupMetadata>} refresh={ws.refresh} />;
  return <WelcomeCard name={ws.workspace.name} status={ws.workspace.status} trialEndsAt={ws.workspace.trial_ends_at} />;
}
