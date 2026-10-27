// Jornada de configuração guiada: etapas em ordem, o que já foi feito e qual é o próximo passo.
// A ordem configura e testa o agente antes de conectar o WhatsApp (a partir daí ele responde clientes reais).
import { readLocal, writeLocal } from "@/lib/storage";

export interface JourneySignals {
  /** Razão social ou CNPJ preenchidos. */
  businessInfo: boolean;
  /** Persona gerada/escrita (diferente da padrão). */
  agentGenerated: boolean;
  segment: string | null;
  /** Conteúdo próprio na base: textos, documentos ou páginas (preços, políticas). */
  ownKnowledge: number;
  bookingConnected: boolean;
  /** Simulador usado neste navegador ou o agente já respondeu alguém. */
  tested: boolean;
  whatsapp: boolean;
  members: number;
  conversations: number;
}

export type StepState = "done" | "current" | "todo" | "skipped";

export interface JourneyStep {
  id: string;
  /** Rótulo curto da linha do tempo. */
  short: string;
  title: string;
  /** O que fazer na tela da etapa. */
  tip: string;
  to: string;
  optional: boolean;
  minutes: number;
  state: StepState;
}

export interface Journey {
  steps: JourneyStep[];
  current: JourneyStep | null;
  /** Feitas + puladas (contam como resolvidas na barra de progresso). */
  resolved: number;
  /** Todas as obrigatórias feitas: a jornada sai de cena. */
  complete: boolean;
}

interface StepDef extends Omit<JourneyStep, "state"> {
  done: (s: JourneySignals) => boolean;
  show?: (s: JourneySignals) => boolean;
}

const STEPS: StepDef[] = [
  {
    id: "empresa", short: "Empresa", title: "Dados da empresa", to: "/settings#empresa", optional: false, minutes: 2,
    tip: "Digite o CNPJ e clique em Buscar: razão social, endereço e CNAE vêm da Receita. Depois salve.",
    done: (s) => s.businessInfo,
  },
  {
    id: "agente", short: "Agente", title: "Gerar o agente com IA", to: "/agent/setup", optional: false, minutes: 5,
    tip: "Informe o site e o Instagram da empresa. A IA monta a persona, as regras e as perguntas frequentes; revise e aplique.",
    done: (s) => s.agentGenerated,
  },
  {
    id: "segmento", short: "Segmento", title: "Segmento e tom", to: "/agent#segmento", optional: false, minutes: 1,
    tip: "Escolha o segmento do negócio e a política de emojis. O segmento traz as boas práticas e as regras obrigatórias do setor. Salve no fim da página.",
    done: (s) => Boolean(s.segment),
  },
  {
    id: "conhecimento", short: "Conhecimento", title: "Base de conhecimento", to: "/knowledge-base?tab=docs", optional: false, minutes: 10,
    tip: "Envie o que o agente precisa saber de cor: tabela de preços, políticas, horários. Confira também as perguntas frequentes geradas.",
    done: (s) => s.ownKnowledge > 0,
  },
  {
    id: "reservas", short: "Reservas", title: "Sistema de reservas", to: "/integrations", optional: true, minutes: 5,
    tip: "Conecte o Hospedin ou informe o link do motor de reservas, para o agente consultar vagas e enviar o link certo.",
    done: (s) => s.bookingConnected,
    show: (s) => s.segment === "hotelaria" || s.bookingConnected,
  },
  {
    id: "teste", short: "Teste", title: "Testar no simulador", to: "/agent#simulador", optional: false, minutes: 5,
    tip: "Converse com o agente como se fosse um cliente: pergunte valores, horários e políticas. Nada é enviado ao WhatsApp.",
    done: (s) => s.tested,
  },
  {
    id: "whatsapp", short: "WhatsApp", title: "Conectar o WhatsApp", to: "/integrations", optional: false, minutes: 2,
    tip: "Leia o QR Code com o celular do número da empresa. A partir daqui o agente responde os clientes.",
    done: (s) => s.whatsapp,
  },
  {
    id: "equipe", short: "Equipe", title: "Convidar a equipe", to: "/team", optional: true, minutes: 2,
    tip: "Convide quem vai assumir as conversas que o agente transferir.",
    done: (s) => s.members > 1,
  },
  {
    id: "inbox", short: "Inbox", title: "Acompanhar as conversas", to: "/inbox", optional: false, minutes: 1,
    tip: "As conversas chegam aqui. Acompanhe as primeiras e clique em Assumir quando o agente transferir.",
    done: (s) => s.conversations > 0,
  },
];

export function buildJourney(signals: JourneySignals, skipped: ReadonlySet<string> = new Set()): Journey {
  let current: JourneyStep | null = null;
  const steps: JourneyStep[] = STEPS.filter((d) => !d.show || d.show(signals)).map(({ done, show: _show, ...d }) => {
    const isDone = done(signals);
    const state: StepState = isDone ? "done" : d.optional && skipped.has(d.id) ? "skipped" : current ? "todo" : "current";
    const step = { ...d, state };
    if (state === "current") current = step;
    return step;
  });
  const resolved = steps.filter((s) => s.state === "done" || s.state === "skipped").length;
  const complete = steps.every((s) => s.optional || s.state === "done");
  return { steps, current, resolved, complete };
}

const pathOf = (to: string) => to.split(/[?#]/)[0];

/** Etapa da tela aberta ("você está aqui"): a atual, se for nesta tela; senão a primeira pendente daqui. */
export function stepForPath(journey: Journey, pathname: string): JourneyStep | null {
  const here = journey.steps.filter((s) => pathOf(s.to) === pathname);
  return here.find((s) => s.state === "current") ?? here.find((s) => s.state !== "done") ?? here[0] ?? null;
}

// Preferências locais por workspace (try/catch em storage.ts).
const skippedKey = (ws: string) => `callia:journey:skipped:${ws}`;
const hiddenKey = (ws: string) => `callia:journey:hidden:${ws}`;
export const testedKey = (ws: string) => `callia:onboarding:simulator:${ws}`;

export function readSkipped(ws: string): Set<string> {
  try {
    const v = JSON.parse(readLocal(skippedKey(ws)) ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function writeSkipped(ws: string, ids: Set<string>) {
  writeLocal(skippedKey(ws), JSON.stringify([...ids]));
}

export function readHidden(ws: string): boolean {
  return readLocal(hiddenKey(ws)) === "1";
}

export function writeHidden(ws: string, hidden: boolean) {
  writeLocal(hiddenKey(ws), hidden ? "1" : null);
}
