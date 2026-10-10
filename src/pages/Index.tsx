import { useEffect, useState } from 'react';
import AppLayout from '@/components/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { CheckCircle2, Circle, HardHat, Users, DollarSign, ShoppingCart } from 'lucide-react';
import { RankingCorretores } from '@/components/brokers/RankingCorretores';

export default function Index() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [savingCompany, setSavingCompany] = useState(false);
  const [hasCompany, setHasCompany] = useState(false);
  const [clientCount, setClientCount] = useState<number | null>(null);
  const [dealCount, setDealCount] = useState<number | null>(null);
  const [projectCount, setProjectCount] = useState<number | null>(null);

  useEffect(() => {
    const checkProfile = async () => {
      if (!user) return;

      const { data: profile, error } = await supabase
        .from('profiles')
        .select('company_id')
        .eq('id', user.id)
        .maybeSingle();

      if (error) return;

      const hasCompanyId = !!profile?.company_id;
      setHasCompany(hasCompanyId);

      if (!hasCompanyId) {
        setShowOnboarding(true);
        return;
      }

      const companyId = profile.company_id;

      const [{ count: clientsCount }, { count: projectsCount }, { count: dealsCount }] =
        await Promise.all([
          supabase
            .from('clients')
            .select('id', { count: 'exact', head: true })
            .eq('company_id', companyId),
          supabase
            .from('projects')
            .select('id', { count: 'exact', head: true })
            .eq('company_id', companyId),
          supabase
            .from('crm_deals')
            .select('id', { count: 'exact', head: true })
            .eq('company_id', companyId),
        ]);

      setClientCount(clientsCount ?? 0);
      setProjectCount(projectsCount ?? 0);
      setDealCount(dealsCount ?? 0);
    };

    void checkProfile();
  }, [user]);

  const handleCreateCompany = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || !companyName.trim() || savingCompany) return;

    setSavingCompany(true);
    const name = companyName.trim();

    const { data: company, error: companyError } = await supabase
      .from('companies')
      .insert({ name })
      .select('id')
      .single();

    if (companyError || !company?.id) {
      toast({
        title: 'Erro ao criar empresa',
        description: 'Tente novamente em alguns instantes.',
        variant: 'destructive',
      });
      setSavingCompany(false);
      return;
    }

    const { error: profileError } = await supabase
      .from('profiles')
      .update({ company_id: company.id })
      .eq('id', user.id);

    if (profileError) {
      toast({
        title: 'Erro ao vincular empresa',
        description: 'A empresa foi criada, mas não foi possível concluir o vínculo do usuário.',
        variant: 'destructive',
      });
      setSavingCompany(false);
      return;
    }

    toast({
      title: 'Empresa criada com sucesso',
      description: 'Agora você pode começar a usar o PRUMO com os dados da sua empresa.',
    });

    setSavingCompany(false);
    setHasCompany(true);
    setShowOnboarding(false);
  };

  const checklistItems = [
    {
      id: 'company',
      title: 'Cadastrar sua empresa',
      description: 'Definir o nome da empresa para organizar obras e contratos.',
      done: hasCompany,
    },
    {
      id: 'client',
      title: 'Cadastrar seu primeiro cliente',
      description: 'Registrar quem contrata suas obras e contratos.',
      done: (clientCount ?? 0) > 0,
    },
    {
      id: 'deal',
      title: 'Registrar sua primeira oportunidade no CRM',
      description: 'Mapear um negócio de obra no funil comercial.',
      done: (dealCount ?? 0) > 0,
    },
    {
      id: 'project',
      title: 'Criar sua primeira obra a partir de uma oportunidade',
      description: 'Converter um negócio ganho em obra dentro do PRUMO.',
      done: (projectCount ?? 0) > 0,
    },
  ];

  const completedSteps = checklistItems.filter((item) => item.done).length;
  const totalSteps = checklistItems.length;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground">Visão geral das suas obras e operações</p>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="text-sm font-medium text-foreground">
                Próximos passos para configurar o PRUMO
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {completedSteps}/{totalSteps} passos concluídos
              </p>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-xs text-muted-foreground">
            {checklistItems.map((item) => (
              <div key={item.id} className="flex items-start gap-3">
                {item.done ? (
                  <CheckCircle2 className="mt-[2px] h-4 w-4 text-primary" />
                ) : (
                  <Circle className="mt-[2px] h-4 w-4 text-muted-foreground" />
                )}
                <div>
                  <p className="text-[13px] font-medium text-foreground">{item.title}</p>
                  <p className="text-[11px] text-muted-foreground">{item.description}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Obras Ativas</CardTitle>
              <HardHat className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">0</div>
              <p className="text-xs text-muted-foreground">Em andamento</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Clientes</CardTitle>
              <Users className="h-4 w-4 text-secondary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">0</div>
              <p className="text-xs text-muted-foreground">Cadastrados</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Contas a Pagar</CardTitle>
              <DollarSign className="h-4 w-4 text-destructive" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">R$ 0</div>
              <p className="text-xs text-muted-foreground">Pendentes</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Compras</CardTitle>
              <ShoppingCart className="h-4 w-4 text-warning" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">0</div>
              <p className="text-xs text-muted-foreground">Este mês</p>
            </CardContent>
          </Card>
        </div>

        <RankingCorretores />

        <Card>
          <CardHeader>
            <CardTitle>Bem-vindo ao PRUMO</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Seu sistema de gestão de obras está pronto. Comece cadastrando seus clientes e criando suas primeiras
              obras. Os módulos serão habilitados conforme as próximas fases de desenvolvimento.
            </p>
          </CardContent>
        </Card>

        <Dialog open={showOnboarding} onOpenChange={setShowOnboarding}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Vamos começar configurando sua empresa</DialogTitle>
            </DialogHeader>
            <form className="space-y-4 pt-2" onSubmit={handleCreateCompany}>
              <div className="space-y-2">
                <Label htmlFor="company-name">Nome da empresa</Label>
                <Input
                  id="company-name"
                  placeholder="Ex.: Construtora Horizonte"
                  value={companyName}
                  onChange={(event) => setCompanyName(event.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Usaremos esse nome para organizar suas obras, contratos e relatórios.
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="submit" disabled={savingCompany}>
                  {savingCompany ? 'Salvando...' : 'Criar empresa e continuar'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
