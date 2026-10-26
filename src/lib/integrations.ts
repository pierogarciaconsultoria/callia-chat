// Utilidades das integrações: datas padrão de teste, idades de crianças, telefone e link de exemplo.

/** Próximo fim de semana (sexta → domingo) em AAAA-MM-DD, para inputs type=date. */
export function nextWeekend(from = new Date()): { checkin: string; checkout: string } {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const untilFriday = (5 - d.getDay() + 7) % 7 || 7;
  const friday = new Date(d);
  friday.setDate(d.getDate() + untilFriday);
  const sunday = new Date(friday);
  sunday.setDate(friday.getDate() + 2);
  return { checkin: toIsoDate(friday), checkout: toIsoDate(sunday) };
}

export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** AAAA-MM-DD → DD/MM/AAAA (formato das functions). */
export function isoToBr(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** "5, 8" → [5, 8]; null se algum valor não for idade válida (0–17). */
export function parseChildrenAges(text: string): number[] | null {
  const parts = text.split(/[,;\s]+/).map((v) => v.trim()).filter(Boolean);
  const ages = parts.map(Number);
  return ages.every((a) => Number.isInteger(a) && a >= 0 && a <= 17) ? ages : null;
}

/** Máscara BR enquanto digita: (48) 99999-0000. */
export function maskBrPhone(value: string): string {
  const d = value.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Dígitos com DDI 55 para a Evolution (aceita quem já digitou o 55). */
export function phoneDigits(value: string): string | null {
  let d = value.replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d.length >= 12 && d.length <= 13 ? d : null;
}

/** Mesmo formato do link que o agente envia: datas e hóspedes preenchidos. */
export function sampleBookingLink(base: string, dates = nextWeekend()): string | null {
  let url: URL;
  try {
    url = new URL(base.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  url.searchParams.set("checkin", isoToBr(dates.checkin));
  url.searchParams.set("checkout", isoToBr(dates.checkout));
  url.searchParams.set("adults", "2");
  url.searchParams.set("children", "0");
  return url.toString();
}

export function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}
