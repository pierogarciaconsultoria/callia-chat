// Hospedin (PMS) — API v2 oficial: categorias de quarto e tarifa/disponibilidade por dia.
// Docs: https://pms.hospedin.com/api-docs/index.html
import { RuntimeError } from "./http.ts";
import { type AvailabilityQuery, buildBookingLink, formatBrDate, type HbookAvailability, type HbookRoom, validateQuery } from "./hbook.ts";

export const HOSPEDIN_DEFAULT_BASE = "https://pms-api.hospedin.com";
const UA = "CalliaChat-Connector/1.0 (+consulta de disponibilidade para o atendimento do hotel)";

export interface HospedinCredentials {
  email: string;
  password: string;
}

export interface HospedinConfig {
  account_id: string;
  account_name?: string | null;
  price_unit?: "reais" | "cents";
  categories?: Array<{ id: number | string; title: string; occupants: number | null }>;
  booking_link?: string | null;
  currency?: string;
}

export interface PlaceType {
  id: number | string;
  title: string;
  status?: boolean;
  occupants?: number | null;
  note?: string | null;
  attachments?: Array<{ id: number | string; file: string }>;
}

export interface DailyRate {
  date: string;
  rate_price: number | null;
  availability: number | null;
}

// ---------------------------------------------------------------------------
// Funções puras
// ---------------------------------------------------------------------------
function b64urlDecode(part: string): string {
  const pad = part.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((part.length + 3) % 4);
  return atob(pad);
}

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    return JSON.parse(b64urlDecode(token.split(".")[1] ?? ""));
  } catch {
    return null;
  }
}

/** Procura o identificador da conta nas claims do token (o formato exato não é documentado). */
export function accountFromClaims(claims: Record<string, unknown> | null): string | null {
  if (!claims) return null;
  // deno-lint-ignore no-explicit-any
  const c = claims as any;
  const candidates = [
    c.account_slug, c.account_id, c.accountId, c.slug, c.account?.slug, c.account?.id,
    c.current_account?.slug, c.current_account?.id, c.accounts?.[0]?.slug, c.accounts?.[0]?.id,
  ];
  const hit = candidates.find((v) => (typeof v === "string" && v.trim()) || typeof v === "number");
  return hit === undefined ? null : String(hit);
}

/** Datas ISO (AAAA-MM-DD) de cada noite: do check-in até a véspera do check-out. */
export function stayNights(checkin: Date, checkout: Date): string[] {
  const out: string[] = [];
  for (let t = checkin.getTime(); t < checkout.getTime(); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** Tarifas de hotel em reais ficam na casa das centenas; em centavos, dezenas de milhares. */
export function detectPriceUnit(prices: number[]): "reais" | "cents" {
  const valid = prices.filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
  if (!valid.length) return "reais";
  return valid[Math.floor(valid.length / 2)] >= 2000 ? "cents" : "reais";
}

/** Cotação de uma categoria para a estadia: disponível só se todas as noites tiverem vaga e preço. */
export function quoteStay(rates: DailyRate[], nights: string[], unit: "reais" | "cents") {
  const byDate = new Map(rates.map((r) => [String(r.date).slice(0, 10), r]));
  let total = 0;
  let minUnits = Infinity;
  for (const night of nights) {
    const r = byDate.get(night);
    if (!r || r.rate_price === null || r.rate_price === undefined || !r.availability || r.availability <= 0) return null;
    total += Number(r.rate_price);
    minUnits = Math.min(minUnits, Number(r.availability));
  }
  const factor = unit === "cents" ? 100 : 1;
  const totalPrice = Math.round((total / factor) * 100) / 100;
  return { total_price: totalPrice, price_per_night: Math.round((totalPrice / nights.length) * 100) / 100, available_units: minUnits };
}

// ---------------------------------------------------------------------------
// Cliente HTTP
// ---------------------------------------------------------------------------
const tokenCache = new Map<string, { token: string; exp: number }>();

export class HospedinClient {
  private readonly base: string;
  private readonly doFetch: typeof fetch;

  constructor(private readonly creds: HospedinCredentials, opts: { baseUrl?: string; fetchImpl?: typeof fetch } = {}) {
    this.base = (opts.baseUrl ?? HOSPEDIN_DEFAULT_BASE).replace(/\/$/, "");
    this.doFetch = opts.fetchImpl ?? fetch;
  }

  private cacheKey() {
    return `${this.base}|${this.creds.email.toLowerCase()}`;
  }

  async login(force = false): Promise<{ token: string; claims: Record<string, unknown> | null }> {
    const cached = tokenCache.get(this.cacheKey());
    if (!force && cached && cached.exp > Date.now() + 60_000) return { token: cached.token, claims: decodeJwtPayload(cached.token) };
    let res: Response;
    try {
      res = await this.doFetch(`${this.base}/api/v2/authentication/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA },
        body: JSON.stringify({ email: this.creds.email, password: this.creds.password }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new RuntimeError("upstream_unavailable", "Hospedin indisponível no momento.");
    }
    if (res.status === 401 || res.status === 422 || res.status === 400) {
      await res.body?.cancel();
      throw new RuntimeError("unprocessable", "E-mail ou senha do Hospedin incorretos.", { reason: "invalid_credentials" });
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new RuntimeError("upstream_unavailable", "Hospedin recusou o login.", { status: res.status });
    }
    const body = await res.json().catch(() => ({}));
    const token = typeof body?.token === "string" ? body.token : null;
    if (!token) throw new RuntimeError("upstream_unavailable", "Hospedin não devolveu o token de acesso.");
    const claims = decodeJwtPayload(token);
    const exp = typeof claims?.exp === "number" ? claims.exp * 1000 : Date.now() + 30 * 60_000;
    tokenCache.set(this.cacheKey(), { token, exp });
    return { token, claims };
  }

  // deno-lint-ignore no-explicit-any
  async get(path: string): Promise<any> {
    for (const attempt of [0, 1]) {
      const { token } = await this.login(attempt === 1);
      let res: Response;
      try {
        res = await this.doFetch(`${this.base}${path}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": UA },
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        throw new RuntimeError("upstream_unavailable", "Hospedin indisponível no momento.");
      }
      if (res.status === 401 && attempt === 0) {
        await res.body?.cancel();
        continue; // token expirado: renova e tenta de novo
      }
      if (res.status === 404) {
        await res.body?.cancel();
        throw new RuntimeError("not_found", "Conta ou recurso não encontrado no Hospedin.", { path });
      }
      if (res.status === 401 || res.status === 403) {
        await res.body?.cancel();
        throw new RuntimeError("unprocessable", "O usuário do Hospedin não tem permissão para esta consulta.", { status: res.status });
      }
      if (!res.ok) {
        await res.body?.cancel();
        throw new RuntimeError("upstream_unavailable", "Hospedin recusou a consulta.", { status: res.status });
      }
      return res.json();
    }
  }

  async myAccount(account: string): Promise<{ name: string | null }> {
    const body = await this.get(`/api/v2/${encodeURIComponent(account)}/my_account`);
    const data = body?.data ?? body;
    return { name: data?.name ?? data?.title ?? data?.company_name ?? null };
  }

  async placeTypes(account: string): Promise<PlaceType[]> {
    const out: PlaceType[] = [];
    for (let page = 1; page <= 20; page++) {
      const body = await this.get(`/api/v2/${encodeURIComponent(account)}/place_types?page=${page}&limit=100`);
      const items: PlaceType[] = Array.isArray(body) ? body : body?.data ?? [];
      out.push(...items);
      const last = Number(body?.pagination?.last ?? 1);
      if (Array.isArray(body) || page >= last || !items.length) break;
    }
    return out.filter((p) => p.status !== false);
  }

  async rates(account: string, placeTypeId: string | number, begin: string, end: string): Promise<DailyRate[]> {
    const q = `begin_date=${begin}&end_date=${end}`;
    const body = await this.get(`/api/v2/${encodeURIComponent(account)}/place_types/${encodeURIComponent(String(placeTypeId))}/rates_and_availabilities?${q}`);
    return Array.isArray(body) ? body : body?.data ?? [];
  }
}

// ---------------------------------------------------------------------------
// Consulta para o agente (mesmo formato do hbook)
// ---------------------------------------------------------------------------
export async function fetchHospedinAvailability(
  cfg: HospedinConfig,
  client: HospedinClient,
  query: AvailabilityQuery,
  opts: { today?: Date } = {},
): Promise<HbookAvailability> {
  if (!cfg.account_id) throw new RuntimeError("unprocessable", "Integração Hospedin sem conta configurada.");
  // A API do Hospedin não usa idade das crianças, só o total de hóspedes.
  const q = validateQuery(query, opts.today ?? new Date(), { default_adults: 2 }, { requireChildrenAges: false });
  const nights = stayNights(q.checkin, q.checkout);
  const guests = q.adults + q.children;
  const bookingLink = cfg.booking_link
    ? (/hbook/i.test(cfg.booking_link)
      ? buildBookingLink({ base_url: "", company_id: "", booking_link: cfg.booking_link }, { checkin: formatBrDate(q.checkin), checkout: formatBrDate(q.checkout), adults: q.adults, children: q.children })
      : cfg.booking_link)
    : null;

  let placeTypes: PlaceType[];
  try {
    placeTypes = await client.placeTypes(cfg.account_id);
  } catch (err) {
    throw err instanceof RuntimeError && err.code === "upstream_unavailable"
      ? new RuntimeError("upstream_unavailable", "Sistema de reservas indisponível.", { booking_link: bookingLink })
      : err;
  }
  const wanted = query.categoryIds?.length ? new Set(query.categoryIds.map(Number)) : null;
  const fitting = (wanted ? placeTypes.filter((p) => wanted.has(Number(p.id))) : placeTypes.filter((p) => !p.occupants || p.occupants >= guests)).slice(0, 12);
  const unit = cfg.price_unit ?? "reais";

  const rooms: HbookRoom[] = [];
  await Promise.all(fitting.map(async (p) => {
    const rates = await client.rates(cfg.account_id, p.id, nights[0], nights[nights.length - 1]).catch(() => null);
    const quote = rates ? quoteStay(rates, nights, unit) : null;
    if (quote) rooms.push({ name: p.title, category_id: Number(p.id), rate: null, capacity: p.occupants ?? null, ...quote });
  }));
  rooms.sort((a, b) => a.total_price - b.total_price);

  return {
    provider: "hospedin",
    checkin: formatBrDate(q.checkin),
    checkout: formatBrDate(q.checkout),
    nights: q.nights,
    adults: q.adults,
    children: q.children,
    children_ages: q.childrenAges,
    currency: cfg.currency || "BRL",
    sold_out: rooms.length === 0,
    rooms,
    booking_link: bookingLink,
    price_note: "Valores da tarifa base no sistema do hotel; o valor final (ocupação, crianças, promoções) é confirmado no link de reserva.",
  };
}
