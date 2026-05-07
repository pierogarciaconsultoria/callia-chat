import { describe, expect, it } from "vitest";
import {
  buildFallbackReply,
  buildFaqReply,
  buildProductReply,
  matchFaq,
  matchProduct,
  shouldTriggerHandoff,
} from "@/lib/agent-pipeline";

describe("agent pipeline helpers", () => {
  it("detects handoff keywords ignoring case and accents", () => {
    expect(
      shouldTriggerHandoff({
        messageText: "Quero falar com um atendente humano agora",
        handoffKeywords: ["Humano", "reclamação"],
      }),
    ).toBe(true);
  });

  it("matches faq and product content", () => {
    expect(
      matchFaq("Qual o horário de atendimento?", [
        { question: "horario de atendimento", answer: "Atendemos de segunda a sexta." },
      ]),
    )?.toEqual({ question: "horario de atendimento", answer: "Atendemos de segunda a sexta." });

    expect(
      matchProduct("Quero o plano premium", [
        { name: "Plano Premium", description: "Acesso completo", price: 149.9, currency: "BRL" },
      ]),
    )?.toEqual({
      name: "Plano Premium",
      description: "Acesso completo",
      price: 149.9,
      currency: "BRL",
    });
  });

  it("builds faq and product replies", () => {
    expect(
      buildFaqReply(
        { question: "pagamento", answer: "Aceitamos pix e cartão." },
        [{ label: "Checkout", url: "https://pay.example/checkout" }],
      ),
    ).toContain("https://pay.example/checkout");

    expect(
      buildProductReply({
        name: "Plano Premium",
        description: "Acesso completo",
        price: 149.9,
        currency: "BRL",
        link: "https://example.com/premium",
      }),
    ).toContain("Plano Premium");
  });

  it("returns contextual fallback replies", () => {
    expect(
      buildFallbackReply({
        messageText: "Preciso do preço do plano premium",
        messageType: "text",
        faqs: [],
        products: [{ name: "Plano Premium", description: "Acesso completo", is_active: true }],
        paymentLinks: [],
      }),
    ).toContain("Plano Premium");

    expect(
      buildFallbackReply({
        messageText: "",
        messageType: "audio",
        faqs: [],
        products: [],
        paymentLinks: [],
        mediaSummary: null,
      }),
    ).toContain("Recebi seu áudio");
  });
});
