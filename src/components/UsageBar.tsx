import { cn } from "@/lib/cn";
import { formatLimit } from "@/lib/entitlements";

// Barra de uso x limite do plano ("ilimitado" quando o limite é nulo).
export function UsageBar({ label, used, limit, compact = false }: { label?: string; used: number; limit: number | null; compact?: boolean }) {
  const ratio = limit === null ? null : limit === 0 ? 1 : used / limit;
  const pct = ratio === null ? 0 : Math.min(100, Math.round(ratio * 100));
  const color = ratio === null ? "bg-slate-300 dark:bg-slate-600" : ratio >= 1 ? "bg-red-500" : ratio >= 0.8 ? "bg-amber-500" : "bg-brand";
  return (
    <div className="min-w-0">
      {!compact && label && (
        <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
          <span className="truncate text-slate-700 dark:text-slate-300">{label}</span>
          <span className="shrink-0 tabular-nums text-slate-500 dark:text-slate-400">
            {new Intl.NumberFormat("pt-BR").format(used)} / {formatLimit(limit)}
          </span>
        </div>
      )}
      {compact && (
        <p className="mb-0.5 text-xs tabular-nums text-slate-500 dark:text-slate-400">
          {new Intl.NumberFormat("pt-BR").format(used)} / {formatLimit(limit)}
        </p>
      )}
      <div className={cn("w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800", compact ? "h-1.5" : "h-2")}>
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: ratio === null ? "100%" : `${pct}%`, opacity: ratio === null ? 0.35 : 1 }} />
      </div>
    </div>
  );
}
