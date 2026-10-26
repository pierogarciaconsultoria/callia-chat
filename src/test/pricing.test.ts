import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { periodForNight, priceTableSchema, quoteStay } from "../../supabase/functions/_shared/pricing.ts";

const table = priceTableSchema.parse(JSON.parse(readFileSync("scripts/data/morada-price-table.json", "utf8")));
const best = (q: Parameters<typeof quoteStay>[1]) => {
  const r = quoteStay(table, q) as { opcoes: Array<{ acomodacao: string; total: number }> };
  return r.opcoes;
};

describe("tabela de preços: período de cada noite", () => {
  it("datas que encostam: vale o período que começa na data", () => {
    expect(periodForNight(table, "2026-12-19")).toBe("baixa");
    expect(periodForNight(table, "2026-12-20")).toBe("alta");
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

  it("kitnet casal 01 a 06/12/2026 → R$ 1.600; novembro cai na baixa → R$ 2.000 nos apartamentos", () => {
    expect(best({ checkin: "01/12/2026", checkout: "06/12/2026", adults: 2, unit: "kitnet" })[0]).toMatchObject({ total: 1600 });
    const nov = best({ checkin: "10/11/2026", checkout: "15/11/2026", adults: 2 });
    expect(nov[0]).toMatchObject({ acomodacao: "Kitnet", total: 1600 });
    expect(nov.find((x) => x.acomodacao.startsWith("Apartamentos 101"))?.total).toBe(2000);
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
      expect.objectContaining({ periodo: "Baixa temporada", noites: 2, diaria: 320 }),
      expect.objectContaining({ periodo: "Alta temporada", noites: 3, diaria: 420 }),
    ]);
    expect(r.opcoes[0].total).toBe(2 * 320 + 3 * 420);
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

describe("tabela de preços: períodos fechados", () => {
  const closedTable = priceTableSchema.parse({ ...table, closed: [{ name: "Inverno", from: "2027-06-21", to: "2027-09-22" }] });

  it("estadia que toca o fechamento não é cotada", () => {
    const r = quoteStay(closedTable, { checkin: "18/06/2027", checkout: "23/06/2027", adults: 2 }) as { fechado?: boolean; opcoes: unknown[]; periodos_fechados?: string };
    expect(r.fechado).toBe(true);
    expect(r.opcoes).toEqual([]);
    expect(r.periodos_fechados).toBe("Inverno: 21/06/2027 a 22/09/2027");
  });

  it("checkout no 1º dia fechado ainda é cotado (a noite anterior está aberta)", () => {
    const r = quoteStay(closedTable, { checkin: "16/06/2027", checkout: "21/06/2027", adults: 2 }) as { fechado?: boolean; opcoes: unknown[] };
    expect(r.fechado).toBeUndefined();
    expect(r.opcoes.length).toBeGreaterThan(0);
  });

  it("rejeita fechamento com fim antes do início", () => {
    expect(priceTableSchema.safeParse({ ...table, closed: [{ name: "x", from: "2027-09-22", to: "2027-06-21" }] }).success).toBe(false);
  });
});
