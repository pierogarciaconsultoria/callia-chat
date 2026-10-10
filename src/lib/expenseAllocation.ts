export type CriterioRateio = 'proporcional' | 'percentual_fixo' | 'manual';

export const CRITERIOS_RATEIO: { value: CriterioRateio; label: string; descricao: string }[] = [
  {
    value: 'proporcional',
    label: 'Proporcional ao custo real (padrão)',
    descricao:
      'Cada obra ativa recebe a fração do seu custo real sobre o custo real de todas as obras ativas, calculada no momento do lançamento.',
  },
  {
    value: 'percentual_fixo',
    label: 'Percentual fixo por obra',
    descricao: 'Cada obra ativa recebe o percentual definido em suas configurações.',
  },
  {
    value: 'manual',
    label: 'Manual',
    descricao: 'Ao marcar o lançamento como custo fixo, o usuário define o valor ou % de cada obra.',
  },
];

export interface ObraRateio {
  id: string;
  custoReal: number;
  percentualFixo: number | null;
}

export interface CriterioAplicado {
  metodo: CriterioRateio;
  percentual: number;
  custo_real_obra?: number;
  custo_real_total?: number;
  /** Proporcional sem custo real em nenhuma obra: divisão igualitária. */
  divisao_igualitaria?: boolean;
}

export interface Alocacao {
  projectId: string;
  valor: number;
  percentual: number;
  criterioAplicado: CriterioAplicado;
}

export interface LinhaRateioManual {
  projectId: string;
  valor: number;
}

export class RateioError extends Error {}

const toCents = (valor: number) => Math.round(valor * 100);
const fromCents = (cents: number) => cents / 100;
const arredondarPercentual = (p: number) => Math.round(p * 1e6) / 1e6;

/** Distribui centavos por pesos (maiores restos), garantindo soma exata. */
function distribuirCentavos(totalCents: number, pesos: number[]): number[] {
  const somaPesos = pesos.reduce((acc, p) => acc + p, 0);
  const brutos = pesos.map((p) => (totalCents * p) / somaPesos);
  const base = brutos.map(Math.floor);
  let restante = totalCents - base.reduce((acc, c) => acc + c, 0);

  const ordem = brutos
    .map((b, i) => ({ i, resto: b - base[i] }))
    .sort((a, b) => b.resto - a.resto);

  for (let k = 0; restante > 0; k = (k + 1) % ordem.length, restante--) {
    base[ordem[k].i] += 1;
  }
  return base;
}

function validarValorTotal(valorTotal: number) {
  if (!(valorTotal > 0)) {
    throw new RateioError('O valor do lançamento deve ser maior que zero.');
  }
}

export function ratearProporcional(valorTotal: number, obras: ObraRateio[]): Alocacao[] {
  validarValorTotal(valorTotal);
  if (obras.length === 0) {
    throw new RateioError('Não há obras ativas para ratear o lançamento.');
  }

  const custos = obras.map((o) => Math.max(0, o.custoReal));
  const custoTotal = custos.reduce((acc, c) => acc + c, 0);
  const divisaoIgualitaria = custoTotal === 0;
  const pesos = divisaoIgualitaria ? obras.map(() => 1) : custos;
  const somaPesos = pesos.reduce((acc, p) => acc + p, 0);
  const centavos = distribuirCentavos(toCents(valorTotal), pesos);

  return obras.map((obra, i) => {
    const percentual = arredondarPercentual((pesos[i] / somaPesos) * 100);
    return {
      projectId: obra.id,
      valor: fromCents(centavos[i]),
      percentual,
      criterioAplicado: {
        metodo: 'proporcional',
        percentual,
        custo_real_obra: custos[i],
        custo_real_total: custoTotal,
        ...(divisaoIgualitaria ? { divisao_igualitaria: true } : {}),
      },
    };
  });
}

/**
 * Aloca o % configurado de cada obra ativa. Se a soma for menor que 100%,
 * a diferença permanece sem rateio (fica na administração).
 */
export function ratearPercentualFixo(valorTotal: number, obras: ObraRateio[]): Alocacao[] {
  validarValorTotal(valorTotal);
  const comPercentual = obras.filter((o) => (o.percentualFixo ?? 0) > 0);
  if (comPercentual.length === 0) {
    throw new RateioError('Nenhuma obra ativa possui percentual de rateio definido.');
  }

  const somaPercentuais = comPercentual.reduce((acc, o) => acc + (o.percentualFixo ?? 0), 0);
  if (somaPercentuais > 100 + 1e-9) {
    throw new RateioError(
      `A soma dos percentuais das obras ativas é ${somaPercentuais.toFixed(2)}%, acima de 100%.`,
    );
  }

  const totalAlocadoCents = Math.round((toCents(valorTotal) * somaPercentuais) / 100);
  const centavos = distribuirCentavos(
    totalAlocadoCents,
    comPercentual.map((o) => o.percentualFixo ?? 0),
  );

  return comPercentual.map((obra, i) => {
    const percentual = obra.percentualFixo ?? 0;
    return {
      projectId: obra.id,
      valor: fromCents(centavos[i]),
      percentual,
      criterioAplicado: { metodo: 'percentual_fixo', percentual },
    };
  });
}

/** Diferença em reais entre o total do lançamento e a soma das linhas (0 = válido). */
export function diferencaRateioManual(valorTotal: number, linhas: LinhaRateioManual[]): number {
  const somaCents = linhas.reduce((acc, l) => acc + toCents(l.valor), 0);
  return fromCents(toCents(valorTotal) - somaCents);
}

export function ratearManual(valorTotal: number, linhas: LinhaRateioManual[]): Alocacao[] {
  validarValorTotal(valorTotal);
  const preenchidas = linhas.filter((l) => toCents(l.valor) !== 0);

  if (preenchidas.some((l) => l.valor < 0)) {
    throw new RateioError('Os valores do rateio não podem ser negativos.');
  }
  if (preenchidas.length === 0) {
    throw new RateioError('Informe o valor ou % de pelo menos uma obra.');
  }
  const diferenca = diferencaRateioManual(valorTotal, preenchidas);
  if (diferenca !== 0) {
    throw new RateioError(
      `A soma do rateio deve ser igual ao valor do lançamento (diferença de R$ ${diferenca.toFixed(2)}).`,
    );
  }

  return preenchidas.map((linha) => {
    const valor = fromCents(toCents(linha.valor));
    const percentual = arredondarPercentual((valor / valorTotal) * 100);
    return {
      projectId: linha.projectId,
      valor,
      percentual,
      criterioAplicado: { metodo: 'manual', percentual },
    };
  });
}

/** Converte % em valor (centavos arredondados) para o modal manual. */
export function valorPorPercentual(valorTotal: number, percentual: number): number {
  return fromCents(Math.round((toCents(valorTotal) * percentual) / 100));
}

export function percentualPorValor(valorTotal: number, valor: number): number {
  if (!(valorTotal > 0)) return 0;
  return Math.round((valor / valorTotal) * 100 * 100) / 100;
}
