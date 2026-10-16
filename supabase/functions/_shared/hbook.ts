// @ts-nocheck
// Pure adapters for the hbook booking engine. The public booking page is a
// JavaScript app, so the availability data only exists in the JSON endpoint it
// calls after load; these helpers build that request and shrink the answer down
// to what a chat agent can actually say.

export const HBOOK_BASE_URL = "https://hbook.hsystem.com.br";
export const HBOOK_TIMEOUT_MS = 10_000;

const DATE_PATTERN = /^(\d{2})\/(\d{2})\/(\d{4})$/;

function toUtcDate(value: string) {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const [, day, month, year] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  ) {
    return null;
  }
  return date;
}

export function parseStayNights(checkin: string, checkout: string) {
  const start = toUtcDate(checkin);
  const end = toUtcDate(checkout);
  if (!start || !end) return null;
  const nights = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  return nights > 0 ? nights : null;
}

function parseCount(value: string | null, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), 0), 12);
}

export function buildAvailabilityRequest(input: {
  companyId: string;
  checkin: string;
  checkout: string;
  adults: number;
  children: number;
  language?: string;
}) {
  return {
    CompanyId: input.companyId,
    ArrivalDateString: input.checkin,
    DepartureDateString: input.checkout,
    PromotionalCode: null,
    AmountAdults: input.adults,
    AmountChildren: input.children,
    ChildrenAges: [],
    IsReturningAbandonedBooking: false,
    IsReturningBudgetBooking: false,
    Language: input.language ?? "pt",
    // Verified against the live engine: the token the page posts is optional,
    // and the endpoint answers without any session cookie.
    AvailabilityToken: null,
  };
}

export function buildBookingLink(input: {
  companyId: string;
  checkin: string;
  checkout: string;
  adults: number;
  children: number;
  language?: string;
}) {
  const params = new URLSearchParams({
    companyId: input.companyId,
    checkin: input.checkin,
    checkout: input.checkout,
    adults: String(input.adults),
    children: String(input.children),
    language: input.language ?? "pt",
  });
  return `${HBOOK_BASE_URL}/Booking?${params.toString()}`;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function pickRate(room) {
  const rates = Array.isArray(room.Rates) ? room.Rates : [];
  const priced = rates.filter(
    (rate) => typeof rate.TotalValue === "number" || typeof rate.FullTotalValue === "number",
  );
  const pool = priced.length ? priced : rates;
  if (!pool.length) return null;

  // BestPrice is the engine's own choice; fall back to the cheapest total when
  // it is missing so the agent never quotes a rate the guest cannot book.
  const bestId = room.BestPrice?.RateTypeId;
  const best = bestId ? pool.find((rate) => rate.RateTypeId === bestId) : null;
  if (best) return best;

  return pool.reduce((cheapest, rate) => {
    const current = rate.TotalValue ?? rate.FullTotalValue ?? Number.POSITIVE_INFINITY;
    const bestValue = cheapest.TotalValue ?? cheapest.FullTotalValue ?? Number.POSITIVE_INFINITY;
    return current < bestValue ? rate : cheapest;
  }, pool[0]);
}

function totalOf(rate, nights: number | null) {
  if (typeof rate.TotalValue === "number") return rate.TotalValue;
  if (typeof rate.FullTotalValue === "number") return rate.FullTotalValue;
  if (typeof rate.DailyPrice === "number" && nights) return round(rate.DailyPrice * nights);
  return null;
}

export function mapAvailability(
  payload,
  context: { nights: number; currency: string; bookingLink: string },
) {
  const rooms = (Array.isArray(payload.Rooms) ? payload.Rooms : [])
    .filter((room) => Number(room.Availability) > 0)
    .map((room) => {
      const rate = pickRate(room);
      if (!rate) return null;
      const totalPrice = totalOf(rate, context.nights);
      if (totalPrice === null) return null;
      return {
        name: String(room.RoomTypeName ?? "").trim(),
        rate: String(rate.RateTypeName ?? "").trim(),
        total_price: totalPrice,
        price_per_night: context.nights ? round(totalPrice / context.nights) : totalPrice,
        currency: context.currency,
        units_available: Number(room.Availability),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.total_price - b.total_price);

  return {
    available: rooms.length > 0,
    nights: context.nights,
    rooms,
    booking_link: context.bookingLink,
  };
}

export async function fetchAvailability(request, timeoutMs = HBOOK_TIMEOUT_MS) {
  const response = await fetch(`${HBOOK_BASE_URL}/Booking/GetAvailability`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
      accept: "application/json",
      "user-agent": "CalliaBot/1.0 (+public-api)",
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) throw new Error(`hbook_upstream_${response.status}`);

  const payload = await response.json();
  if (!payload || !Array.isArray(payload.Rooms)) throw new Error("hbook_unexpected_response");
  return payload;
}

export function resolveAvailabilityQuery(searchParams: URLSearchParams, companyId: string) {
  const checkin = (searchParams.get("checkin") ?? "").trim();
  const checkout = (searchParams.get("checkout") ?? "").trim();
  const nights = parseStayNights(checkin, checkout);
  if (!nights) throw new Error("invalid_stay_dates");

  const adults = parseCount(searchParams.get("adults"), 2);
  const children = parseCount(searchParams.get("children"), 0);
  if (adults < 1) throw new Error("invalid_stay_dates");

  return {
    companyId,
    checkin,
    checkout,
    adults,
    children,
    nights,
    request: buildAvailabilityRequest({ companyId, checkin, checkout, adults, children }),
    bookingLink: buildBookingLink({ companyId, checkin, checkout, adults, children }),
  };
}
