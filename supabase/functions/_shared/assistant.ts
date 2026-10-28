// Assistente do painel: entende pedidos em linguagem natural ("kitnet na alta vai para 450", "fechado de 21/06 a
// 22/09") e transforma em operações validadas sobre os fatos estruturados. Nada é gravado sem confirmação.
import type { ToolDefinition } from "./ai.ts";
import { formatMoney } from "./agent-core.ts";
import { type PriceTableData, priceTableSchema, priceTableSummary } from "./pricing.ts";

// ---------------------------------------------------------------------------
// Operações sobre a tabela de preços
// ---------------------------------------------------------------------------
export type PriceOp =
  | { op: "set_price"; unit: string; period: string; price: number; guests?: number; label?: string }
  | { op: "set_period"; period: string; name?: string; ranges?: Array<[string, string]>; min_nights?: number | null }
  /** Ajusta uma faixa de datas do período: `match` é uma data dentro da faixa; `from`/`to` são os novos limites. */
  | { op: "set_range"; period: string; match: string; from?: string; to?: string }
  | { op: "remove_period"; period: string }
  | { op: "add_closed"; name?: string; from: string; to: string }
  | { op: "remove_closed"; name?: string; from?: string; to?: string }
  | { op: "set_max_guests"; unit: string; max_guests: number }
  | { op: "set_child_rule"; unit: string; child_max_age: number; guests?: number; max_adults?: number; label?: string; copy_prices_from_guests?: number };

export class AssistantError extends Error {}

const FIELD_MAP: Record<string, string> = {
  acomodacao: "unit", periodo: "period", diaria: "price", pessoas: "guests", tarifa: "label", nome: "name", faixas: "ranges",
  minimo_diarias: "min_nights", data_na_faixa: "match", inicio: "from", fim: "to", capacidade: "max_guests", adultos: "max_adults",
  idade_max_crianca: "child_max_age",
};

/** Aceita os campos em português da ferramenta (e os internos) e descarta lixo óbvio. */
export function normalizeOp(raw: Record<string, unknown>): PriceOp {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === null || v === undefined || v === "") continue;
    out[FIELD_MAP[k] ?? k] = v;
  }
  if (typeof out.unit === "string" && /^r\$?$/i.test(out.unit.trim())) delete out.unit;
  if (typeof out.price === "string") out.price = Number(String(out.price).replace(/[^\d,.-]/g, "").replace(",", "."));
  return out as PriceOp;
}

const norm = (s: string | null | undefined) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const slug = (s: string) => norm(s).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || "periodo";

/** "DD/MM/AAAA" ou "AAAA-MM-DD" → "AAAA-MM-DD". */
export function toIsoDate(value: string): string {
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (!m) throw new AssistantError(`Data inválida: "${value}". Use DD/MM/AAAA.`);
  const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) throw new AssistantError(`Data inexistente: "${value}".`);
  return iso;
}
export const brDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

function findUnit(table: PriceTableData, name: string) {
  if (!name) throw new AssistantError("Informe a acomodação.");
  const n = norm(name);
  const exact = table.units.find((u) => norm(u.name) === n);
  const partial = table.units.filter((u) => norm(u.name).includes(n) || n.includes(norm(u.name)) || norm(u.name).split(/\D+/).includes(n));
  const unit = exact ?? (partial.length === 1 ? partial[0] : undefined);
  if (!unit) {
    throw new AssistantError(partial.length > 1
      ? `Mais de uma acomodação combina com "${name}": ${partial.map((u) => u.name).join(", ")}. Diga qual.`
      : `Acomodação "${name}" não encontrada. Existem: ${table.units.map((u) => u.name).join(", ")}.`);
  }
  return unit;
}

function findPeriod(table: PriceTableData, ref: string) {
  if (!ref) throw new AssistantError(`Informe o período. Existem: ${table.periods.map((x) => x.name).join(", ")}.`);
  const n = norm(ref);
  const p = table.periods.find((x) => x.id === ref || norm(x.name) === n) ?? table.periods.find((x) => norm(x.name).includes(n) || n.includes(norm(x.name)));
  if (!p) throw new AssistantError(`Período "${ref}" não encontrado. Existem: ${table.periods.map((x) => `${x.name} (${x.id})`).join(", ")}.`);
  return p;
}

function findRate(unit: PriceTableData["units"][number], guests?: number, label?: string) {
  if (label) {
    const n = norm(label);
    const r = unit.rates.find((x) => norm(x.label ?? "") === n) ?? unit.rates.find((x) => norm(x.label ?? "").includes(n));
    if (r) return r;
  }
  if (guests !== undefined) {
    const r = unit.rates.find((x) => x.guests === guests && !x.max_adults) ?? unit.rates.find((x) => x.guests === guests);
    if (r) return r;
  }
  if (unit.rates.length === 1 && !label && guests === undefined) return unit.rates[0];
  throw new AssistantError(`Em "${unit.name}" há estas tarifas: ${unit.rates.map((r) => r.label ?? `até ${r.guests} pessoa(s)`).join("; ")}. Diga para qual delas.`);
}

/** Aplica as operações numa cópia e devolve a tabela nova (validada) e as linhas "de → para". */
export function applyPriceOps(current: PriceTableData, ops: PriceOp[], currency = "BRL"): { table: PriceTableData; changes: string[] } {
  if (!ops.length) throw new AssistantError("Nenhuma alteração informada.");
  const table = structuredClone(current) as PriceTableData;
  const changes: string[] = [];
  const money = (v: number) => formatMoney(v, currency);
  // O modelo às vezes repete a mesma operação na mesma chamada.
  const seen = new Set<string>();
  for (const rawOp of ops) {
    const op = normalizeOp(rawOp as unknown as Record<string, unknown>);
    const key = JSON.stringify(op);
    if (seen.has(key)) continue;
    seen.add(key);
    switch (op.op) {
      case "set_price": {
        const unit = findUnit(table, op.unit);
        const period = findPeriod(table, op.period);
        const rate = findRate(unit, op.guests, op.label);
        if (!(op.price >= 0)) throw new AssistantError("Valor inválido.");
        const before = rate.prices[period.id];
        rate.prices[period.id] = op.price;
        changes.push(`${unit.name}, ${rate.label ?? `até ${rate.guests} pessoa(s)`}, ${period.name}: ${before === undefined ? "sem valor" : money(before)} → ${money(op.price)}`);
        break;
      }
      case "set_period": {
        let period = table.periods.find((x) => x.id === op.period || norm(x.name) === norm(op.period));
        if (!period) {
          if (!op.ranges?.length) throw new AssistantError(`Período "${op.period}" não existe; para criar, informe as datas.`);
          period = { id: slug(op.name ?? op.period), name: op.name ?? op.period, ranges: [], min_nights: op.min_nights ?? null };
          table.periods.push(period);
          changes.push(`Período novo: ${period.name}`);
        }
        if (op.name && op.name !== period.name) {
          changes.push(`Período ${period.name}: nome → ${op.name}`);
          period.name = op.name;
        }
        if (op.ranges) {
          const ranges = op.ranges.map(([a, b]) => [toIsoDate(a), toIsoDate(b)] as [string, string]);
          for (const [a, b] of ranges) if (a > b) throw new AssistantError(`Intervalo invertido: ${brDate(a)} a ${brDate(b)}.`);
          const fmt = (rs: Array<[string, string]>) => rs.map(([a, b]) => `${brDate(a)} a ${brDate(b)}`).join("; ") || "sem datas";
          changes.push(`${period.name}, datas: ${fmt(period.ranges)} → ${fmt(ranges)}`);
          period.ranges = ranges;
        }
        if (op.min_nights !== undefined && op.min_nights !== period.min_nights) {
          changes.push(`${period.name}, mínimo de diárias: ${period.min_nights ?? 1} → ${op.min_nights ?? 1}`);
          period.min_nights = op.min_nights;
        }
        break;
      }
      case "set_range": {
        const period = findPeriod(table, op.period);
        const match = toIsoDate(op.match);
        const idx = period.ranges.findIndex(([a, b]) => a <= match && match <= b);
        if (idx < 0) throw new AssistantError(`${period.name} não tem faixa que inclua ${brDate(match)}. Faixas: ${period.ranges.map(([a, b]) => `${brDate(a)} a ${brDate(b)}`).join("; ") || "nenhuma"}.`);
        const [a0, b0] = period.ranges[idx];
        const a = op.from ? toIsoDate(op.from) : a0;
        const b = op.to ? toIsoDate(op.to) : b0;
        if (a > b) throw new AssistantError(`Faixa invertida: ${brDate(a)} a ${brDate(b)}.`);
        if (a !== a0 || b !== b0) changes.push(`${period.name}, faixa ${brDate(a0)} a ${brDate(b0)} → ${brDate(a)} a ${brDate(b)}`);
        period.ranges[idx] = [a, b];
        break;
      }
      case "remove_period": {
        const period = findPeriod(table, op.period);
        if (period.id === table.default_period) throw new AssistantError(`"${period.name}" é o período padrão e não pode ser removido.`);
        table.periods = table.periods.filter((p) => p.id !== period.id);
        for (const u of table.units) for (const r of u.rates) delete r.prices[period.id];
        changes.push(`Período removido: ${period.name}`);
        break;
      }
      case "add_closed": {
        if (!op.from || !op.to) throw new AssistantError("Informe o início e o fim do fechamento.");
        const from = toIsoDate(op.from);
        const to = toIsoDate(op.to);
        if (from > to) throw new AssistantError(`Fechamento invertido: ${brDate(from)} a ${brDate(to)}.`);
        // Sem nome: atualiza o único fechamento existente (caso comum: "em vez de 21/06 a 22/09") ou cria "Fechado".
        const overlaps = (c: { from: string; to: string }) => c.from <= to && from <= c.to;
        const existing = op.name ? table.closed.find((c) => norm(c.name) === norm(op.name)) : table.closed.find(overlaps) ?? (table.closed.length === 1 ? table.closed[0] : undefined);
        op.name = op.name || existing?.name || "Fechado";
        if (existing) {
          changes.push(`Fechado (${existing.name}): ${brDate(existing.from)} a ${brDate(existing.to)} → ${brDate(from)} a ${brDate(to)}`);
          existing.from = from;
          existing.to = to;
        } else {
          table.closed.push({ name: op.name, from, to });
          changes.push(`Fechado (novo): ${op.name}, ${brDate(from)} a ${brDate(to)}`);
        }
        break;
      }
      case "remove_closed": {
        const byDates = op.from || op.to ? table.closed.find((x) => (!op.from || x.from === toIsoDate(op.from!)) && (!op.to || x.to === toIsoDate(op.to!))) : undefined;
        const c = byDates ?? (op.name ? table.closed.find((x) => norm(x.name) === norm(op.name) || norm(x.name).includes(norm(op.name))) : table.closed.length === 1 ? table.closed[0] : undefined);
        if (!c && !op.name && table.closed.length > 1) throw new AssistantError(`Qual fechamento remover? Existem: ${table.closed.map((x) => `${x.name} (${brDate(x.from)} a ${brDate(x.to)})`).join(", ")}.`);
        if (!c) throw new AssistantError(`Fechamento "${op.name}" não encontrado. Existem: ${table.closed.map((x) => x.name).join(", ") || "nenhum"}.`);
        table.closed = table.closed.filter((x) => x !== c);
        changes.push(`Fechamento removido: ${c.name} (${brDate(c.from)} a ${brDate(c.to)})`);
        break;
      }
      case "set_max_guests": {
        const unit = findUnit(table, op.unit);
        if (unit.max_guests !== op.max_guests) changes.push(`${unit.name}, capacidade: ${unit.max_guests} → ${op.max_guests} pessoas`);
        unit.max_guests = op.max_guests;
        break;
      }
      case "set_child_rule": {
        const unit = findUnit(table, op.unit);
        if (!(op.child_max_age >= 0 && op.child_max_age <= 17)) throw new AssistantError("Idade máxima da criança deve ser de 0 a 17 anos.");
        const existing = (op.guests ? unit.rates.find((r) => r.guests === op.guests && r.max_adults) : undefined) ?? unit.rates.find((r) => r.max_adults);
        const plainMax = Math.max(0, ...unit.rates.filter((r) => !r.max_adults).map((r) => r.guests));
        const maxAdults = op.max_adults ?? existing?.max_adults ?? plainMax;
        const guests = op.guests ?? existing?.guests ?? maxAdults + 1;
        if (guests <= maxAdults) throw new AssistantError("O total de pessoas precisa ser maior que o número de adultos.");
        const kids = guests - maxAdults;
        const label = op.label ?? `${maxAdults} adulto${maxAdults > 1 ? "s" : ""} + ${kids} criança${kids > 1 ? "s" : ""} de até ${op.child_max_age} anos`;
        if (existing) {
          if (existing.label !== label || existing.max_adults !== maxAdults || existing.child_max_age !== op.child_max_age || existing.guests !== guests) {
            changes.push(`${unit.name}: regra "${existing.label}" → "${label}"`);
          }
          Object.assign(existing, { guests, label, max_adults: maxAdults, child_max_age: op.child_max_age });
        } else {
          const source = unit.rates.find((r) => r.guests === (op.copy_prices_from_guests ?? maxAdults)) ?? unit.rates[unit.rates.length - 1];
          unit.rates.push({ guests, label, max_adults: maxAdults, child_max_age: op.child_max_age, prices: { ...source.prices } });
          changes.push(`${unit.name}: tarifa nova "${label}" (valores iguais a "${source.label ?? `até ${source.guests}`}")`);
        }
        if (unit.max_guests < guests) {
          changes.push(`${unit.name}, capacidade: ${unit.max_guests} → ${guests} pessoas`);
          unit.max_guests = guests;
        }
        break;
      }
      default:
        throw new AssistantError(`Operação desconhecida: ${(op as { op: string }).op}`);
    }
  }
  const parsed = priceTableSchema.safeParse(table);
  if (!parsed.success) throw new AssistantError(`Tabela ficaria inválida: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return { table: parsed.data, changes };
}

// ---------------------------------------------------------------------------
// Horário de atendimento
// ---------------------------------------------------------------------------
export type Hours = Record<string, Array<[string, string]>>;
const DAYS: Array<[string, string]> = [["mon", "segunda"], ["tue", "terça"], ["wed", "quarta"], ["thu", "quinta"], ["fri", "sexta"], ["sat", "sábado"], ["sun", "domingo"]];
const DAY_ALIASES: Record<string, string> = { seg: "mon", segunda: "mon", ter: "tue", terca: "tue", qua: "wed", quarta: "wed", qui: "thu", quinta: "thu", sex: "fri", sexta: "fri", sab: "sat", sabado: "sat", dom: "sun", domingo: "sun", mon: "mon", tue: "tue", wed: "wed", thu: "thu", fri: "fri", sat: "sat", sun: "sun" };

export function parseDay(d: string): string {
  const key = DAY_ALIASES[norm(d).replace(/-feira$/, "")];
  if (!key) throw new AssistantError(`Dia inválido: "${d}".`);
  return key;
}

export function formatHours(h: Hours): string {
  return DAYS.map(([k, label]) => `${label}: ${(h[k] ?? []).map(([a, b]) => `${a}–${b}`).join(", ") || "fechado"}`).join("; ");
}

/** Aplica intervalos por dia ("todos" = os 7). Vazio em um dia = sem atendimento. */
export function applyHours(current: Hours, changes: Array<{ days: string[]; ranges: Array<[string, string]> }>): { hours: Hours; changes: string[] } {
  const hours: Hours = structuredClone(current ?? {});
  const lines: string[] = [];
  for (const c of changes) {
    const days = c.days.some((d) => /^(todos|todo dia|diariamente|all)$/i.test(norm(d))) ? DAYS.map(([k]) => k) : c.days.map(parseDay);
    for (const [a, b] of c.ranges) if (!/^\d{2}:\d{2}$/.test(a) || !/^\d{2}:\d{2}$/.test(b)) throw new AssistantError(`Horário inválido: ${a}–${b}. Use HH:MM.`);
    for (const d of days) {
      const before = (hours[d] ?? []).map(([a, b]) => `${a}–${b}`).join(", ") || "fechado";
      const after = c.ranges.map(([a, b]) => `${a}–${b}`).join(", ") || "fechado";
      if (before !== after) lines.push(`${DAYS.find(([k]) => k === d)![1]}: ${before} → ${after}`);
      hours[d] = c.ranges;
    }
  }
  return { hours, changes: lines };
}

// ---------------------------------------------------------------------------
// Ferramentas e prompt
// ---------------------------------------------------------------------------
export const SCREENS: Array<{ id: string; label: string; to: string; what: string }> = [
  { id: "atendimento", label: "Atendimento", to: "/agent", what: "nome do agente, persona, regras de comportamento, segmento, emojis, modelo, horário da equipe, mensagem fora do horário, palavras-chave de transferência, simulador" },
  { id: "empresa", label: "Informações da empresa → Empresa", to: "/knowledge-base?tab=empresa", what: "razão social, CNPJ, endereço, telefone, dados de pagamento, PIX, sinal, link de pré-reserva" },
  { id: "politicas", label: "Informações da empresa → Políticas", to: "/knowledge-base?tab=politicas", what: "check-in, check-out, cancelamento, crianças, animais, comodidades, localização" },
  { id: "precos", label: "Informações da empresa → Catálogo e preços", to: "/knowledge-base?tab=catalog", what: "acomodações/produtos, tabela de preços, temporadas, fechamentos, capacidade" },
  { id: "fotos", label: "Informações da empresa → Fotos", to: "/knowledge-base?tab=fotos", what: "álbuns de fotos que o agente envia" },
  { id: "faq", label: "Informações da empresa → Perguntas e respostas", to: "/knowledge-base?tab=faq", what: "perguntas frequentes" },
  { id: "documentos", label: "Informações da empresa → Documentos e site", to: "/knowledge-base?tab=docs", what: "PDFs, textos, páginas do site, Instagram" },
  { id: "integracoes", label: "Integrações", to: "/integrations", what: "WhatsApp (QR code), Hospedin, hbook, link de reserva" },
  { id: "equipe", label: "Equipe", to: "/team", what: "convidar pessoas, papéis" },
  { id: "inbox", label: "Inbox", to: "/inbox", what: "conversas, assumir, devolver ao bot" },
  { id: "configuracoes", label: "Configurações", to: "/settings", what: "plano, assinatura, identidade visual" },
];

export const ASSISTANT_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "navegar",
      description: "Indica a tela do painel onde algo é visto ou alterado, quando o pedido não é uma alteração que você possa propor.",
      parameters: { type: "object", properties: { tela: { type: "string", enum: SCREENS.map((s) => s.id) }, motivo: { type: "string" } }, required: ["tela"] },
    },
  },
  {
    type: "function",
    function: {
      name: "propor_tabela_precos",
      description: [
        "Propõe alterações na tabela de preços. Cada operação é um objeto com \"op\" e os campos daquela operação, usando os NOMES EXATOS listados no contexto.",
        "Exemplos: {\"op\":\"set_price\",\"acomodacao\":\"Kitnet\",\"periodo\":\"alta\",\"diaria\":450}",
        "{\"op\":\"set_price\",\"acomodacao\":\"Apartamentos 205 e 206\",\"periodo\":\"pascoa\",\"diaria\":900}",
        "{\"op\":\"set_range\",\"periodo\":\"alta\",\"data_na_faixa\":\"20/01/2027\",\"fim\":\"10/02/2027\"}",
        "{\"op\":\"add_closed\",\"nome\":\"Inverno\",\"inicio\":\"15/06/2027\",\"fim\":\"30/09/2027\"}",
        "{\"op\":\"set_child_rule\",\"acomodacao\":\"Apartamentos 210 a 212\",\"idade_max_crianca\":12}",
      ].join(" "),
      parameters: {
        type: "object",
        properties: {
          operacoes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                op: { type: "string", enum: ["set_price", "set_period", "set_range", "remove_period", "add_closed", "remove_closed", "set_max_guests", "set_child_rule"], description: "set_price: muda a diária. set_range: muda início/fim de UMA faixa de datas do período. set_period: substitui todas as faixas e/ou o mínimo de diárias. remove_period: só se pedirem para remover. add_closed/remove_closed: fechamentos. set_max_guests: capacidade. set_child_rule: idade máxima da criança." },
                acomodacao: { type: "string", description: "Nome exato da acomodação (ex.: \"Kitnet\", \"Apartamentos 205 e 206\"). Obrigatório em set_price, set_max_guests, set_child_rule." },
                periodo: { type: "string", description: "Id ou nome do período (ex.: \"alta\", \"Pacote de Páscoa\"). Obrigatório em set_price, set_period, set_range, remove_period." },
                diaria: { type: "number", description: "Novo valor da diária em reais (só o número). set_price." },
                pessoas: { type: "integer", description: "Qual tarifa, pelo número de pessoas, quando a acomodação tem mais de uma (ex.: 2 ou 3). set_price." },
                tarifa: { type: "string", description: "Qual tarifa, pelo rótulo exato (ex.: \"3 adultos + 1 criança de até 5 anos\"). set_price." },
                data_na_faixa: { type: "string", description: "set_range: uma data (DD/MM/AAAA) dentro da faixa que vai mudar." },
                inicio: { type: "string", description: "Data inicial DD/MM/AAAA (set_range, add_closed, remove_closed)." },
                fim: { type: "string", description: "Data final DD/MM/AAAA (set_range, add_closed, remove_closed)." },
                nome: { type: "string", description: "Nome do fechamento (add_closed/remove_closed) ou do período novo (set_period)." },
                faixas: { type: "array", items: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 2 }, description: "set_period: TODAS as faixas [inicio, fim] do período, inclusive as que não mudam." },
                minimo_diarias: { type: ["integer", "null"], description: "set_period: mínimo de diárias." },
                capacidade: { type: "integer", description: "set_max_guests: total de pessoas." },
                adultos: { type: "integer", description: "set_child_rule: máximo de adultos (opcional)." },
                idade_max_crianca: { type: "integer", description: "set_child_rule: idade máxima da criança, 0 a 17." },
              },
              required: ["op"],
            },
          },
        },
        required: ["operacoes"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propor_horario",
      description: "Propõe o horário em que a equipe humana atende (afeta só o que o agente diz ao transferir fora do horário) e a mensagem fora do horário.",
      parameters: {
        type: "object",
        properties: {
          dias: { type: "array", items: { type: "object", properties: { days: { type: "array", items: { type: "string" } }, ranges: { type: "array", items: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 2 } } }, required: ["days", "ranges"] } },
          mensagem_fora_do_horario: { type: ["string", "null"] },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propor_politica",
      description: "Cria ou altera uma política/informação oficial da empresa (check-in, cancelamento, animais...). Para alterar, informe o id da política existente.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" }, topic: { type: "string" }, title: { type: "string" }, content: { type: "string" } },
        required: ["topic", "title", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propor_regras",
      description: "Propõe o texto completo das regras de comportamento do agente (como ele age, não fatos do negócio).",
      parameters: { type: "object", properties: { texto: { type: "string" } }, required: ["texto"] },
    },
  },
];

export interface AssistantFacts {
  agentName: string;
  businessName: string;
  priceTable: PriceTableData | null;
  currency: string;
  policies: Array<{ id: string; topic: string; title: string; content: string }>;
  businessHours: Hours;
  outOfHoursMessage: string | null;
  guardrails: string | null;
  timezone: string;
}

export function buildAssistantPrompt(f: AssistantFacts, now = new Date()): string {
  const screens = SCREENS.map((s) => `- ${s.id}: ${s.label} — ${s.what}`).join("\n");
  const table = f.priceTable
    ? [
      "Identificadores para as operações (use exatamente):",
      `- Períodos: ${f.priceTable.periods.map((p) => `"${p.name}" (id ${p.id}${p.min_nights ? `, mínimo ${p.min_nights}` : ""})`).join("; ")}; período padrão: ${f.priceTable.default_period}`,
      `- Acomodações: ${f.priceTable.units.map((u) => `"${u.name}" [tarifas: ${u.rates.map((r) => `${r.label ?? `até ${r.guests}`} (guests ${r.guests})`).join(", ")}]`).join("; ")}`,
      `- Fechamentos: ${f.priceTable.closed.map((c) => `"${c.name}" ${c.from} a ${c.to}`).join("; ") || "nenhum"}`,
      "",
      priceTableSummary(f.priceTable, f.currency),
    ].join("\n")
    : "Sem tabela de preços cadastrada (crie em Catálogo e preços).";
  const policies = f.policies.length ? f.policies.map((p) => `- [${p.id}] ${p.topic} — ${p.title}: ${p.content}`).join("\n") : "- nenhuma";
  return [
    `Você é o assistente de configuração do Callia para a empresa "${f.businessName}", ajudando o administrador a ajustar o atendimento do agente "${f.agentName}". Hoje é ${now.toLocaleDateString("pt-BR", { timeZone: f.timezone })}.`,
    "",
    "Como agir:",
    "- Responda em português, curto e direto, como um colega que conhece o sistema.",
    "- Para alterar valores, datas de temporada, fechamentos, capacidade, horário da equipe, políticas ou regras: chame a ferramenta propor_* com os dados exatos. A proposta é mostrada ao administrador, que confirma ou descarta; você nunca grava diretamente. Depois de chamar a ferramenta, diga em uma frase o que propôs e peça para confirmar no cartão.",
    "- Se faltar um dado (qual acomodação, qual período, qual valor, de quando a quando), pergunte antes de propor. Não chute.",
    "- Quando o administrador afirma um fato diferente do cadastrado (\"a alta termina 10/02\", \"o check-out é 11h\"), isso é um pedido de alteração: proponha a mudança. Nunca o corrija com o valor atual.",
    "- Um pedido com várias mudanças vira uma única chamada de ferramenta com todas as operações. Não repita a mesma proposta.",
    "- Datas de temporada: para mudar o início ou o fim de uma faixa (\"a alta de janeiro termina 10/02\"), use set_range com match = uma data da faixa atual e o novo from/to. Nunca remova um período para isso.",
    "- Fechamentos: para trocar as datas de um fechamento existente, use add_closed com o nome dele (ex.: \"Inverno\") e as datas novas.",
    "- Valores em reais são por diária. Datas em DD/MM/AAAA; se o ano não for dito, use a temporada em andamento ou a próxima (os períodos cadastrados ajudam).",
    "- Para 'onde eu mudo X' ou algo que você não altera (fotos, documentos, dados da empresa, integrações, equipe, plano): use a ferramenta navegar.",
    "- Mudanças de fatos nunca vão para as regras do agente; vão para políticas ou tabela de preços.",
    "",
    "Telas do painel:",
    screens,
    "",
    "# Tabela de preços atual",
    table,
    "",
    "# Políticas atuais",
    policies,
    "",
    `# Horário da equipe (${f.timezone}): ${Object.keys(f.businessHours ?? {}).length ? formatHours(f.businessHours) : "não definido (o agente responde 24 h)"}`,
    `Mensagem fora do horário: ${f.outOfHoursMessage?.trim() || "(nenhuma)"}`,
    "",
    "# Regras de comportamento do agente",
    f.guardrails?.trim() || "(nenhuma)",
  ].join("\n");
}
