// Regras do assistente de configuração (sem I/O): fontes elegíveis, duplicados e seções a aplicar.
import type { AgentSetupContent, BusinessHours, Faq, KnowledgeSource, KnowledgeSourceKind, Product, SetupSections } from "./database.types";

/** Persona padrão criada com o workspace: enquanto for esta, vale sugerir o assistente. */
export const DEFAULT_PERSONA = "Você é um atendente cordial e objetivo. Responda em mensagens curtas, próprias para WhatsApp.";

export const SETUP_SOURCE_KINDS: KnowledgeSourceKind[] = ["site", "social", "url", "document", "text"];

export function isDefaultPersona(persona: string | null | undefined): boolean {
  return !persona || persona.trim() === DEFAULT_PERSONA;
}

export function eligibleSources(sources: KnowledgeSource[] | undefined): KnowledgeSource[] {
  return (sources ?? []).filter((s) => SETUP_SOURCE_KINDS.includes(s.kind));
}

/** Todas as fontes elegíveis que não falharam, menos as que o usuário desmarcou. */
export function selectedSources(sources: KnowledgeSource[] | undefined, excluded: ReadonlySet<string>): KnowledgeSource[] {
  return eligibleSources(sources).filter((s) => s.status !== "failed" && !excluded.has(s.id));
}

export function isBusy(s: Pick<KnowledgeSource, "status">): boolean {
  return s.status === "pending" || s.status === "indexing";
}

export function normalizeKey(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Índices do rascunho que repetem uma FAQ já cadastrada (mesma pergunta normalizada). */
export function duplicateFaqIndexes(draftFaqs: AgentSetupContent["faqs"], existing: Pick<Faq, "question">[] | undefined): Set<number> {
  const known = new Set((existing ?? []).map((f) => normalizeKey(f.question)));
  const out = new Set<number>();
  draftFaqs.forEach((f, i) => {
    if (known.has(normalizeKey(f.question))) out.add(i);
  });
  return out;
}

export function duplicateProductIndexes(
  draftProducts: AgentSetupContent["products"],
  existing: Pick<Product, "name">[] | undefined,
): Set<number> {
  const known = new Set((existing ?? []).map((p) => normalizeKey(p.name)));
  const out = new Set<number>();
  draftProducts.forEach((p, i) => {
    if (known.has(normalizeKey(p.name))) out.add(i);
  });
  return out;
}

export function hasBusinessHours(hours: BusinessHours | null | undefined): boolean {
  return Boolean(hours && Object.values(hours).some((ranges) => (ranges?.length ?? 0) > 0));
}

export interface SectionToggles {
  profile: boolean;
  guardrails: boolean;
  business_hours: boolean;
  handoff: boolean;
  payment_links: boolean;
}

export function defaultToggles(content: AgentSetupContent): SectionToggles {
  return {
    profile: true,
    guardrails: true,
    business_hours: hasBusinessHours(content.business_hours?.weekly),
    handoff: true,
    payment_links: content.payment_links.length > 0,
  };
}

/** Itens marcados por padrão: todos, menos os que já existem. */
export function defaultSelection(count: number, duplicates: ReadonlySet<number>): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < count; i++) if (!duplicates.has(i)) out.add(i);
  return out;
}

export function buildSections(toggles: SectionToggles, faqs: ReadonlySet<number>, products: ReadonlySet<number>): SetupSections {
  return {
    ...toggles,
    faqs: [...faqs].sort((a, b) => a - b),
    products: [...products].sort((a, b) => a - b),
  };
}

export function nothingSelected(sections: SetupSections): boolean {
  return (
    !sections.profile &&
    !sections.guardrails &&
    !sections.business_hours &&
    !sections.handoff &&
    !sections.payment_links &&
    (sections.faqs?.length ?? 0) === 0 &&
    (sections.products?.length ?? 0) === 0
  );
}

/** Limpa o conteúdo antes de enviar: remove links vazios e espaços sobrando. */
export function cleanContent(content: AgentSetupContent): AgentSetupContent {
  return {
    ...content,
    agent: {
      ...content.agent,
      agent_name: content.agent.agent_name.trim(),
      persona_prompt: content.agent.persona_prompt.trim(),
      guardrails: content.agent.guardrails.trim(),
    },
    handoff: {
      keywords: content.handoff.keywords.map((k) => k.trim()).filter(Boolean),
      message: content.handoff.message.trim(),
      out_of_hours_message: content.handoff.out_of_hours_message?.trim() || null,
    },
    payment_links: content.payment_links
      .filter((p) => p.label.trim() && p.url.trim())
      .map((p) => ({ label: p.label.trim(), url: p.url.trim(), description: p.description?.trim() || null })),
    faqs: content.faqs.map((f) => ({ ...f, question: f.question.trim(), answer: f.answer.trim() })),
    products: content.products.map((p) => ({ ...p, name: p.name.trim(), description: p.description?.trim() || null, url: p.url?.trim() || null })),
  };
}

/** "@pousada", "pousada" ou URL → URL do perfil (apenas para exibição). */
export function instagramHandle(input: string): string | null {
  const v = input.trim();
  if (!v) return null;
  const m = /instagram\.com\/([A-Za-z0-9._]+)/i.exec(v);
  const handle = (m ? m[1] : v.replace(/^@/, "")).replace(/\/$/, "");
  return /^[A-Za-z0-9._]{1,30}$/.test(handle) ? handle : null;
}
