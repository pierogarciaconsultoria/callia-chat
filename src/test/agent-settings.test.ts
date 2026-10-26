import { describe, expect, it } from "vitest";
import {
  buildSystemPrompt,
  formatBusinessHours, historyToChat, isWithinBusinessHours, localClock, matchHandoffKeyword, normalizeText, sanitizeReply,
} from "../../supabase/functions/_shared/agent-core.ts";

describe("regras do agente", () => {
  it("normaliza texto sem acento e pontuação", () => {
    expect(normalizeText("  Olá, ATENDENTE!! ")).toBe("ola atendente");
  });

  it("detecta palavras-chave de handoff", () => {
    const kws = ["atendente", "falar com uma pessoa"];
    expect(matchHandoffKeyword("quero um ATENDENTE", kws)).toBe("atendente");
    expect(matchHandoffKeyword("posso falar com uma pessoa?", kws)).toBe("falar com uma pessoa");
    expect(matchHandoffKeyword("atendentes", kws)).toBeNull();
    expect(matchHandoffKeyword(null, kws)).toBeNull();
  });

  it("calcula relógio local e horário de atendimento", () => {
    // 2026-10-26 é segunda-feira; 13:30Z = 10:30 em São Paulo.
    const now = new Date("2026-10-26T13:30:00Z");
    expect(localClock(now, "America/Sao_Paulo")).toMatchObject({ weekday: "mon", minutes: 630 });
    const hours = { mon: [["08:00", "12:00"], ["14:00", "18:00"]] as Array<[string, string]> };
    expect(isWithinBusinessHours(hours, "America/Sao_Paulo", now)).toBe(true);
    expect(isWithinBusinessHours(hours, "America/Sao_Paulo", new Date("2026-10-26T16:00:00Z"))).toBe(false); // 13:00
    expect(isWithinBusinessHours({}, "America/Sao_Paulo", now)).toBeNull();
    // Faixa que cruza a meia-noite.
    expect(isWithinBusinessHours({ mon: [["22:00", "02:00"]] }, "America/Sao_Paulo", new Date("2026-10-27T02:00:00Z"))).toBe(true); // seg 23:00
  });

  it("formata horário semanal em português", () => {
    expect(formatBusinessHours({ mon: [["08:00", "18:00"]] })).toBe(
      "segunda: 08:00–18:00; terça: fechado; quarta: fechado; quinta: fechado; sexta: fechado; sábado: fechado; domingo: fechado",
    );
  });

  it("agrupa mensagens seguidas no histórico de chat", () => {
    const at = "2026-10-25T00:00:00Z";
    expect(historyToChat([
      { direction: "inbound", sender: "customer", type: "text", content: "oi", created_at: at },
      { direction: "inbound", sender: "customer", type: "text", content: "tudo bem?", created_at: at },
      { direction: "outbound", sender: "agent", type: "text", content: "Olá!", created_at: at },
      { direction: "inbound", sender: "customer", type: "image", content: null, created_at: at },
    ])).toEqual([
      { role: "user", content: "oi\ntudo bem?" },
      { role: "assistant", content: "Olá!" },
      { role: "user", content: "[image]" },
    ]);
  });

  it("adapta markdown para WhatsApp", () => {
    expect(sanitizeReply("## Título\n**Preço:** veja [aqui](https://x.com/p)\n\n\n\nFim")).toBe("Título\n*Preço:* veja aqui: https://x.com/p\n\nFim");
  });
});

describe("pagamento no prompt", () => {
  const base = {
    workspace_id: "w", enabled: true, agent_name: "MarIA", persona_prompt: "Você é a MarIA.", guardrails: null, language: "pt-BR", ai_model: null,
    temperature: 0.4, website_url: null, voice_enabled: false, voice_id: null, timezone: "America/Sao_Paulo", business_hours: {}, out_of_hours_message: null,
    handoff_keywords: [], handoff_message: "x", payment_links: [], reply_debounce_ms: 0, external_agent_enabled: false, external_agent_url: null,
    external_agent_secret_ref: null, external_agent_timeout_ms: 25000,
  };
  const pay = { legal_name: "Pousada Exemplo Ltda", cnpj: "11.222.333/0001-81", bank_name: "Sicredi", bank_code: "748", agency: "0101", account: "12.345-6",
    account_type: "corrente", payee_name: null, pix_key_type: "telefone", pix_key: "48 90000 0000", deposit_percent: null, payment_instructions: null };
  const prompt = (paymentInfo: (typeof pay & { pre_reservation_url?: string | null }) | null) => buildSystemPrompt({ config: base, businessName: "Morada", now: new Date(), withinHours: null, knowledge: [], products: [], contactName: null, hasAvailabilityTool: false, paymentInfo });

  it("só inclui dados de pagamento quando habilitado", () => {
    expect(prompt(null)).not.toContain("Pagamento da reserva");
    const p = prompt(pay);
    expect(p).toContain("- PIX (telefone): 48 90000 0000");
    expect(p).toContain("Antes de pagar por PIX, aguarde nossa equipe confirmar a vaga para essas datas.");
    expect(p).toContain("Favorecido: Pousada Exemplo Ltda — CNPJ 11.222.333/0001-81");
    expect(p).toContain("Sicredi (748), agência 0101, conta corrente 12.345-6");
    expect(p).toContain("Nunca peça número de cartão");
    expect(p).toContain("sinal é confirmado pela equipe");
  });

  it("com link de pré-reserva, o PIX vai pela pré-reserva e nenhum dado bancário entra no prompt", () => {
    const p = prompt({ ...pay, deposit_percent: 50, pre_reservation_url: "https://pms.hospedin.com/pre-reserva/exemplo" });
    expect(p).toContain("envie o link de pré-reserva https://pms.hospedin.com/pre-reserva/exemplo");
    expect(p).toContain("a equipe confirma a vaga e envia os dados do PIX");
    expect(p).toContain("Sinal para garantir a reserva: 50% do total");
    expect(p).not.toContain("48 90000 0000");
    expect(p).not.toContain("12.345-6");
    expect(p).not.toContain("Antes de pagar por PIX");
  });

  it("com percentual de sinal, manda usar o valor calculado", () => {
    expect(prompt({ ...pay, deposit_percent: 30 })).toContain("Sinal para garantir a reserva: 30% do total");
  });
});
