import { describe, expect, it } from "vitest";
import { applyHours, applyPriceOps, AssistantError, buildAssistantPrompt, normalizeOp, toIsoDate } from "../../supabase/functions/_shared/assistant.ts";
import { priceTableSchema } from "../../supabase/functions/_shared/pricing.ts";

const table = priceTableSchema.parse({
  default_period: "baixa",
  periods: [
    { id: "baixa", name: "Baixa temporada", min_nights: 5, ranges: [["2026-11-30", "2026-12-20"]] },
    { id: "alta", name: "Alta temporada", min_nights: 5, ranges: [["2027-01-04", "2027-02-04"]] },
  ],
  units: [
    { name: "Kitnet", product_ids: [], pms_category_ids: [], max_guests: 2, rates: [{ guests: 2, label: "até 2 pessoas", prices: { baixa: 320, alta: 420 } }] },
    { name: "Apartamentos 101 a 104 e 201 a 204", product_ids: [], pms_category_ids: [], max_guests: 3, rates: [
      { guests: 2, label: "2 pessoas", prices: { baixa: 400, alta: 550 } },
      { guests: 3, label: "3 pessoas", prices: { baixa: 440, alta: 600 } },
    ] },
  ],
  notes: [],
  closed: [{ name: "Inverno", from: "2027-06-21", to: "2027-09-22" }],
});

describe("assistente: operações na tabela de preços", () => {
  it("muda a diária de uma acomodação num período, com linha de → para", () => {
    const { table: t, changes } = applyPriceOps(table, [{ op: "set_price", unit: "kitnet", period: "alta", price: 450 }]);
    expect(t.units[0].rates[0].prices.alta).toBe(450);
    expect(changes).toEqual([expect.stringMatching(/^Kitnet, até 2 pessoas, Alta temporada: R\$\s420,00 → R\$\s450,00$/)]);
    expect(table.units[0].rates[0].prices.alta).toBe(420); // original intacta
  });

  it("acha a acomodação pelo número e a tarifa pelo número de pessoas; ambíguo pede para escolher", () => {
    const { changes } = applyPriceOps(table, [{ op: "set_price", unit: "201", period: "Baixa temporada", price: 460, guests: 3 }]);
    expect(changes[0]).toMatch(/Apartamentos 101 a 104 e 201 a 204, 3 pessoas, Baixa temporada: R\$\s440,00 → R\$\s460,00/);
    expect(() => applyPriceOps(table, [{ op: "set_price", unit: "201", period: "alta", price: 1 }])).toThrow(/há estas tarifas/);
    expect(() => applyPriceOps(table, [{ op: "set_price", unit: "cobertura", period: "alta", price: 1 }])).toThrow(/não encontrada/);
    expect(() => applyPriceOps(table, [])).toThrow(AssistantError);
  });

  it("períodos: datas em DD/MM/AAAA, mínimo de diárias, criação e remoção", () => {
    const { table: t, changes } = applyPriceOps(table, [
      { op: "set_period", period: "alta", ranges: [["04/01/2027", "28/02/2027"]], min_nights: 4 },
      { op: "set_period", period: "Carnaval", name: "Carnaval", ranges: [["13/02/2027", "17/02/2027"]], min_nights: 3 },
    ]);
    expect(t.periods.find((p) => p.id === "alta")!.ranges).toEqual([["2027-01-04", "2027-02-28"]]);
    expect(changes).toContain("Alta temporada, datas: 04/01/2027 a 04/02/2027 → 04/01/2027 a 28/02/2027");
    expect(changes).toContain("Alta temporada, mínimo de diárias: 5 → 4");
    expect(t.periods.find((p) => p.id === "carnaval")).toMatchObject({ name: "Carnaval", min_nights: 3 });
    expect(() => applyPriceOps(table, [{ op: "remove_period", period: "baixa" }])).toThrow(/período padrão/);
    expect(() => applyPriceOps(table, [{ op: "set_period", period: "alta", ranges: [["30/02/2027", "01/03/2027"]] }])).toThrow(/inexistente/);
    expect(toIsoDate("2027-03-01")).toBe("2027-03-01");
  });

  it("fechamentos: acrescenta, atualiza pelo nome e remove", () => {
    const { table: t, changes } = applyPriceOps(table, [
      { op: "add_closed", name: "Inverno", from: "15/06/2027", to: "30/09/2027" },
      { op: "add_closed", name: "Reforma", from: "01/04/2027", to: "10/04/2027" },
    ]);
    expect(t.closed).toEqual([{ name: "Inverno", from: "2027-06-15", to: "2027-09-30" }, { name: "Reforma", from: "2027-04-01", to: "2027-04-10" }]);
    expect(changes[0]).toBe("Fechado (Inverno): 21/06/2027 a 22/09/2027 → 15/06/2027 a 30/09/2027");
    expect(applyPriceOps(t, [{ op: "remove_closed", name: "reforma" }]).table.closed).toHaveLength(1);
    expect(() => applyPriceOps(table, [{ op: "add_closed", name: "X", from: "10/04/2027", to: "01/04/2027" }])).toThrow(/invertido/);
    // Sem nome (a IA omite): com um único fechamento, atualiza esse; remover sem nome também.
    const noName = applyPriceOps(table, [{ op: "add_closed", from: "15/06/2027", to: "30/09/2027" }]);
    expect(noName.table.closed).toEqual([{ name: "Inverno", from: "2027-06-15", to: "2027-09-30" }]);
    expect(applyPriceOps(table, [{ op: "remove_closed" }]).table.closed).toEqual([]);
    expect(() => applyPriceOps(table, [{ op: "set_price", unit: "", period: "alta", price: 1 }])).toThrow(/Informe a acomodação/);
  });

  it("capacidade e regra de crianças: cria tarifa copiando os valores e sobe a capacidade", () => {
    const { table: t, changes } = applyPriceOps(table, [{ op: "set_child_rule", unit: "101", guests: 4, max_adults: 3, child_max_age: 5 }]);
    const unit = t.units[1];
    expect(unit.max_guests).toBe(4);
    expect(unit.rates[2]).toMatchObject({ guests: 4, max_adults: 3, child_max_age: 5, label: "3 adultos + 1 criança de até 5 anos", prices: { baixa: 440, alta: 600 } });
    expect(changes).toContain("Apartamentos 101 a 104 e 201 a 204, capacidade: 3 → 4 pessoas");
    // Só a idade (a IA costuma mandar só isso): atualiza a regra existente; sem regra, cria com 1 criança além dos adultos.
    const again = applyPriceOps(t, [{ op: "set_child_rule", unit: "101", child_max_age: 6 }]);
    expect(again.table.units[1].rates[2]).toMatchObject({ guests: 4, max_adults: 3, child_max_age: 6, label: "3 adultos + 1 criança de até 6 anos" });
    expect(again.changes).toEqual(['Apartamentos 101 a 104 e 201 a 204: regra "3 adultos + 1 criança de até 5 anos" → "3 adultos + 1 criança de até 6 anos"']);
    const kit = applyPriceOps(table, [{ op: "set_child_rule", unit: "kitnet", child_max_age: 10 }]);
    expect(kit.table.units[0].rates[1]).toMatchObject({ guests: 3, max_adults: 2, child_max_age: 10 });
    expect(kit.table.units[0].max_guests).toBe(3);
  });

  it("set_range ajusta só a faixa que contém a data; operações repetidas contam uma vez", () => {
    const { table: t, changes } = applyPriceOps(table, [
      { op: "set_range", period: "alta", match: "20/01/2027", to: "10/02/2027" },
      { op: "set_price", unit: "kitnet", period: "alta", price: 450 },
      { op: "set_price", unit: "kitnet", period: "alta", price: 450 },
    ]);
    expect(t.periods.find((p) => p.id === "alta")!.ranges).toEqual([["2027-01-04", "2027-02-10"]]);
    expect(changes).toEqual(["Alta temporada, faixa 04/01/2027 a 04/02/2027 → 04/01/2027 a 10/02/2027", expect.stringMatching(/Kitnet.*420,00 → R\$\s450,00$/)]);
    expect(() => applyPriceOps(table, [{ op: "set_range", period: "alta", match: "01/06/2027", to: "02/06/2027" }])).toThrow(/não tem faixa/);
  });

  it("fechamento sem nome casa pela sobreposição de datas, mesmo com mais de um cadastrado", () => {
    const two = applyPriceOps(table, [{ op: "add_closed", name: "Reforma", from: "01/04/2027", to: "10/04/2027" }]).table;
    const { table: t, changes } = applyPriceOps(two, [{ op: "add_closed", from: "15/06/2027", to: "30/09/2027" }]);
    expect(t.closed.find((c) => c.name === "Inverno")).toEqual({ name: "Inverno", from: "2027-06-15", to: "2027-09-30" });
    expect(changes).toEqual(["Fechado (Inverno): 21/06/2027 a 22/09/2027 → 15/06/2027 a 30/09/2027"]);
    expect(applyPriceOps(two, [{ op: "remove_closed", from: "21/06/2027" }]).table.closed.map((c) => c.name)).toEqual(["Reforma"]);
    expect(() => applyPriceOps(two, [{ op: "remove_closed" }])).toThrow(/Qual fechamento remover/);
  });
});

describe("assistente: campos em português da ferramenta", () => {
  it("aceita acomodacao/periodo/diaria e descarta 'R$' como acomodação", () => {
    expect(normalizeOp({ op: "set_price", acomodacao: "Kitnet", periodo: "alta", diaria: "450" })).toEqual({ op: "set_price", unit: "Kitnet", period: "alta", price: 450 });
    expect(normalizeOp({ op: "set_price", unit: "R$", tarifa: "até 2 pessoas", periodo: "alta", diaria: 450 })).toEqual({ op: "set_price", label: "até 2 pessoas", period: "alta", price: 450 });
    const { changes } = applyPriceOps(table, [{ op: "set_range", periodo: "alta", data_na_faixa: "20/01/2027", fim: "10/02/2027" } as unknown as Parameters<typeof applyPriceOps>[1][number]]);
    expect(changes).toEqual(["Alta temporada, faixa 04/01/2027 a 04/02/2027 → 04/01/2027 a 10/02/2027"]);
  });
});

describe("assistente: horário da equipe e prompt", () => {
  it("aplica horários por dia, 'todos' vale para a semana, e descreve as mudanças", () => {
    const { hours, changes } = applyHours({ mon: [["08:00", "18:00"]] }, [{ days: ["todos"], ranges: [["08:00", "22:00"]] }, { days: ["domingo"], ranges: [] }]);
    expect(hours.mon).toEqual([["08:00", "22:00"]]);
    expect(hours.sun).toEqual([]);
    expect(changes[0]).toBe("segunda: 08:00–18:00 → 08:00–22:00");
    expect(changes.at(-1)).toBe("domingo: 08:00–22:00 → fechado");
    expect(() => applyHours({}, [{ days: ["sexta"], ranges: [["8h", "22h"]] }])).toThrow(/HH:MM/);
  });

  it("prompt traz identificadores exatos, políticas com id, horário e telas", () => {
    const p = buildAssistantPrompt({
      agentName: "MarIA", businessName: "Morada", priceTable: table, currency: "BRL",
      policies: [{ id: "p1", topic: "checkin", title: "Check-in", content: "Das 14h às 22h." }],
      businessHours: { mon: [["08:00", "22:00"]] }, outOfHoursMessage: null, guardrails: "- Seja gentil.", timezone: "America/Sao_Paulo",
    });
    expect(p).toContain('"Alta temporada" (id alta, mínimo 5)');
    expect(p).toContain('"Kitnet" [tarifas: até 2 pessoas (guests 2)]');
    expect(p).toContain("- [p1] checkin — Check-in: Das 14h às 22h.");
    expect(p).toContain("segunda: 08:00–22:00; terça: fechado");
    expect(p).toContain("- precos: Informações da empresa → Catálogo e preços");
    expect(p).toContain("nunca grava diretamente");
  });
});
