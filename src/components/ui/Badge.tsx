import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type BadgeTone = "neutral" | "brand" | "green" | "amber" | "red" | "blue" | "violet";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  brand: "bg-brand/10 text-brand dark:bg-brand/20",
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  red: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  blue: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  violet: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
};

export function Badge({ tone = "neutral", children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", tones[tone], className)}>
      {children}
    </span>
  );
}

// Tom padrão para status recorrentes nas telas de log.
export function statusTone(status: string | null | undefined): BadgeTone {
  switch (status) {
    case "success":
    case "sent":
    case "open":
    case "processed":
    case "replied":
    case "indexed":
    case "delivered":
    case "read":
      return "green";
    case "pending":
    case "retrying":
    case "queued":
    case "running":
    case "connecting":
    case "qr":
    case "indexing":
      return "amber";
    case "failed":
    case "error":
      return "red";
    case "handoff":
      return "violet";
    default:
      return "neutral";
  }
}
