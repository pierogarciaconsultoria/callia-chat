// Painel de atendimentos: tipos do get_dashboard, períodos do filtro e formatação dos indicadores.

export interface DashboardKpis {
  conversations: number;
  new_conversations: number;
  received: number;
  sent_bot: number;
  sent_agent: number;
  resolved_by_ai: number;
  handed_off_by_ai: number;
  taken_by_team: number;
  unanswered: number;
  median_first_reply_bot_s: number | null;
  median_first_reply_team_s: number | null;
  ai_runs: number;
  ai_failed: number;
  ai_avg_latency_ms: number | null;
}

export interface DashboardPoint { t: string; received: number; bot: number; agent: number }
export interface WaitingConversation {
  conversation_id: string;
  contact_name: string | null;
  contact_phone: string;
  mode: "bot" | "human" | "closed";
  since: string;
  preview: string | null;
}

export interface DashboardData {
  range: { from: string; to: string; timezone: string; bucket: "day" | "hour" };
  current: DashboardKpis;
  previous: DashboardKpis;
  series: DashboardPoint[];
  by_hour: Array<{ hour: number; received: number }>;
  tools: Record<string, number>;
  handoff_reasons: Record<string, number>;
  waiting: WaitingConversation[];
}

export interface QuotesReservations {
  pms_connected: boolean;
  tracking_since: string | null;
  quotes: number;
  quoted_conversations: number;
  reservations: number;
  confirmed: number;
  pre_reservations: number;
  canceled: number;
  from_quote: number;
  from_quote_total_cents: number;
  by_channel: Record<string, number>;
}

export const CHANNEL_LABELS: Record<string, string> = {
  site: "Site de reservas (cartão)",
  pre_reservation_form: "Formulário de pré-reserva (PIX)",
  front_desk: "Balcão",
  ota: "Booking, Airbnb e outras agências",
  other: "Outros canais",
};

// ---------------------------------------------------------------- Período

export type RangePreset = "today" | "7d" | "30d" | "90d" | "month" | "custom";

export const RANGE_PRESETS: Array<{ value: RangePreset; label: string }> = [
  { value: "today", label: "Hoje" },
  { value: "7d", label: "Últimos 7 dias" },
  { value: "30d", label: "Últimos 30 dias" },
  { value: "90d", label: "Últimos 90 dias" },
  { value: "month", label: "Este mês" },
  { value: "custom", label: "Personalizado" },
];

/** AAAA-MM-DD na data local. */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

/** Intervalo inclusivo [from, to] do preset; "custom" usa as datas informadas. */
export function rangeFor(preset: RangePreset, today = new Date(), custom?: { from: string; to: string }): { from: string; to: string } {
  const to = isoDay(today);
  switch (preset) {
    case "today": return { from: to, to };
    case "7d": return { from: isoDay(addDays(today, -6)), to };
    case "30d": return { from: isoDay(addDays(today, -29)), to };
    case "90d": return { from: isoDay(addDays(today, -89)), to };
    case "month": return { from: isoDay(new Date(today.getFullYear(), today.getMonth(), 1)), to };
    case "custom": {
      const from = custom?.from || to;
      const end = custom?.to || from;
      return from <= end ? { from, to: end } : { from: end, to: from };
    }
  }
}

// ---------------------------------------------------------------- Indicadores

export function percent(part: number, total: number): number | null {
  return total > 0 ? Math.round((part / total) * 100) : null;
}

/** Variação contra o período anterior; null quando não há base de comparação. */
export function delta(current: number | null, previous: number | null): { diff: number; pct: number | null } | null {
  if (current === null || previous === null) return null;
  const diff = current - previous;
  return { diff, pct: previous > 0 ? Math.round((diff / previous) * 100) : null };
}

/** 1284 → "1.284"; 12900 → "12,9 mil". */
export function compact(n: number): string {
  if (Math.abs(n) >= 10_000) return `${(n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return n.toLocaleString("pt-BR");
}

/** Segundos → "8 s", "2 min", "1 h 5 min". */
export function duration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

/** Tempo de espera desde `since` (ISO), em texto curto. */
export function waitingFor(since: string, now = new Date()): string {
  return duration((now.getTime() - Date.parse(since)) / 1000);
}

export const TOOL_LABELS: Record<string, string> = {
  consultar_disponibilidade: "Consultas de disponibilidade",
  calcular_valor: "Cotações pela tabela de preços",
  enviar_fotos: "Envios de fotos",
  buscar_conhecimento: "Buscas na base de conhecimento",
  transferir_para_atendente: "Transferências para a equipe",
};

export const HANDOFF_LABELS: Record<string, string> = {
  ai_decision: "A IA decidiu transferir",
  keyword: "Cliente pediu atendente (palavra-chave)",
  no_answer: "IA sem resposta",
  external_agent: "Agente externo transferiu",
  other: "Outros",
};

/** Entradas de um mapa {chave: n} como lista rotulada, da maior para a menor. */
export function labeledCounts(map: Record<string, number>, labels: Record<string, string>): Array<{ key: string; label: string; value: number }> {
  return Object.entries(map)
    .filter(([, v]) => v > 0)
    .map(([key, value]) => ({ key, label: labels[key] ?? key, value }))
    .sort((a, b) => b.value - a.value);
}

/** Rótulo curto do eixo X: "26/10" por dia, "14h" por hora. */
export function bucketLabel(t: string, bucket: "day" | "hour"): string {
  if (bucket === "hour") return `${Number(t.slice(11, 13))}h`;
  return `${t.slice(8, 10)}/${t.slice(5, 7)}`;
}

/** Rótulo completo para o tooltip: "seg., 26/10" ou "26/10, 14h–15h". */
export function bucketTitle(t: string, bucket: "day" | "hour"): string {
  if (bucket === "hour") {
    const h = Number(t.slice(11, 13));
    return `${t.slice(8, 10)}/${t.slice(5, 7)}, ${h}h–${h + 1}h`;
  }
  const d = new Date(`${t}T12:00:00`);
  return `${d.toLocaleDateString("pt-BR", { weekday: "short" })} ${t.slice(8, 10)}/${t.slice(5, 7)}`;
}

/** Divisão "limpa" do eixo Y para contagens: passo inteiro (1, 2, 5, 10…) e cerca de 4 marcas. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = Math.max(1, max / count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const top = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

/** No dia de hoje (por hora), as horas que ainda não chegaram saem da série para não parecerem "zero". */
export function trimFuture(points: DashboardPoint[], bucket: "day" | "hour", timezone: string, now = new Date()): DashboardPoint[] {
  if (bucket !== "hour") return points;
  // Hora atual no fuso do workspace (o mesmo do get_dashboard), não no do navegador.
  let current: string;
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(now).map((x) => [x.type, x.value]));
    current = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:00`;
  } catch {
    current = `${isoDay(now)}T${String(now.getHours()).padStart(2, "0")}:00`;
  }
  return points.filter((p) => p.t <= current);
}
