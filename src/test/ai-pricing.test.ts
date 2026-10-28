import { describe, expect, it } from "vitest";
import { estimateAiCost } from "../../supabase/functions/_shared/ai-pricing.ts";

describe("custo estimado de IA", () => {
  it("soma por modelo com o preço da tabela; execução sem modelo usa o padrão; data no nome não atrapalha", () => {
    const cost = estimateAiCost([
      { usage: { model: "gpt-4.1-mini", prompt_tokens: 1_000_000, completion_tokens: 0 } }, // US$ 0,40
      { usage: { model: "gpt-4.1-mini-2025-04-14", prompt_tokens: 0, completion_tokens: 1_000_000 } }, // US$ 1,60
      { usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 } }, // padrão gpt-4o-mini: 0,15 + 0,60
      { usage: null },
      { usage: { model: "gpt-4.1-mini", prompt_tokens: 0, completion_tokens: 0 } }, // sem tokens: não conta
    ]);
    expect(cost.usd).toBe(2.75);
    expect(cost.by_model["gpt-4.1-mini"]).toMatchObject({ runs: 1, usd: 0.4 });
    expect(cost.by_model["gpt-4.1-mini-2025-04-14"]).toMatchObject({ runs: 1, usd: 1.6 });
    expect(cost.by_model["gpt-4o-mini"]).toMatchObject({ runs: 1, prompt_tokens: 1_000_000, usd: 0.75 });
    expect(cost.unknown_models).toEqual([]);
  });

  it("modelo fora da tabela é custeado pelo padrão e sinalizado", () => {
    const cost = estimateAiCost([{ usage: { model: "modelo-x", prompt_tokens: 2_000_000, completion_tokens: 0 } }], "gpt-4.1-mini");
    expect(cost.usd).toBe(0.8);
    expect(cost.unknown_models).toEqual(["modelo-x"]);
  });
});
