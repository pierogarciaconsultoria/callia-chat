import AppLayout from '@/components/AppLayout';
import { ContasAReceberTable } from '@/components/financeiro/contas-a-receber/ContasAReceberTable';

export default function ContasAReceber() {
  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Contas a Receber</h1>
          <p className="text-muted-foreground">Recebíveis de clientes, vencimentos e status de recebimento.</p>
        </div>
        <ContasAReceberTable />
      </div>
    </AppLayout>
  );
}
