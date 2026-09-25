import boardMd from "../../PROJECT_BOARD.md?raw";

import { parseProjectBoard } from "@/lib/project-board-parser";

export type PhaseStatus = "pending" | "in_progress" | "completed" | "blocked" | "next";

export type ProjectPhase = {
  id: string;
  order: number;
  title: string;
  status: PhaseStatus;
  goal: string;
  scope: string[];
  deliverables: string[];
  dependsOn: string;
};

const parsedPhases = parseProjectBoard(boardMd);

const firstPending = parsedPhases.find((phase) => phase.status === "pending");

export const projectPhases: ProjectPhase[] = parsedPhases.map((phase) =>
  phase === firstPending ? { ...phase, status: "next" as const } : phase,
);

export const statusMeta: Record<
  PhaseStatus,
  { label: string; className: string }
> = {
  pending: {
    label: "Pendente",
    className: "border-slate-300 bg-slate-100 text-slate-700",
  },
  in_progress: {
    label: "Em andamento",
    className: "border-blue-300 bg-blue-100 text-blue-700",
  },
  completed: {
    label: "Concluida",
    className: "border-emerald-300 bg-emerald-100 text-emerald-700",
  },
  next: {
    label: "Proxima",
    className: "border-amber-300 bg-amber-100 text-amber-800",
  },
  blocked: {
    label: "Bloqueada",
    className: "border-rose-300 bg-rose-100 text-rose-700",
  },
};
