import AppLayout from '@/components/AppLayout';
import { ContasAPagarTable } from '@/components/financeiro/contas-a-pagar/ContasAPagarTable';

export default function ContasAPagar() {
  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Contas a Pagar</h1>
          <p className="text-muted-foreground">Despesas, vencimentos e custos fixos rateados entre as obras.</p>
        </div>
        <ContasAPagarTable />
      </div>
    </AppLayout>
  );
}
