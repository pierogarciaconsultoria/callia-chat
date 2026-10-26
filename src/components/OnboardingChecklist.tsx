import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Circle, Rocket, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useWorkspace } from "@/lib/workspace";
import { readLocal, writeLocal } from "@/lib/storage";
import { isDefaultPersona } from "@/lib/agent-setup";
import { useAgentConfig } from "@/hooks/use-agent-config";
import { useSetupDrafts } from "@/hooks/use-agent-setup";
import { findIntegration, useIntegrations } from "@/hooks/use-integrations";

const dismissKey = (ws: string) => `callia:onboarding:dismissed:${ws}`;
const simulatorKey = (ws: string) => `callia:onboarding:simulator:${ws}`;

interface Step {
  id: string;
  title: string;
  description: string;
  to: string;
  done: boolean;
  onClick?: () => void;
}

/** "Primeiros passos" para admins de workspaces novos; some quando tudo estiver feito ou ao dispensar. */
export function OnboardingChecklist({ className, compact = false }: { className?: string; compact?: boolean }) {
  const { workspaceId, isAdmin } = useWorkspace();
  const ws = workspaceId ?? "";
  const [dismissed, setDismissed] = useState(() => readLocal(dismissKey(ws)) === "1");
  const [simulatorClicked, setSimulatorClicked] = useState(() => readLocal(simulatorKey(ws)) === "1");
  const visible = isAdmin && Boolean(workspaceId) && !dismissed;
  const integrations = useIntegrations(workspaceId, visible);
  const config = useAgentConfig(ws);
  const drafts = useSetupDrafts(ws);

  if (!visible || integrations.isLoading || config.isLoading) return null;

  const connected = (kind: Parameters<typeof findIntegration>[1]) => findIntegration(integrations.data, kind)?.status === "connected";
  const bookingLink = findIntegration(integrations.data, "booking_link");
  const steps: Step[] = [
    {
      id: "whatsapp",
      title: "Conectar o WhatsApp",
      description: "Leia o QR Code ou use o código pelo celular.",
      to: "/integrations",
      done: connected("whatsapp"),
    },
    {
      id: "reservas",
      title: "Conectar o sistema de reservas",
      description: "Hospedin ou o link do seu motor de reservas.",
      to: "/integrations",
      done: connected("hospedin") || connected("hbook") || Boolean(bookingLink?.details.booking_link) || bookingLink?.status === "connected",
    },
    {
      id: "agente",
      title: "Gerar o agente a partir do site e Instagram",
      description: "A IA monta a persona e as respostas com as informações da empresa.",
      to: "/agent/setup",
      done: Boolean(config.data && !isDefaultPersona(config.data.persona_prompt)),
    },
    {
      id: "simulador",
      title: "Testar no simulador",
      description: "Converse com o agente como se fosse um hóspede.",
      to: "/agent",
      done: simulatorClicked || Boolean(drafts.data?.some((d) => d.status === "applied")),
      onClick: () => {
        writeLocal(simulatorKey(ws), "1");
        setSimulatorClicked(true);
      },
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;

  return (
    <div
      className={cn(
        "w-full rounded-xl border border-slate-200 bg-white text-left shadow-sm dark:border-slate-800 dark:bg-slate-900",
        compact ? "p-3" : "max-w-md p-4",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Rocket className="h-4 w-4 text-brand" />
          <p className="text-sm font-semibold">Primeiros passos</p>
          <span className="text-xs text-slate-500">{doneCount} de {steps.length}</span>
        </div>
        <button
          type="button"
          aria-label="Dispensar primeiros passos"
          className="text-slate-400 hover:text-slate-600"
          onClick={() => {
            writeLocal(dismissKey(ws), "1");
            setDismissed(true);
          }}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>
      <ol className="mt-3 space-y-1">
        {steps.map((s) => (
          <li key={s.id}>
            <Link
              to={s.to}
              onClick={s.onClick}
              className={cn(
                "flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60",
                s.done && "opacity-60",
              )}
            >
              {s.done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />}
              <span className="min-w-0">
                <span className={cn("block text-sm font-medium", s.done && "line-through")}>{s.title}</span>
                {!compact && !s.done && <span className="block text-xs text-slate-500 dark:text-slate-400">{s.description}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
