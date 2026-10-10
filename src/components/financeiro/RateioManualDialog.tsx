import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  diferencaRateioManual,
  percentualPorValor,
  valorPorPercentual,
  type LinhaRateioManual,
} from '@/lib/expenseAllocation';

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface RateioManualDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  valorTotal: number;
  obras: { id: string; nome: string }[];
  onConfirm: (linhas: LinhaRateioManual[]) => void;
}

interface Linha {
  valor: string;
  percentual: string;
}

const parseNumero = (texto: string) => {
  const n = Number(texto.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

export function RateioManualDialog({
  open,
  onOpenChange,
  valorTotal,
  obras,
  onConfirm,
}: RateioManualDialogProps) {
  const [linhas, setLinhas] = useState<Record<string, Linha>>({});

  useEffect(() => {
    if (open) setLinhas({});
  }, [open]);

  const linhasRateio: LinhaRateioManual[] = useMemo(
    () => obras.map((o) => ({ projectId: o.id, valor: parseNumero(linhas[o.id]?.valor ?? '') })),
    [obras, linhas],
  );
  const diferenca = diferencaRateioManual(valorTotal, linhasRateio);
  const temNegativo = linhasRateio.some((l) => l.valor < 0);
  const valido = diferenca === 0 && !temNegativo;

  const alterarValor = (id: string, valor: string) =>
    setLinhas((prev) => ({
      ...prev,
      [id]: { valor, percentual: String(percentualPorValor(valorTotal, parseNumero(valor))) },
    }));

  const alterarPercentual = (id: string, percentual: string) =>
    setLinhas((prev) => ({
      ...prev,
      [id]: {
        percentual,
        valor: String(valorPorPercentual(valorTotal, parseNumero(percentual))),
      },
    }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Rateio do custo fixo</DialogTitle>
          <DialogDescription>
            Distribua {brl(valorTotal)} entre as obras ativas informando o valor ou o % de cada uma.
          </DialogDescription>
        </DialogHeader>

        {obras.length === 0 ? (
          <p className="text-sm text-muted-foreground">Não há obras ativas para ratear.</p>
        ) : (
          <div className="max-h-[50vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="py-2 pr-4 font-medium">Obra</th>
                  <th className="w-36 py-2 pr-4 font-medium">Valor (R$)</th>
                  <th className="w-28 py-2 font-medium">%</th>
                </tr>
              </thead>
              <tbody>
                {obras.map((obra) => (
                  <tr key={obra.id} className="border-b last:border-0">
                    <td className="py-2 pr-4">{obra.nome}</td>
                    <td className="py-2 pr-4">
                      <Input
                        inputMode="decimal"
                        placeholder="0,00"
                        value={linhas[obra.id]?.valor ?? ''}
                        onChange={(e) => alterarValor(obra.id, e.target.value)}
                      />
                    </td>
                    <td className="py-2">
                      <Input
                        inputMode="decimal"
                        placeholder="0"
                        value={linhas[obra.id]?.percentual ?? ''}
                        onChange={(e) => alterarPercentual(obra.id, e.target.value)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">
            Rateado: {brl(valorTotal - diferenca)} de {brl(valorTotal)}
          </span>
          <span className={valido ? 'text-green-600' : 'text-destructive'}>
            {temNegativo
              ? 'Valores não podem ser negativos'
              : diferenca === 0
                ? 'Soma confere'
                : diferenca > 0
                  ? `Faltam ${brl(diferenca)}`
                  : `Excede em ${brl(-diferenca)}`}
          </span>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={!valido}
            onClick={() => onConfirm(linhasRateio.filter((l) => l.valor !== 0))}
          >
            Confirmar rateio
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
