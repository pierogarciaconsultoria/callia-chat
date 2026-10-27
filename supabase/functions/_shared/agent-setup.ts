// Assistente de configuração: transforma as fontes da empresa num rascunho de persona e instruções do agente.
import { z } from "npm:zod@3.23.8";
import type { ChatMessage } from "./ai.ts";
import type { BusinessHours, Weekday } from "./agent-core.ts";
import { getSegmentProfile, SEGMENT_LIST } from "./segments.ts";

const WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const HHMM = /^([01]\d|2[0-4]):[0-5]\d$/;

export interface SetupMaterial {
  title: string;
  kind: string;
  url: string | null;
  content: string;
}

export interface ExistingSetup {
  agent_name: string;
  persona_prompt: string;
  guardrails: string | null;
  /** Segmento já escolhido: o perfil orienta o tom e as regras da persona gerada. */
  segment_id?: string | null;
  faqs: Array<{ question: string }>;
  products: Array<{ name: string }>;
}

// ---------------------------------------------------------------------------
// Formato da resposta (JSON Schema estrito para a IA + zod para validar)
// ---------------------------------------------------------------------------
const str = { type: "string" };
const nstr = { type: ["string", "null"] };
const range = { type: "object", additionalProperties: false, required: ["start", "end"], properties: { start: str, end: str } };
const day = { type: "array", items: range };

export const SETUP_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["business", "agent", "business_hours", "handoff", "payment_links", "faqs", "products", "missing_information", "sources_used"],
  properties: {
    business: {
      type: "object",
      additionalProperties: false,
      required: ["name", "summary", "segment", "segment_id", "city", "address", "phone", "whatsapp", "email", "website_url", "instagram", "tone_observed"],
      properties: {
        name: str, summary: str, segment: str, segment_id: { type: "string", enum: [...SEGMENT_LIST.map((p) => p.id), "outro"] }, city: nstr, address: nstr, phone: nstr, whatsapp: nstr, email: nstr,
        website_url: nstr, instagram: nstr, tone_observed: str,
      },
    },
    agent: {
      type: "object",
      additionalProperties: false,
      required: ["agent_name", "language", "persona_prompt", "guardrails"],
      properties: { agent_name: str, language: str, persona_prompt: str, guardrails: str },
    },
    business_hours: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["timezone", "weekly"],
          properties: {
            timezone: str,
            weekly: {
              type: "object",
              additionalProperties: false,
              required: WEEKDAYS,
              properties: Object.fromEntries(WEEKDAYS.map((d) => [d, day])),
            },
          },
        },
        { type: "null" },
      ],
    },
    handoff: {
      type: "object",
      additionalProperties: false,
      required: ["keywords", "message", "out_of_hours_message"],
      properties: { keywords: { type: "array", items: str }, message: str, out_of_hours_message: nstr },
    },
    payment_links: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["label", "url", "description"], properties: { label: str, url: str, description: nstr } },
    },
    faqs: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["question", "answer", "source"], properties: { question: str, answer: str, source: str } },
    },
    products: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "description", "price", "currency", "url"],
        properties: { name: str, description: nstr, price: { type: ["number", "null"] }, currency: str, url: nstr },
      },
    },
    missing_information: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["topic", "question"], properties: { topic: str, question: str } },
    },
    sources_used: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["title", "kind"], properties: { title: str, kind: str } },
    },
  },
} as const;

const zRange = z.object({ start: z.string(), end: z.string() });
const zRawDraft = z.object({
  business: z.object({
    name: z.string(), summary: z.string(), segment: z.string(),
    // Opcional: rascunhos gerados antes do catálogo de segmentos não têm o campo.
    segment_id: z.string().nullable().optional(),
    city: z.string().nullable(), address: z.string().nullable(),
    phone: z.string().nullable(), whatsapp: z.string().nullable(), email: z.string().nullable(), website_url: z.string().nullable(),
    instagram: z.string().nullable(), tone_observed: z.string(),
  }),
  agent: z.object({ agent_name: z.string(), language: z.string(), persona_prompt: z.string(), guardrails: z.string() }),
  business_hours: z.object({ timezone: z.string(), weekly: z.record(z.array(zRange)) }).nullable(),
  handoff: z.object({ keywords: z.array(z.string()), message: z.string(), out_of_hours_message: z.string().nullable() }),
  payment_links: z.array(z.object({ label: z.string(), url: z.string(), description: z.string().nullable() })),
  faqs: z.array(z.object({ question: z.string(), answer: z.string(), source: z.string() })),
  products: z.array(z.object({
    name: z.string(), description: z.string().nullable(), price: z.number().nullable(), currency: z.string(), url: z.string().nullable(),
  })),
  missing_information: z.array(z.object({ topic: z.string(), question: z.string() })),
  sources_used: z.array(z.object({ title: z.string(), kind: z.string() })),
});

/** Conteúdo do rascunho como o painel edita e o apply recebe (horário no formato de agent_configs). */
export const draftContentSchema = z.object({
  business: zRawDraft.shape.business,
  agent: z.object({
    agent_name: z.string().trim().min(1).max(60),
    language: z.string().trim().min(2).max(10),
    persona_prompt: z.string().trim().min(20).max(8000),
    guardrails: z.string().max(6000),
  }),
  business_hours: z.object({
    timezone: z.string().min(3).max(60),
    weekly: z.record(z.array(z.tuple([z.string().regex(HHMM), z.string().regex(HHMM)]))),
  }).nullable(),
  handoff: z.object({
    keywords: z.array(z.string().trim().min(2).max(60)).max(30),
    message: z.string().trim().min(5).max(1000),
    out_of_hours_message: z.string().max(1000).nullable(),
  }),
  payment_links: z.array(z.object({ label: z.string().min(1).max(80), url: z.string().url(), description: z.string().max(300).nullable() })).max(20),
  faqs: z.array(z.object({ question: z.string().trim().min(3).max(500), answer: z.string().trim().min(1).max(3000), source: z.string().max(300) })).max(80),
  products: z.array(z.object({
    name: z.string().trim().min(1).max(200), description: z.string().max(2000).nullable(), price: z.number().nonnegative().nullable(),
    currency: z.string().length(3), url: z.string().url().nullable(),
  })).max(100),
  missing_information: z.array(z.object({ topic: z.string(), question: z.string() })),
  sources_used: z.array(z.object({ title: z.string(), kind: z.string() })),
});
export type DraftContent = z.infer<typeof draftContentSchema>;

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------
const KIND_LABEL: Record<string, string> = {
  site: "site da empresa",
  social: "Instagram",
  url: "página web",
  document: "documento",
  text: "texto do dono",
};

/** Junta as fontes dentro de um orçamento de caracteres, dividindo o espaço entre elas. */
export function assembleMaterials(materials: SetupMaterial[], budget = 120_000): { text: string; truncated: string[] } {
  const usable = materials.filter((m) => m.content.trim().length > 0);
  const truncated: string[] = [];
  let remaining = budget;
  const parts: string[] = [];
  usable.forEach((m, i) => {
    const share = Math.floor(remaining / (usable.length - i));
    const body = m.content.trim();
    const piece = body.length > share ? body.slice(0, share) : body;
    if (piece.length < body.length) truncated.push(m.title);
    remaining -= piece.length;
    parts.push(`### FONTE ${i + 1}: ${m.title} (${KIND_LABEL[m.kind] ?? m.kind}${m.url ? `, ${m.url}` : ""})\n${piece}`);
  });
  return { text: parts.join("\n\n"), truncated };
}

const SETUP_INSTRUCTIONS = `Você configura o atendente virtual de WhatsApp de uma empresa a partir das informações públicas e dos documentos dela.

Regras obrigatórias:
- Use SOMENTE o que está nas fontes. Nunca invente preços, horários, endereços, políticas, nomes, regras ou serviços.
- Se uma informação importante para atender não aparece nas fontes, deixe o campo vazio/nulo e registre em "missing_information" uma pergunta objetiva para o dono responder.
- Se as fontes se contradizem, prefira documentos e texto do dono a site, e site a Instagram; cite a divergência em "missing_information".
- Escreva em português do Brasil.

Como preencher:
- business: dados da empresa encontrados; "tone_observed" descreve o tom de comunicação que a empresa já usa (formal, acolhedor, divertido…).
- business.segment_id: o segmento que melhor descreve a empresa, entre: ${SEGMENT_LIST.map((p) => `${p.id} (${p.label})`).join(", ")}. Use "outro" se nenhum servir.
- agent.agent_name: um nome curto e simpático para o atendente, coerente com a marca (ex.: "Lia da Pousada X"); se a empresa já usa um nome de atendente, use-o.
- agent.persona_prompt: texto em segunda pessoa ("Você é…"), 150 a 400 palavras, que define quem é o atendente, o tom (baseado no tom observado), o que a empresa oferece, para quem, os diferenciais, como conduzir a conversa (cumprimentar, entender a necessidade, responder com objetividade, oferecer o próximo passo) e fatos estáveis essenciais (localização, tipo de negócio). Não repita listas longas de preços: isso fica na base de conhecimento.
- agent.guardrails: regras específicas deste negócio em linhas iniciadas por "- " (ex.: não confirmar reserva sem pagamento, enviar o link de reserva, não prometer disponibilidade sem consultar, política de pets/crianças se existir). Não repita regras genéricas de segurança nem as do perfil do segmento (o sistema já as aplica).
- business_hours: horário de atendimento humano por dia (HH:MM, 24h) se aparecer nas fontes; senão null. Fuso padrão America/Sao_Paulo salvo indicação contrária.
- handoff.keywords: 4 a 8 expressões que um cliente usaria para pedir uma pessoa; handoff.message: mensagem curta e no tom da marca avisando que alguém da equipe vai continuar; out_of_hours_message: se houver horário, avise quando a equipe volta.
- payment_links: só links de pagamento/reserva explícitos nas fontes.
- faqs: 10 a 30 perguntas que clientes realmente fariam, com respostas completas e fiéis às fontes (indique em "source" o título da fonte). Não repita perguntas que já existem na configuração atual.
- products: produtos/serviços/acomodações com descrição; price só se o valor estiver explícito (número, sem símbolo); currency em código ISO (BRL padrão).
- missing_information: o que falta para um bom atendimento (ex.: horários de check-in/check-out, política de cancelamento, formas de pagamento, estacionamento, pets).
- sources_used: as fontes que de fato contribuíram.`;

/** Perfil do segmento escolhido como ponto de partida da persona (o que a empresa já comunica prevalece). */
function segmentBrief(segmentId: string | null | undefined): string | null {
  const p = getSegmentProfile(segmentId);
  if (!p) return null;
  return [
    `Segmento escolhido pelo dono: ${p.label}. Use este perfil como ponto de partida para o tom e o objetivo da persona; o tom que a empresa já usa nas fontes prevalece.`,
    `Tom padrão: ${p.tone}`,
    `Objetivo principal: ${p.goal}`,
    `Exemplos de respostas no tom do segmento (inspiração, não copie):\n${p.examples.map((e) => `- ${e}`).join("\n")}`,
  ].join("\n");
}

export function buildSetupMessages(materials: SetupMaterial[], existing: ExistingSetup, extraText: string | null): { messages: ChatMessage[]; truncated: string[] } {
  const { text, truncated } = assembleMaterials(
    extraText?.trim() ? [...materials, { title: "Informações adicionais do dono", kind: "text", url: null, content: extraText }] : materials,
  );
  const current = [
    `Nome atual do atendente: ${existing.agent_name}`,
    `Persona atual: ${existing.persona_prompt}`,
    existing.guardrails ? `Regras atuais: ${existing.guardrails}` : null,
    segmentBrief(existing.segment_id),
    existing.faqs.length ? `Perguntas já cadastradas (não repetir):\n${existing.faqs.map((f) => `- ${f.question}`).join("\n")}` : null,
    existing.products.length ? `Produtos já cadastrados (não repetir):\n${existing.products.map((p) => `- ${p.name}`).join("\n")}` : null,
  ].filter(Boolean).join("\n\n");
  return {
    truncated,
    messages: [
      { role: "system", content: SETUP_INSTRUCTIONS },
      { role: "user", content: `# Configuração atual\n${current}\n\n# Fontes da empresa\n${text}\n\nGere a configuração no formato JSON pedido.` },
    ],
  };
}

// ---------------------------------------------------------------------------
// Normalização
// ---------------------------------------------------------------------------
function normalizeTime(value: string): string | null {
  const m = /^(\d{1,2})(?::|h)?(\d{2})?$/.exec(value.trim().toLowerCase());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? "0");
  if (h > 24 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function cleanUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Converte a resposta da IA para o formato do rascunho, descartando valores inválidos em vez de falhar. */
export function normalizeDraft(raw: unknown): DraftContent {
  const d = zRawDraft.parse(raw);
  let hours: DraftContent["business_hours"] = null;
  if (d.business_hours) {
    const weekly: BusinessHours = {};
    for (const day of WEEKDAYS) {
      const ranges = (d.business_hours.weekly[day] ?? [])
        .map((r) => [normalizeTime(r.start), normalizeTime(r.end)] as const)
        .filter((r): r is readonly [string, string] => Boolean(r[0] && r[1]));
      weekly[day] = ranges.map(([s, e]) => [s, e]);
    }
    if (WEEKDAYS.some((day) => (weekly[day]?.length ?? 0) > 0)) {
      hours = { timezone: d.business_hours.timezone || "America/Sao_Paulo", weekly: weekly as Record<string, Array<[string, string]>> };
    }
  }
  const seenQ = new Set<string>();
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return {
    business: { ...d.business, segment_id: getSegmentProfile(d.business.segment_id) ? d.business.segment_id : null },
    agent: {
      agent_name: d.agent.agent_name.trim().slice(0, 60) || "Assistente",
      language: d.agent.language.trim() || "pt-BR",
      persona_prompt: d.agent.persona_prompt.trim(),
      guardrails: d.agent.guardrails.trim(),
    },
    business_hours: hours,
    handoff: {
      keywords: [...new Set(d.handoff.keywords.map((k) => k.trim().toLowerCase()).filter((k) => k.length >= 2))].slice(0, 30),
      message: d.handoff.message.trim(),
      out_of_hours_message: d.handoff.out_of_hours_message?.trim() || null,
    },
    payment_links: d.payment_links
      .map((l) => ({ label: l.label.trim(), url: cleanUrl(l.url), description: l.description?.trim() || null }))
      .filter((l): l is { label: string; url: string; description: string | null } => Boolean(l.label && l.url)),
    faqs: d.faqs
      .map((f) => ({ question: f.question.trim(), answer: f.answer.trim(), source: f.source.trim() }))
      .filter((f) => f.question.length >= 3 && f.answer.length > 0 && !seenQ.has(norm(f.question)) && seenQ.add(norm(f.question))),
    products: d.products.map((p) => ({
      name: p.name.trim(),
      description: p.description?.trim() || null,
      price: p.price !== null && Number.isFinite(p.price) && p.price >= 0 ? Math.round(p.price * 100) / 100 : null,
      currency: /^[A-Z]{3}$/.test(p.currency) ? p.currency : "BRL",
      url: cleanUrl(p.url),
    })).filter((p) => p.name.length > 0),
    missing_information: d.missing_information,
    sources_used: d.sources_used,
  };
}

export function sameQuestion(a: string, b: string): boolean {
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return norm(a) === norm(b);
}
