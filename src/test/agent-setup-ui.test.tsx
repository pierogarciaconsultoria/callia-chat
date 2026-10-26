import { describe, expect, it } from "vitest";
import {
  buildSections,
  cleanContent,
  defaultSelection,
  defaultToggles,
  duplicateFaqIndexes,
  duplicateProductIndexes,
  eligibleSources,
  instagramHandle,
  isDefaultPersona,
  nothingSelected,
  selectedSources,
  DEFAULT_PERSONA,
} from "@/lib/agent-setup";
import type { AgentSetupContent, KnowledgeSource } from "@/lib/database.types";

function source(id: string, kind: KnowledgeSource["kind"], status: KnowledgeSource["status"] = "indexed"): KnowledgeSource {
  return {
    id, workspace_id: "ws", kind, title: id, origin_id: null, content: null, url: null, storage_path: null, mime_type: null,
    status, error: null, chunk_count: 1, embedded: false, indexed_at: null, created_at: "", updated_at: "",
  };
}

const content: AgentSetupContent = {
  business: { name: "Pousada", summary: "", segment: "", city: "", address: null, phone: null, whatsapp: null, email: null, website_url: null, instagram: null, tone_observed: "" },
  agent: { agent_name: " Lia ", language: "pt-BR", persona_prompt: " Você é a Lia. ", guardrails: "" },
  business_hours: null,
  handoff: { keywords: [" atendente ", ""], message: " Já chamo alguém. ", out_of_hours_message: "  " },
  payment_links: [{ label: "Pix", url: "https://pix", description: null }, { label: "", url: "", description: null }],
  faqs: [
    { question: "Qual o horário do café?", answer: "7h às 10h", source: "Site" },
    { question: "Aceitam pets?", answer: "Sim", source: "Instagram" },
  ],
  products: [{ name: "Suíte Mar", description: null, price: 490, currency: "BRL", url: null }],
  missing_information: [],
  sources_used: [],
};

describe("assistente de configuração", () => {
  it("reconhece a persona padrão", () => {
    expect(isDefaultPersona(DEFAULT_PERSONA)).toBe(true);
    expect(isDefaultPersona(` ${DEFAULT_PERSONA}\n`)).toBe(true);
    expect(isDefaultPersona("Você é a Lia, da Pousada Alfa.")).toBe(false);
  });

  it("seleciona fontes elegíveis prontas, sem falhas nem desmarcadas", () => {
    const list = [source("faq", "faq"), source("site", "site"), source("ig", "social", "pending"), source("doc", "document", "failed"), source("txt", "text")];
    expect(eligibleSources(list).map((s) => s.id)).toEqual(["site", "ig", "doc", "txt"]);
    expect(selectedSources(list, new Set(["txt"])).map((s) => s.id)).toEqual(["site", "ig"]);
  });

  it("detecta FAQ e produtos repetidos ignorando acento e caixa", () => {
    expect([...duplicateFaqIndexes(content.faqs, [{ question: "qual o HORARIO do cafe" }])]).toEqual([0]);
    expect([...duplicateProductIndexes(content.products, [{ name: "suite mar" }])]).toEqual([0]);
    expect([...defaultSelection(2, new Set([0]))]).toEqual([1]);
  });

  it("marca seções por padrão conforme o rascunho", () => {
    expect(defaultToggles(content)).toEqual({ profile: true, guardrails: true, business_hours: false, handoff: true, payment_links: true });
    const withHours = { ...content, business_hours: { timezone: "America/Sao_Paulo", weekly: { mon: [["08:00", "18:00"]] as [string, string][] } }, payment_links: [] };
    expect(defaultToggles(withHours)).toMatchObject({ business_hours: true, payment_links: false });
  });

  it("monta as seções e detecta seleção vazia", () => {
    const off = { profile: false, guardrails: false, business_hours: false, handoff: false, payment_links: false };
    expect(nothingSelected(buildSections(off, new Set(), new Set()))).toBe(true);
    expect(buildSections(off, new Set([2, 0]), new Set())).toEqual({ ...off, faqs: [0, 2], products: [] });
  });

  it("limpa o conteúdo antes de aplicar", () => {
    const c = cleanContent(content);
    expect(c.agent.agent_name).toBe("Lia");
    expect(c.handoff).toEqual({ keywords: ["atendente"], message: "Já chamo alguém.", out_of_hours_message: null });
    expect(c.payment_links).toEqual([{ label: "Pix", url: "https://pix", description: null }]);
  });

  it("entende o perfil do Instagram em vários formatos", () => {
    expect(instagramHandle("@pousada.alfa")).toBe("pousada.alfa");
    expect(instagramHandle("https://www.instagram.com/pousada_alfa/")).toBe("pousada_alfa");
    expect(instagramHandle("pousada alfa")).toBeNull();
  });
});
