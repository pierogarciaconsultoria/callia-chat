export type BoardStatus = "pending" | "in_progress" | "completed" | "blocked";

export type ParsedPhase = {
  id: string;
  order: number;
  title: string;
  status: BoardStatus;
  goal: string;
  scope: string[];
  deliverables: string[];
  dependsOn: string;
};

const FIELD_KEYS = [
  "Objetivo",
  "Escopo",
  "Entregaveis",
  "Criterio de entrada",
  "Criterio de saida",
  "Dependencias",
  "Status",
] as const;

const LIST_KEYS = new Set<string>(["Escopo", "Entregaveis"]);

const STATUS_VALUES = new Set<string>(["pending", "in_progress", "completed", "blocked"]);

const clean = (text: string) => text.replace(/`/g, "").trim();

export function parseProjectBoard(md: string): ParsedPhase[] {
  const phases: ParsedPhase[] = [];
  let current: ParsedPhase | null = null;
  let currentKey: string | null = null;

  for (const rawLine of md.split(/\r?\n/)) {
    const header = rawLine.match(/^## Fase (\d+) - (.+)$/);
    if (header) {
      current = {
        id: `phase-${header[1]}`,
        order: Number(header[1]),
        title: clean(header[2]),
        status: "pending",
        goal: "",
        scope: [],
        deliverables: [],
        dependsOn: "",
      };
      phases.push(current);
      currentKey = null;
      continue;
    }

    if (!current) continue;

    const bullet = rawLine.match(/^[-*] (.+)$/);
    if (!bullet) continue;

    const text = bullet[1];
    const key = FIELD_KEYS.find((candidate) => text.startsWith(`${candidate}:`));

    if (key) {
      currentKey = key;
      const value = clean(text.slice(key.length + 1));
      if (key === "Objetivo") {
        current.goal = value;
      } else if (key === "Dependencias") {
        current.dependsOn = value;
      } else if (key === "Status" && STATUS_VALUES.has(value)) {
        current.status = value as BoardStatus;
      }
      continue;
    }

    if (currentKey === "Escopo") {
      current.scope.push(clean(text));
    } else if (currentKey === "Entregaveis") {
      current.deliverables.push(clean(text));
    }
  }

  return phases;
}
