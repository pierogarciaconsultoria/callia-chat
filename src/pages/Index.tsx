import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, Clock3, Layers3, LockKeyhole, RadioTower } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { projectPhases, statusMeta } from "@/data/project-board";

const roadmapHighlights = [
  {
    title: "Fundacao primeiro",
    description: "Banco, seguranca, segredos e contratos antes das integracoes operacionais.",
    icon: LockKeyhole,
  },
  {
    title: "Canais depois",
    description: "WhatsApp, webhooks e pipeline entram depois que a estrutura estiver pronta.",
    icon: RadioTower,
  },
  {
    title: "Operacao por fases",
    description: "Cada entrega fecha um bloco funcional antes de abrir o proximo.",
    icon: Layers3,
  },
];

const totalPhases = projectPhases.length;
const completedPhases = projectPhases.filter((phase) => phase.status === "completed").length;
const currentPhase = projectPhases.find((phase) => phase.status === "in_progress");
const nextPhase = projectPhases.find((phase) => phase.status === "next");
const roadmapCompleted = completedPhases === totalPhases;

export default function Index() {
  return (
    <div className="min-h-screen bg-muted/30">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-10 md:px-6 lg:px-8">
        <section className="rounded-3xl border bg-background p-8 shadow-sm">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl space-y-4">
              <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-sm font-medium text-primary">
                Acompanhamento publico temporario do projeto
              </div>
              <div className="space-y-3">
                <h1 className="text-4xl font-semibold tracking-tight text-foreground md:text-5xl">
                  Agent Hub em desenvolvimento por fases
                </h1>
                <p className="max-w-2xl text-base text-muted-foreground md:text-lg">
                  Esta pagina mostra a ordem de desenvolvimento do projeto, o que entra em cada fase e qual bloco vem a seguir.
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                to="/login"
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Entrar no painel
              </Link>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Fases planejadas</CardDescription>
              <CardTitle className="text-3xl">{totalPhases}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Da fundacao tecnica ate o acabamento e go-live.
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Fase atual</CardDescription>
              <CardTitle className="text-xl">
                {roadmapCompleted ? "Roadmap concluido" : currentPhase ? `Fase ${currentPhase.order}` : "Nenhuma em execucao"}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {roadmapCompleted
                ? "Todas as fases base do MVP foram entregues e validadas."
                : currentPhase?.title ?? "A execucao principal ainda nao foi iniciada."}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Proxima fase</CardDescription>
              <CardTitle className="text-xl">
                {roadmapCompleted ? "Nenhuma pendente" : nextPhase ? `Fase ${nextPhase.order}` : "Roadmap em revisao"}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {roadmapCompleted
                ? "O roadmap base foi concluido. Novas etapas entram como expansao ou pos-piloto."
                : nextPhase?.title ?? "As proximas etapas serao atualizadas aqui."}
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          {roadmapHighlights.map(({ title, description, icon: Icon }) => (
            <Card key={title}>
              <CardHeader>
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <CardTitle className="text-lg">{title}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{description}</CardContent>
            </Card>
          ))}
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
          <Card>
            <CardHeader>
              <CardTitle>Ordem de desenvolvimento</CardTitle>
              <CardDescription>
                A construcao segue da fundacao ao telhado para reduzir retrabalho.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {projectPhases.map((phase) => {
                const meta = statusMeta[phase.status];

                return (
                  <div key={phase.id} className="rounded-2xl border bg-background p-5">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="space-y-2">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-full border bg-muted text-sm font-semibold">
                            {phase.order}
                          </div>
                          <div>
                            <h3 className="text-lg font-semibold">{phase.title}</h3>
                            <p className="text-sm text-muted-foreground">{phase.goal}</p>
                          </div>
                        </div>
                      </div>
                      <span className={`inline-flex w-fit items-center rounded-full border px-3 py-1 text-xs font-medium ${meta.className}`}>
                        {meta.label}
                      </span>
                    </div>

                    <div className="mt-5 grid gap-4 lg:grid-cols-2">
                      <div>
                        <div className="mb-2 text-sm font-medium text-foreground">Escopo principal</div>
                        <ul className="space-y-2 text-sm text-muted-foreground">
                          {phase.scope.map((item) => (
                            <li key={item} className="flex items-start gap-2">
                              <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <div className="mb-2 text-sm font-medium text-foreground">Entregaveis</div>
                        <ul className="space-y-2 text-sm text-muted-foreground">
                          {phase.deliverables.map((item) => (
                            <li key={item} className="flex items-start gap-2">
                              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                        <div className="mt-4 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                          <span className="font-medium text-foreground">Dependencias:</span> {phase.dependsOn}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Resumo executivo</CardTitle>
                <CardDescription>Status geral da obra do produto.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm text-muted-foreground">
                <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2">
                  <span>Concluidas</span>
                  <span className="font-medium text-foreground">{completedPhases}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2">
                  <span>Em andamento</span>
                  <span className="font-medium text-foreground">
                    {currentPhase ? 1 : 0}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2">
                  <span>Planejadas</span>
                  <span className="font-medium text-foreground">
                    {Math.max(totalPhases - completedPhases - (currentPhase ? 1 : 0), 0)}
                  </span>
                </div>
                <div className="rounded-xl border border-dashed p-4">
                  <div className="mb-2 flex items-center gap-2 text-foreground">
                    <Clock3 className="h-4 w-4 text-primary" />
                    <span className="font-medium">Atualizacao deste painel</span>
                  </div>
                  <p>
                    Esta tela le o guia do projeto (PROJECT_BOARD.md) e se atualiza sozinha sempre que o status de uma fase muda.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Como ler</CardTitle>
                <CardDescription>Guia rapido para acompanhamento.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p>
                  <span className="font-medium text-foreground">Proxima:</span> etapa que abre a execucao principal.
                </p>
                <p>
                  <span className="font-medium text-foreground">Em andamento:</span> fase atualmente em desenvolvimento.
                </p>
                <p>
                  <span className="font-medium text-foreground">Concluida:</span> fase entregue e validada.
                </p>
                <p>
                  <span className="font-medium text-foreground">Pendente:</span> fase planejada, aguardando dependencias anteriores.
                </p>
                <p>
                  <span className="font-medium text-foreground">Bloqueada:</span> fase pausada por dependencia externa ou decisao pendente.
                </p>
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    </div>
  );
}
