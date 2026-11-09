import { describe, expect, it } from "vitest";
import { planMemory, speakerLabel, summaryMessages, teamContext, toHistoryItem, MEMORY_TRIGGER, MEMORY_WINDOW } from "../../supabase/functions/_shared/conversation-memory.ts";
import { historyToChat } from "../../supabase/functions/_shared/agent-core.ts";
import { promisesHandoff } from "../../supabase/functions/_shared/agent-pipeline.ts";

const at = "2026-11-08T16:27:00Z";
const msg = (seq: number, sender: "customer" | "bot" | "agent" | "system", content: string, extra: Record<string, unknown> = {}) => ({
  seq, sender, direction: sender === "customer" ? ("inbound" as const) : ("outbound" as const), type: "text", content, created_at: at, ...extra,
});

describe("memória da conversa", () => {
  it("divide entre resumo e janela só quando passa do gatilho", () => {
    const few = Array.from({ length: MEMORY_TRIGGER }, (_, i) => i);
    expect(planMemory(few)).toEqual({ toSummarize: [], window: few });
    const many = Array.from({ length: MEMORY_TRIGGER + 5 }, (_, i) => i);
    const plan = planMemory(many);
    expect(plan.window).toHaveLength(MEMORY_WINDOW);
    expect(plan.toSummarize).toEqual(many.slice(0, many.length - MEMORY_WINDOW));
    expect(plan.window[0]).toBe(many.length - MEMORY_WINDOW);
  });

  it("rotula quem falou e monta o prompt do resumo com o anterior", () => {
    expect(speakerLabel({ sender: "agent" }, "Piero")).toBe("Piero, da equipe");
    expect(speakerLabel({ sender: "agent", metadata: { from_device: true } }, null)).toBe("Equipe (pelo celular)");
    expect(speakerLabel({ sender: "bot" }, null)).toBe("Assistente");
    const [system, user] = summaryMessages("- Cliente quer 27/12 a 02/01", [
      { ...msg(3, "agent", "Geralmente pedimos 30% de entrada", { agent_user_id: "u1" }), text: "Geralmente pedimos 30% de entrada", agentName: "Piero" },
      { ...msg(4, "customer", "Tá ok"), text: "Tá ok" },
    ], "America/Sao_Paulo");
    expect(system.content).toMatch(/EQUIPE humana combinou/);
    expect(user.content).toContain("Resumo anterior:\n- Cliente quer 27/12 a 02/01");
    expect(user.content).toMatch(/\[08\/11,? 13:27\] Piero, da equipe: Geralmente pedimos 30% de entrada/);
    expect(user.content).toContain("Cliente: Tá ok");
  });

  it("contexto da equipe: última fala humana e a devolução automática depois dela", () => {
    expect(teamContext([msg(1, "customer", "oi"), msg(2, "bot", "Olá!")], "America/Sao_Paulo")).toBeNull();
    const ctx = teamContext([
      { ...msg(1, "agent", "Pode ser", { agent_user_id: "u1" }), agentName: "Piero" },
      msg(2, "system", "Devolvida ao bot: sem mensagens há 30 min (limite de 30 min).", { metadata: { event: "auto_return", idle_minutes: 30 } }),
      msg(3, "customer", "Vc pode me passar o pix?"),
    ], "America/Sao_Paulo");
    expect(ctx).toContain('Última mensagem humana (Piero, da equipe, 08/11');
    expect(ctx).toContain('"Pode ser"');
    expect(ctx).toContain("voltou para você automaticamente após 30 min");
    expect(ctx).toContain("transfira para a equipe");
  });

  it("histórico da IA: equipe rotulada pelo nome, sistema fora", () => {
    const history = [
      toHistoryItem(msg(1, "customer", "Posso parcelar?"), "Posso parcelar?", null),
      toHistoryItem(msg(2, "agent", "Geralmente pedimos 30% de entrada", { agent_user_id: "u1" }), "Geralmente pedimos 30% de entrada", "Piero"),
      toHistoryItem(msg(3, "system", "Devolvida ao bot"), "Devolvida ao bot", null),
      toHistoryItem(msg(4, "customer", "Tá ok"), "Tá ok", null),
    ];
    expect(historyToChat(history)).toEqual([
      { role: "user", content: "Posso parcelar?" },
      { role: "assistant", content: "[Piero, da equipe] Geralmente pedimos 30% de entrada" },
      { role: "user", content: "Tá ok" },
    ]);
  });
});

describe("trava: prometeu a equipe sem transferir", () => {
  it("reconhece a promessa", () => {
    expect(promisesHandoff("Vou passar para a equipe, que vai te enviar os dados do PIX e confirmar a reserva.")).toBe(true);
    expect(promisesHandoff("Já acionei a equipe para te ajudar com isso.")).toBe(true);
    expect(promisesHandoff("Nossa equipe vai entrar em contato em breve.")).toBe(true);
    expect(promisesHandoff("Vou encaminhar seu pedido ao responsável.")).toBe(true);
    expect(promisesHandoff("Passei para a equipe conferir o pagamento.")).toBe(true);
  });

  it("não dispara em menções neutras à equipe", () => {
    expect(promisesHandoff("Sou a assistente virtual; a equipe pode assumir quando quiserem.")).toBe(false);
    expect(promisesHandoff("Quer que eu chame alguém da equipe?")).toBe(false);
    expect(promisesHandoff("Posso transferir para a equipe se preferir.")).toBe(false);
    expect(promisesHandoff("O café é servido pela equipe das 7h às 10h.")).toBe(false);
  });
});
