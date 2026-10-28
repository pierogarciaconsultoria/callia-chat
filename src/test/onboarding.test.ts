import { describe, expect, it } from "vitest";
import { buildJourney, stepForPath, type JourneySignals } from "@/lib/onboarding";

const fresh: JourneySignals = {
  businessInfo: false, agentGenerated: false, segment: null, ownKnowledge: 0, bookingConnected: false,
  tested: false, whatsapp: false, members: 1, conversations: 0,
};
const ids = (j: ReturnType<typeof buildJourney>) => j.steps.map((s) => s.id);

describe("jornada de configuração", () => {
  it("workspace novo: começa pelos dados da empresa e testa antes de conectar o WhatsApp", () => {
    const j = buildJourney(fresh);
    expect(j.current?.id).toBe("empresa");
    expect(ids(j)).toEqual(["empresa", "agente", "segmento", "conhecimento", "teste", "whatsapp", "equipe", "inbox"]);
    expect(ids(j).indexOf("teste")).toBeLessThan(ids(j).indexOf("whatsapp"));
    expect(j.steps.filter((s) => s.state === "current")).toHaveLength(1);
    expect(j.resolved).toBe(0);
    expect(j.complete).toBe(false);
  });

  it("hotelaria ganha a etapa de sistema de reservas (opcional)", () => {
    const j = buildJourney({ ...fresh, segment: "hotelaria" });
    const step = j.steps.find((s) => s.id === "reservas");
    expect(step?.optional).toBe(true);
    expect(ids(j).indexOf("reservas")).toBe(ids(j).indexOf("conhecimento") + 1);
  });

  it("o próximo passo é a primeira etapa pendente, mesmo fora de ordem", () => {
    const j = buildJourney({ ...fresh, businessInfo: true, agentGenerated: true, whatsapp: true });
    expect(j.current?.id).toBe("segmento");
    expect(j.steps.find((s) => s.id === "whatsapp")?.state).toBe("done");
    expect(j.resolved).toBe(3);
  });

  it("etapa opcional pulada deixa de travar a jornada", () => {
    const base = { ...fresh, businessInfo: true, agentGenerated: true, segment: "hotelaria", ownKnowledge: 2 };
    expect(buildJourney(base).current?.id).toBe("reservas");
    const j = buildJourney(base, new Set(["reservas"]));
    expect(j.steps.find((s) => s.id === "reservas")?.state).toBe("skipped");
    expect(j.current?.id).toBe("teste");
    expect(buildJourney(base, new Set(["teste"])).current?.id).toBe("reservas"); // obrigatória não pula
  });

  it("completa com todas as obrigatórias, mesmo sem as opcionais", () => {
    const j = buildJourney({ ...fresh, businessInfo: true, agentGenerated: true, segment: "saude", ownKnowledge: 1, tested: true, whatsapp: true, conversations: 3 });
    expect(j.complete).toBe(true);
    expect(j.current?.id).toBe("equipe");
  });

  it("você está aqui: na tela com duas etapas, vale a do próximo passo", () => {
    const j = buildJourney({ ...fresh, businessInfo: true, agentGenerated: true, segment: "varejo", ownKnowledge: 1 });
    expect(j.current?.id).toBe("teste");
    expect(stepForPath(j, "/agent")?.id).toBe("teste");
    expect(stepForPath(j, "/integrations")?.id).toBe("whatsapp");
    // Empresa e Políticas ficam na mesma tela: com as duas feitas vale a primeira; com uma pendente, a pendente.
    expect(stepForPath(j, "/knowledge-base")?.id).toBe("empresa");
    expect(stepForPath(buildJourney({ ...fresh, businessInfo: true, agentGenerated: true, segment: "varejo" }), "/knowledge-base")?.id).toBe("conhecimento");
    expect(stepForPath(j, "/logs")).toBeNull();
  });
});
