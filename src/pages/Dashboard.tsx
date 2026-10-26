import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Clock, Minus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/functions";
import { cn } from "@/lib/cn";
import { useRequiredWorkspace } from "@/lib/workspace";
import { formatDateTime, formatPhone } from "@/lib/format";
import { useAgentConfig } from "@/hooks/use-agent-config";
import { useWhatsAppInstances } from "@/hooks/use-whatsapp-instances";
import {
  brl, bucketLabel, bucketTitle, compact, delta, duration, HANDOFF_LABELS, labeledCounts, percent, RANGE_PRESETS, rangeFor,
  CHANNEL_LABELS, TOOL_LABELS, trimFuture, waitingFor, type DashboardData, type QuotesReservations as QuotesData, type RangePreset,
} from "@/lib/dashboard";
import { BarList, ChartCard, ColumnChart, DataTable, Legend, LineChart, StackedBar } from "@/components/charts";
import { Badge, Card, CardBody, CardHeader, ErrorState, Input, PageHeader, Select, Spinner } from "@/components/ui";

const C = { guest: "var(--viz-1)", ai: "var(--viz-2)", team: "var(--viz-3)", handoff: "var(--viz-4)", none: "var(--viz-muted)" };

/** Tela inicial: indicadores dos atendimentos no período e conversas aguardando resposta. */
export default function Dashboard() {
  const { workspaceId } = useRequiredWorkspace();
  const [preset, setPreset] = useState<RangePreset>("7d");
  const [custom, setCustom] = useState(() => rangeFor("7d"));
  const [instanceId, setInstanceId] = useState("");
  const range = useMemo(() => rangeFor(preset, new Date(), custom), [preset, custom]);
  const instances = useWhatsAppInstances(workspaceId);
  const config = useAgentConfig(workspaceId);
  const agent = config.data?.agent_name?.trim() || "IA";

  const query = useQuery({
    queryKey: ["dashboard", workspaceId, range.from, range.to, instanceId],
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
    queryFn: async () =>
      unwrap(await supabase.rpc("get_dashboard", {
        p_workspace_id: workspaceId, p_from: range.from, p_to: range.to, p_instance_id: instanceId || null,
      })) as unknown as DashboardData,
  });

  const sales = useQuery({
    queryKey: ["quotes-reservations", workspaceId, range.from, range.to, instanceId],
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
    queryFn: async () =>
      unwrap(await supabase.rpc("get_quotes_reservations", {
        p_workspace_id: workspaceId, p_from: range.from, p_to: range.to, p_instance_id: instanceId || null,
      })) as unknown as QuotesData,
  });

  return (
    <div className="space-y-5">
      <PageHeader title="Painel de atendimentos" description={`Como a ${agent} e a equipe estão atendendo os hóspedes no período escolhido.`} />

      {/* Filtros: uma linha, valem para tudo abaixo. */}
      <div className="flex flex-wrap items-end gap-3">
        <Select label="Período" value={preset} onChange={(e) => setPreset(e.target.value as RangePreset)} wrapperClassName="w-48">
          {RANGE_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </Select>
        {preset === "custom" && (
          <>
            <Input label="De" type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} wrapperClassName="w-40" />
            <Input label="Até" type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} wrapperClassName="w-40" />
          </>
        )}
        {(instances.data?.length ?? 0) > 1 && (
          <Select label="Instância" value={instanceId} onChange={(e) => setInstanceId(e.target.value)} wrapperClassName="w-56">
            <option value="">Todas as instâncias</option>
            {instances.data!.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </Select>
        )}
        {query.isFetching && !query.isLoading && <Spinner className="mb-2.5 h-4 w-4 text-slate-400" />}
      </div>

      {query.isLoading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : query.data ? (
        <div className={cn("space-y-5 transition-opacity", query.isFetching && query.isPlaceholderData && "opacity-60")}>
          <Waiting data={query.data} />
          <Kpis data={query.data} agent={agent} />
          {sales.data && <QuotesReservations data={sales.data} agent={agent} />}
          <Activity data={query.data} agent={agent} />
          <div className="grid gap-5 lg:grid-cols-2">
            <PeakHours data={query.data} />
            <Outcomes data={query.data} agent={agent} />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <AgentWork data={query.data} agent={agent} />
            <HandoffReasons data={query.data} agent={agent} />
          </div>
          <AiHealth data={query.data} agent={agent} />
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- Aguardando resposta (agora)

function Waiting({ data }: { data: DashboardData }) {
  if (!data.waiting.length) return null;
  return (
    <Card className="border-amber-300 dark:border-amber-800">
      <CardHeader
        title={<span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden /> Aguardando resposta agora ({data.waiting.length})</span>}
        description="Conversas abertas em que a última mensagem é do hóspede."
      />
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {data.waiting.map((w) => (
          <li key={w.conversation_id}>
            <Link to={`/inbox/${w.conversation_id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 sm:px-5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{w.contact_name || formatPhone(w.contact_phone)}</p>
                <p className="truncate text-sm text-slate-500">{w.preview || "(mídia)"}</p>
              </div>
              <Badge tone={w.mode === "bot" ? "brand" : "amber"}>{w.mode === "bot" ? "Bot" : "Equipe"}</Badge>
              <span className="flex items-center gap-1 whitespace-nowrap text-sm text-slate-600 dark:text-slate-300"><Clock className="h-3.5 w-3.5" aria-hidden /> {waitingFor(w.since)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---------------------------------------------------------------- Indicadores

function DeltaText({ current, previous, upIsGood = true, kind = "count" }: { current: number | null; previous: number | null; upIsGood?: boolean; kind?: "count" | "points" | "time" }) {
  const d = delta(current, previous);
  if (!d || (previous === 0 && current === 0)) return <p className="mt-1 text-xs text-slate-400">sem comparação</p>;
  if (d.diff === 0) return <p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><Minus className="h-3 w-3" aria-hidden /> igual ao período anterior</p>;
  const good = d.diff > 0 === upIsGood;
  const Icon = d.diff > 0 ? ArrowUpRight : ArrowDownRight;
  const amount = kind === "time" ? duration(Math.abs(d.diff)) : kind === "points" ? `${Math.abs(d.diff)} p.p.` : compact(Math.abs(d.diff));
  return (
    <p className="mt-1 flex items-center gap-1 text-xs">
      <Icon className="h-3.5 w-3.5" style={{ color: good ? "var(--viz-good)" : "var(--viz-bad)" }} aria-hidden />
      <span className="font-medium text-slate-700 dark:text-slate-200">{d.diff > 0 ? "+" : "−"}{amount}</span>
      <span className="text-slate-500">vs período anterior</span>
    </p>
  );
}

function Tile({ label, value, hint, children, hero }: { label: string; value: string; hint?: string; children?: ReactNode; hero?: boolean }) {
  return (
    <Card className={cn("viz", hero && "sm:col-span-2")}>
      <CardBody>
        <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
        <p className={cn("mt-1 font-semibold text-slate-900 dark:text-slate-100", hero ? "text-5xl" : "text-2xl")}>{value}</p>
        {children}
        {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
      </CardBody>
    </Card>
  );
}

function Kpis({ data, agent }: { data: DashboardData; agent: string }) {
  const c = data.current;
  const p = data.previous;
  const resolved = percent(c.resolved_by_ai, c.conversations);
  const resolvedPrev = percent(p.resolved_by_ai, p.conversations);
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Tile hero label="Conversas atendidas" value={compact(c.conversations)} hint={`${compact(c.new_conversations)} novo(s) contato(s) no período`}>
        <DeltaText current={c.conversations} previous={p.conversations} />
      </Tile>
      <Tile label={`Resolvidas pela ${agent}`} value={resolved === null ? "—" : `${resolved}%`} hint={`${c.resolved_by_ai} de ${c.conversations} conversa(s), sem a equipe`}>
        <DeltaText current={resolved} previous={resolvedPrev} kind="points" />
      </Tile>
      <Tile label="Mensagens recebidas" value={compact(c.received)} hint={`${compact(c.sent_bot)} respostas da ${agent} · ${compact(c.sent_agent)} da equipe`}>
        <DeltaText current={c.received} previous={p.received} />
      </Tile>
      <Tile label={`1ª resposta da ${agent}`} value={duration(c.median_first_reply_bot_s)} hint="mediana do tempo até responder">
        <DeltaText current={c.median_first_reply_bot_s} previous={p.median_first_reply_bot_s} upIsGood={false} kind="time" />
      </Tile>
      <Tile label="1ª resposta da equipe" value={duration(c.median_first_reply_team_s)} hint="mediana, quando a equipe respondeu">
        <DeltaText current={c.median_first_reply_team_s} previous={p.median_first_reply_team_s} upIsGood={false} kind="time" />
      </Tile>
      <Tile label="Transferidas para a equipe" value={compact(c.handed_off_by_ai + c.taken_by_team)} hint={`${c.handed_off_by_ai} pela ${agent} · ${c.taken_by_team} assumidas pela equipe`}>
        <DeltaText current={c.handed_off_by_ai + c.taken_by_team} previous={p.handed_off_by_ai + p.taken_by_team} upIsGood={false} />
      </Tile>
      <Tile label="Sem resposta" value={compact(c.unanswered)} hint="conversas do período que ninguém respondeu">
        <DeltaText current={c.unanswered} previous={p.unanswered} upIsGood={false} />
      </Tile>
    </div>
  );
}

// ---------------------------------------------------------------- Orçamentos x reservas

function QuotesReservations({ data, agent }: { data: QuotesData; agent: string }) {
  const conversion = percent(data.from_quote, data.quoted_conversations);
  // Por canal: valor em R$ (barra) e quantidade (detalhe).
  const channels = labeledCounts(data.by_channel_cents, CHANNEL_LABELS)
    .map((c) => ({ ...c, detail: `${data.by_channel[c.key] ?? 0} reserva(s)` }));
  const channelCounts = labeledCounts(data.by_channel, CHANNEL_LABELS).filter((c) => !data.by_channel_cents[c.key]);
  return (
    <section className="space-y-3" aria-labelledby="quotes-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="quotes-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">Orçamentos e reservas</h2>
        {data.pms_connected && data.tracking_since && (
          <p className="text-xs text-slate-500">Reservas contadas desde {formatDateTime(data.tracking_since)} (início da sincronização com o Hospedin)</p>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Orçamentos realizados" value={compact(data.quotes)} hint={`${data.quoted_conversations} conversa(s) receberam orçamento da ${agent}`} />
        {data.pms_connected ? (
          <>
            <Tile label="Reservas efetuadas" value={brl(data.reservations_total_cents)} hint={`${data.reservations} reserva(s) em todos os canais`}>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Confirmadas: {brl(data.confirmed_total_cents)} ({data.confirmed})</p>
              <p className="text-xs text-slate-600 dark:text-slate-300">Pré-reservas: {brl(data.pre_total_cents)} ({data.pre_reservations})</p>
              {data.canceled > 0 && <p className="mt-0.5 text-xs text-slate-500">Canceladas {brl(data.canceled_total_cents)} ({data.canceled}), fora do total</p>}
            </Tile>
            <Tile label="Reservas após orçamento" value={brl(data.from_quote_total_cents)}
              hint={`${data.from_quote} reserva(s) de hóspedes que receberam orçamento (mesmo telefone, até 30 dias depois)`} />
            <Tile label="Conversão dos orçamentos" value={conversion === null ? "—" : `${conversion}%`}
              hint={`${data.from_quote} reserva(s) de ${data.quoted_conversations} conversa(s) com orçamento`} />
          </>
        ) : (
          <Card className="sm:col-span-1 lg:col-span-3">
            <CardBody className="flex h-full items-center">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Conecte o Hospedin em <Link to="/integrations" className="font-medium text-brand hover:underline">Integrações</Link> para contar as reservas efetuadas e a conversão dos orçamentos.
              </p>
            </CardBody>
          </Card>
        )}
      </div>
      {data.pms_connected && (
        <ChartCard title="Reservas por canal" description="Valor em diárias (R$) das reservas confirmadas e pré-reservas do período, por canal de venda."
          table={<DataTable head={["Canal", "Reservas", "Valor (R$)"]}
            rows={[...channels.map((c) => [c.label, data.by_channel[c.key] ?? 0, brl(c.value * 100)]), ...channelCounts.map((c) => [c.label, c.value, brl(0)])]} />}>
          <BarList items={channels.map((c) => ({ ...c, value: c.value / 100 }))} color={C.guest} empty="Nenhuma reserva nova no período."
            format={(v) => brl(v * 100)} />
        </ChartCard>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- Gráficos

function Activity({ data, agent }: { data: DashboardData; agent: string }) {
  const b = data.range.bucket;
  const series = [
    { key: "received", label: "Recebidas", color: C.guest },
    { key: "bot", label: `Respostas da ${agent}`, color: C.ai },
    { key: "agent", label: "Respostas da equipe", color: C.team },
  ];
  const totals = { received: data.current.received, bot: data.current.sent_bot, agent: data.current.sent_agent };
  const points = trimFuture(data.series, b, data.range.timezone);
  return (
    <ChartCard
      title={b === "hour" ? "Mensagens por hora" : "Mensagens por dia"}
      description="Recebidas dos hóspedes e respostas enviadas."
      table={<DataTable head={[b === "hour" ? "Hora" : "Dia", ...series.map((s) => s.label)]}
        rows={points.map((p) => [bucketTitle(p.t, b), p.received, p.bot, p.agent])} />}
    >
      <div className="space-y-3">
        <Legend line items={series.map((s) => ({ label: s.label, color: s.color, value: compact(totals[s.key as keyof typeof totals]) }))} />
        <LineChart points={points as never} series={series}
          xLabel={(i) => bucketLabel(points[i].t, b)} xTitle={(i) => bucketTitle(points[i].t, b)} />
      </div>
    </ChartCard>
  );
}

function PeakHours({ data }: { data: DashboardData }) {
  const values = data.by_hour.map((h) => h.received);
  return (
    <ChartCard title="Horário de pico" description="Mensagens recebidas por hora do dia."
      table={<DataTable head={["Hora", "Mensagens"]} rows={data.by_hour.filter((h) => h.received > 0).map((h) => [`${h.hour}h–${h.hour + 1}h`, h.received])} />}>
      <ColumnChart values={values} color={C.guest} valueLabel="mensagens recebidas" labelEvery={3}
        labels={data.by_hour.map((h) => `${h.hour}h`)} titles={data.by_hour.map((h) => `${h.hour}h–${h.hour + 1}h`)} />
    </ChartCard>
  );
}

function Outcomes({ data, agent }: { data: DashboardData; agent: string }) {
  const c = data.current;
  const parts = [
    { key: "ai", label: `Resolvidas pela ${agent}`, value: c.resolved_by_ai, color: C.ai },
    { key: "team", label: "Assumidas pela equipe", value: c.taken_by_team, color: C.team },
    { key: "handoff", label: `Transferidas pela ${agent}`, value: c.handed_off_by_ai, color: C.handoff },
    { key: "none", label: "Sem resposta", value: c.unanswered, color: C.none },
  ];
  return (
    <ChartCard title="Desfecho das conversas" description="Quem atendeu cada conversa do período."
      table={<DataTable head={["Desfecho", "Conversas", "%"]} rows={parts.map((p) => [p.label, p.value, `${percent(p.value, c.conversations) ?? 0}%`])} />}>
      <StackedBar parts={parts} total={c.conversations} />
    </ChartCard>
  );
}

function AgentWork({ data, agent }: { data: DashboardData; agent: string }) {
  const items = labeledCounts(data.tools, TOOL_LABELS);
  return (
    <ChartCard title={`O que a ${agent} fez`} description="Respostas em que ela usou cada recurso."
      table={<DataTable head={["Recurso", "Respostas"]} rows={items.map((i) => [i.label, i.value])} />}>
      <BarList items={items} color={C.ai} empty="Nenhuma consulta, cotação ou envio de fotos no período." />
    </ChartCard>
  );
}

function HandoffReasons({ data, agent }: { data: DashboardData; agent: string }) {
  const items = labeledCounts(data.handoff_reasons, HANDOFF_LABELS);
  return (
    <ChartCard title="Motivos de transferência" description={`Por que a ${agent} passou a conversa para a equipe.`}
      table={<DataTable head={["Motivo", "Transferências"]} rows={items.map((i) => [i.label, i.value])} />}>
      <BarList items={items} color={C.handoff} empty={`A ${agent} não transferiu nenhuma conversa no período.`} />
    </ChartCard>
  );
}

function AiHealth({ data, agent }: { data: DashboardData; agent: string }) {
  const c = data.current;
  return (
    <p className="text-xs text-slate-500 dark:text-slate-400">
      {agent}: {compact(c.ai_runs)} processamento(s) no período
      {c.ai_avg_latency_ms !== null && <> · tempo médio de processamento {duration(c.ai_avg_latency_ms / 1000)}</>}
      {" · "}
      {c.ai_failed > 0
        ? <span className="inline-flex items-center gap-1 font-medium text-red-700 dark:text-red-400"><AlertTriangle className="h-3 w-3" aria-hidden /> {c.ai_failed} falha(s) de envio — veja em Logs</span>
        : "sem falhas"}
    </p>
  );
}
