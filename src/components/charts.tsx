// Gráficos do painel em SVG (sem biblioteca): marcas finas, grade discreta, tooltip no hover/foco
// e uma tabela equivalente em cada cartão. Cores vêm das variáveis .viz (src/index.css).
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Table2, LineChart as LineIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { compact, niceTicks } from "@/lib/dashboard";
import { Button, Card, CardBody, CardHeader } from "@/components/ui";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

// ---------------------------------------------------------------- Cartão com alternância gráfico/tabela

export function ChartCard({ title, description, table, children, className }: {
  title: string; description?: string; table: ReactNode; children: ReactNode; className?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card className={cn("viz", className)}>
      <CardHeader
        title={title}
        description={description}
        actions={
          <Button size="sm" variant="ghost" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
            {asTable ? <><LineIcon className="h-4 w-4" /> Ver gráfico</> : <><Table2 className="h-4 w-4" /> Ver tabela</>}
          </Button>
        }
      />
      <CardBody>{asTable ? <div className="overflow-x-auto">{table}</div> : children}</CardBody>
    </Card>
  );
}

/** Tabela simples (a versão acessível de cada gráfico). */
export function DataTable({ head, rows }: { head: string[]; rows: Array<Array<string | number>> }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800">
          {head.map((h, i) => <th key={h} className={cn("py-2 pr-3 font-medium", i > 0 && "text-right")}>{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri} className="border-b border-slate-100 last:border-0 dark:border-slate-800/60">
            {r.map((c, ci) => <td key={ci} className={cn("py-1.5 pr-3", ci > 0 && "text-right tabular-nums")}>{c}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(x + 12, 0), Math.max(0, width - 190));
  return (
    <div role="status" className="pointer-events-none absolute z-10 w-[178px] rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-800"
      style={{ left, top: Math.max(0, y - 8) }}>
      {children}
    </div>
  );
}

function TooltipRow({ color, label, value, line = true }: { color: string; label: string; value: string | number; line?: boolean }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className={cn("shrink-0", line ? "h-0.5 w-3 rounded" : "h-2.5 w-2.5 rounded-sm")} style={{ background: color }} aria-hidden />
      <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">{value}</span>
      <span className="truncate text-slate-500 dark:text-slate-400">{label}</span>
    </div>
  );
}

export function Legend({ items, line = false }: { items: Array<{ label: string; color: string; value?: string }>; line?: boolean }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600 dark:text-slate-300">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className={cn("shrink-0", line ? "h-0.5 w-3.5 rounded" : "h-2.5 w-2.5 rounded-sm")} style={{ background: i.color }} aria-hidden />
          {i.label}
          {i.value !== undefined && <span className="font-semibold text-slate-900 dark:text-slate-100">{i.value}</span>}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- Linhas (várias séries, um eixo)

export interface LineSeries { key: string; label: string; color: string }

const M = { top: 12, right: 14, bottom: 26, left: 34 };

export function LineChart({ points, series, xLabel, xTitle, height = 220 }: {
  points: Array<Record<string, number | string>>;
  series: LineSeries[];
  xLabel: (i: number) => string;
  xTitle: (i: number) => string;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const n = points.length;
  const max = Math.max(0, ...points.flatMap((p) => series.map((s) => Number(p[s.key]) || 0)));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const plotW = Math.max(0, width - M.left - M.right);
  const plotH = height - M.top - M.bottom;
  const x = (i: number) => M.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => M.top + plotH - (v / top) * plotH;
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 56))));

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left - M.left;
    setActive(n <= 1 ? 0 : Math.min(n - 1, Math.max(0, Math.round((px / plotW) * (n - 1)))));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === "ArrowRight") setActive((a) => Math.min(n - 1, (a ?? -1) + 1));
    else if (e.key === "ArrowLeft") setActive((a) => Math.max(0, (a ?? n) - 1));
    else return;
    e.preventDefault();
  };

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`Gráfico de linhas: ${series.map((s) => s.label).join(", ")}. Use as setas para ver cada ponto.`}
          tabIndex={0} className="touch-none outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded"
          onPointerMove={pick} onPointerLeave={() => setActive(null)} onFocus={() => setActive((a) => a ?? n - 1)} onBlur={() => setActive(null)} onKeyDown={onKey}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={M.left + plotW} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--viz-axis)" : "var(--viz-grid)"} strokeWidth={1} />
              <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-slate-400 text-[11px] tabular-nums">{compact(t)}</text>
            </g>
          ))}
          {points.map((_, i) => (i % every === 0 || i === n - 1) && (i === n - 1 || n - 1 - i >= every) ? (
            <text key={i} x={x(i)} y={height - 8} textAnchor={n > 1 && i === 0 ? "start" : n > 1 && i === n - 1 ? "end" : "middle"} className="fill-slate-400 text-[11px] tabular-nums">{xLabel(i)}</text>
          ) : null)}
          {active !== null && <line x1={x(active)} x2={x(active)} y1={M.top} y2={M.top + plotH} stroke="var(--viz-axis)" strokeWidth={1} />}
          {series.map((s) => (
            <path key={s.key} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
              d={points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(Number(p[s.key]) || 0)}`).join("")} />
          ))}
          {series.map((s) => {
            const i = active ?? n - 1;
            return n ? <circle key={s.key} cx={x(i)} cy={y(Number(points[i][s.key]) || 0)} r={4} fill={s.color} stroke="var(--viz-surface)" strokeWidth={2} /> : null;
          })}
        </svg>
      )}
      {active !== null && n > 0 && (
        <Tooltip x={x(active)} y={M.top} width={width}>
          <p className="mb-1 font-medium text-slate-700 dark:text-slate-200">{xTitle(active)}</p>
          {series.map((s) => <TooltipRow key={s.key} color={s.color} label={s.label} value={compact(Number(points[active][s.key]) || 0)} />)}
        </Tooltip>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Colunas (série única)

export function ColumnChart({ values, labels, titles, color, valueLabel, height = 200, labelEvery = 1 }: {
  values: number[]; labels: string[]; titles: string[]; color: string; valueLabel: string; height?: number; labelEvery?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const n = values.length;
  const ticks = niceTicks(Math.max(0, ...values));
  const top = ticks[ticks.length - 1];
  const plotW = Math.max(0, width - M.left - M.right);
  const plotH = height - M.top - M.bottom - 14;
  const band = n ? plotW / n : 0;
  const barW = Math.max(2, Math.min(24, band - 2));
  const y = (v: number) => M.top + 14 + plotH - (v / top) * plotH;
  const peak = values.indexOf(Math.max(...values));

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`Gráfico de colunas: ${valueLabel}`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={M.left + plotW} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--viz-axis)" : "var(--viz-grid)"} strokeWidth={1} />
              <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-slate-400 text-[11px] tabular-nums">{compact(t)}</text>
            </g>
          ))}
          {values.map((v, i) => {
            const cx = M.left + band * i + band / 2;
            const h = Math.max(0, y(0) - y(v));
            const r = Math.min(4, h, barW / 2);
            const x0 = cx - barW / 2;
            const y0 = y(0) - h;
            return (
              <g key={i} tabIndex={0} role="graphics-symbol" aria-label={`${titles[i]}: ${v} ${valueLabel}`}
                onPointerEnter={() => setActive(i)} onPointerLeave={() => setActive(null)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}
                className="outline-none">
                <rect x={M.left + band * i} y={M.top} width={band} height={plotH + 14} fill="transparent" />
                {h > 0 && (
                  <path fill={color} opacity={active === null || active === i ? 1 : 0.55}
                    d={`M${x0},${y(0)} V${y0 + r} Q${x0},${y0} ${x0 + r},${y0} H${x0 + barW - r} Q${x0 + barW},${y0} ${x0 + barW},${y0 + r} V${y(0)} Z`} />
                )}
                {i === peak && v > 0 && <text x={cx} y={y0 - 5} textAnchor="middle" className="fill-slate-600 text-[11px] font-semibold tabular-nums dark:fill-slate-300">{compact(v)}</text>}
                {i % labelEvery === 0 && <text x={cx} y={height - 8} textAnchor="middle" className="fill-slate-400 text-[11px] tabular-nums">{labels[i]}</text>}
              </g>
            );
          })}
        </svg>
      )}
      {active !== null && (
        <Tooltip x={M.left + band * active + band / 2} y={M.top} width={width}>
          <p className="mb-1 font-medium text-slate-700 dark:text-slate-200">{titles[active]}</p>
          <TooltipRow color={color} label={valueLabel} value={compact(values[active])} line={false} />
        </Tooltip>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Barras horizontais (série única, valor na ponta)

export function BarList({ items, color, empty }: { items: Array<{ key: string; label: string; value: number }>; color: string; empty: string }) {
  if (!items.length) return <p className="py-6 text-center text-sm text-slate-500">{empty}</p>;
  const max = Math.max(...items.map((i) => i.value));
  return (
    <ul className="space-y-3">
      {items.map((i) => (
        <li key={i.key}>
          <p className="mb-1 text-sm text-slate-700 dark:text-slate-300">{i.label}</p>
          <div className="flex items-center gap-2">
            <div className="h-3 min-w-[2px] rounded-r" style={{ width: `${Math.max(1, (i.value / max) * 85)}%`, background: color }} aria-hidden />
            <span className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">{compact(i.value)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- Parte do todo (barra empilhada horizontal)

export function StackedBar({ parts, total }: { parts: Array<{ key: string; label: string; value: number; color: string }>; total: number }) {
  const [active, setActive] = useState<string | null>(null);
  const visible = parts.filter((p) => p.value > 0);
  const pct = (v: number) => (total > 0 ? Math.round((v / total) * 100) : 0);
  return (
    <div className="space-y-3">
      {total > 0 ? (
        <div className="flex h-6 w-full gap-[2px]" role="img" aria-label={visible.map((p) => `${p.label}: ${p.value}`).join("; ")}>
          {visible.map((p, i) => (
            <div key={p.key} tabIndex={0} title={`${p.label}: ${p.value} (${pct(p.value)}%)`}
              onPointerEnter={() => setActive(p.key)} onPointerLeave={() => setActive(null)} onFocus={() => setActive(p.key)} onBlur={() => setActive(null)}
              className={cn("h-full outline-none transition-opacity", i === 0 && "rounded-l", i === visible.length - 1 && "rounded-r", active && active !== p.key && "opacity-55")}
              style={{ flexGrow: p.value, flexBasis: 0, minWidth: 3, background: p.color }} />
          ))}
        </div>
      ) : (
        <div className="h-6 w-full rounded bg-slate-100 dark:bg-slate-800" aria-hidden />
      )}
      <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center justify-between gap-2 text-sm">
            <span className="flex min-w-0 items-center gap-1.5 text-slate-600 dark:text-slate-300">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: p.color }} aria-hidden />
              <span className="truncate">{p.label}</span>
            </span>
            <span className="whitespace-nowrap tabular-nums">
              <span className="font-semibold text-slate-900 dark:text-slate-100">{p.value}</span>
              <span className="ml-1 text-slate-500">{pct(p.value)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
