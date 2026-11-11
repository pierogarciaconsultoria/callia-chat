import { useState, type FormEvent } from "react";
import { CalendarSearch, ExternalLink } from "lucide-react";
import {
  Button,
  EmptyState,
  Input,
  Modal,
  Notice,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui";
import { errorMessage } from "@/lib/functions";
import { formatMoney } from "@/lib/format";
import { isoToBr, nextWeekend, parseChildrenAges } from "@/lib/integrations";
import type { AvailabilityTest, TableAvailability } from "@/lib/database.types";
import { useIntegrationActions } from "@/hooks/use-integrations";

/** Resultado como a MarIA recebe: valores da tabela de preços, vaga do sistema de reservas por acomodação. */
function TableAvailabilityView({
  data,
  tabela,
}: {
  data: AvailabilityTest;
  tabela: TableAvailability;
}) {
  const options = tabela.opcoes ?? [];
  const link = tabela.link_reserva ?? data.booking_link;
  const header = (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600 dark:text-slate-300">
      <span>
        {data.checkin} → {data.checkout} · {tabela.noites ?? data.nights}{" "}
        noite(s) · {data.adults} adulto(s)
        {data.children_ages.length
          ? ` · crianças: ${data.children_ages.join(", ")} anos`
          : ""}
        {tabela.periodos?.length ? ` · ${tabela.periodos.join(" + ")}` : ""}
      </span>
      {link && (
        <a
          href={link}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium text-brand hover:underline"
        >
          Link de reserva <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
  const notices = (
    <>
      {tabela.fechado && (
        <Notice tone="warn">
          Hotel fechado nessas datas ({tabela.periodos_fechados}). A MarIA não
          cota e sugere outras datas.
        </Notice>
      )}
      {tabela.sem_tarifa && (
        <Notice tone="warn">
          Sem valores cadastrados para essas datas (tabela:{" "}
          {tabela.temporada_cadastrada}). A MarIA não cota nem confirma vaga.
        </Notice>
      )}
      {tabela.erro && <Notice tone="warn">{tabela.erro}</Notice>}
      {tabela.atende_estadia_minima === false && (
        <Notice tone="warn">
          Abaixo do mínimo de {tabela.estadia_minima} diárias para esse período.
        </Notice>
      )}
      {tabela.sem_opcao && <Notice tone="warn">{tabela.sem_opcao}</Notice>}
    </>
  );
  const lists = (
    <ul className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
      {tabela.sem_vaga?.length ? (
        <li>
          <span className="font-medium">Sem vaga no sistema de reservas:</span>{" "}
          {tabela.sem_vaga.join(", ")}
        </li>
      ) : null}
      {tabela.nao_verificadas?.length ? (
        <li>
          <span className="font-medium">
            Sem categoria do PMS vinculada (vaga não verificada):
          </span>{" "}
          {tabela.nao_verificadas.map((o) => o.acomodacao).join(", ")}
        </li>
      ) : null}
      {tabela.nao_comportam?.length ? (
        <li>
          <span className="font-medium">Não comportam o grupo:</span>{" "}
          {tabela.nao_comportam.join(", ")}
        </li>
      ) : null}
    </ul>
  );
  return (
    <div className="space-y-3">
      {header}
      {notices}
      {options.length ? (
        <Table>
          <THead>
            <tr>
              <TH>Acomodação</TH>
              <TH>Períodos</TH>
              <TH>Total (tabela)</TH>
              <TH>Vaga</TH>
            </tr>
          </THead>
          <TBody>
            {options.map((o) => (
              <TR key={o.acomodacao}>
                <TD className="font-medium">
                  {o.acomodacao}
                  {o.tarifa && (
                    <span className="block text-xs font-normal text-slate-500">
                      {o.tarifa}
                    </span>
                  )}
                </TD>
                <TD className="text-xs text-slate-500">
                  {o.detalhamento
                    ?.map(
                      (d) =>
                        `${d.noites} × ${d.diaria_formatada} (${d.periodo})`,
                    )
                    .join(" + ") ?? "—"}
                </TD>
                <TD className="whitespace-nowrap font-medium">
                  {o.total_formatado}
                </TD>
                <TD>
                  {o.unidades_disponiveis != null
                    ? `${o.unidades_disponiveis} unidade(s)`
                    : "não verificada"}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : !tabela.fechado && !tabela.sem_tarifa && !tabela.erro ? (
        <EmptyState
          title="Sem disponibilidade"
          description="Nenhuma acomodação que comporta o grupo tem vaga nessas datas no sistema de reservas."
        />
      ) : null}
      {lists}
      {data.rooms.length > 0 && (
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer">
            Tarifas base do{" "}
            {data.provider === "hospedin" ? "Hospedin" : "motor de reservas"}{" "}
            (referência; a MarIA não as usa)
          </summary>
          <ul className="mt-1 list-disc pl-5">
            {data.rooms.map((r, i) => (
              <li key={`${r.name}-${i}`}>
                {r.name}: {formatMoney(r.price_per_night, data.currency)}/noite
                · {r.available_units ?? "—"} unidade(s)
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Resultado de uma consulta de disponibilidade (mesmo formato que o agente recebe). */
export function AvailabilityTable({ data }: { data: AvailabilityTest }) {
  if (data.tabela)
    return <TableAvailabilityView data={data} tabela={data.tabela} />;
  const header = (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600 dark:text-slate-300">
      <span>
        {data.checkin} → {data.checkout} · {data.nights} noite(s) ·{" "}
        {data.adults} adulto(s)
        {data.children_ages.length
          ? ` · crianças: ${data.children_ages.join(", ")} anos`
          : ""}
      </span>
      {data.booking_link && (
        <a
          href={data.booking_link}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium text-brand hover:underline"
        >
          Link de reserva <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
  if (data.sold_out || !data.rooms.length) {
    return (
      <div className="space-y-3">
        {header}
        <EmptyState
          title="Sem disponibilidade"
          description="Nenhuma acomodação livre em todas as noites desse período. Tente outras datas."
        />
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
                {r.rate && (
                  <span className="block text-xs font-normal text-slate-500">
                    {r.rate}
                  </span>
                )}
              </TD>
              {showCapacity && (
                <TD>{r.capacity != null ? `${r.capacity} pessoa(s)` : "—"}</TD>
              )}
              <TD className="whitespace-nowrap">
                {formatMoney(r.price_per_night, data.currency)}
              </TD>
              <TD className="whitespace-nowrap font-medium">
                {formatMoney(r.total_price, data.currency)}
              </TD>
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
    test.mutate({
      kind,
      checkin: isoToBr(checkin),
      checkout: isoToBr(checkout),
      adults,
      children_ages: parsedAges,
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description="É a mesma consulta que a MarIA faz quando um hóspede pergunta por datas: vaga pelo sistema de reservas, valores pela tabela de preços."
      size="lg"
    >
      <form
        onSubmit={submit}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <Input
          label="Entrada"
          type="date"
          value={checkin}
          onChange={(e) => setCheckin(e.target.value)}
          required
        />
        <Input
          label="Saída"
          type="date"
          value={checkout}
          min={checkin}
          onChange={(e) => setCheckout(e.target.value)}
          required
        />
        <Input
          label="Adultos"
          type="number"
          min={1}
          max={20}
          value={adults}
          onChange={(e) => setAdults(Math.max(1, Number(e.target.value) || 1))}
        />
        <Input
          label="Idades das crianças"
          placeholder="ex.: 5, 8"
          value={ages}
          onChange={(e) => setAges(e.target.value)}
          error={
            parsedAges
              ? undefined
              : "Use idades de 0 a 17, separadas por vírgula"
          }
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
