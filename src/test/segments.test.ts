import { describe, expect, it, vi } from "vitest";
import {
  resolveSegmentFromCnae, SEGMENT_LIST, SEGMENT_PROFILES, segmentPromptSection,
} from "../../supabase/functions/_shared/segments.ts";
import { buildSystemPrompt } from "../../supabase/functions/_shared/agent-core.ts";
import { buildSetupMessages, normalizeDraft } from "../../supabase/functions/_shared/agent-setup.ts";
import { formatCnae, lookupCnpj } from "@/lib/business-info";

describe("segmentos: catálogo", () => {
  it("ids batem com as chaves e cada perfil está completo", () => {
    for (const [key, p] of Object.entries(SEGMENT_PROFILES)) {
      expect(p.id).toBe(key);
      expect(p.conduct.length).toBeGreaterThanOrEqual(3);
      expect(p.conduct.length).toBeLessThanOrEqual(4);
      expect(p.escalation.length).toBeGreaterThanOrEqual(2);
      expect(p.escalation.length).toBeLessThanOrEqual(4);
      expect(p.examples).toHaveLength(2);
      expect(p.cnaePrefixes.every((x) => /^\d{2,4}$/.test(x))).toBe(true);
    }
  });

  it("nenhum prefixo de CNAE aparece em dois segmentos", () => {
    const all = SEGMENT_LIST.flatMap((p) => p.cnaePrefixes);
    expect(new Set(all).size).toBe(all.length);
  });

  it("regras legais: LGPD em saúde e financeiro, CDC art. 49 no varejo", () => {
    expect(SEGMENT_PROFILES.saude.mandatory.join(" ")).toMatch(/LGPD/);
    expect(SEGMENT_PROFILES.financeiro.mandatory.join(" ")).toMatch(/LGPD/);
    expect(SEGMENT_PROFILES.financeiro.mandatory.join(" ")).toMatch(/Nunca prometa aprovação/);
    expect(SEGMENT_PROFILES.varejo.mandatory.join(" ")).toMatch(/art\. 49/);
  });
});

describe("segmentos: CNAE", () => {
  it("aceita formatos com e sem máscara e o número da BrasilAPI", () => {
    expect(resolveSegmentFromCnae("5510-8/02")?.id).toBe("hotelaria");
    expect(resolveSegmentFromCnae("5611201")?.id).toBe("alimentacao");
    expect(resolveSegmentFromCnae(6422100)?.id).toBe("financeiro");
  });

  it("prefixo mais longo: só a classe certa dentro da divisão", () => {
    expect(resolveSegmentFromCnae("9602-5/01")?.id).toBe("beleza");
    expect(resolveSegmentFromCnae("9601-7/01")).toBeUndefined(); // lavanderia
    expect(resolveSegmentFromCnae("9603-3/04")).toBeUndefined(); // funerária
    expect(resolveSegmentFromCnae("9313-1/00")?.id).toBe("fitness");
    expect(resolveSegmentFromCnae("9321-2/00")).toBeUndefined(); // parque de diversão
    expect(resolveSegmentFromCnae("7020-4/00")?.id).toBe("consultoria");
    expect(resolveSegmentFromCnae("7010-7/00")).toBeUndefined(); // holding
  });

  it("vazio ou desconhecido pede escolha manual", () => {
    expect(resolveSegmentFromCnae("")).toBeUndefined();
    expect(resolveSegmentFromCnae(null)).toBeUndefined();
    expect(resolveSegmentFromCnae("0111-3/01")).toBeUndefined(); // agricultura
  });

  it("formata o CNAE para o formulário", () => {
    expect(formatCnae("5510802")).toBe("5510-8/02");
    expect(formatCnae("55108")).toBe("5510-8");
    expect(formatCnae("5510-8/02x9")).toBe("5510-8/02");
  });
});

describe("segmentos: prompt do agente", () => {
  const base = {
    workspace_id: "w", enabled: true, agent_name: "Lia", persona_prompt: "Você é a Lia.", guardrails: "- Regra da empresa.", language: "pt-BR", ai_model: null,
    temperature: 0.4, website_url: null, voice_enabled: false, voice_id: null, timezone: "America/Sao_Paulo", business_hours: {}, out_of_hours_message: null,
    handoff_keywords: [], handoff_message: "x", payment_links: [], reply_debounce_ms: 0, external_agent_enabled: false, external_agent_url: null,
    external_agent_secret_ref: null, external_agent_timeout_ms: 25000,
  };
  const prompt = (extra: Record<string, unknown>) =>
    buildSystemPrompt({ config: { ...base, ...extra }, businessName: "Clínica", now: new Date(), withinHours: null, knowledge: [], products: [], contactName: null, hasAvailabilityTool: false });

  it("sem segmento, o prompt não ganha seção nova", () => {
    expect(prompt({})).not.toContain("# Segmento");
    expect(prompt({})).not.toContain("# Emojis");
    expect(segmentPromptSection(null)).toBeNull();
  });

  it("com segmento: entra depois das regras, com as obrigatórias e a transferência", () => {
    const p = prompt({ segment_id: "saude" });
    expect(p.indexOf("# Segmento: Saúde e clínicas")).toBeGreaterThan(p.indexOf("- Regra da empresa."));
    expect(p).toContain("siga a empresa");
    expect(p).toContain("Obrigatório (vale sempre");
    expect(p).toContain("192 (SAMU)");
    expect(p).toContain("Emojis: Não use emojis.");
  });

  it("a política de emoji da empresa substitui a do segmento", () => {
    expect(prompt({ segment_id: "saude", emoji_policy: "light" })).toContain("Emojis: Use no máximo um emoji");
    expect(prompt({ emoji_policy: "none" })).toContain("# Emojis\n- Não use emojis.");
  });

  it("nunca nega ser assistente virtual", () => {
    expect(prompt({})).toContain("Nunca negue ser um assistente virtual.");
  });

  it("segmento desconhecido é ignorado", () => {
    expect(prompt({ segment_id: "inexistente" })).not.toContain("# Segmento");
  });
});

describe("segmentos: assistente de configuração", () => {
  it("usa o perfil escolhido como ponto de partida e lista os segmentos", () => {
    const { messages } = buildSetupMessages(
      [{ title: "Site", kind: "site", url: null, content: "Hotel na praia." }],
      { agent_name: "A", persona_prompt: "p", guardrails: null, segment_id: "hotelaria", faqs: [], products: [] },
      null,
    );
    expect(messages[0].content).toContain("hotelaria (Hotelaria e hospedagem)");
    expect(messages[1].content).toContain("Segmento escolhido pelo dono: Hotelaria e hospedagem");
    expect(messages[1].content).toContain("não copie");
  });

  it("descarta segmento fora do catálogo", () => {
    const raw = (segment_id: string) => ({
      business: { name: "X", summary: "s", segment: "hotel", segment_id, city: null, address: null, phone: null, whatsapp: null, email: null, website_url: null, instagram: null, tone_observed: "t" },
      agent: { agent_name: "Lia", language: "pt-BR", persona_prompt: "Você é a Lia, atendente.", guardrails: "" },
      business_hours: null, handoff: { keywords: [], message: "Já chamo.", out_of_hours_message: null },
      payment_links: [], faqs: [], products: [], missing_information: [], sources_used: [],
    });
    expect(normalizeDraft(raw("hotelaria")).business.segment_id).toBe("hotelaria");
    expect(normalizeDraft(raw("outro")).business.segment_id).toBeNull();
  });
});

describe("consulta de CNPJ (BrasilAPI)", () => {
  it("mapeia razão social, endereço, telefone e CNAE", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      razao_social: "POUSADA EXEMPLO LTDA", cnae_fiscal: 5510802, cnae_fiscal_descricao: "Apart-hotéis",
      logradouro: "RUA DAS GAIVOTAS", numero: "100", complemento: "", bairro: "CENTRO", municipio: "GAROPABA", uf: "SC",
      cep: "88495000", ddd_telefone_1: "4890000000", email: "CONTATO@EXEMPLO.COM.BR",
    })));
    const r = await lookupCnpj("11.222.333/0001-81", fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith("https://brasilapi.com.br/api/cnpj/v1/11222333000181");
    expect(r).toEqual({
      legal_name: "POUSADA EXEMPLO LTDA",
      address: "RUA DAS GAIVOTAS, 100, CENTRO, GAROPABA/SC, CEP 88495-000",
      phone: "(48) 9000-0000",
      email: "contato@exemplo.com.br",
      cnae_code: "5510802",
      cnae_description: "Apart-hotéis",
    });
  });

  it("CNPJ incompleto ou não encontrado vira mensagem clara", async () => {
    await expect(lookupCnpj("11.222")).rejects.toThrow("14 dígitos");
    const notFound = vi.fn(async () => new Response("{}", { status: 404 }));
    await expect(lookupCnpj("11222333000181", notFound as unknown as typeof fetch)).rejects.toThrow("não encontrado");
  });
});
