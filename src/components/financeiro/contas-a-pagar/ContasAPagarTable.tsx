import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ContaAPagarDialog } from './ContaAPagarDialog';
import { useCategoriasFinanceiras, useCompanyId, useObrasSelect } from '@/hooks/useFinanceiroCadastros';
import {
  STATUS_LANCAMENTO,
  TODOS,
  formatarCompetencia,
  formatarData,
  formatarMoeda,
  hojeISO,
  statusExibido,
  type Lancamento,
} from '@/lib/financeiro';

type LinhaContaAPagar = Lancamento & {
  obra: { name: string } | null;
  categoria: { name: string } | null;
};

export function ContasAPagarTable() {
  const companyId = useCompanyId();
  const [status, setStatus] = useState<string>(TODOS);
  const [obra, setObra] = useState<string>(TODOS);
  const [custoFixo, setCustoFixo] = useState<string>(TODOS);
  const [categoria, setCategoria] = useState<string>(TODOS);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editando, setEditando] = useState<Lancamento | null>(null);

  const { data: contas = [], isLoading } = useQuery({
    queryKey: ['contas-a-pagar', companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('financial_entries')
        .select('*, obra:project_id(name), categoria:category_id(name)')
        .eq('company_id', companyId)
        .eq('entry_type', 'conta_a_pagar')
        .order('due_date', { ascending: true });
      if (error) throw error;
      return data as unknown as LinhaContaAPagar[];
    },
    enabled: !!companyId,
  });

  const { data: obras = [] } = useObrasSelect(companyId);
  const { data: categorias = [] } = useCategoriasFinanceiras(companyId);

  const hoje = hojeISO();
  const filtradas = useMemo(
    () =>
      contas.filter(
        (c) =>
          (status === TODOS || statusExibido(c.status, c.due_date, hoje) === status) &&
          (obra === TODOS || c.project_id === obra) &&
          (custoFixo === TODOS || c.custo_fixo === (custoFixo === 'sim')) &&
          (categoria === TODOS || c.category_id === categoria),
      ),
    [contas, status, obra, custoFixo, categoria, hoje],
  );

  const total = filtradas.reduce((acc, c) => acc + Number(c.value), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos os status</SelectItem>
              {Object.entries(STATUS_LANCAMENTO).map(([value, s]) => (
                <SelectItem key={value} value={value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={obra} onValueChange={setObra}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Obra" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todas as obras</SelectItem>
              {obras.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={custoFixo} onValueChange={setCustoFixo}>
            <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Custo fixo: todos</SelectItem>
              <SelectItem value="sim">Só custo fixo</SelectItem>
              <SelectItem value="nao">Sem custo fixo</SelectItem>
            </SelectContent>
          </Select>
          <Select value={categoria} onValueChange={setCategoria}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Categoria" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todas as categorias</SelectItem>
              {categorias.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button
          className="gap-2 bg-primary hover:bg-primary/90"
          disabled={!companyId}
          onClick={() => {
            setEditando(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          Nova conta a pagar
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fornecedor</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead>Competência</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Obra</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead className="w-[60px] text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground">Carregando...</TableCell>
              </TableRow>
            ) : filtradas.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground">Nenhuma conta a pagar encontrada</TableCell>
              </TableRow>
            ) : (
              filtradas.map((c) => {
                const st = STATUS_LANCAMENTO[statusExibido(c.status, c.due_date, hoje)] ?? {
                  label: c.status,
                  variant: 'outline' as const,
                };
                return (
                  <TableRow key={c.id} className="border-border/70">
                    <TableCell className="text-muted-foreground">—</TableCell>
                    <TableCell className="font-medium">{c.description || '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{formatarCompetencia(c.data_competencia)}</TableCell>
                    <TableCell className="text-muted-foreground">{formatarData(c.due_date)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatarMoeda(Number(c.value))}</TableCell>
                    <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
                    <TableCell className="text-muted-foreground">
                      {c.custo_fixo ? <Badge variant="secondary">Rateado</Badge> : (c.obra?.name ?? '—')}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{c.categoria?.name ?? '—'}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Editar conta a pagar"
                        onClick={() => {
                          setEditando(c);
                          setDialogOpen(true);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {filtradas.length > 0 && (
        <p className="text-right text-sm text-muted-foreground">
          {filtradas.length} {filtradas.length === 1 ? 'título' : 'títulos'} — total a pagar {formatarMoeda(total)}
        </p>
      )}

      <ContaAPagarDialog open={dialogOpen} onOpenChange={setDialogOpen} conta={editando} companyId={companyId} />
    </div>
  );
}
