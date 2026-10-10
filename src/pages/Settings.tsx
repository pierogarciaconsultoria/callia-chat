import { AppLayout } from '@/components/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Hammer, KeyRound, Layers3, LifeBuoy, PieChart, Tag } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function Settings() {
  const navigate = useNavigate();

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold text-foreground">Configurações</h1>
          <p className="text-muted-foreground">
            Selecione um módulo para gerenciar os parâmetros do sistema.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                  <KeyRound className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-base">Conta e segurança</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Gerencie senha e acesso da sua conta.
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Button
                type="button"
                size="sm"
                className="mt-2"
                onClick={() => navigate('/configuracoes/conta')}
              >
                Gerenciar
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                  <Hammer className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-base">Tipos de obra</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Cadastre os tipos de obra usados no CRM.
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Button
                type="button"
                size="sm"
                className="mt-2"
                onClick={() => navigate('/configuracoes/tipos-obra')}
              >
                Gerenciar
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                  <Layers3 className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-base">Categorias de obra</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Agrupe tipos de obra por segmento.
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Button
                type="button"
                size="sm"
                className="mt-2"
                onClick={() => navigate('/configuracoes/categorias-obra')}
              >
                Gerenciar
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                  <Tag className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-base">CRM</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Configure motivos de perda e outros parâmetros comerciais.
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Button
                type="button"
                size="sm"
                className="mt-2"
                onClick={() => navigate('/configuracoes/crm')}
              >
                Motivos de perda
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                  <PieChart className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-base">Rateio de custos fixos</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Defina como despesas administrativas são distribuídas entre as obras.
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Button
                type="button"
                size="sm"
                className="mt-2"
                onClick={() => navigate('/configuracoes/rateio')}
              >
                Configurar
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                  <LifeBuoy className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-base">Suporte e chamados</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Acompanhe o histórico de chamados e interações com o suporte.
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Button
                type="button"
                size="sm"
                className="mt-2"
                onClick={() => navigate('/configuracoes/suporte')}
              >
                Ver chamados
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
