// Motor de reservas hbook: só monta o link de reserva já preenchido (datas e hóspedes).
// A HSystem não permite consultas automáticas nem integração fora de parceiros homologados
// (resposta do suporte em 26/10/2026): o Callia não acessa o hbook; quem abre o link é o hóspede.
// Os tipos de disponibilidade abaixo são os mesmos usados pelo Hospedin.
import { RuntimeError } from "./http.ts";

export interface HbookConfig {
  base_url: string;
  company_id: string;
  booking_link?: string | null;
  currency?: string | null;
  default_adults?: number | null;
}

export interface HbookRoom {
  name: string;
  /** Categoria no PMS (Hospedin place_type), para cruzar com a tabela de preços. */
  category_id?: number | null;
  capacity?: number | null;
  rate: string | null;
  total_price: number;
  price_per_night: number;
  available_units: number | null;
  /** Vagas por noite no entorno da estadia (só com aroundNights): mostra se a estadia curta é uma janela entre reservas. */
  nightly?: Record<string, number>;
}

export interface HbookAvailability {
  provider?: "hbook" | "hospedin";
  checkin: string;
  checkout: string;
  nights: number;
  adults: number;
  children: number;
  children_ages: number[];
  currency: string;
  sold_out: boolean;
  rooms: HbookRoom[];
  booking_link: string | null;
  price_note?: string;
}

/** DD/MM/AAAA → Date UTC; aceita também AAAA-MM-DD. */
export function parseBrDate(value: string): Date | null {
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value?.trim() ?? "");
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value?.trim() ?? "");
  const [d, m, y] = br ? [br[1], br[2], br[3]] : iso ? [iso[3], iso[2], iso[1]] : [];
  if (!d) return null;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return date.getUTCDate() === Number(d) && date.getUTCMonth() === Number(m) - 1 ? date : null;
}

export function formatBrDate(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${date.getUTCFullYear()}`;
}

export function countNights(checkin: Date, checkout: Date): number {
  return Math.round((checkout.getTime() - checkin.getTime()) / 86_400_000);
}

export interface AvailabilityQuery {
  checkin: string;
  checkout: string;
  adults?: number;
  /** Quantidade; o motor exige também a idade de cada criança (childrenAges). */
  children?: number;
  childrenAges?: number[];
  /** Só estas categorias do PMS, sem filtrar pela ocupação cadastrada lá (a capacidade vem da tabela de preços). */
  categoryIds?: number[];
  /** Lê também a vaga destas noites antes e depois da estadia (estadia mínima: janela entre reservas). */
  aroundNights?: number;
}

export function validateQuery(
  q: AvailabilityQuery,
  today: Date,
  cfg: Pick<HbookConfig, "default_adults">,
  opts: { requireChildrenAges?: boolean } = {},
) {
  const checkin = parseBrDate(q.checkin);
  const checkout = parseBrDate(q.checkout);
  if (!checkin || !checkout) throw new RuntimeError("invalid_request", "Datas devem estar no formato DD/MM/AAAA.");
  const nights = countNights(checkin, checkout);
  if (nights < 1) throw new RuntimeError("invalid_request", "checkout deve ser depois do checkin.");
  if (nights > 60) throw new RuntimeError("invalid_request", "Período máximo de 60 noites.");
  const startOfToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (checkin.getTime() < startOfToday - 86_400_000) throw new RuntimeError("invalid_request", "checkin no passado.");
  const adults = Math.trunc(Number(q.adults ?? cfg.default_adults ?? 2));
  const childrenAges = (q.childrenAges ?? []).map((a) => Math.trunc(Number(a)));
  if (childrenAges.some((a) => !(a >= 0 && a <= 17))) throw new RuntimeError("invalid_request", "Idade de criança deve estar entre 0 e 17 anos.");
  const children = childrenAges.length || Math.trunc(Number(q.children ?? 0));
  if (!(adults >= 1 && adults <= 20) || !(children >= 0 && children <= 10)) {
    throw new RuntimeError("invalid_request", "Quantidade de hóspedes inválida.");
  }
  // O motor do hbook calcula a tarifa pela idade de cada criança.
  if ((opts.requireChildrenAges ?? true) && children > 0 && childrenAges.length !== children) {
    throw new RuntimeError("invalid_request", "Informe a idade de cada criança para consultar a tarifa.", { needs: "children_ages" });
  }
  return { checkin, checkout, nights, adults, children, childrenAges };
}

/**
 * Link do motor já preenchido com as datas e hóspedes (mesmo formato da página de reservas do hbook):
 * <base>/Booking?companyId=...&checkin=DD/MM/AAAA&checkout=DD/MM/AAAA&adults=N&children=N
 */
export function buildBookingLink(
  cfg: Pick<HbookConfig, "base_url" | "company_id" | "booking_link">,
  q: { checkin: string; checkout: string; adults: number; children: number },
): string | null {
  const base = cfg.booking_link || (cfg.base_url ? `${cfg.base_url.replace(/\/$/, "")}/Booking` : null);
  if (!base) return null;
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return base;
  }
  if (!url.searchParams.has("companyId") && cfg.company_id) url.searchParams.set("companyId", cfg.company_id);
  url.searchParams.set("checkin", q.checkin);
  url.searchParams.set("checkout", q.checkout);
  url.searchParams.set("adults", String(q.adults));
  url.searchParams.set("children", String(q.children));
  return url.toString();
}

/**
 * O hbook não tem consulta automática: devolve o erro com o link de reserva preenchido,
 * para o hóspede consultar e reservar no próprio motor.
 */
export function hbookLinkOnly(cfg: HbookConfig, query: AvailabilityQuery, today = new Date()): never {
  if (!cfg.base_url || !cfg.company_id) throw new RuntimeError("unprocessable", "Conector hbook sem base_url ou company_id.");
  const q = validateQuery(query, today, cfg, { requireChildrenAges: false });
  const bookingLink = buildBookingLink(cfg, { checkin: formatBrDate(q.checkin), checkout: formatBrDate(q.checkout), adults: q.adults, children: q.children });
  throw new RuntimeError("unprocessable", "O hbook não permite consulta automática: a disponibilidade é vista pelo link de reserva.", { booking_link: bookingLink });
}
