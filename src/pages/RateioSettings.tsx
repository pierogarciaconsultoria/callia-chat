import { useEffect, useState } from 'react';
import AppLayout from '@/components/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { CRITERIOS_RATEIO, type CriterioRateio } from '@/lib/expenseAllocation';
import { buscarCriterioRateio } from '@/lib/expenseAllocationService';

// projects ainda não tem coluna de % de rateio, então o critério fixo fica indisponível.
const CRITERIOS_INDISPONIVEIS: CriterioRateio[] = ['percentual_fixo'];

export default function RateioSettings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [criterio, setCriterio] = useState<CriterioRateio>('proporcional');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data: profile } = await supabase
        .from('profiles')
        .select('company_id')
        .eq('id', user.id)
        .maybeSingle();
      if (!profile?.company_id) return;
      setCompanyId(profile.company_id);
      try {
        setCriterio(await buscarCriterioRateio(profile.company_id));
      } catch (error) {
        toast({
          title: 'Erro ao carregar configurações de rateio',
          description: (error as Error).message,
          variant: 'destructive',
        });
      }
    };
    load();
  }, [user, toast]);

  const salvar = async () => {
    if (!companyId) return;
    setSalvando(true);
    try {
      const { error } = await supabase
        .from('companies')
        .update({ rateio_criterio: criterio })
        .eq('id', companyId);
      if (error) throw error;
      toast({ title: 'Configurações de rateio salvas' });
    } catch (error) {
      toast({
        title: 'Erro ao salvar',
        description: (error as Error).message,
        variant: 'destructive',
      });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold text-foreground">Financeiro – Rateio de custos fixos</h1>
          <p className="text-sm text-muted-foreground">
            Defina como as despesas administrativas (lançamentos marcados como custo fixo) são
            distribuídas entre as obras ativas.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Critério de rateio</CardTitle>
          </CardHeader>
          <CardContent>
            <RadioGroup
              value={criterio}
              onValueChange={(v) => setCriterio(v as CriterioRateio)}
              className="gap-4"
            >
              {CRITERIOS_RATEIO.map((c) => {
                const indisponivel = CRITERIOS_INDISPONIVEIS.includes(c.value);
                return (
                  <div key={c.value} className="flex items-start gap-3">
                    <RadioGroupItem
                      value={c.value}
                      id={`criterio-${c.value}`}
                      className="mt-1"
                      disabled={indisponivel}
                    />
                    <Label
                      htmlFor={`criterio-${c.value}`}
                      className={indisponivel ? 'opacity-60' : 'cursor-pointer'}
                    >
                      <span className="font-medium">{c.label}</span>
                      <span className="block text-xs font-normal text-muted-foreground">
                        {indisponivel
                          ? 'Em breve: as obras ainda não têm percentual de rateio cadastrado.'
                          : c.descricao}
                      </span>
                    </Label>
                  </div>
                );
              })}
            </RadioGroup>
          </CardContent>
        </Card>

        <div>
          <Button type="button" onClick={salvar} disabled={salvando || !companyId}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      </div>
    </AppLayout>
  );
}
