import { useState, type FormEvent } from "react";
import { CalendarSearch, ExternalLink } from "lucide-react";
import { Button, EmptyState, Input, Modal, Notice, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { errorMessage } from "@/lib/functions";
import { formatMoney } from "@/lib/format";
import { isoToBr, nextWeekend, parseChildrenAges } from "@/lib/integrations";
import type { AvailabilityTest } from "@/lib/database.types";
import { useIntegrationActions } from "@/hooks/use-integrations";

/** Resultado de uma consulta de disponibilidade (mesmo formato que o agente recebe). */
export function AvailabilityTable({ data }: { data: AvailabilityTest }) {
  const header = (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600 dark:text-slate-300">
      <span>
        {data.checkin} → {data.checkout} · {data.nights} noite(s) · {data.adults} adulto(s)
        {data.children_ages.length ? ` · crianças: ${data.children_ages.join(", ")} anos` : ""}
      </span>
      {data.booking_link && (
        <a href={data.booking_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-brand hover:underline">
          Link de reserva <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
  if (data.sold_out || !data.rooms.length) {
    return (
      <div className="space-y-3">
        {header}
        <EmptyState title="Sem disponibilidade" description="Nenhuma acomodação livre em todas as noites desse período. Tente outras datas." />
      </div>
    );
  }
  const showCapacity = data.rooms.some((r) => r.capacity != null);
  return (
    <div className="space-y-3">
      {header}
      <Table>
        <THead>
          <tr>
            <TH>Categoria</TH>
            {showCapacity && <TH>Capacidade</TH>}
            <TH>Por noite</TH>
            <TH>Total</TH>
            <TH>Unidades</TH>
          </tr>
        </THead>
        <TBody>
          {data.rooms.map((r, i) => (
            <TR key={`${r.name}-${i}`}>
              <TD className="font-medium">
                {r.name}
                {r.rate && <span className="block text-xs font-normal text-slate-500">{r.rate}</span>}
              </TD>
              {showCapacity && <TD>{r.capacity != null ? `${r.capacity} pessoa(s)` : "—"}</TD>}
              <TD className="whitespace-nowrap">{formatMoney(r.price_per_night, data.currency)}</TD>
              <TD className="whitespace-nowrap font-medium">{formatMoney(r.total_price, data.currency)}</TD>
              <TD>{r.available_units ?? "—"}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

/** Formulário de consulta de teste: datas (padrão: próximo fim de semana), adultos e idades das crianças. */
export function AvailabilityTestDialog({
  open,
  onClose,
  workspaceId,
  kind,
  title = "Testar consulta de disponibilidade",
}: {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  kind: "hospedin" | "hbook";
  title?: string;
}) {
  const { test } = useIntegrationActions(workspaceId);
  const initial = nextWeekend();
  const [checkin, setCheckin] = useState(initial.checkin);
  const [checkout, setCheckout] = useState(initial.checkout);
  const [adults, setAdults] = useState(2);
  const [ages, setAges] = useState("");
  const parsedAges = parseChildrenAges(ages);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!parsedAges) return;
    test.mutate({ kind, checkin: isoToBr(checkin), checkout: isoToBr(checkout), adults, children_ages: parsedAges });
  }

  return (
    <Modal open={open} onClose={onClose} title={title} description="É a mesma consulta que a MarIA faz quando um hóspede pergunta por datas." size="lg">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input label="Entrada" type="date" value={checkin} onChange={(e) => setCheckin(e.target.value)} required />
        <Input label="Saída" type="date" value={checkout} min={checkin} onChange={(e) => setCheckout(e.target.value)} required />
        <Input label="Adultos" type="number" min={1} max={20} value={adults} onChange={(e) => setAdults(Math.max(1, Number(e.target.value) || 1))} />
        <Input
          label="Idades das crianças"
          placeholder="ex.: 5, 8"
          value={ages}
          onChange={(e) => setAges(e.target.value)}
          error={parsedAges ? undefined : "Use idades de 0 a 17, separadas por vírgula"}
        />
        <div className="sm:col-span-2 lg:col-span-4">
          <Button type="submit" loading={test.isPending} disabled={!parsedAges}>
            <CalendarSearch className="h-4 w-4" /> Consultar
          </Button>
        </div>
      </form>
      <div className="mt-4">
        {test.error && <Notice tone="warn">{errorMessage(test.error)}</Notice>}
        {test.data?.test && <AvailabilityTable data={test.data.test} />}
      </div>
    </Modal>
  );
}
