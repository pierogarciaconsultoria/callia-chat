import { supabase } from '@/integrations/supabase/client';
import {
  RateioError,
  ratearManual,
  ratearProporcional,
  type Alocacao,
  type CriterioRateio,
  type LinhaRateioManual,
  type ObraRateio,
} from './expenseAllocation';

const STATUS_OBRA_INATIVA = ['concluida', 'concluido', 'cancelada', 'cancelado'];

export interface ObraAtiva extends ObraRateio {
  nome: string;
}

export async function buscarCriterioRateio(companyId: string): Promise<CriterioRateio> {
  const { data, error } = await supabase
    .from('companies')
    .select('rateio_criterio')
    .eq('id', companyId)
    .maybeSingle();
  if (error) throw error;
  return (data?.rateio_criterio as CriterioRateio | null) ?? 'proporcional';
}

/**
 * Obras ativas com custo real = soma das contas a pagar lançadas diretamente
 * na obra (exclui custos fixos, cuja parte rateada fica em expense_allocations).
 */
export async function buscarObrasAtivas(companyId: string): Promise<ObraAtiva[]> {
  const { data: obras, error } = await supabase
    .from('projects')
    .select('id, name')
    .eq('company_id', companyId)
    .not('status', 'in', `(${STATUS_OBRA_INATIVA.join(',')})`)
    .order('name');
  if (error) throw error;
  if (!obras || obras.length === 0) return [];

  const { data: lancamentos, error: errLanc } = await supabase
    .from('financial_entries')
    .select('project_id, value')
    .eq('company_id', companyId)
    .eq('entry_type', 'conta_a_pagar')
    .eq('custo_fixo', false)
    .neq('status', 'cancelado')
    .in(
      'project_id',
      obras.map((o) => o.id),
    );
  if (errLanc) throw errLanc;

  const custoPorObra = new Map<string, number>();
  for (const l of lancamentos ?? []) {
    if (!l.project_id) continue;
    custoPorObra.set(l.project_id, (custoPorObra.get(l.project_id) ?? 0) + Number(l.value));
  }

  return obras.map((o) => ({
    id: o.id,
    nome: o.name,
    custoReal: custoPorObra.get(o.id) ?? 0,
    percentualFixo: null,
  }));
}

export interface RatearLancamentoInput {
  companyId: string;
  financialEntryId: string;
  valor: number;
  /** Obrigatório quando o critério da empresa é manual (vem do modal de rateio). */
  linhasManuais?: LinhaRateioManual[];
}

/**
 * Calcula o rateio de um lançamento de custo fixo pelo critério da empresa e
 * grava em expense_allocations, substituindo um rateio anterior do mesmo lançamento.
 */
export async function ratearLancamento(input: RatearLancamentoInput): Promise<Alocacao[]> {
  const criterio = await buscarCriterioRateio(input.companyId);

  let alocacoes: Alocacao[];
  if (criterio === 'manual') {
    if (!input.linhasManuais) {
      throw new RateioError('Critério manual: informe o rateio por obra no modal de rateio.');
    }
    alocacoes = ratearManual(input.valor, input.linhasManuais);
  } else if (criterio === 'percentual_fixo') {
    // projects não tem coluna de % de rateio no banco atual.
    throw new RateioError(
      'Critério percentual fixo ainda não disponível: as obras não têm percentual de rateio cadastrado.',
    );
  } else {
    alocacoes = ratearProporcional(input.valor, await buscarObrasAtivas(input.companyId));
  }

  const { error: errDelete } = await supabase
    .from('expense_allocations')
    .delete()
    .eq('financial_entry_id', input.financialEntryId);
  if (errDelete) throw errDelete;

  const { error } = await supabase.from('expense_allocations').insert(
    alocacoes.map((a) => ({
      company_id: input.companyId,
      financial_entry_id: input.financialEntryId,
      project_id: a.projectId,
      valor_alocado: a.valor,
      percentual: a.percentual,
      criterio_aplicado: JSON.stringify(a.criterioAplicado),
    })),
  );
  if (error) throw error;

  return alocacoes;
}
