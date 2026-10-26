// Editores reaproveitados pela página do agente e pelo assistente de configuração.
import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import type { BusinessHours, PaymentLink, TimeRange, Weekday } from "@/lib/database.types";
import { Button, Input } from "@/components/ui";

export const WEEKDAYS: { id: Weekday; label: string }[] = [
  { id: "mon", label: "Segunda" },
  { id: "tue", label: "Terça" },
  { id: "wed", label: "Quarta" },
  { id: "thu", label: "Quinta" },
  { id: "fri", label: "Sexta" },
  { id: "sat", label: "Sábado" },
  { id: "sun", label: "Domingo" },
];

export function BusinessHoursEditor({ value, onChange }: { value: BusinessHours; onChange: (v: BusinessHours) => void }) {
  const setDay = (day: Weekday, ranges: TimeRange[]) => onChange({ ...value, [day]: ranges });
  return (
    <div className="space-y-2">
      {WEEKDAYS.map(({ id, label }) => {
        const ranges = value[id] ?? [];
        return (
          <div key={id} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-2 dark:border-slate-800 sm:flex-row sm:items-start">
            <div className="flex w-full items-center justify-between sm:w-28 sm:pt-1.5">
              <span className="text-sm font-medium">{label}</span>
              {ranges.length === 0 && <span className="text-xs text-slate-400 sm:hidden">Fechado</span>}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              {ranges.length === 0 && <span className="hidden pt-1.5 text-sm text-slate-400 sm:block">Fechado</span>}
              {ranges.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="time"
                    value={r[0]}
                    onChange={(e) => setDay(id, ranges.map((x, j) => (j === i ? [e.target.value, x[1]] : x)))}
                    className="h-9 w-28 rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                    aria-label={`${label} início`}
                  />
                  <span className="text-slate-400">às</span>
                  <input
                    type="time"
                    value={r[1]}
                    onChange={(e) => setDay(id, ranges.map((x, j) => (j === i ? [x[0], e.target.value] : x)))}
                    className="h-9 w-28 rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                    aria-label={`${label} fim`}
                  />
                  <button
                    type="button"
                    onClick={() => setDay(id, ranges.filter((_, j) => j !== i))}
                    className="rounded p-1 text-slate-400 hover:text-red-600"
                    aria-label="Remover faixa"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <Button size="sm" variant="ghost" onClick={() => setDay(id, [...ranges, ["08:00", "18:00"]])}>
              <Plus className="h-4 w-4" /> Faixa
            </Button>
          </div>
        );
      })}
    </div>
  );
}

export function KeywordChips({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const k = draft.trim().toLowerCase();
    if (k && !value.includes(k)) onChange([...value, k]);
    setDraft("");
  };
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Palavras-chave de transferência</p>
      <div className="flex flex-wrap gap-1.5">
        {value.map((k) => (
          <span key={k} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs dark:bg-slate-800">
            {k}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== k))} aria-label={`Remover ${k}`}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {value.length === 0 && <span className="text-xs text-slate-400">Nenhuma palavra-chave.</span>}
      </div>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Ex.: falar com atendente"
          className="h-9 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
        />
        <Button size="sm" variant="secondary" onClick={add} className="h-9">
          Adicionar
        </Button>
      </div>
      <p className="text-xs text-slate-500">A comparação ignora maiúsculas e acentos.</p>
    </div>
  );
}

export function PaymentLinksEditor({ value, onChange }: { value: PaymentLink[]; onChange: (v: PaymentLink[]) => void }) {
  const update = (i: number, patch: Partial<PaymentLink>) => onChange(value.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <div className="space-y-3">
      {value.map((p, i) => (
        <div key={i} className="grid gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800 sm:grid-cols-[1fr_2fr_auto]">
          <Input placeholder="Nome (ex.: Pix)" value={p.label} onChange={(e) => update(i, { label: e.target.value })} aria-label="Nome do link" />
          <Input placeholder="https://" type="url" value={p.url} onChange={(e) => update(i, { url: e.target.value })} aria-label="URL" />
          <Button variant="ghost" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Remover link">
            <Trash2 className="h-4 w-4" />
          </Button>
          <Input
            wrapperClassName="sm:col-span-3"
            placeholder="Quando usar (opcional)"
            value={p.description ?? ""}
            onChange={(e) => update(i, { description: e.target.value })}
            aria-label="Descrição"
          />
        </div>
      ))}
      <Button size="sm" variant="secondary" onClick={() => onChange([...value, { label: "", url: "", description: "" }])}>
        <Plus className="h-4 w-4" /> Adicionar link
      </Button>
    </div>
  );
}
