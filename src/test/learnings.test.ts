import { describe, expect, it } from "vitest";
import {
  appendGuardrail, buildLearningMessages, fingerprintFor, LearningError, LIMITS, mergeEvidence, messageText, normalizeSuggestions, resolveApplied,
  selectTranscripts, type Transcript, whoFor,
} from "../../supabase/functions/_shared/learnings.ts";

const facts = {
  agentName: "MarIA", businessName: "Morada do Sol",
  faqs: [{ question: "Tem Wi-Fi?", answer: "Sim, grátis em todos os apartamentos." }],
  policies: [{ id: "p1", topic: "pets", title: "Animais", content: "Não aceitamos animais." }],
  guardrails: "- Nunca confirme reserva.",
};
const t = (id: string, msgs: Array<[Transcript["messages"][number]["who"], string]>, handoff: string | null = null): Transcript => ({
  id, contact: `Contato ${id}`, handoff, messages: msgs.map(([who, text], i) => ({ who, text, at: `2026-10-30T10:0${i}:00Z` })),
});

describe("aprendizados: seleção das conversas", () => {
  it("prioriza transferidas e com resposta da equipe, ignora conversas sem cliente e respeita o teto", () => {
    const quiet = t("c-quiet", [["cliente", "oi"], ["ia", "Olá! Como posso ajudar?"]]);
    const handoff = t("c-handoff", [["cliente", "aceita pet?"], ["ia", "Vou chamar a equipe."]], "no_answer");
    const team = t("c-team", [["cliente", "tem estacionamento?"], ["equipe", "Sim, gratuito e coberto."]]);
    const botOnly = t("c-bot", [["ia", "Bom dia!"]]);
    const picked = selectTranscripts([quiet, botOnly, handoff, team]);
    expect(picked.map((x) => x.id).slice(0, 2).sort()).toEqual(["c-handoff", "c-team"]);
    expect(picked.find((x) => x.id === "c-bot")).toBeUndefined();
    const many = Array.from({ length: 60 }, (_, i) => t(`c${i}`, [["cliente", "pergunta"], ["ia", "resposta"]]));
    expect(selectTranscripts(many)).toHaveLength(LIMITS.conversations);
    const long = t("c-long", Array.from({ length: 80 }, (_, i) => ["cliente", `m${i}`] as ["cliente", string]));
    expect(selectTranscripts([long])[0].messages).toHaveLength(LIMITS.messagesPerConversation);
  });

  it("mapeia remetentes e descreve mídia sem texto", () => {
    expect(whoFor("customer")).toBe("cliente");
    expect(whoFor("bot")).toBe("ia");
    expect(whoFor("agent")).toBe("equipe");
    expect(whoFor("system")).toBeNull();
    expect(messageText({ type: "audio", content: null })).toBe("[áudio]");
    expect(messageText({ type: "text", content: "  oi \n tudo bem " })).toBe("oi tudo bem");
    expect(messageText({ type: "text", content: "" })).toBe("");
  });

  it("prompt traz FAQs, políticas e regras atuais e as conversas numeradas por id", () => {
    const msgs = buildLearningMessages(facts, [t("c1", [["cliente", "aceita pet?"]], "no_answer")]);
    const system = String(msgs[0].content);
    expect(system).toContain("Tem Wi-Fi?");
    expect(system).toContain("[p1] pets");
    expect(system).toContain("Nunca confirme reserva");
    expect(system).toMatch(/NUNCA proponha valores de diária/);
    expect(String(msgs[1].content)).toContain("### Conversa c1 — contato: Contato c1 — transferida para a equipe (no_answer)");
    expect(String(msgs[1].content)).toContain("[cliente] aceita pet?");
  });
});

describe("aprendizados: normalização do JSON da IA", () => {
  const transcripts = [t("c1", [["cliente", "aceita pet?"], ["equipe", "Aceitamos até 10 kg, taxa de R$ 50."]]), t("c2", [["cliente", "tem estacionamento?"]])];

  it("mantém só evidência de conversas reais, calcula ocorrências e descarta sugestão sem evidência", () => {
    const out = normalizeSuggestions({
      suggestions: [
        { kind: "policy", title: "Pets", rationale: "Equipe disse que aceita.", question: null, answer: null, topic: "Pets", content: "Aceitamos animais de até 10 kg mediante taxa de R$ 50.", policy_id: "p1",
          evidence: [{ conversation_id: "c1", excerpts: [{ who: "equipe", text: "Aceitamos até 10 kg, taxa de R$ 50." }] }, { conversation_id: "inventada", excerpts: [] }, { conversation_id: "c1", excerpts: [] }] },
        { kind: "faq", title: "Estacionamento", rationale: "Ninguém respondeu.", question: "Tem estacionamento?", answer: null, topic: null, content: null, policy_id: null,
          evidence: [{ conversation_id: "c2", excerpts: [{ who: "cliente", text: "tem estacionamento?" }] }] },
        { kind: "guardrail", title: "Sem evidência", rationale: "x", question: null, answer: null, topic: null, content: "Não faça isso.", policy_id: null, evidence: [{ conversation_id: "nope", excerpts: [] }] },
        { kind: "outro", title: "Tipo inválido", rationale: "x", evidence: [{ conversation_id: "c1", excerpts: [] }] },
      ],
    }, transcripts, facts);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ kind: "policy", occurrences: 1, payload: { topic: "pets", title: "Animais", id: "p1" } });
    expect(out[0].evidence).toEqual([{ conversation_id: "c1", contact: "Contato c1", excerpts: [{ who: "equipe", text: "Aceitamos até 10 kg, taxa de R$ 50." }] }]);
    expect(out[1]).toMatchObject({ kind: "faq", payload: { question: "Tem estacionamento?", answer: null } });
    expect(out[1].fingerprint).toBe(fingerprintFor("faq", "Tem estacionamento?"));
  });

  it("policy_id desconhecido vira política nova; assunto é normalizado; duplicatas somem", () => {
    const base = { kind: "policy", title: "Check-in", rationale: "x", question: null, answer: null, topic: "Check-In Antecipado", content: "Check-in a partir das 14h.", policy_id: "zzz", evidence: [{ conversation_id: "c1", excerpts: [] }] };
    const out = normalizeSuggestions({ suggestions: [base, { ...base, rationale: "repetida" }] }, transcripts, facts);
    expect(out).toHaveLength(1);
    expect(out[0].payload).toEqual({ topic: "check_in_antecipado", title: "Check-in", content: "Check-in a partir das 14h.", id: null });
  });

  it("fingerprint ignora acentos, maiúsculas e palavras curtas; evidência mescla sem repetir conversa", () => {
    expect(fingerprintFor("faq", "Vocês aceitam PET?")).toBe(fingerprintFor("faq", "voces aceitam pet"));
    expect(fingerprintFor("faq", "a")).toBe("faq:a");
    const merged = mergeEvidence([{ conversation_id: "c1", contact: "A", excerpts: [] }], [{ conversation_id: "c1", contact: "A", excerpts: [] }, { conversation_id: "c2", contact: "B", excerpts: [] }]);
    expect(merged.map((e) => e.conversation_id)).toEqual(["c1", "c2"]);
  });
});

describe("aprendizados: aprovação", () => {
  it("faq exige resposta; edições do admin prevalecem", () => {
    expect(() => resolveApplied("faq", { question: "Tem estacionamento?", answer: null }, null)).toThrow(LearningError);
    expect(resolveApplied("faq", { question: "Tem estacionamento?", answer: null }, { answer: " Sim, gratuito. " })).toEqual({ question: "Tem estacionamento?", answer: "Sim, gratuito." });
  });
  it("política normaliza o assunto e mantém o id; regra exige texto", () => {
    expect(resolveApplied("policy", { topic: "pets", title: "Animais", content: "x", id: "p1" }, { topic: "Animais de Estimação", content: "Aceitamos até 10 kg." }))
      .toEqual({ topic: "animais_de_estimacao", title: "Animais", content: "Aceitamos até 10 kg.", id: "p1" });
    expect(() => resolveApplied("guardrail", { text: "" }, {})).toThrow("Escreva a regra.");
  });
  it("regra entra como item novo e não duplica", () => {
    expect(appendGuardrail(null, "Não prometa upgrade.")).toBe("- Não prometa upgrade.");
    expect(appendGuardrail("- Nunca confirme reserva.", "Não prometa upgrade.")).toBe("- Nunca confirme reserva.\n- Não prometa upgrade.");
    expect(appendGuardrail("- Não prometa upgrade.", "não prometa UPGRADE")).toBe("- Não prometa upgrade.");
  });
});
