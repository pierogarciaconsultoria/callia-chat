// Aprendizados do atendimento: parte pura (sem banco) da análise diária das conversas.
// Seleciona as conversas que valem análise, monta o prompt, valida o JSON da IA e normaliza as sugestões.
// Nada aqui grava no agente: toda sugestão passa pela aprovação de um admin (function learnings).
import type { ChatMessage } from "./ai.ts";

export type Who = "cliente" | "ia" | "equipe";
export type SuggestionKind = "faq" | "policy" | "guardrail";

export interface TranscriptMessage { who: Who; text: string; at: string }
export interface Transcript {
  id: string;
  contact: string;
  /** Motivo da transferência para a equipe registrado pelo pipeline (keyword:…, no_answer, payment_proof…). */
  handoff: string | null;
  messages: TranscriptMessage[];
}

export interface Excerpt { who: Who; text: string }
export interface Evidence { conversation_id: string; contact: string; excerpts: Excerpt[] }

export type SuggestionPayload =
  | { question: string; answer: string | null }
  | { topic: string; title: string; content: string; id: string | null }
  | { text: string };

export interface Suggestion {
  kind: SuggestionKind;
  fingerprint: string;
  title: string;
  rationale: string;
  payload: SuggestionPayload;
  evidence: Evidence[];
  occurrences: number;
}

export interface LearningFacts {
  agentName: string;
  businessName: string;
  faqs: Array<{ question: string; answer: string }>;
  policies: Array<{ id: string; topic: string; title: string; content: string }>;
  guardrails: string | null;
}

export class LearningError extends Error {}

export const LIMITS = {
  conversations: 40,
  messagesPerConversation: 30,
  charsPerMessage: 600,
  totalChars: 90_000,
  evidencePerSuggestion: 8,
  excerptsPerEvidence: 4,
  excerptChars: 280,
} as const;

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Chave de deduplicação: tipo + assunto normalizado (sem acento, só letras e números). */
export function fingerprintFor(kind: SuggestionKind, subject: string): string {
  const words = norm(subject).split(" ").filter((w) => w.length > 2).slice(0, 12).join(" ");
  return `${kind}:${words || norm(subject).slice(0, 40) || "x"}`.slice(0, 120);
}

export function whoFor(sender: string): Who | null {
  if (sender === "customer") return "cliente";
  if (sender === "bot") return "ia";
  if (sender === "agent") return "equipe";
  return null;
}

/** Texto de uma mensagem para o transcript: conteúdo ou o tipo de mídia entre colchetes. */
export function messageText(m: { type?: string | null; content?: string | null }): string {
  const content = (m.content ?? "").replace(/\s+/g, " ").trim();
  if (content) return content.slice(0, LIMITS.charsPerMessage);
  const type = m.type ?? "text";
  return type === "text" ? "" : `[${type === "image" ? "imagem" : type === "audio" ? "áudio" : type === "document" ? "documento" : type}]`;
}

/**
 * Prioriza o que tem mais chance de ensinar algo: conversas transferidas para a equipe, com respostas da equipe,
 * ou em que a IA admitiu não saber. Corta pelo orçamento de caracteres.
 */
export function selectTranscripts(all: Transcript[], limits = LIMITS): Transcript[] {
  const score = (t: Transcript) => {
    let s = 0;
    if (t.handoff) s += 3;
    if (t.messages.some((m) => m.who === "equipe")) s += 3;
    if (t.messages.some((m) => m.who === "ia" && /não (tenho|sei|consigo|posso)|vou verificar|não encontrei|equipe/i.test(m.text))) s += 2;
    s += Math.min(2, t.messages.filter((m) => m.who === "cliente").length / 3);
    return s;
  };
  const trimmed = all
    .filter((t) => t.messages.some((m) => m.who === "cliente"))
    .map((t) => ({ ...t, messages: t.messages.slice(-limits.messagesPerConversation) }))
    .sort((a, b) => score(b) - score(a));
  const out: Transcript[] = [];
  let chars = 0;
  for (const t of trimmed) {
    if (out.length >= limits.conversations) break;
    const size = t.messages.reduce((n, m) => n + m.text.length + 12, 40);
    if (chars + size > limits.totalChars) continue;
    chars += size;
    out.push(t);
  }
  return out;
}

export function formatTranscripts(ts: Transcript[]): string {
  return ts.map((t) => {
    const head = `### Conversa ${t.id} — contato: ${t.contact}${t.handoff ? ` — transferida para a equipe (${t.handoff})` : ""}`;
    const lines = t.messages.map((m) => `[${m.who}] ${m.text || "(vazio)"}`);
    return `${head}\n${lines.join("\n")}`;
  }).join("\n\n");
}

export const LEARNING_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", enum: ["faq", "policy", "guardrail"] },
          title: { type: "string", description: "Assunto curto (até 120 caracteres)." },
          rationale: { type: "string", description: "Por que sugerir: o que faltou e o que a equipe respondeu, em 1 a 3 frases." },
          question: { type: ["string", "null"], description: "faq: a pergunta do cliente, generalizada." },
          answer: { type: ["string", "null"], description: "faq: a resposta, SÓ se a equipe a deu nas conversas; senão null." },
          topic: { type: ["string", "null"], description: "policy: assunto (checkin, checkout, cancelamento, pagamento, criancas, pets, comodidades, horarios, outro...)." },
          content: { type: ["string", "null"], description: "policy: texto da política. guardrail: a regra de comportamento (uma frase imperativa)." },
          policy_id: { type: ["string", "null"], description: "policy: id da política existente que deve mudar, ou null para nova." },
          evidence: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                conversation_id: { type: "string" },
                excerpts: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: { who: { type: "string", enum: ["cliente", "ia", "equipe"] }, text: { type: "string" } },
                    required: ["who", "text"],
                  },
                },
              },
              required: ["conversation_id", "excerpts"],
            },
          },
        },
        required: ["kind", "title", "rationale", "question", "answer", "topic", "content", "policy_id", "evidence"],
      },
    },
  },
  required: ["suggestions"],
} as const;

export function buildLearningMessages(facts: LearningFacts, transcripts: Transcript[], now = new Date()): ChatMessage[] {
  const faqs = facts.faqs.length ? facts.faqs.map((f) => `- P: ${f.question}\n  R: ${f.answer.slice(0, 300)}`).join("\n") : "- nenhuma";
  const policies = facts.policies.length ? facts.policies.map((p) => `- [${p.id}] ${p.topic} — ${p.title}: ${p.content.slice(0, 400)}`).join("\n") : "- nenhuma";
  const system = [
    `Você revisa o atendimento por WhatsApp da empresa "${facts.businessName}", feito pela IA "${facts.agentName}" e pela equipe humana. Hoje é ${now.toLocaleDateString("pt-BR")}.`,
    "Sua tarefa: ler as conversas abaixo e propor o que a empresa deveria cadastrar para a IA atender melhor da próxima vez. O administrador vai aprovar ou descartar cada sugestão; você não altera nada.",
    "",
    "Procure por:",
    "1. Perguntas que a IA não soube responder, respondeu vagamente ou transferiu para a equipe por falta de informação.",
    "2. Fatos que a equipe humana afirmou nas conversas e que NÃO estão nas perguntas frequentes nem nas políticas atuais (horários, regras, serviços, endereço, como chegar, o que está incluso…).",
    "3. Perguntas que se repetem em várias conversas.",
    "4. Comportamentos errados da IA (prometeu algo que não podia, insistiu, respondeu fora do assunto, tom inadequado) → sugestão de regra (guardrail), uma frase imperativa.",
    "",
    "Regras:",
    "- NUNCA proponha valores de diária, preços de acomodação, disponibilidade ou datas de temporada: isso vem da tabela de preços e do sistema de reservas, não das conversas. Taxas avulsas ditas pela equipe (ex.: taxa de pet) podem virar política.",
    "- Não invente respostas. Em faq, preencha answer só com o que a equipe respondeu de fato; se ninguém respondeu, deixe answer null (o administrador completa).",
    "- Não repita o que já está cadastrado. Se uma política existente está errada ou incompleta segundo a equipe, proponha policy com policy_id dela e o texto corrigido.",
    "- Generalize: a pergunta/resposta deve servir para qualquer cliente (sem nomes, datas ou números de telefone).",
    "- Cada sugestão precisa de evidência: ids das conversas e trechos curtos literais (quem disse e o que).",
    "- Junte o mesmo assunto em uma sugestão só. No máximo 8 sugestões, das mais úteis para as menos. Se não houver nada que valha, devolva a lista vazia.",
    "- Escreva em português do Brasil, direto, como um colega de equipe.",
    "",
    "# Perguntas frequentes já cadastradas",
    faqs,
    "",
    "# Políticas já cadastradas",
    policies,
    "",
    "# Regras de comportamento atuais da IA",
    facts.guardrails?.trim() || "(nenhuma)",
  ].join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: `# Conversas do período (${transcripts.length})\n\n${formatTranscripts(transcripts)}` },
  ];
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const normTopic = (raw: string) => raw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "outro";

/** Valida o JSON da IA contra as conversas enviadas: descarta evidência inventada e sugestões sem evidência. */
export function normalizeSuggestions(raw: unknown, transcripts: Transcript[], facts: LearningFacts): Suggestion[] {
  const byId = new Map(transcripts.map((t) => [t.id, t]));
  const list = Array.isArray((raw as { suggestions?: unknown })?.suggestions) ? (raw as { suggestions: unknown[] }).suggestions : [];
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  for (const item of list.slice(0, 12)) {
    const s = (item ?? {}) as Record<string, unknown>;
    const kind = s.kind as SuggestionKind;
    if (!["faq", "policy", "guardrail"].includes(kind)) continue;
    const title = str(s.title, 160);
    const rationale = str(s.rationale, 1200);
    if (title.length < 2 || rationale.length < 2) continue;

    const evidence: Evidence[] = [];
    for (const e of (Array.isArray(s.evidence) ? s.evidence : []).slice(0, LIMITS.evidencePerSuggestion)) {
      const ev = (e ?? {}) as Record<string, unknown>;
      const t = byId.get(String(ev.conversation_id ?? ""));
      if (!t || evidence.some((x) => x.conversation_id === t.id)) continue;
      const excerpts: Excerpt[] = (Array.isArray(ev.excerpts) ? ev.excerpts : [])
        .map((x) => ({ who: (x as Excerpt)?.who, text: str((x as Excerpt)?.text, LIMITS.excerptChars) }))
        .filter((x): x is Excerpt => ["cliente", "ia", "equipe"].includes(x.who) && x.text.length > 0)
        .slice(0, LIMITS.excerptsPerEvidence);
      evidence.push({ conversation_id: t.id, contact: t.contact, excerpts });
    }
    if (!evidence.length) continue;

    let payload: SuggestionPayload;
    let subject: string;
    if (kind === "faq") {
      const question = str(s.question, 300) || title;
      const answer = str(s.answer, 2000) || null;
      payload = { question, answer };
      subject = question;
    } else if (kind === "policy") {
      const content = str(s.content, 4000);
      if (content.length < 2) continue;
      const id = typeof s.policy_id === "string" && facts.policies.some((p) => p.id === s.policy_id) ? s.policy_id : null;
      const existing = id ? facts.policies.find((p) => p.id === id) : undefined;
      const topic = normTopic(str(s.topic, 40) || existing?.topic || "outro");
      payload = { topic, title: existing?.title ?? title.slice(0, 120), content, id };
      subject = existing ? `policy ${existing.id}` : `${topic} ${title}`;
    } else {
      const text = str(s.content, 600);
      if (text.length < 2) continue;
      payload = { text };
      subject = text;
    }
    const fingerprint = fingerprintFor(kind, subject);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    out.push({ kind, fingerprint, title, rationale, payload, evidence, occurrences: evidence.length });
  }
  return out;
}

/** Soma a evidência nova à existente (sem repetir conversa), respeitando o teto. */
export function mergeEvidence(existing: Evidence[], incoming: Evidence[]): Evidence[] {
  const out = [...existing];
  for (const e of incoming) {
    if (out.some((x) => x.conversation_id === e.conversation_id)) continue;
    out.push(e);
  }
  return out.slice(-LIMITS.evidencePerSuggestion);
}

/**
 * O que gravar ao aprovar: o payload da sugestão com as edições do admin por cima, validado.
 * Lança LearningError com mensagem para o usuário.
 */
export function resolveApplied(kind: SuggestionKind, base: SuggestionPayload, edits: Record<string, unknown> | null | undefined): SuggestionPayload {
  const e = edits ?? {};
  if (kind === "faq") {
    const b = base as { question: string; answer: string | null };
    const question = str(e.question ?? b.question, 300);
    const answer = str(e.answer ?? b.answer ?? "", 2000);
    if (question.length < 2) throw new LearningError("Informe a pergunta.");
    if (answer.length < 2) throw new LearningError("Escreva a resposta antes de aprovar: a equipe não respondeu isso nas conversas.");
    return { question, answer };
  }
  if (kind === "policy") {
    const b = base as { topic: string; title: string; content: string; id: string | null };
    const topic = normTopic(str(e.topic ?? b.topic, 40));
    const title = str(e.title ?? b.title, 120);
    const content = str(e.content ?? b.content, 4000);
    if (title.length < 2 || content.length < 2) throw new LearningError("Título e texto da política são obrigatórios.");
    return { topic, title, content, id: b.id };
  }
  const b = base as { text: string };
  const text = str(e.text ?? b.text, 600);
  if (text.length < 2) throw new LearningError("Escreva a regra.");
  return { text };
}

/** Acrescenta a regra ao fim das regras atuais, sem duplicar. */
export function appendGuardrail(current: string | null, rule: string): string {
  const cur = (current ?? "").trim();
  if (norm(cur).includes(norm(rule))) return cur;
  return cur ? `${cur}\n- ${rule}` : `- ${rule}`;
}
