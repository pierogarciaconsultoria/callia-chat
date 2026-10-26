import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";
import { bannerFor } from "@/lib/entitlements";
import { useEntitlements } from "@/hooks/use-entitlements";

// Aviso de status/cota do workspace no topo do painel.
export function PlanBanner() {
  const { data } = useEntitlements();
  const banner = bannerFor(data, new Date());
  if (!banner) return null;
  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-2 border-b px-4 py-2.5 text-sm sm:px-6",
        banner.tone === "red"
          ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200"
          : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200",
      )}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="min-w-0">{banner.message}</p>
    </div>
  );
}
