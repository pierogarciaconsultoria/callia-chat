import { useCallback, useMemo, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Calculator, Pencil, Plus, Table2, Trash2 } from "lucide-react";
import { ApiError, invokeFunction } from "@/lib/functions";
import { formatMoney } from "@/lib/format";
import { useRequiredWorkspace } from "@/lib/workspace";
import { useProducts } from "@/hooks/use-knowledge";
import { findIntegration, useIntegrations } from "@/hooks/use-integrations";
import {
  emptyRate, formatBRLInput, fromEditor, newKey, parseBRL, serverIssues, starterEditor, toEditor,
  type EditorModel, type EditorPeriod, type EditorRate, type EditorUnit, type PriceTable, type ServerIssue,
} from "@/lib/price-table";
import { Badge, Button, Card, CardBody, CardHeader, Checkbox, EmptyState, ErrorState, Input, Modal, Spinner, Table, TBody, TD, TH, THead, TR, useToast } from "@/components/ui";

interface QuoteOption { acomodacao: string; tarifa: string; total_formatado: string; detalhamento: Array<{ periodo: string; noites: number; diaria_formatada: string; subtotal_formatado: string }> }
interface Quote { noites: number; hospedes: number; periodos: string[]; estadia_minima: number; atende_estadia_minima: boolean; opcoes: QuoteOption[]; sem_opcao?: string; erro?: string; fechado?: boolean; periodos_fechados?: string }

const brDate = (iso: string) => iso.split("-").reverse().join("/");
const toBr = (v: string) => (v ? v.split("-").reverse().join("/") : "");

const rateLabel = (r: { label?: string; guests: number; max_adults?: number | null; child_max_age?: number | null }) =>
  r.label || `até ${r.guests} pessoa(s)${r.max_adults ? ` (máx. ${r.max_adults} adulto(s), criança até ${r.child_max_age ?? 0} anos)` : ""}`;

/** Tabela de preços estruturada: o que a MarIA usa para calcular valores (sem fazer conta). */
export function PriceTableCard({ workspaceId }: { workspaceId: string }) {
  const { isAdmin } = useRequiredWorkspace();
  const [editing, setEditing] = useState<EditorModel | null>(null);
  const table = useQuery({
    queryKey: ["price-table", workspaceId],
    queryFn: async () => (await invokeFunction<{ price_table: PriceTable | null }>("knowledge-index", { action: "price_table_get", workspace_id: workspaceId })).price_table,
  });

  return (
    <Card>
      <CardHeader
        title="Tabela de preços"
        description="A MarIA calcula os valores por esta tabela, noite a noite, pelo período e pelo número de pessoas — ela não faz contas."
        actions={isAdmin && table.data ? (
          <Button size="sm" variant="secondary" onClick={() => setEditing(toEditor(table.data!.name, table.data!.data))}>
            <Pencil className="h-4 w-4" /> Editar tabela
          </Button>
        ) : undefined}
      />
      {table.isLoading ? (
        <CardBody className="flex justify-center"><Spinner /></CardBody>
      ) : table.error ? (
        <CardBody><ErrorState error={table.error} onRetry={() => void table.refetch()} /></CardBody>
      ) : !table.data ? (
        <div className="pb-4">
          <EmptyState icon={Table2} title="Nenhuma tabela de preços" description="Cadastre períodos, acomodações e valores por número de pessoas; a MarIA passa a calcular os valores automaticamente." />
          {isAdmin && <div className="flex justify-center"><Button onClick={() => setEditing(starterEditor())}><Plus className="h-4 w-4" /> Criar tabela de preços</Button></div>}
        </div>
      ) : (
        <PriceTableView table={table.data} workspaceId={workspaceId} />
      )}
      {editing && (
        <PriceTableEditor
          workspaceId={workspaceId}
          currency={table.data?.currency ?? "BRL"}
          initial={editing}
          creating={!table.data}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}

function PriceTableView({ table, workspaceId }: { table: PriceTable; workspaceId: string }) {
  const { periods, units, notes, default_period, closed } = table.data;
  return (
    <div className="space-y-5 pb-4">
      <CardBody className="space-y-2 pb-0">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Períodos</p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {periods.map((p) => (
            <li key={p.id} className="rounded-lg border border-slate-200 p-2.5 text-sm dark:border-slate-800">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium">{p.name}</span>
                {p.min_nights ? <Badge>mín. {p.min_nights} diárias</Badge> : null}
                {p.id === default_period && <Badge tone="brand">{p.ranges.length ? "padrão nas lacunas da temporada" : "padrão fora dos períodos"}</Badge>}
              </div>
              <p className="mt-1 text-xs text-slate-500">{p.ranges.map(([a, b]) => `${brDate(a)} a ${brDate(b)}`).join(" · ") || "—"}</p>
            </li>
          ))}
        </ul>
        {closed?.length ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            <span className="font-medium">Fechado:</span> {closed.map((c) => `${c.name} (${brDate(c.from)} a ${brDate(c.to)})`).join(" · ")}
          </p>
        ) : null}
      </CardBody>

      <div className="overflow-x-auto">
        <Table>
          <THead>
            <tr>
              <TH>Acomodação</TH>
              {periods.map((p) => <TH key={p.id} className="whitespace-nowrap text-right">{p.name}</TH>)}
            </tr>
          </THead>
          <TBody>
            {units.flatMap((u, ui) =>
              u.rates.map((r, i) => (
                <TR key={`${ui}-${i}`}>
                  <TD className="min-w-[200px]">
                    {i === 0 && <p className="font-medium text-slate-900 dark:text-slate-100">{u.name} <span className="text-xs font-normal text-slate-500">· máx. {u.max_guests}</span></p>}
                    <p className="text-xs text-slate-500">{rateLabel(r)}</p>
                  </TD>
                  {periods.map((p) => (
                    <TD key={p.id} className="whitespace-nowrap text-right tabular-nums">
                      {r.prices[p.id] !== undefined ? formatMoney(r.prices[p.id], table.currency) : "—"}
                    </TD>
                  ))}
                </TR>
              ))
            )}
          </TBody>
        </Table>
      </div>
      {notes?.length ? <CardBody className="py-0"><ul className="list-disc pl-5 text-xs text-slate-500">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul></CardBody> : null}
      <QuoteSimulator workspaceId={workspaceId} />
    </div>
  );
}

// ---------------------------------------------------------------- Editor

function PriceTableEditor({ workspaceId, currency, initial, creating, onClose }: {
  workspaceId: string; currency: string; initial: EditorModel; creating: boolean; onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const products = useProducts(workspaceId);
  const integrations = useIntegrations(workspaceId);
  const hospedin = findIntegration(integrations.data, "hospedin");
  const pmsCategories = hospedin?.status === "connected" ? ((hospedin.details as { categories?: Array<{ id: number; title: string }> }).categories ?? []) : [];
  const [model, setModel] = useState(initial);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [remote, setRemote] = useState<ServerIssue[]>([]);
  const snapshot = useRef(JSON.stringify(initial));
  const dirty = JSON.stringify(model) !== snapshot.current;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const result = useMemo(() => fromEditor(model), [model]);
  const errors = useMemo(() => new Map(showErrors ? result.issues.map((i) => [i.field, i.message] as const).reverse() : []), [result, showErrors]);
  const err = (field: string) => errors.get(field);

  // Estável: o Modal refaz o foco quando onClose muda.
  const requestClose = useCallback(() => {
    if (dirtyRef.current && !window.confirm("Descartar as alterações na tabela de preços?")) return;
    onClose();
  }, [onClose]);

  const patch = (fn: (m: EditorModel) => EditorModel) => setModel((m) => fn(m));
  const patchPeriod = (key: string, change: Partial<EditorPeriod>) =>
    patch((m) => ({ ...m, periods: m.periods.map((p) => (p.key === key ? { ...p, ...change } : p)) }));
  const patchUnit = (key: string, change: Partial<EditorUnit>) =>
    patch((m) => ({ ...m, units: m.units.map((u) => (u.key === key ? { ...u, ...change } : u)) }));
  const patchRate = (unitKey: string, rateKey: string, change: Partial<EditorRate>) =>
    patch((m) => ({ ...m, units: m.units.map((u) => (u.key === unitKey ? { ...u, rates: u.rates.map((r) => (r.key === rateKey ? { ...r, ...change } : r)) } : u)) }));
  const moveUnit = (index: number, delta: number) =>
    patch((m) => {
      const units = [...m.units];
      const [u] = units.splice(index, 1);
      units.splice(index + delta, 0, u);
      return { ...m, units };
    });

  async function save(e?: FormEvent) {
    e?.preventDefault();
    setShowErrors(true);
    setRemote([]);
    if (!result.data) return;
    setSaving(true);
    try {
      const res = await invokeFunction<{ price_table: PriceTable }>("knowledge-index", {
        action: "price_table_save", workspace_id: workspaceId, name: model.name.trim(), currency, data: result.data,
      });
      queryClient.setQueryData(["price-table", workspaceId], res.price_table);
      await queryClient.invalidateQueries({ queryKey: ["price-table", workspaceId] });
      toast.success(creating ? "Tabela de preços criada." : "Tabela de preços salva.");
      onClose();
    } catch (error) {
      const issues = error instanceof ApiError ? serverIssues(error.details, result.data) : [];
      if (issues.length) setRemote(issues);
      else toast.error(error);
    } finally {
      setSaving(false);
    }
  }

  const issueCount = showErrors ? result.issues.length : 0;

  return (
    <Modal
      open
      size="lg"
      onClose={requestClose}
      title={creating ? "Criar tabela de preços" : "Editar tabela de preços"}
      description="Valores por diária. Uma noite fora dos intervalos usa o período padrão; em intervalos sobrepostos vale o que começa mais tarde."
      footer={
        <>
          {issueCount > 0 && <p className="mr-auto self-center text-sm text-red-600">Corrija {issueCount === 1 ? "o campo destacado" : `os ${issueCount} campos destacados`}.</p>}
          <Button variant="secondary" onClick={requestClose}>Cancelar</Button>
          <Button onClick={() => void save()} loading={saving} disabled={!dirty && !creating}>Salvar tabela</Button>
        </>
      }
    >
      <form onSubmit={save} className="space-y-6">
        {remote.length > 0 && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            <p className="font-medium">O servidor recusou a tabela:</p>
            <ul className="mt-1 list-disc pl-5">{remote.map((i, n) => <li key={n}><span className="font-medium">{i.path}:</span> {i.message}</li>)}</ul>
          </div>
        )}
        <Input label="Nome da tabela" value={model.name} maxLength={120} error={err("name")} onChange={(e) => patch((m) => ({ ...m, name: e.target.value }))} />

        <section className="space-y-3">
          <SectionTitle title="Períodos" hint="Datas incluem início e fim. O período padrão vale para as datas fora de qualquer intervalo." />
          {err("default") && <p className="text-sm text-red-600">{err("default")}</p>}
          {model.periods.map((p) => {
            const isDefault = p.key === model.defaultKey;
            return (
              <div key={p.key} className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
                  <Input label="Nome do período" value={p.name} maxLength={80} error={err(`p:${p.key}:name`)} onChange={(e) => patchPeriod(p.key, { name: e.target.value })} />
                  <Input label="Mín. diárias" type="number" min={1} max={60} placeholder="—" value={p.min_nights} error={err(`p:${p.key}:min`)} onChange={(e) => patchPeriod(p.key, { min_nights: e.target.value })} />
                </div>
                <div className="space-y-2">
                  {p.ranges.map(([a, b], i) => (
                    <div key={i} className="space-y-1">
                      <div className="flex items-end gap-2">
                        <Input wrapperClassName="flex-1" label={i === 0 ? "De" : undefined} aria-label="Início" type="date" value={a}
                          onChange={(e) => patchPeriod(p.key, { ranges: p.ranges.map((r, j) => (j === i ? [e.target.value, r[1]] : r)) })} />
                        <Input wrapperClassName="flex-1" label={i === 0 ? "Até" : undefined} aria-label="Fim" type="date" value={b} min={a || undefined}
                          onChange={(e) => patchPeriod(p.key, { ranges: p.ranges.map((r, j) => (j === i ? [r[0], e.target.value] : r)) })} />
                        <IconButton label="Remover intervalo" onClick={() => patchPeriod(p.key, { ranges: p.ranges.filter((_, j) => j !== i) })} />
                      </div>
                      {err(`p:${p.key}:r${i}`) && <p className="text-xs text-red-600">{err(`p:${p.key}:r${i}`)}</p>}
                    </div>
                  ))}
                  {!p.ranges.length && <p className="text-xs text-slate-500">{isDefault ? "Sem intervalos: vale para todas as datas não cobertas por outro período." : "Sem intervalos: este período nunca será aplicado."}</p>}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <Button size="sm" variant="ghost" onClick={() => patchPeriod(p.key, { ranges: [...p.ranges, ["", ""]] })}><Plus className="h-4 w-4" /> Intervalo de datas</Button>
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                      <input type="radio" name="default-period" checked={isDefault} onChange={() => patch((m) => ({ ...m, defaultKey: p.key }))} className="h-4 w-4 border-slate-300 text-brand focus:ring-brand/40" />
                      Período padrão
                    </label>
                  </div>
                  <Button size="sm" variant="ghost" disabled={isDefault} title={isDefault ? "Escolha outro período padrão antes de remover" : undefined}
                    onClick={() => patch((m) => ({ ...m, periods: m.periods.filter((x) => x.key !== p.key) }))}>
                    <Trash2 className="h-4 w-4" /> Remover período
                  </Button>
                </div>
              </div>
            );
          })}
          {err("periods") && <p className="text-sm text-red-600">{err("periods")}</p>}
          <Button size="sm" variant="secondary" onClick={() => patch((m) => ({ ...m, periods: [...m.periods, { key: newKey("p"), id: null, name: "", min_nights: "", ranges: [["", ""]] }] }))}>
            <Plus className="h-4 w-4" /> Adicionar período
          </Button>
        </section>

        <section className="space-y-3">
          <SectionTitle title="Períodos fechados" hint="Datas em que o hotel não funciona. A MarIA não cota estadias com noites nesses dias." />
          {model.closed.map((c) => (
            <div key={c.key} className="space-y-1">
              <div className="grid items-end gap-2 sm:grid-cols-[1fr_10rem_10rem_auto]">
                <Input label="Motivo" placeholder="Inverno" value={c.name} maxLength={80} error={err(`c:${c.key}:name`)}
                  onChange={(e) => patch((m) => ({ ...m, closed: m.closed.map((x) => (x.key === c.key ? { ...x, name: e.target.value } : x)) }))} />
                <Input label="De" type="date" value={c.from}
                  onChange={(e) => patch((m) => ({ ...m, closed: m.closed.map((x) => (x.key === c.key ? { ...x, from: e.target.value } : x)) }))} />
                <Input label="Até" type="date" value={c.to} min={c.from || undefined}
                  onChange={(e) => patch((m) => ({ ...m, closed: m.closed.map((x) => (x.key === c.key ? { ...x, to: e.target.value } : x)) }))} />
                <IconButton label="Remover fechamento" onClick={() => patch((m) => ({ ...m, closed: m.closed.filter((x) => x.key !== c.key) }))} />
              </div>
              {err(`c:${c.key}:dates`) && <p className="text-xs text-red-600">{err(`c:${c.key}:dates`)}</p>}
            </div>
          ))}
          <Button size="sm" variant="secondary" onClick={() => patch((m) => ({ ...m, closed: [...m.closed, { key: newKey("c"), name: "", from: "", to: "" }] }))}>
            <Plus className="h-4 w-4" /> Adicionar período fechado
          </Button>
        </section>

        <section className="space-y-3">
          <SectionTitle title="Acomodações" hint="Uma linha por faixa de ocupação, com o valor da diária em cada período." />
          {model.units.map((u, ui) => (
            <div key={u.key} className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
                <Input label="Nome da acomodação" value={u.name} maxLength={120} error={err(`u:${u.key}:name`)} onChange={(e) => patchUnit(u.key, { name: e.target.value })} />
                <Input label="Máx. pessoas" type="number" min={1} max={30} value={u.max_guests} error={err(`u:${u.key}:max`)} onChange={(e) => patchUnit(u.key, { max_guests: e.target.value })} />
              </div>
              {products.data?.length ? (
                <div>
                  <p className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">Itens do catálogo</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {products.data.map((prod) => (
                      <Checkbox key={prod.id} label={prod.active ? prod.name : `${prod.name} (inativo)`} checked={u.product_ids.includes(prod.id)}
                        onChange={(on) => patchUnit(u.key, { product_ids: on ? [...u.product_ids, prod.id] : u.product_ids.filter((id) => id !== prod.id) })} />
                    ))}
                  </div>
                </div>
              ) : null}
              {pmsCategories.length ? (
                <div>
                  <p className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">Categorias no Hospedin <span className="font-normal text-slate-500">(a vaga vem de lá; o preço, desta tabela)</span></p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {pmsCategories.map((cat) => (
                      <Checkbox key={cat.id} label={cat.title} checked={u.pms_category_ids.includes(cat.id)}
                        onChange={(on) => patchUnit(u.key, { pms_category_ids: on ? [...u.pms_category_ids, cat.id] : u.pms_category_ids.filter((id) => id !== cat.id) })} />
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="space-y-2">
                {u.rates.map((r) => (
                  <div key={r.key} className="space-y-2 rounded-md bg-slate-50 p-2.5 dark:bg-slate-950/40">
                    <div className="grid grid-cols-[7rem_1fr_auto] items-end gap-2">
                      <Input label="Até (pessoas)" type="number" min={1} max={30} value={r.guests} error={err(`r:${r.key}:guests`)} onChange={(e) => patchRate(u.key, r.key, { guests: e.target.value })} />
                      <Input label="Rótulo (opcional)" placeholder={`até ${r.guests || "N"} pessoas`} value={r.label} maxLength={80} onChange={(e) => patchRate(u.key, r.key, { label: e.target.value })} />
                      <IconButton label="Remover tarifa" onClick={() => patchUnit(u.key, { rates: u.rates.filter((x) => x.key !== r.key) })} />
                    </div>
                    <Checkbox label="Tarifa com criança (limita adultos)" checked={r.childRule} onChange={(childRule) => patchRate(u.key, r.key, { childRule })} />
                    {r.childRule && (
                      <div className="grid grid-cols-2 gap-2 sm:max-w-sm">
                        <Input label="Máx. adultos" type="number" min={1} max={30} value={r.max_adults} error={err(`r:${r.key}:adults`)} onChange={(e) => patchRate(u.key, r.key, { max_adults: e.target.value })} />
                        <Input label="Idade máx. criança" type="number" min={0} max={17} value={r.child_max_age} error={err(`r:${r.key}:age`)} onChange={(e) => patchRate(u.key, r.key, { child_max_age: e.target.value })} />
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {model.periods.map((p) => (
                        <Input key={p.key} label={p.name || "Período"} inputMode="decimal" placeholder="0,00" value={r.prices[p.key] ?? ""}
                          error={err(`r:${r.key}:price:${p.key}`) ? "Informe o valor" : undefined}
                          onChange={(e) => patchRate(u.key, r.key, { prices: { ...r.prices, [p.key]: e.target.value } })}
                          onBlur={(e) => {
                            const v = parseBRL(e.target.value);
                            if (v !== null) patchRate(u.key, r.key, { prices: { ...r.prices, [p.key]: formatBRLInput(v) } });
                          }} />
                      ))}
                    </div>
                  </div>
                ))}
                {err(`u:${u.key}:rates`) && <p className="text-sm text-red-600">{err(`u:${u.key}:rates`)}</p>}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button size="sm" variant="ghost" onClick={() => patchUnit(u.key, { rates: [...u.rates, emptyRate()] })}><Plus className="h-4 w-4" /> Faixa de ocupação</Button>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" aria-label="Mover para cima" disabled={ui === 0} onClick={() => moveUnit(ui, -1)}><ArrowUp className="h-4 w-4" /></Button>
                  <Button size="sm" variant="ghost" aria-label="Mover para baixo" disabled={ui === model.units.length - 1} onClick={() => moveUnit(ui, 1)}><ArrowDown className="h-4 w-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => patch((m) => ({ ...m, units: m.units.filter((x) => x.key !== u.key) }))}><Trash2 className="h-4 w-4" /> Remover acomodação</Button>
                </div>
              </div>
            </div>
          ))}
          {err("units") && <p className="text-sm text-red-600">{err("units")}</p>}
          <Button size="sm" variant="secondary" onClick={() => patch((m) => ({ ...m, units: [...m.units, { key: newKey("u"), name: "", max_guests: "2", product_ids: [], pms_category_ids: [], rates: [emptyRate()] }] }))}>
            <Plus className="h-4 w-4" /> Adicionar acomodação
          </Button>
        </section>

        <section className="space-y-3">
          <SectionTitle title="Observações" hint="Regras que a MarIA informa junto com o valor (ex.: café da manhã incluso)." />
          {model.notes.map((n, i) => (
            <div key={i} className="flex items-end gap-2">
              <Input wrapperClassName="flex-1" aria-label={`Observação ${i + 1}`} value={n} maxLength={300}
                onChange={(e) => patch((m) => ({ ...m, notes: m.notes.map((x, j) => (j === i ? e.target.value : x)) }))} />
              <IconButton label="Remover observação" onClick={() => patch((m) => ({ ...m, notes: m.notes.filter((_, j) => j !== i) }))} />
            </div>
          ))}
          <Button size="sm" variant="secondary" onClick={() => patch((m) => ({ ...m, notes: [...m.notes, ""] }))}><Plus className="h-4 w-4" /> Adicionar observação</Button>
        </section>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function SectionTitle({ title, hint }: { title: string; hint: string }) {
  return (
    <div>
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</p>
      <p className="text-xs text-slate-500">{hint}</p>
    </div>
  );
}

function IconButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className="mb-0.5 rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800">
      <Trash2 className="h-4 w-4" />
    </button>
  );
}

function QuoteSimulator({ workspaceId }: { workspaceId: string }) {
  const [checkin, setCheckin] = useState("");
  const [checkout, setCheckout] = useState("");
  const [adults, setAdults] = useState(2);
  const [ages, setAges] = useState("");
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await invokeFunction<{ quote: Quote }>("knowledge-index", {
        action: "price_quote",
        workspace_id: workspaceId,
        checkin: toBr(checkin),
        checkout: toBr(checkout),
        adults,
        children_ages: ages.split(",").map((v) => v.trim()).filter(Boolean).map(Number),
      });
      setQuote(res.quote);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <CardBody className="space-y-3 border-t border-slate-100 dark:border-slate-800">
      <p className="flex items-center gap-1.5 text-sm font-medium"><Calculator className="h-4 w-4" /> Simular valor (mesmo cálculo da MarIA)</p>
      <form onSubmit={submit} className="grid gap-2 sm:grid-cols-5 sm:items-end">
        <Input label="Entrada" type="date" value={checkin} onChange={(e) => setCheckin(e.target.value)} required />
        <Input label="Saída" type="date" value={checkout} min={checkin} onChange={(e) => setCheckout(e.target.value)} required />
        <Input label="Adultos" type="number" min={1} value={adults} onChange={(e) => setAdults(Number(e.target.value))} />
        <Input label="Idades das crianças" placeholder="ex.: 7, 13" value={ages} onChange={(e) => setAges(e.target.value)} />
        <Button type="submit" loading={busy}>Calcular</Button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {quote && (
        <div className="space-y-2 text-sm">
          {quote.erro ? <p className="text-red-600">{quote.erro}</p> : quote.fechado ? (
            <p className="text-amber-700">Hotel fechado nessas datas ({quote.periodos_fechados}). A MarIA não cota e sugere outras datas.</p>
          ) : (
            <>
              <p className="text-slate-600 dark:text-slate-300">
                {quote.noites} noite(s) · {quote.hospedes} hóspede(s) · {quote.periodos.join(" + ")}
                {!quote.atende_estadia_minima && <Badge tone="amber" className="ml-2">abaixo do mínimo de {quote.estadia_minima} diárias</Badge>}
              </p>
              {quote.sem_opcao && <p className="text-amber-700">{quote.sem_opcao}</p>}
              <ul className="space-y-1.5">
                {quote.opcoes.map((o) => (
                  <li key={o.acomodacao} className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium">{o.acomodacao} <span className="text-xs font-normal text-slate-500">({o.tarifa})</span></span>
                      <span className="font-semibold tabular-nums">{o.total_formatado}</span>
                    </div>
                    <p className="text-xs text-slate-500">{o.detalhamento.map((d) => `${d.noites} × ${d.diaria_formatada} (${d.periodo})`).join(" + ")}</p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </CardBody>
  );
}
