import { describe, expect, it } from 'vitest';
import {
  RateioError,
  diferencaRateioManual,
  ratearManual,
  ratearPercentualFixo,
  ratearProporcional,
  type Alocacao,
  type ObraRateio,
} from '@/lib/expenseAllocation';

const soma = (alocacoes: Alocacao[]) =>
  Math.round(alocacoes.reduce((acc, a) => acc + a.valor * 100, 0)) / 100;

const obra = (id: string, custoReal = 0, percentualFixo: number | null = null): ObraRateio => ({
  id,
  custoReal,
  percentualFixo,
});

describe('ratearProporcional', () => {
  it('aloca pela fração do custo real e registra o percentual aplicado', () => {
    const r = ratearProporcional(1000, [obra('a', 3000), obra('b', 1000)]);
    expect(r.map((a) => a.valor)).toEqual([750, 250]);
    expect(r[0].percentual).toBe(75);
    expect(r[0].criterioAplicado).toEqual({
      metodo: 'proporcional',
      percentual: 75,
      custo_real_obra: 3000,
      custo_real_total: 4000,
    });
  });

  it('fecha a soma exata em centavos com dízimas', () => {
    const r = ratearProporcional(100, [obra('a', 1), obra('b', 1), obra('c', 1)]);
    expect(soma(r)).toBe(100);
    expect(r.map((a) => a.valor).sort()).toEqual([33.33, 33.33, 33.34]);
  });

  it('divide igualmente quando nenhuma obra tem custo real', () => {
    const r = ratearProporcional(90, [obra('a'), obra('b'), obra('c')]);
    expect(r.map((a) => a.valor)).toEqual([30, 30, 30]);
    expect(r[0].criterioAplicado.divisao_igualitaria).toBe(true);
  });

  it('falha sem obras ativas', () => {
    expect(() => ratearProporcional(100, [])).toThrow(RateioError);
  });
});

describe('ratearPercentualFixo', () => {
  it('aloca o % configurado de cada obra', () => {
    const r = ratearPercentualFixo(2000, [obra('a', 0, 60), obra('b', 0, 40)]);
    expect(r.map((a) => [a.projectId, a.valor, a.percentual])).toEqual([
      ['a', 1200, 60],
      ['b', 800, 40],
    ]);
  });

  it('ignora obras sem percentual e deixa a sobra sem rateio quando soma < 100%', () => {
    const r = ratearPercentualFixo(1000, [obra('a', 0, 30), obra('b', 0, null), obra('c', 0, 20)]);
    expect(r.map((a) => a.projectId)).toEqual(['a', 'c']);
    expect(soma(r)).toBe(500);
  });

  it('rejeita soma de percentuais acima de 100%', () => {
    expect(() => ratearPercentualFixo(1000, [obra('a', 0, 70), obra('b', 0, 40)])).toThrow(
      /acima de 100%/,
    );
  });

  it('rejeita quando nenhuma obra tem percentual', () => {
    expect(() => ratearPercentualFixo(1000, [obra('a')])).toThrow(RateioError);
  });
});

describe('ratearManual', () => {
  it('aceita quando a soma dos valores é igual ao total', () => {
    const r = ratearManual(1000, [
      { projectId: 'a', valor: 600 },
      { projectId: 'b', valor: 400 },
      { projectId: 'c', valor: 0 },
    ]);
    expect(r.map((a) => [a.projectId, a.valor, a.percentual])).toEqual([
      ['a', 600, 60],
      ['b', 400, 40],
    ]);
    expect(r[0].criterioAplicado.metodo).toBe('manual');
  });

  it('rejeita quando a soma difere do total', () => {
    expect(() => ratearManual(1000, [{ projectId: 'a', valor: 999.99 }])).toThrow(/diferença/);
    expect(diferencaRateioManual(1000, [{ projectId: 'a', valor: 999.99 }])).toBe(0.01);
  });

  it('rejeita valores negativos', () => {
    expect(() =>
      ratearManual(100, [
        { projectId: 'a', valor: 150 },
        { projectId: 'b', valor: -50 },
      ]),
    ).toThrow(/negativos/);
  });
});
