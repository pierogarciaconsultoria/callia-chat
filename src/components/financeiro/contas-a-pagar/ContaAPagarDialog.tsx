import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RateioManualDialog } from '../RateioManualDialog';
import type { LinhaRateioManual } from '@/lib/expenseAllocation';
import { buscarCriterioRateio, buscarObrasAtivas, ratearLancamento } from '@/lib/expenseAllocationService';
import {
  NENHUM,
  PAGO_POR,
  doBanco,
  formatarData,
  formatarMoeda,
  paraBanco,
  type Lancamento,
} from '@/lib/financeiro';
import {
  useCategoriasFinanceiras,
  useCnpjsEmissores,
  useContasBancarias,
  useObrasSelect,
} from '@/hooks/useFinanceiroCadastros';

const schema = z
  .object({
    description: z.string().trim().min(1, 'Descrição é obrigatória').max(500),
    value: z.coerce.number({ invalid_type_error: 'Informe o valor' }).positive('Valor deve ser maior que zero'),
    due_date: z.string().min(1, 'Vencimento é obrigatório'),
    data_competencia: z.string(),
    numero_documento: z.string().max(100),
    category_id: z.string(),
    subcategoria_id: z.string(),
    project_id: z.string(),
    legal_entity_id: z.string(),
    conta_bancaria_id: z.string(),
    custo_fixo: z.boolean(),
    pago_por: z.enum(['empresa', 'cliente', 'terceiro']),
    cr_vinculado_id: z.string(),
  })
  .refine((v) => v.pago_por !== 'cliente' || v.cr_vinculado_id !== NENHUM, {
    message: 'Selecione a conta a receber vinculada',
    path: ['cr_vinculado_id'],
  });

type FormValues = z.infer<typeof schema>;

const valoresIniciais: FormValues = {
  description: '',
  value: 0,
  due_date: '',
  data_competencia: '',
  numero_documento: '',
  category_id: NENHUM,
  subcategoria_id: NENHUM,
  project_id: NENHUM,
  legal_entity_id: NENHUM,
  conta_bancaria_id: NENHUM,
  custo_fixo: false,
  pago_por: 'empresa',
  cr_vinculado_id: NENHUM,
};

interface ContaAPagarDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conta: Lancamento | null;
  companyId: string;
}

export function ContaAPagarDialog({ open, onOpenChange, conta, companyId }: ContaAPagarDialogProps) {
  const queryClient = useQueryClient();
  const editando = !!conta;
  const [rateioManual, setRateioManual] = useState<{ valores: FormValues; obras: { id: string; nome: string }[] } | null>(null);

  const { data: categorias = [] } = useCategoriasFinanceiras(companyId, open);
  const { data: obras = [] } = useObrasSelect(companyId, open);
  const { data: cnpjs = [] } = useCnpjsEmissores(companyId, open);
  const { data: contasBancarias = [] } = useContasBancarias(companyId, open);

  const { data: contasAReceber = [] } = useQuery({
    queryKey: ['contas-a-receber-select', companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('financial_entries')
        .select('id, description, value, due_date')
        .eq('company_id', companyId)
        .eq('entry_type', 'conta_a_receber')
        .neq('status', 'cancelado')
        .order('due_date', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!companyId && open,
  });

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: valoresIniciais });
  const custoFixo = form.watch('custo_fixo');
  const pagoPor = form.watch('pago_por');
  const categoriaId = form.watch('category_id');

  useEffect(() => {
    if (!open) return;
    form.reset(
      conta
        ? {
            description: conta.description ?? '',
            value: conta.value,
            due_date: conta.due_date ?? '',
            data_competencia: conta.data_competencia ?? '',
            numero_documento: conta.numero_documento ?? '',
            category_id: doBanco(conta.category_id),
            subcategoria_id: doBanco(conta.subcategoria_id),
            project_id: doBanco(conta.project_id),
            legal_entity_id: doBanco(conta.legal_entity_id),
            conta_bancaria_id: doBanco(conta.conta_bancaria_id),
            custo_fixo: conta.custo_fixo,
            pago_por: (conta.pago_por as FormValues['pago_por'] | null) ?? 'empresa',
            cr_vinculado_id: doBanco(conta.cr_vinculado_id),
          }
        : valoresIniciais,
    );
  }, [conta, open, form]);

  useEffect(() => {
    if (custoFixo) form.setValue('project_id', NENHUM);
  }, [custoFixo, form]);

  useEffect(() => {
    if (pagoPor !== 'cliente') form.setValue('cr_vinculado_id', NENHUM);
  }, [pagoPor, form]);

  // Rateio só é (re)calculado ao marcar custo fixo ou mudar o valor, preservando o histórico.
  const precisaRatear = (valores: FormValues) =>
    !conta || !conta.custo_fixo || conta.value !== valores.value;

  const mutation = useMutation({
    mutationFn: async ({ valores, linhasManuais }: { valores: FormValues; linhasManuais?: LinhaRateioManual[] }) => {
      const payload = {
        company_id: companyId,
        entry_type: 'conta_a_pagar',
        description: valores.description,
        value: valores.value,
        due_date: valores.due_date,
        data_competencia: valores.data_competencia || null,
        numero_documento: valores.numero_documento || null,
        category_id: paraBanco(valores.category_id),
        subcategoria_id: paraBanco(valores.subcategoria_id),
        project_id: valores.custo_fixo ? null : paraBanco(valores.project_id),
        legal_entity_id: paraBanco(valores.legal_entity_id),
        conta_bancaria_id: paraBanco(valores.conta_bancaria_id),
        custo_fixo: valores.custo_fixo,
        pago_por: valores.pago_por,
        cr_vinculado_id: valores.pago_por === 'cliente' ? paraBanco(valores.cr_vinculado_id) : null,
      };

      let entryId: string;
      if (editando) {
        const { error } = await supabase.from('financial_entries').update(payload).eq('id', conta.id);
        if (error) throw error;
        entryId = conta.id;
      } else {
        const { data, error } = await supabase
          .from('financial_entries')
          .insert({ ...payload, status: 'pendente' })
          .select('id')
          .single();
        if (error) throw error;
        entryId = data.id;
      }

      if (!valores.custo_fixo) {
        if (conta?.custo_fixo) {
          const { error } = await supabase.from('expense_allocations').delete().eq('financial_entry_id', entryId);
          if (error) throw error;
        }
        return { rateioErro: null };
      }
      if (!precisaRatear(valores)) return { rateioErro: null };

      try {
        await ratearLancamento({ companyId, financialEntryId: entryId, valor: valores.value, linhasManuais });
        return { rateioErro: null };
      } catch (error) {
        return { rateioErro: (error as Error).message };
      }
    },
    onSuccess: ({ rateioErro }) => {
      queryClient.invalidateQueries({ queryKey: ['contas-a-pagar'] });
      if (rateioErro) {
        toast.warning(`Conta a pagar salva, mas o rateio não foi feito: ${rateioErro}`);
      } else {
        toast.success(editando ? 'Conta a pagar atualizada' : 'Conta a pagar criada');
      }
      setRateioManual(null);
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(`Erro ao salvar conta a pagar: ${error.message}`),
  });

  const onSubmit = async (valores: FormValues) => {
    if (valores.custo_fixo && precisaRatear(valores)) {
      try {
        if ((await buscarCriterioRateio(companyId)) === 'manual') {
          const ativas = await buscarObrasAtivas(companyId);
          setRateioManual({ valores, obras: ativas.map((o) => ({ id: o.id, nome: o.nome })) });
          return;
        }
      } catch (error) {
        toast.error(`Erro ao preparar o rateio: ${(error as Error).message}`);
        return;
      }
    }
    mutation.mutate({ valores });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editando ? 'Editar conta a pagar' : 'Nova conta a pagar'}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <Tabs defaultValue="geral">
                <TabsList>
                  <TabsTrigger value="geral">Geral</TabsTrigger>
                </TabsList>

                <TabsContent value="geral" className="space-y-4 pt-2">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <FormItem>
                      <FormLabel>Fornecedor</FormLabel>
                      <Select disabled>
                        <SelectTrigger><SelectValue placeholder="Cadastro de fornecedores em breve" /></SelectTrigger>
                      </Select>
                      <FormDescription>Enquanto não houver cadastro, identifique o fornecedor na descrição.</FormDescription>
                    </FormItem>
                    <FormField control={form.control} name="description" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Descrição</FormLabel>
                        <FormControl><Input placeholder="Ex.: Aluguel do escritório – outubro" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                    <FormField control={form.control} name="value" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Valor (R$)</FormLabel>
                        <FormControl><Input type="number" step="0.01" min="0" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="due_date" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Vencimento</FormLabel>
                        <FormControl><Input type="date" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="data_competencia" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Competência</FormLabel>
                        <FormControl><Input type="date" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="numero_documento" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nº do documento</FormLabel>
                        <FormControl><Input placeholder="NF, boleto..." {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <FormField control={form.control} name="category_id" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Categoria</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value={NENHUM}>Nenhuma</SelectItem>
                            {categorias.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="subcategoria_id" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Subcategoria</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value={NENHUM}>Nenhuma</SelectItem>
                            {categorias
                              .filter((c) => c.id !== categoriaId)
                              .map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="legal_entity_id" render={({ field }) => (
                      <FormItem>
                        <FormLabel>CNPJ emissor</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value={NENHUM}>Nenhum</SelectItem>
                            {cnpjs.map((e) => (
                              <SelectItem key={e.id} value={e.id}>
                                {e.razao_social}{e.cnpj ? ` — ${e.cnpj}` : ''}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="conta_bancaria_id" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Conta bancária</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value={NENHUM}>Nenhuma</SelectItem>
                            {contasBancarias.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.nome}{c.banco ? ` — ${c.banco}` : ''}{c.agencia || c.conta ? ` (${c.agencia ?? ''}/${c.conta ?? ''})` : ''}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  <FormField control={form.control} name="custo_fixo" render={({ field }) => (
                    <FormItem className="flex items-start justify-between gap-4 rounded-lg border p-3">
                      <div className="space-y-0.5">
                        <FormLabel>Custo fixo (despesa administrativa)</FormLabel>
                        <FormDescription>
                          Entra no pool de rateio e é distribuído entre as obras ativas pelo critério da empresa.
                        </FormDescription>
                      </div>
                      <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                    </FormItem>
                  )} />

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <FormField control={form.control} name="project_id" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Obra / projeto</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value} disabled={custoFixo}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value={NENHUM}>Nenhuma</SelectItem>
                            {obras.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        {custoFixo && <FormDescription>Custo fixo é rateado entre as obras, sem obra única.</FormDescription>}
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="pago_por" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Pago por</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>
                            {PAGO_POR.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  {pagoPor === 'cliente' && (
                    <FormField control={form.control} name="cr_vinculado_id" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Conta a receber vinculada</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Selecione a CR do cliente..." /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value={NENHUM}>Selecione...</SelectItem>
                            {contasAReceber.map((cr) => (
                              <SelectItem key={cr.id} value={cr.id}>
                                {cr.description || 'Sem descrição'} — {formatarMoeda(cr.value)} — venc. {formatarData(cr.due_date)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                  )}
                </TabsContent>
              </Tabs>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                <Button type="submit" disabled={mutation.isPending}>
                  {mutation.isPending ? 'Salvando…' : 'Salvar'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <RateioManualDialog
        open={!!rateioManual}
        onOpenChange={(aberto) => !aberto && setRateioManual(null)}
        valorTotal={rateioManual?.valores.value ?? 0}
        obras={rateioManual?.obras ?? []}
        onConfirm={(linhas) => rateioManual && mutation.mutate({ valores: rateioManual.valores, linhasManuais: linhas })}
      />
    </>
  );
}
