import { describe, expect, it } from "vitest";
import { emptyRate, fromEditor, newKey, parseBRL, serverIssues, slugId, starterEditor, toEditor, type PriceTableData } from "@/lib/price-table";
import { EMPTY_BUSINESS_INFO, maskCnpj, paymentPreview } from "@/lib/business-info";

const TABLE: PriceTableData = {
  default_period: "baixa",
  periods: [
    { id: "baixa", name: "Baixa temporada", min_nights: 5, ranges: [] },
    { id: "alta", name: "Alta temporada", min_nights: null, ranges: [["2026-12-20", "2027-02-28"]] },
  ],
  units: [{
    name: "Apartamento",
    product_ids: ["11111111-1111-1111-1111-111111111111"],
    max_guests: 3,
    rates: [
      { guests: 2, prices: { baixa: 350, alta: 500 } },
      { guests: 3, label: "2 adultos + 1 criança", max_adults: 2, child_max_age: 10, prices: { baixa: 400, alta: 1500.5 } },
    ],
  }],
  notes: ["Café da manhã incluso"],
};

describe("tabela de preços: editor", () => {
  it("lê valores em reais com vírgula", () => {
    expect(parseBRL("1.500,00")).toBe(1500);
    expect(parseBRL("1500,5")).toBe(1500.5);
    expect(parseBRL("R$ 350")).toBe(350);
    expect(parseBRL("1500.50")).toBe(1500.5);
    expect(parseBRL("")).toBeNull();
    expect(parseBRL("abc")).toBeNull();
    expect(parseBRL("-10")).toBeNull();
  });

  it("ida e volta pelo editor preserva a tabela", () => {
    const { data, issues } = fromEditor(toEditor("Tabela 2026", TABLE));
    expect(issues).toEqual([]);
    expect(data).toEqual(TABLE);
  });

  it("renomear um período mantém o id; período novo ganha id único do nome", () => {
    const model = toEditor("T", TABLE);
    model.periods[1].name = "Verão";
    const novo = { key: newKey("p"), id: null, name: "Alta", min_nights: "3", ranges: [["2026-04-02", "2026-04-05"]] as Array<[string, string]> };
    model.periods.push(novo);
    model.units[0].rates.forEach((r) => (r.prices[novo.key] = "600"));
    const { data, issues } = fromEditor(model);
    expect(issues).toEqual([]);
    expect(data!.periods.map((p) => p.id)).toEqual(["baixa", "alta", "alta-2"]);
    expect(data!.units[0].rates[0].prices).toEqual({ baixa: 350, alta: 500, "alta-2": 600 });
    expect(slugId("Réveillon 2026/27", new Set())).toBe("reveillon-2026-27");
    expect(slugId("!!!", new Set(["periodo"]))).toBe("periodo-2");
  });

  it("aponta valor faltando, intervalo invertido e regra de criança incompleta", () => {
    const model = toEditor("T", TABLE);
    const rate = model.units[0].rates[0];
    rate.prices[model.periods[1].key] = "";
    model.periods[1].ranges = [["2027-02-28", "2026-12-20"]];
    model.units[0].rates.push({ ...emptyRate(), childRule: true });
    const { data, issues } = fromEditor(model);
    expect(data).toBeNull();
    const fields = issues.map((i) => i.field);
    expect(fields).toContain(`r:${rate.key}:price:${model.periods[1].key}`);
    expect(fields).toContain(`p:${model.periods[1].key}:r0`);
    expect(issues.find((i) => i.field.endsWith(":adults"))?.message).toMatch(/adultos/);
  });

  it("exige período padrão existente", () => {
    const model = toEditor("T", TABLE);
    model.defaultKey = "nao-existe";
    expect(fromEditor(model).issues.map((i) => i.field)).toContain("default");
  });

  it("modelo inicial: baixa temporada padrão, mín. 5 e uma acomodação", () => {
    const starter = starterEditor();
    expect(starter.periods).toHaveLength(1);
    expect(starter.periods[0]).toMatchObject({ id: "baixa", name: "Baixa temporada", min_nights: "5", ranges: [] });
    expect(starter.defaultKey).toBe(starter.periods[0].key);
    starter.units[0].name = "Kitnet";
    starter.units[0].rates[0].prices[starter.periods[0].key] = "250,00";
    const { data, issues } = fromEditor(starter);
    expect(issues).toEqual([]);
    expect(data).toMatchObject({ default_period: "baixa", units: [{ name: "Kitnet", max_guests: 2, rates: [{ guests: 2, prices: { baixa: 250 } }] }] });
  });

  it("traduz o caminho dos erros do servidor", () => {
    const issues = serverIssues({ issues: [{ path: ["units", 0, "rates", 1, "prices", "alta"], message: "obrigatório" }, { path: "periods.1.ranges.0", message: "inválido" }] }, TABLE);
    expect(issues).toEqual([
      { path: "Apartamento › tarifa 2 › valor Alta temporada", message: "obrigatório" },
      { path: "Alta temporada › intervalo 1", message: "inválido" },
    ]);
    expect(serverIssues(undefined)).toEqual([]);
  });
});

describe("dados da empresa e pagamento", () => {
  it("máscara de CNPJ", () => {
    expect(maskCnpj("11222333000181")).toBe("11.222.333/0001-81");
    expect(maskCnpj("6887")).toBe("68.87");
    expect(maskCnpj("11.222.333/0001-811234")).toBe("11.222.333/0001-81");
  });

  it("prévia usa a razão social quando não há favorecido", () => {
    const lines = paymentPreview({
      ...EMPTY_BUSINESS_INFO,
      legal_name: "Pousada Exemplo Ltda",
      cnpj: "11.222.333/0001-81",
      pix_key_type: "cnpj",
      pix_key: "11.222.333/0001-81",
      bank_name: "Banco do Brasil",
      bank_code: "001",
      agency: "1234-5",
      account: "98765-0",
      account_type: "corrente",
      deposit_percent: 50,
    });
    expect(lines).toEqual([
      "PIX (CNPJ): 11.222.333/0001-81",
      "Favorecido: Pousada Exemplo Ltda — CNPJ 11.222.333/0001-81",
      "Transferência: Banco do Brasil (001), agência 1234-5, conta corrente 98765-0",
      "Sinal para garantir a reserva: 50% do total",
    ]);
    expect(paymentPreview(EMPTY_BUSINESS_INFO)).toEqual(["Sinal: informado pela equipe"]);
  });
});

describe("tabela de preços: períodos fechados no editor", () => {
  const base = { default_period: "baixa", periods: [{ id: "baixa", name: "Baixa", min_nights: 5, ranges: [] }], units: [{ name: "Apto", product_ids: [], max_guests: 2, rates: [{ guests: 2, prices: { baixa: 400 } }] }], notes: [] };

  it("preserva o fechamento na ida e volta", () => {
    const data = { ...base, closed: [{ name: "Inverno", from: "2027-06-21", to: "2027-09-22" }] };
    expect(fromEditor(toEditor("T", data)).data?.closed).toEqual(data.closed);
  });

  it("exige motivo e datas em ordem", () => {
    const model = toEditor("T", { ...base, closed: [{ name: "", from: "2027-09-22", to: "2027-06-21" }] });
    const { issues } = fromEditor(model);
    expect(issues.map((i) => i.message)).toEqual(expect.arrayContaining(["Informe o motivo (ex.: Inverno).", "O início deve ser antes ou igual ao fim."]));
  });
});

describe("prévia do pagamento com pré-reserva", () => {
  it("mostra a pré-reserva e não mostra chave PIX nem conta", () => {
    const lines = paymentPreview({ ...EMPTY_BUSINESS_INFO, pix_key: "48 90000 0000", account: "12.345-6", deposit_percent: 50, pre_reservation_url: "https://pms.hospedin.com/pre-reserva/exemplo", share_payment_info: true });
    expect(lines).toContain("PIX: pré-reserva em https://pms.hospedin.com/pre-reserva/exemplo");
    expect(lines.join("\n")).not.toMatch(/90000|12\.345/);
  });
});
