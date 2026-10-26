// Cálculo exato do valor da estadia pela tabela de preços do workspace (noite a noite).
// A IA nunca faz essa conta: recebe o resultado pronto da ferramenta calcular_valor.
import { z } from "npm:zod@3.23.8";
import { formatMoney } from "./agent-core.ts";
import { parseBrDate } from "./hbook.ts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const priceTableSchema = z.object({
  /** Período usado nas noites que não caem em nenhum intervalo (ex.: baixa temporada). */
  default_period: z.string().min(1),
  periods: z.array(z.object({
    id: z.string().regex(/^[a-z0-9_-]{1,30}$/),
    name: z.string().min(1).max(80),
    min_nights: z.number().int().min(1).max(60).nullable().optional(),
    /** Noites [início, fim], datas inclusivas. Se dois períodos cobrem a mesma noite, vale o que começou por último. */
    ranges: z.array(z.tuple([isoDate, isoDate])).default([]),
  })).min(1),
  units: z.array(z.object({
    name: z.string().min(1).max(120),
    product_ids: z.array(z.string().uuid()).default([]),
    /** Categorias do PMS (Hospedin) desta acomodação: a vaga vem de lá, o preço daqui. */
    pms_category_ids: z.array(z.number().int().positive()).max(20).default([]),
    max_guests: z.number().int().min(1).max(30),
    rates: z.array(z.object({
      /** Até quantas pessoas esta linha vale. */
      guests: z.number().int().min(1).max(30),
      label: z.string().max(120).optional(),
      /** Com regra de criança: no máximo N adultos; crianças acima da idade contam como adulto. */
      max_adults: z.number().int().min(1).max(30).nullable().optional(),
      child_max_age: z.number().int().min(0).max(17).nullable().optional(),
      /** Valor da diária por id de período. */
      prices: z.record(z.number().nonnegative()),
    })).min(1),
  })).min(1),
  notes: z.array(z.string().max(500)).default([]),
  /** Datas em que o hotel não funciona (noites inclusivas): nada é cotado. */
  closed: z.array(z.object({
    name: z.string().min(1).max(80),
    from: isoDate,
    to: isoDate,
  })).max(30).default([]),
}).superRefine((t, ctx) => {
  t.closed.forEach((c, i) => {
    if (c.from > c.to) ctx.addIssue({ code: "custom", path: ["closed", i, "to"], message: "fim antes do início" });
  });
  const ids = new Set(t.periods.map((p) => p.id));
  if (!ids.has(t.default_period)) ctx.addIssue({ code: "custom", path: ["default_period"], message: "período padrão inexistente" });
  t.units.forEach((u, i) => u.rates.forEach((r, j) => {
    for (const k of Object.keys(r.prices)) {
      if (!ids.has(k)) ctx.addIssue({ code: "custom", path: ["units", i, "rates", j, "prices", k], message: "período inexistente" });
    }
  }));
});
export type PriceTableData = z.infer<typeof priceTableSchema>;

export interface QuoteQuery {
  checkin: string;
  checkout: string;
  adults: number;
  childrenAges?: number[];
  /** Filtra por nome de acomodação (opcional). */
  unit?: string | null;
}

function toDate(value: string): Date | null {
  return parseBrDate(value);
}

function isoNights(checkin: Date, checkout: Date): string[] {
  const out: string[] = [];
  for (let t = checkin.getTime(); t < checkout.getTime(); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** Período da noite: o intervalo que contém a data e começou por último; sem intervalo, o período padrão. */
export function periodForNight(table: PriceTableData, night: string): string {
  let best: { id: string; start: string } | null = null;
  for (const p of table.periods) {
    for (const [start, end] of p.ranges) {
      if (start <= night && night <= end && (!best || start > best.start)) best = { id: p.id, start };
    }
  }
  return best?.id ?? table.default_period;
}

const brDate = (iso: string) => iso.split("-").reverse().join("/");

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Acrescenta o sinal (percentual do total) a cada opção, calculado aqui — nunca pela IA. */
export function withDeposit<T extends object>(result: T, percent: number | null, currency = "BRL"): T {
  const opcoes = (result as { opcoes?: Array<{ total: number }> }).opcoes;
  if (!percent || !Array.isArray(opcoes)) return result;
  return {
    ...result,
    opcoes: opcoes.map((o) => {
      const sinal = Math.round(o.total * percent) / 100;
      return { ...o, sinal, sinal_formatado: formatMoney(sinal, currency), sinal_percentual: percent };
    }),
  };
}

export function quoteStay(table: PriceTableData, q: QuoteQuery, currency = "BRL") {
  const checkin = toDate(q.checkin);
  const checkout = toDate(q.checkout);
  if (!checkin || !checkout) return { erro: "Datas devem estar no formato DD/MM/AAAA." };
  const nights = isoNights(checkin, checkout);
  if (nights.length < 1) return { erro: "A data de saída deve ser depois da entrada." };
  if (nights.length > 60) return { erro: "Período máximo de 60 noites." };
  const adults = Math.max(1, Math.trunc(Number(q.adults) || 0));
  const ages = (q.childrenAges ?? []).map((a) => Math.trunc(Number(a))).filter((a) => a >= 0 && a <= 17);
  const guests = adults + ages.length;

  const closedHits = (table.closed ?? []).filter((c) => nights.some((n) => c.from <= n && n <= c.to));
  if (closedHits.length) {
    const when = closedHits.map((c) => `${c.name}: ${brDate(c.from)} a ${brDate(c.to)}`).join("; ");
    return {
      checkin: q.checkin,
      checkout: q.checkout,
      noites: nights.length,
      fechado: true,
      periodos_fechados: when,
      opcoes: [],
      observacao: `O hotel estará fechado nessas datas (${when}). Não cote nem ofereça reserva para elas; informe o fechamento e sugira datas fora desse período.`,
    };
  }

  const periodOf = nights.map((n) => periodForNight(table, n));
  const periodName = (id: string) => table.periods.find((p) => p.id === id)?.name ?? id;
  const minNights = Math.max(1, ...[...new Set(periodOf)].map((id) => table.periods.find((p) => p.id === id)?.min_nights ?? 1));

  const options = [];
  const notFitting: string[] = [];
  for (const unit of table.units) {
    if (q.unit && !norm(unit.name).includes(norm(q.unit)) && !norm(q.unit).includes(norm(unit.name))) continue;
    if (guests > unit.max_guests) {
      notFitting.push(unit.name);
      continue;
    }
    const row = [...unit.rates].sort((a, b) => a.guests - b.guests).find((r) => {
      if (r.guests < guests) return false;
      if (r.max_adults) {
        const limit = r.child_max_age ?? 17;
        const effectiveAdults = adults + ages.filter((a) => a > limit).length;
        if (effectiveAdults > r.max_adults) return false;
      }
      return true;
    });
    if (!row) {
      notFitting.push(unit.name);
      continue;
    }
    if (periodOf.some((p) => row.prices[p] === undefined)) continue;
    const byPeriod = new Map<string, { periodo: string; noites: number; diaria: number; subtotal: number }>();
    for (const p of periodOf) {
      const cur = byPeriod.get(p) ?? { periodo: periodName(p), noites: 0, diaria: row.prices[p], subtotal: 0 };
      cur.noites++;
      cur.subtotal += row.prices[p];
      byPeriod.set(p, cur);
    }
    const total = [...byPeriod.values()].reduce((s, b) => s + b.subtotal, 0);
    options.push({
      acomodacao: unit.name,
      product_ids: unit.product_ids,
      pms_category_ids: unit.pms_category_ids ?? [],
      tarifa: row.label ?? `até ${row.guests} pessoa(s)`,
      total,
      total_formatado: formatMoney(total, currency),
      detalhamento: [...byPeriod.values()].map((b) => ({ ...b, diaria_formatada: formatMoney(b.diaria, currency), subtotal_formatado: formatMoney(b.subtotal, currency) })),
    });
  }
  options.sort((a, b) => a.total - b.total);

  return {
    checkin: q.checkin,
    checkout: q.checkout,
    noites: nights.length,
    adultos: adults,
    idades_criancas: ages,
    hospedes: guests,
    periodos: [...new Set(periodOf)].map(periodName),
    estadia_minima: minNights,
    atende_estadia_minima: nights.length >= minNights,
    opcoes: options,
    ...(options.length ? {} : { sem_opcao: `Nenhuma acomodação da tabela comporta ${guests} pessoa(s) com essas idades.` }),
    ...(notFitting.length ? { nao_comportam: notFitting } : {}),
    observacao: "Valores calculados pela tabela de preços oficial do hotel. Informe-os exatamente como estão. Este cálculo NÃO confirma disponibilidade: a vaga é confirmada no site de reservas ou pela equipe.",
  };
}

interface PmsRoom { category_id?: number | null; available_units: number | null }
type TableQuote = ReturnType<typeof quoteStay>;

/**
 * Vaga pelo PMS, preço pela tabela: cada opção da tabela recebe as unidades livres das suas categorias.
 * Opções sem categoria vinculada ficam como "não verificadas" (o hóspede confirma no link).
 */
export function mergeAvailability(quote: TableQuote, rooms: PmsRoom[]) {
  const opcoes = (quote as { opcoes?: Array<{ acomodacao: string; pms_category_ids?: number[] }> }).opcoes ?? [];
  const free = new Map<number, number>();
  for (const r of rooms) if (r.category_id) free.set(r.category_id, (free.get(r.category_id) ?? 0) + Math.max(0, r.available_units ?? 1));
  const disponiveis = [];
  const sem_vaga: string[] = [];
  const nao_verificadas = [];
  for (const { pms_category_ids: ids = [], ...o } of opcoes as Array<{ acomodacao: string; pms_category_ids?: number[] }>) {
    if (!ids.length) {
      nao_verificadas.push(o);
      continue;
    }
    const units = ids.reduce((sum, id) => sum + (free.get(id) ?? 0), 0);
    if (units > 0) disponiveis.push({ ...o, unidades_disponiveis: units });
    else sem_vaga.push(o.acomodacao);
  }
  return {
    ...quote,
    opcoes: disponiveis,
    disponibilidade_confirmada: disponiveis.length > 0,
    ...(sem_vaga.length ? { sem_vaga } : {}),
    ...(nao_verificadas.length ? { nao_verificadas } : {}),
    observacao: disponiveis.length
      ? "Vaga confirmada agora no sistema do hotel para as opcoes listadas; valores da tabela de preços oficial (informe exatamente como estão). As acomodações em sem_vaga estão lotadas nessas datas."
      : "Nenhuma acomodação que comporta o grupo tem vaga nessas datas no sistema do hotel. Informe isso e sugira outras datas.",
  };
}

/** Tira os ids de categoria do PMS do resultado mostrado à IA (só servem para o cruzamento). */
export function stripPmsIds<T>(result: T): T {
  const opcoes = (result as { opcoes?: unknown[] } | null)?.opcoes;
  if (!Array.isArray(opcoes)) return result;
  return { ...result, opcoes: opcoes.map((o) => {
    const { pms_category_ids: _ids, ...rest } = o as { pms_category_ids?: unknown };
    return rest;
  }) } as T;
}
