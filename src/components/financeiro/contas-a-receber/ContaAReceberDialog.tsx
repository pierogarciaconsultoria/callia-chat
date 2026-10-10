import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { NENHUM, doBanco, paraBanco, type Lancamento } from '@/lib/financeiro';
import {
  useCategoriasFinanceiras,
  useClientesSelect,
  useCnpjsEmissores,
  useContasBancarias,
  useObrasSelect,
} from '@/hooks/useFinanceiroCadastros';

const schema = z.object({
  client_id: z.string(),
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
});

type FormValues = z.infer<typeof schema>;

const valoresIniciais: FormValues = {
  client_id: NENHUM,
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
};

interface ContaAReceberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conta: Lancamento | null;
  companyId: string;
}

export function ContaAReceberDialog({ open, onOpenChange, conta, companyId }: ContaAReceberDialogProps) {
  const queryClient = useQueryClient();
  const editando = !!conta;

  const { data: clientes = [] } = useClientesSelect(companyId, open);
  const { data: categorias = [] } = useCategoriasFinanceiras(companyId, open);
  const { data: obras = [] } = useObrasSelect(companyId, open);
  const { data: cnpjs = [] } = useCnpjsEmissores(companyId, open);
  const { data: contasBancarias = [] } = useContasBancarias(companyId, open);

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: valoresIniciais });
  const categoriaId = form.watch('category_id');

  useEffect(() => {
    if (!open) return;
    form.reset(
      conta
        ? {
            client_id: doBanco(conta.client_id),
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
          }
        : valoresIniciais,
    );
  }, [conta, open, form]);

  const mutation = useMutation({
    mutationFn: async (valores: FormValues) => {
      const payload = {
        company_id: companyId,
        entry_type: 'conta_a_receber',
        client_id: paraBanco(valores.client_id),
        description: valores.description,
        value: valores.value,
        due_date: valores.due_date,
        data_competencia: valores.data_competencia || null,
        numero_documento: valores.numero_documento || null,
        category_id: paraBanco(valores.category_id),
        subcategoria_id: paraBanco(valores.subcategoria_id),
        project_id: paraBanco(valores.project_id),
        legal_entity_id: paraBanco(valores.legal_entity_id),
        conta_bancaria_id: paraBanco(valores.conta_bancaria_id),
      };

      if (editando) {
        const { error } = await supabase.from('financial_entries').update(payload).eq('id', conta.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('financial_entries').insert({ ...payload, status: 'pendente' });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contas-a-receber'] });
      queryClient.invalidateQueries({ queryKey: ['contas-a-receber-select'] });
      toast.success(editando ? 'Conta a receber atualizada' : 'Conta a receber criada');
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(`Erro ao salvar conta a receber: ${error.message}`),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editando ? 'Editar conta a receber' : 'Nova conta a receber'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <Tabs defaultValue="geral">
              <TabsList>
                <TabsTrigger value="geral">Geral</TabsTrigger>
              </TabsList>

              <TabsContent value="geral" className="space-y-4 pt-2">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField control={form.control} name="client_id" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cliente</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value={NENHUM}>Nenhum</SelectItem>
                          {clientes.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="description" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Descrição</FormLabel>
                      <FormControl><Input placeholder="Ex.: Medição 3 – Residencial Jardins" {...field} /></FormControl>
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
                  <FormField control={form.control} name="project_id" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Obra / projeto</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value={NENHUM}>Nenhuma</SelectItem>
                          {obras.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
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
                      <FormLabel>Conta bancária de recebimento</FormLabel>
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
  );
}
