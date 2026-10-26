// Tabela de preços estruturada: tipos, modelo do editor e validação (espelha priceTableSchema do backend).

export interface PricePeriod { id: string; name: string; min_nights?: number | null; ranges: Array<[string, string]> }
export interface PriceRate { guests: number; label?: string; max_adults?: number | null; child_max_age?: number | null; prices: Record<string, number> }
export interface PriceUnit { name: string; product_ids: string[]; pms_category_ids?: number[]; max_guests: number; rates: PriceRate[] }
export interface ClosedPeriod { name: string; from: string; to: string }
export interface PriceTableData { default_period: string; periods: PricePeriod[]; units: PriceUnit[]; notes: string[]; closed?: ClosedPeriod[] }
export interface PriceTable { id: string; name: string; currency: string; updated_at: string; data: PriceTableData }

// ---------------------------------------------------------------- Modelo do editor
// Campos numéricos ficam como texto enquanto o admin digita; preços são indexados pela chave local do período,
// e os ids definitivos só são calculados ao salvar (ids de períodos existentes não mudam ao renomear).
export interface EditorPeriod { key: string; id: string | null; name: string; min_nights: string; ranges: Array<[string, string]> }
export interface EditorRate { key: string; guests: string; label: string; childRule: boolean; max_adults: string; child_max_age: string; prices: Record<string, string> }
export interface EditorUnit { key: string; name: string; max_guests: string; product_ids: string[]; pms_category_ids: number[]; rates: EditorRate[] }
export interface EditorClosed { key: string; name: string; from: string; to: string }
export interface EditorModel { name: string; defaultKey: string; periods: EditorPeriod[]; units: EditorUnit[]; notes: string[]; closed: EditorClosed[] }

let seq = 0;
export const newKey = (prefix: string) => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;

/** "1.500,00" / "1500,5" / "1500.50" → número; vazio ou inválido → null. */
export function parseBRL(value: string): number | null {
  const v = value.replace(/[R$\s]/g, "").trim();
  if (!v) return null;
  const normalized = v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return Number(normalized);
}

export function formatBRLInput(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function slugId(name: string, taken: Set<string>): string {
  const base = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 26) || "periodo";
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`.slice(0, 30);
  return id;
}

export function toEditor(name: string, data: PriceTableData): EditorModel {
  const keyById = new Map<string, string>();
  const periods: EditorPeriod[] = data.periods.map((p) => {
    const key = newKey("p");
    keyById.set(p.id, key);
    return { key, id: p.id, name: p.name, min_nights: p.min_nights ? String(p.min_nights) : "", ranges: p.ranges.map(([a, b]) => [a, b] as [string, string]) };
  });
  return {
    name,
    defaultKey: keyById.get(data.default_period) ?? periods[0]?.key ?? "",
    periods,
    units: data.units.map((u) => ({
      key: newKey("u"),
      name: u.name,
      max_guests: String(u.max_guests),
      product_ids: [...(u.product_ids ?? [])],
      pms_category_ids: [...(u.pms_category_ids ?? [])],
      rates: u.rates.map((r) => ({
        key: newKey("r"),
        guests: String(r.guests),
        label: r.label ?? "",
        childRule: Boolean(r.max_adults),
        max_adults: r.max_adults ? String(r.max_adults) : "",
        child_max_age: r.child_max_age !== null && r.child_max_age !== undefined ? String(r.child_max_age) : "",
        prices: Object.fromEntries(Object.entries(r.prices).flatMap(([id, v]) => (keyById.has(id) ? [[keyById.get(id)!, formatBRLInput(v)]] : []))),
      })),
    })),
    notes: [...(data.notes ?? [])],
    closed: (data.closed ?? []).map((c) => ({ key: newKey("c"), ...c })),
  };
}

/** Tabela inicial: um período padrão e uma acomodação com uma tarifa. */
export function starterEditor(): EditorModel {
  const period: EditorPeriod = { key: newKey("p"), id: "baixa", name: "Baixa temporada", min_nights: "5", ranges: [] };
  return {
    name: "Tabela de preços",
    defaultKey: period.key,
    periods: [period],
    units: [{ key: newKey("u"), name: "", max_guests: "2", product_ids: [], pms_category_ids: [], rates: [emptyRate()] }],
    notes: [],
    closed: [],
  };
}

export function emptyRate(): EditorRate {
  return { key: newKey("r"), guests: "2", label: "", childRule: false, max_adults: "", child_max_age: "", prices: {} };
}

export interface EditorIssue { field: string; message: string }

const int = (v: string, min: number, max: number) => {
  const n = Number(v.trim());
  return v.trim() !== "" && Number.isInteger(n) && n >= min && n <= max ? n : null;
};

/** Valida e converte o modelo do editor para o formato salvo. `field` aponta o campo com problema. */
export function fromEditor(model: EditorModel): { data: PriceTableData | null; issues: EditorIssue[] } {
  const issues: EditorIssue[] = [];
  const add = (field: string, message: string) => issues.push({ field, message });

  if (!model.name.trim()) add("name", "Dê um nome à tabela.");
  if (!model.periods.length) add("periods", "Cadastre ao menos um período.");
  if (!model.units.length) add("units", "Cadastre ao menos uma acomodação.");
  if (!model.periods.some((p) => p.key === model.defaultKey)) add("default", "Escolha o período padrão (usado fora dos intervalos).");

  // ids: existentes ficam; novos vêm do nome, sem colidir.
  const taken = new Set(model.periods.map((p) => p.id).filter((id): id is string => Boolean(id)));
  const idByKey = new Map<string, string>();
  const seen = new Set<string>();
  for (const p of model.periods) {
    if (!p.name.trim()) add(`p:${p.key}:name`, "Informe o nome do período.");
    let id = p.id;
    if (!id) {
      id = slugId(p.name || "periodo", taken);
      taken.add(id);
    }
    if (!/^[a-z0-9_-]{1,30}$/.test(id) || seen.has(id)) add(`p:${p.key}:name`, "Identificador do período inválido ou repetido.");
    seen.add(id);
    idByKey.set(p.key, id);
    if (p.min_nights.trim() && int(p.min_nights, 1, 60) === null) add(`p:${p.key}:min`, "Mínimo de diárias entre 1 e 60.");
    p.ranges.forEach(([a, b], i) => {
      if (!a || !b) add(`p:${p.key}:r${i}`, "Preencha início e fim do intervalo.");
      else if (a > b) add(`p:${p.key}:r${i}`, "O início deve ser antes ou igual ao fim.");
    });
  }

  model.closed.forEach((c) => {
    if (!c.name.trim()) add(`c:${c.key}:name`, "Informe o motivo (ex.: Inverno).");
    if (!c.from || !c.to) add(`c:${c.key}:dates`, "Preencha início e fim.");
    else if (c.from > c.to) add(`c:${c.key}:dates`, "O início deve ser antes ou igual ao fim.");
  });

  const units: PriceUnit[] = [];
  for (const u of model.units) {
    if (!u.name.trim()) add(`u:${u.key}:name`, "Informe o nome da acomodação.");
    const max = int(u.max_guests, 1, 30);
    if (max === null) add(`u:${u.key}:max`, "Máximo de pessoas entre 1 e 30.");
    if (!u.rates.length) add(`u:${u.key}:rates`, "Cadastre ao menos uma tarifa.");
    const rates: PriceRate[] = [];
    for (const r of u.rates) {
      const guests = int(r.guests, 1, 30);
      if (guests === null) add(`r:${r.key}:guests`, "Número de pessoas entre 1 e 30.");
      let maxAdults: number | null = null;
      let childAge: number | null = null;
      if (r.childRule) {
        maxAdults = int(r.max_adults, 1, 30);
        childAge = int(r.child_max_age, 0, 17);
        if (maxAdults === null) add(`r:${r.key}:adults`, "Máximo de adultos entre 1 e 30.");
        if (childAge === null) add(`r:${r.key}:age`, "Idade máxima da criança entre 0 e 17.");
      }
      const prices: Record<string, number> = {};
      for (const p of model.periods) {
        const value = parseBRL(r.prices[p.key] ?? "");
        if (value === null) add(`r:${r.key}:price:${p.key}`, `Informe o valor (${p.name || "período"}).`);
        else prices[idByKey.get(p.key)!] = value;
      }
      rates.push({
        guests: guests ?? 1,
        ...(r.label.trim() ? { label: r.label.trim() } : {}),
        ...(r.childRule ? { max_adults: maxAdults, child_max_age: childAge } : {}),
        prices,
      });
    }
    units.push({ name: u.name.trim(), product_ids: u.product_ids, ...(u.pms_category_ids.length ? { pms_category_ids: u.pms_category_ids } : {}), max_guests: max ?? 1, rates });
  }

  if (issues.length) return { data: null, issues };
  return {
    data: {
      default_period: idByKey.get(model.defaultKey)!,
      periods: model.periods.map((p) => ({
        id: idByKey.get(p.key)!,
        name: p.name.trim(),
        min_nights: p.min_nights.trim() ? Number(p.min_nights) : null,
        ranges: p.ranges,
      })),
      units,
      notes: model.notes.map((n) => n.trim()).filter(Boolean),
      ...(model.closed.length ? { closed: model.closed.map((c) => ({ name: c.name.trim(), from: c.from, to: c.to })) } : {}),
    },
    issues,
  };
}

export interface ServerIssue { path: string; message: string }

/** Issues do 400 de price_table_save (error.details.issues), com o caminho em português. */
export function serverIssues(details: unknown, data?: PriceTableData | null): ServerIssue[] {
  const raw = (details as { issues?: unknown } | null | undefined)?.issues;
  if (!Array.isArray(raw)) return [];
  return raw.map((it) => {
    const issue = it as { path?: unknown; message?: unknown };
    const parts = Array.isArray(issue.path) ? issue.path.map(String) : String(issue.path ?? "").split(".").filter(Boolean);
    return { path: describePath(parts, data), message: String(issue.message ?? "inválido") };
  });
}

function describePath(parts: string[], data?: PriceTableData | null): string {
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const key = parts[i];
    const next = parts[i + 1];
    const idx = next !== undefined && /^\d+$/.test(next) ? Number(next) : null;
    if (key === "periods" && idx !== null) { out.push(data?.periods[idx]?.name ?? `Período ${idx + 1}`); i++; }
    else if (key === "units" && idx !== null) { out.push(data?.units[idx]?.name || `Acomodação ${idx + 1}`); i++; }
    else if (key === "rates" && idx !== null) { out.push(`tarifa ${idx + 1}`); i++; }
    else if (key === "ranges" && idx !== null) { out.push(`intervalo ${idx + 1}`); i++; }
    else if (key === "notes" && idx !== null) { out.push(`observação ${idx + 1}`); i++; }
    else if (key === "closed" && idx !== null) { out.push(data?.closed?.[idx]?.name ?? `Fechamento ${idx + 1}`); i++; }
    else if (key === "prices" && next !== undefined) { out.push(`valor ${data?.periods.find((p) => p.id === next)?.name ?? next}`); i++; }
    else out.push(key === "default_period" ? "período padrão" : key === "name" ? "nome" : key);
  }
  return out.join(" › ") || "tabela";
}
