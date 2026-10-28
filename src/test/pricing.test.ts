import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canExtendToMinimum, fitToGroup, isOpenNight, mergeAvailability, periodForNight, priceTableSchema, priceTableSummary, quoteStay } from "../../supabase/functions/_shared/pricing.ts";

const table = priceTableSchema.parse(JSON.parse(readFileSync("scripts/data/morada-price-table.json", "utf8")));
const best = (q: Parameters<typeof quoteStay>[1]) => {
  const r = quoteStay(table, q) as { opcoes: Array<{ acomodacao: string; total: number }> };
  return r.opcoes;
};

describe("tabela de preços: período de cada noite", () => {
  it("datas que encostam: vale o período que começa na data", () => {
    expect(periodForNight(table, "2026-12-19")).toBe("baixa");
    expect(periodForNight(table, "2026-12-20")).toBe("baixa"); // alta de dezembro começa em 21/12, como no site
    expect(periodForNight(table, "2026-12-21")).toBe("alta");
    expect(periodForNight(table, "2026-12-24")).toBe("natal");
    expect(periodForNight(table, "2027-01-03")).toBe("natal");
    expect(periodForNight(table, "2027-01-04")).toBe("alta");
    expect(periodForNight(table, "2027-02-10")).toBe("carnaval");
    expect(periodForNight(table, "2027-02-11")).toBe("alta");
  });

  it("datas fora da tabela caem na baixa temporada", () => {
    expect(periodForNight(table, "2026-11-10")).toBe("baixa");
    expect(periodForNight(table, "2027-02-05")).toBe("baixa");
    expect(periodForNight(table, "2027-04-15")).toBe("baixa");
  });
});

describe("tabela de preços: texto para o prompt gerado da estrutura", () => {
  it("lista períodos com mínimo, fechamentos, capacidade com regra de idade e diárias por período", () => {
    const t = priceTableSchema.parse({
      default_period: "baixa",
      periods: [
        { id: "baixa", name: "Baixa temporada", min_nights: 5, ranges: [["2026-11-30", "2026-12-20"]] },
        { id: "alta", name: "Alta temporada", min_nights: 5, ranges: [["2027-01-04", "2027-02-04"]] },
      ],
      units: [{
        name: "Apartamentos 101 a 104", product_ids: [], pms_category_ids: [274], max_guests: 4,
        rates: [
          { guests: 3, label: "3 pessoas", prices: { baixa: 440, alta: 600 } },
          { guests: 4, label: "3 adultos + 1 criança de até 5 anos", max_adults: 3, child_max_age: 5, prices: { baixa: 440, alta: 600 } },
          { guests: 2, label: "2 pessoas", prices: { baixa: 400, alta: 550 } },
        ],
      }],
      notes: ["Páscoa: 3 diárias."],
      closed: [{ name: "Inverno", from: "2027-06-21", to: "2027-09-22" }],
    });
    const text = priceTableSummary(t);
    expect(text).toContain("- Baixa temporada: 30/11/2026 a 20/12/2026 (mínimo de 5 diárias)");
    expect(text).toContain("Noites fora de todos os períodos acima não têm valor cadastrado");
    expect(text).toContain("Fechado (não cote nem ofereça reserva): Inverno, 21/06/2027 a 22/09/2027.");
    // Capacidade com a ressalva da criança explícita (a IA resumia "até 4 pessoas").
    expect(text).toContain("- Apartamentos 101 a 104: até 3 pessoas, ou 3 adultos + 1 criança de até 5 anos:");
    // Tarifas em ordem de pessoas, regra de idade explícita, diária por período.
    expect(text.indexOf("- 2 pessoas:")).toBeLessThan(text.indexOf("- 3 pessoas:"));
    // formatMoney usa espaço fixo (NBSP) depois de "R$".
    expect(text).toMatch(/- 3 adultos \+ 1 criança de até 5 anos \[até 3 adultos; criança de até 5 anos; a partir disso conta como adulto\]: Baixa temporada R\$\s440,00 \| Alta temporada R\$\s600,00/);
    expect(text).toContain("Observações: Páscoa: 3 diárias.");
    expect(text).not.toMatch(/R\$\s[\d.]+,\d{2}[^\n]*\btotal\b/i); // nenhum total calculado no texto: só pela ferramenta
  });
});

describe("tabela de preços: cálculo (gabarito confirmado com o hotel)", () => {
  it("casal + crianças de 13 e 7 anos, 10 a 20/01/2027 → 205/206 por R$ 8.500", () => {
    const o = best({ checkin: "10/01/2027", checkout: "20/01/2027", adults: 2, childrenAges: [13, 7] });
    expect(o[0]).toMatchObject({ acomodacao: "Apartamentos 205 e 206", total: 8500 });
    expect(o.map((x) => x.acomodacao)).not.toContain("Apartamentos 210 a 212"); // 13 anos conta como adulto
  });

  it("2 pessoas no 201 de 10 a 15/01/2027 → R$ 2.750", () => {
    const o = best({ checkin: "10/01/2027", checkout: "15/01/2027", adults: 2, unit: "201" });
    expect(o).toEqual([expect.objectContaining({ acomodacao: "Apartamentos 101 a 104, 201 a 204 e 207 a 209", total: 2750 })]);
  });

  it("Réveillon 4 pessoas, 27/12/2026 a 01/01/2027 → R$ 5.000 (pacote Natal e Ano Novo)", () => {
    expect(best({ checkin: "27/12/2026", checkout: "01/01/2027", adults: 4 })[0]).toMatchObject({ acomodacao: "Apartamentos 205 e 206", total: 5000 });
  });

  it("kitnet casal 01 a 06/12/2026 → R$ 1.600; fevereiro entre alta e Carnaval usa a baixa", () => {
    expect(best({ checkin: "01/12/2026", checkout: "06/12/2026", adults: 2, unit: "kitnet" })[0]).toMatchObject({ total: 1600 });
    const r = quoteStay(table, { checkin: "05/02/2027", checkout: "06/02/2027", adults: 2 }) as { periodos?: string[]; sem_tarifa?: boolean };
    expect(r.sem_tarifa).toBeUndefined();
    expect(r.periodos).toEqual(["Baixa temporada"]);
  });

  it("fora da temporada cadastrada não cota (novembro antes da abertura, abril depois da Páscoa)", () => {
    for (const [checkin, checkout] of [["10/11/2026", "15/11/2026"], ["28/11/2026", "02/12/2026"], ["27/03/2027", "30/03/2027"]]) {
      const r = quoteStay(table, { checkin, checkout, adults: 2 }) as { sem_tarifa?: boolean; opcoes: unknown[]; temporada_cadastrada?: string };
      expect(r.sem_tarifa).toBe(true);
      expect(r.opcoes).toEqual([]);
      expect(r.temporada_cadastrada).toBe("30/11/2026 a 28/03/2027");
    }
    // Tabela sem datas no período padrão vale o ano todo.
    const yearRound = priceTableSchema.parse({ ...table, periods: table.periods.map((p) => (p.id === table.default_period ? { ...p, ranges: [] } : p)) });
    expect((quoteStay(yearRound, { checkin: "10/11/2026", checkout: "15/11/2026", adults: 2 }) as { opcoes: unknown[] }).opcoes.length).toBeGreaterThan(0);
  });

  it("Páscoa 3 adultos, 26 a 29/03/2027 → 3 noites × R$ 600 = R$ 1.800", () => {
    const r = quoteStay(table, { checkin: "26/03/2027", checkout: "29/03/2027", adults: 3 }) as { noites: number; estadia_minima: number; atende_estadia_minima: boolean; opcoes: Array<{ total: number }> };
    expect(r).toMatchObject({ noites: 3, estadia_minima: 3, atende_estadia_minima: true });
    expect(r.opcoes[0].total).toBe(1800);
  });

  it("casal + filha de 8 anos em março (baixa) → 210 a 212 por R$ 2.200", () => {
    const o = best({ checkin: "01/03/2027", checkout: "06/03/2027", adults: 2, childrenAges: [8] });
    expect(o.find((x) => x.acomodacao === "Apartamentos 210 a 212")?.total).toBe(2200);
  });

  it("estadia que atravessa períodos soma cada trecho pelo seu valor", () => {
    const r = quoteStay(table, { checkin: "18/12/2026", checkout: "23/12/2026", adults: 2, unit: "kitnet" }) as {
      opcoes: Array<{ total: number; detalhamento: Array<{ periodo: string; noites: number; diaria: number }> }>;
    };
    expect(r.opcoes[0].detalhamento).toEqual([
      expect.objectContaining({ periodo: "Baixa temporada", noites: 3, diaria: 320 }),
      expect.objectContaining({ periodo: "Alta temporada", noites: 2, diaria: 420 }),
    ]);
    expect(r.opcoes[0].total).toBe(3 * 320 + 2 * 420);
  });

  it("avisa estadia abaixo do mínimo e grupos que não cabem em nenhuma acomodação", () => {
    const short = quoteStay(table, { checkin: "10/01/2027", checkout: "12/01/2027", adults: 2 }) as { atende_estadia_minima: boolean; estadia_minima: number };
    expect(short).toMatchObject({ atende_estadia_minima: false, estadia_minima: 5 });
    const big = quoteStay(table, { checkin: "10/01/2027", checkout: "15/01/2027", adults: 9 }) as { opcoes: unknown[]; sem_opcao?: string };
    expect(big.opcoes).toHaveLength(0);
    expect(big.sem_opcao).toMatch(/9 pessoa/);
  });

  it("valida a tabela: preço em período inexistente é rejeitado", () => {
    const bad = JSON.parse(JSON.stringify(table));
    bad.units[0].rates[0].prices.inexistente = 1;
    expect(priceTableSchema.safeParse(bad).success).toBe(false);
  });
});

describe("sinal", () => {
  it("calcula o sinal pelo percentual, sem a IA fazer conta", async () => {
    const { withDeposit } = await import("../../supabase/functions/_shared/pricing.ts");
    const r = withDeposit(quoteStay(table, { checkin: "27/12/2026", checkout: "01/01/2027", adults: 4 }) as { opcoes: Array<{ total: number }> }, 30) as { opcoes: Array<{ total: number; sinal: number; sinal_formatado: string }> };
    expect(r.opcoes[0]).toMatchObject({ total: 5000, sinal: 1500 });
    expect(r.opcoes[0].sinal_formatado).toMatch(/1\.500,00/);
  });
});

describe("tabela de preços: valor igual ao site e tamanho do grupo", () => {
  it("3 adultos de 18 a 26/12/2026 → R$ 4.820 (3 baixa + 3 alta + 2 Natal), igual ao site", () => {
    const apt = best({ checkin: "18/12/2026", checkout: "26/12/2026", adults: 3 }).find((o) => o.acomodacao.startsWith("Apartamentos 101"));
    expect(apt?.total).toBe(4820);
  });

  const sizedNames = (adults: number) =>
    (fitToGroup(quoteStay(table, { checkin: "01/12/2026", checkout: "06/12/2026", adults })) as { opcoes: Array<{ acomodacao: string }>; maiores_que_o_grupo?: string[] });

  it("casal não recebe acomodações para 4 ou 7 pessoas", () => {
    const r = sizedNames(2);
    expect(r.opcoes.map((o) => o.acomodacao)).toEqual(expect.arrayContaining(["Kitnet"]));
    expect(r.opcoes.some((o) => /205|Verdes/.test(o.acomodacao))).toBe(false);
    expect(r.maiores_que_o_grupo).toEqual(expect.arrayContaining(["Apartamentos 205 e 206", "Condomínio Verdes Mares"]));
  });

  it("3 pessoas: até o 205/206 (4 lugares), sem o Verdes Mares; 6 pessoas: Verdes Mares", () => {
    const three = sizedNames(3).opcoes.map((o) => o.acomodacao);
    expect(three).toContain("Apartamentos 205 e 206");
    expect(three).not.toContain("Condomínio Verdes Mares");
    expect(sizedNames(6).opcoes.map((o) => o.acomodacao)).toEqual(["Condomínio Verdes Mares"]);
  });

  it("se as do tamanho certo estão lotadas, mostra as maiores", () => {
    const withIds = priceTableSchema.parse({ ...table, units: table.units.map((u, i) => ({ ...u, pms_category_ids: [100 + i] })) });
    const q = quoteStay(withIds, { checkin: "01/12/2026", checkout: "06/12/2026", adults: 2 });
    const bigOnly = (q as { opcoes: Array<{ acomodacao: string; pms_category_ids: number[] }> }).opcoes
      .filter((o) => /205|Verdes/.test(o.acomodacao)).map((o) => ({ category_id: o.pms_category_ids[0], available_units: 1 }));
    const merged = fitToGroup(mergeAvailability(q, bigOnly)) as { opcoes: Array<{ acomodacao: string }>; maiores_que_o_grupo?: string[] };
    expect(merged.opcoes.map((o) => o.acomodacao).sort()).toEqual(["Apartamentos 205 e 206", "Condomínio Verdes Mares"]);
    expect(merged.maiores_que_o_grupo).toBeUndefined();
  });
});

describe("estadia mínima: janela entre reservas", () => {
  const days = (from: string, n: number, units = 1) => Object.fromEntries(Array.from({ length: n }, (_, i) => [new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10), units]));
  const stay = ["2027-01-10", "2027-01-11", "2027-01-12"];

  it("3 noites livres entre reservas não estendem até 5: estadia curta permitida", () => {
    expect(canExtendToMinimum(stay, 5, { ...days("2027-01-07", 10, 0), ...days("2027-01-10", 3) })).toBe(false);
  });

  it("com vaga para estender (antes ou depois), exige o mínimo", () => {
    expect(canExtendToMinimum(stay, 5, days("2027-01-10", 5))).toBe(true); // depois
    expect(canExtendToMinimum(stay, 5, days("2027-01-08", 5))).toBe(true); // antes
    expect(canExtendToMinimum(stay, 5, { ...days("2027-01-09", 4), "2027-01-14": 1 })).toBe(false); // furo em 13/01
  });

  it("noite fechada não conta como extensão possível", () => {
    expect(canExtendToMinimum(stay, 5, days("2027-01-05", 15), (n) => n !== "2027-01-13" && n !== "2027-01-09")).toBe(false);
    expect(isOpenNight(table, "2026-12-01")).toBe(true);
    expect(isOpenNight(table, "2027-04-10")).toBe(false); // depois da temporada cadastrada
  });

  it("merge marca cada opção como permitida ou exige_minimo", () => {
    const withIds = priceTableSchema.parse({ ...table, units: table.units.map((u, i) => ({ ...u, pms_category_ids: [100 + i] })) });
    const q = quoteStay(withIds, { checkin: "10/01/2027", checkout: "13/01/2027", adults: 2 }) as { atende_estadia_minima: boolean; opcoes: Array<{ acomodacao: string; pms_category_ids: number[] }> };
    expect(q.atende_estadia_minima).toBe(false);
    const kit = q.opcoes.find((o) => o.acomodacao === "Kitnet")!.pms_category_ids[0];
    const apt = q.opcoes.find((o) => o.acomodacao.startsWith("Apartamentos 101"))!.pms_category_ids[0];
    const merged = mergeAvailability(q as never, [
      { category_id: kit, available_units: 1, nightly: { ...days("2027-01-07", 10, 0), ...days("2027-01-10", 3) } },
      { category_id: apt, available_units: 2, nightly: days("2027-01-07", 10) },
    ]) as { opcoes: Array<{ acomodacao: string; estadia_curta?: string }> };
    expect(merged.opcoes.find((o) => o.acomodacao === "Kitnet")?.estadia_curta).toBe("permitida");
    expect(merged.opcoes.find((o) => o.acomodacao.startsWith("Apartamentos 101"))?.estadia_curta).toBe("exige_minimo");
  });
});

describe("tabela de preços: períodos fechados", () => {
  const closedTable = priceTableSchema.parse({ ...table, closed: [{ name: "Reforma", from: "2027-03-10", to: "2027-03-20" }] });

  it("estadia que toca o fechamento não é cotada", () => {
    const r = quoteStay(closedTable, { checkin: "08/03/2027", checkout: "12/03/2027", adults: 2 }) as { fechado?: boolean; opcoes: unknown[]; periodos_fechados?: string };
    expect(r.fechado).toBe(true);
    expect(r.opcoes).toEqual([]);
    expect(r.periodos_fechados).toBe("Reforma: 10/03/2027 a 20/03/2027");
  });

  it("checkout no 1º dia fechado ainda é cotado (a noite anterior está aberta)", () => {
    const r = quoteStay(closedTable, { checkin: "05/03/2027", checkout: "10/03/2027", adults: 2 }) as { fechado?: boolean; opcoes: unknown[] };
    expect(r.fechado).toBeUndefined();
    expect(r.opcoes.length).toBeGreaterThan(0);
  });

  it("rejeita fechamento com fim antes do início", () => {
    expect(priceTableSchema.safeParse({ ...table, closed: [{ name: "x", from: "2027-09-22", to: "2027-06-21" }] }).success).toBe(false);
  });
});

describe("vaga pelo Hospedin, preço pela tabela", () => {
  const mapped = priceTableSchema.parse({
    ...table,
    units: table.units.map((u) => ({ ...u, pms_category_ids: u.name.startsWith("Apartamentos 205") ? [275] : u.name === "Kitnet" ? [276] : [] })),
  });

  it("lista só as opções com vaga, com o preço da tabela; lotadas vão para sem_vaga", () => {
    const quote = quoteStay(mapped, { checkin: "27/12/2026", checkout: "01/01/2027", adults: 2 });
    const r = mergeAvailability(quote, [{ category_id: 275, available_units: 2 }, { category_id: 276, available_units: 0 }]) as {
      opcoes: Array<{ acomodacao: string; total: number; unidades_disponiveis: number }>; disponibilidade_confirmada: boolean; sem_vaga?: string[]; nao_verificadas?: unknown[];
    };
    expect(r.disponibilidade_confirmada).toBe(true);
    expect(r.opcoes).toEqual([expect.objectContaining({ acomodacao: "Apartamentos 205 e 206", total: 5000, unidades_disponiveis: 2 })]);
    expect(r.sem_vaga).toEqual(["Kitnet"]);
    expect(r.nao_verificadas?.length).toBeGreaterThan(0);
  });

  it("sem nenhuma vaga, não confirma disponibilidade", () => {
    const quote = quoteStay(mapped, { checkin: "27/12/2026", checkout: "01/01/2027", adults: 4 });
    const r = mergeAvailability(quote, [{ category_id: 275, available_units: 0 }]) as { disponibilidade_confirmada: boolean; opcoes: unknown[] };
    expect(r.disponibilidade_confirmada).toBe(false);
    expect(r.opcoes).toEqual([]);
  });
});
