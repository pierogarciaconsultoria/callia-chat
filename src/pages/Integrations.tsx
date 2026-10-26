import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { BedDouble, CalendarSearch, ExternalLink, Link2, MessageCircle, type LucideIcon } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  ConfirmButton,
  ErrorState,
  Input,
  Notice,
  PageHeader,
  PageLoader,
  useToast,
  type BadgeTone,
} from "@/components/ui";
import { useRequiredWorkspace } from "@/lib/workspace";
import { formatDateTime } from "@/lib/format";
import { isValidHttpUrl, sampleBookingLink } from "@/lib/integrations";
import type { Integration, IntegrationKind, IntegrationStatus } from "@/lib/database.types";
import { findIntegration, useIntegrationActions, useIntegrations } from "@/hooks/use-integrations";
import { useInstanceMutations, useWhatsAppInstances } from "@/hooks/use-whatsapp-instances";
import { useEntitlements } from "@/hooks/use-entitlements";
import { WhatsAppConnectModal } from "@/components/integrations/WhatsAppConnectModal";
import { HospedinConnectModal } from "@/components/integrations/HospedinConnectModal";
import { AvailabilityTestDialog } from "@/components/integrations/AvailabilityTest";

const STATUS: Record<IntegrationStatus, { label: string; tone: BadgeTone }> = {
  connected: { label: "Conectado", tone: "green" },
  pending: { label: "Pendente", tone: "amber" },
  error: { label: "Erro", tone: "red" },
  disconnected: { label: "Desconectado", tone: "neutral" },
};

function placeholder(kind: IntegrationKind, title: string): Integration {
  return { kind, status: "disconnected", title, summary: null, last_checked_at: null, last_error: null, details: {} };
}

export default function Integrations() {
  const { workspaceId } = useRequiredWorkspace();
  const list = useIntegrations(workspaceId);
  const entitlements = useEntitlements();
  const inactive = entitlements.data ? !entitlements.data.active : false;

  if (list.isLoading) return <PageLoader />;
  if (list.error) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;

  const whatsapp = findIntegration(list.data, "whatsapp") ?? placeholder("whatsapp", "WhatsApp");
  const hospedin = findIntegration(list.data, "hospedin") ?? placeholder("hospedin", "Hospedin");
  const bookingLink = findIntegration(list.data, "booking_link") ?? placeholder("booking_link", "Link de reservas");
  const hbook = findIntegration(list.data, "hbook");

  return (
    <>
      <PageHeader
        title="Integrações"
        description="Conecte o WhatsApp e o seu sistema de reservas. Cada conexão leva poucos minutos e não precisa de conhecimento técnico."
      />
      {inactive && (
        <div className="mb-4">
          <Notice tone="warn">Este workspace está inativo. Fale com o suporte para reativar antes de conectar novos serviços.</Notice>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <WhatsAppCard workspaceId={workspaceId} integration={whatsapp} disabled={inactive} />
        <HospedinCard workspaceId={workspaceId} integration={hospedin} disabled={inactive} />
        <BookingLinkCard workspaceId={workspaceId} integration={bookingLink} hbook={hbook} disabled={inactive} />
        {hbook && hbook.status !== "disconnected" && <HbookCard workspaceId={workspaceId} integration={hbook} />}
      </div>
    </>
  );
}

function IntegrationCard({
  icon: Icon,
  title,
  description,
  integration,
  actions,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  integration: Integration;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const status = STATUS[integration.status] ?? STATUS.disconnected;
  return (
    <Card className="flex flex-col">
      <div className="flex items-start gap-3 p-4 sm:p-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
            <Badge tone={status.tone}>{status.label}</Badge>
          </div>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{integration.summary ?? description}</p>
          {integration.last_error && <p className="mt-1 text-sm text-red-600 dark:text-red-400">{integration.last_error}</p>}
          {integration.last_checked_at && (
            <p className="mt-1 text-xs text-slate-400">Verificado em {formatDateTime(integration.last_checked_at)}</p>
          )}
        </div>
      </div>
      {children && <div className="px-4 pb-4 sm:px-5">{children}</div>}
      {actions && (
        <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-800 sm:px-5">{actions}</div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- WhatsApp
function WhatsAppCard({ workspaceId, integration, disabled }: { workspaceId: string; integration: Integration; disabled: boolean }) {
  const [modal, setModal] = useState<null | "connect" | "replace">(null);
  const instances = useWhatsAppInstances(workspaceId);
  const { action } = useInstanceMutations(workspaceId);
  const toast = useToast();
  const { refresh } = useIntegrationActions(workspaceId);
  const connected = integration.status === "connected";
  const instance =
    instances.data?.find((i) => i.id === integration.details.instance_id) ??
    instances.data?.find((i) => i.is_default) ??
    instances.data?.[0];

  return (
    <>
      <IntegrationCard
        icon={MessageCircle}
        title="WhatsApp"
        description="Conecte o número que atende os hóspedes. A MarIA responde por ele."
        integration={integration}
        actions={
          <>
            {connected ? (
              <>
                <Button size="sm" variant="secondary" onClick={() => setModal("replace")} disabled={disabled}>
                  Trocar número
                </Button>
                {instance && (
                  <ConfirmButton
                    size="sm"
                    variant="ghost"
                    title="Desconectar o WhatsApp?"
                    description="A MarIA deixa de receber e responder mensagens até você conectar de novo."
                    confirmLabel="Desconectar"
                    onConfirm={async () => {
                      try {
                        await action.mutateAsync({ action: "disconnect", instance_id: instance.id });
                        refresh();
                        toast.success("WhatsApp desconectado.");
                      } catch (err) {
                        toast.error(err);
                      }
                    }}
                  >
                    Desconectar
                  </ConfirmButton>
                )}
              </>
            ) : (
              <Button size="sm" onClick={() => setModal("connect")} disabled={disabled}>
                Conectar WhatsApp
              </Button>
            )}
            <Link to="/whatsapp" className="ml-auto text-xs text-slate-500 hover:underline">
              Gerenciar números (avançado)
            </Link>
          </>
        }
      />
      <WhatsAppConnectModal
        open={modal !== null}
        replace={modal === "replace"}
        onClose={() => {
          setModal(null);
          refresh();
        }}
        workspaceId={workspaceId}
      />
    </>
  );
}

// ---------------------------------------------------------------- Hospedin
function HospedinCard({ workspaceId, integration, disabled }: { workspaceId: string; integration: Integration; disabled: boolean }) {
  const [connectOpen, setConnectOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const { disconnect } = useIntegrationActions(workspaceId);
  const toast = useToast();
  const connected = integration.status === "connected" || integration.status === "error";
  const categories = integration.details.categories ?? [];

  return (
    <>
      <IntegrationCard
        icon={BedDouble}
        title="Sistema de reservas · Hospedin"
        description="Informe o usuário do Hospedin e a MarIA passa a consultar disponibilidade e valores sozinha."
        integration={integration}
        actions={
          connected ? (
            <>
              <Button size="sm" variant="secondary" onClick={() => setTestOpen(true)}>
                <CalendarSearch className="h-4 w-4" /> Testar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConnectOpen(true)} disabled={disabled}>
                Reconectar
              </Button>
              <ConfirmButton
                size="sm"
                variant="ghost"
                title="Desconectar o Hospedin?"
                description="A MarIA deixa de consultar disponibilidade e valores no Hospedin. O usuário e a senha guardados são apagados."
                confirmLabel="Desconectar"
                onConfirm={async () => {
                  try {
                    await disconnect.mutateAsync("hospedin");
                    toast.success("Hospedin desconectado.");
                  } catch (err) {
                    toast.error(err);
                  }
                }}
              >
                Desconectar
              </ConfirmButton>
            </>
          ) : (
            <Button size="sm" onClick={() => setConnectOpen(true)} disabled={disabled}>
              Conectar Hospedin
            </Button>
          )
        }
      >
        {connected && (integration.details.account_id || categories.length > 0) && (
          <dl className="space-y-1 text-sm">
            {integration.details.account_id && (
              <div className="flex gap-2">
                <dt className="text-slate-500">Conta:</dt>
                <dd className="font-medium">{integration.details.account_id}</dd>
              </div>
            )}
            {categories.length > 0 && (
              <div>
                <dt className="text-slate-500">Categorias ({categories.length}):</dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {categories.map((c) => (
                    <Badge key={String(c.id)}>
                      {c.title}
                      {c.occupants ? ` · ${c.occupants} pess.` : ""}
                    </Badge>
                  ))}
                </dd>
              </div>
            )}
          </dl>
        )}
      </IntegrationCard>
      <HospedinConnectModal open={connectOpen} onClose={() => setConnectOpen(false)} workspaceId={workspaceId} current={integration} />
      <AvailabilityTestDialog open={testOpen} onClose={() => setTestOpen(false)} workspaceId={workspaceId} kind="hospedin" />
    </>
  );
}

// ---------------------------------------------------------------- Link de reservas
function BookingLinkCard({
  workspaceId,
  integration,
  hbook,
  disabled,
}: {
  workspaceId: string;
  integration: Integration;
  hbook?: Integration;
  disabled: boolean;
}) {
  const saved = integration.details.booking_link ?? hbook?.details.booking_link ?? "";
  const [value, setValue] = useState(saved);
  const { saveBookingLink } = useIntegrationActions(workspaceId);
  const toast = useToast();
  useEffect(() => setValue(saved), [saved]);
  const valid = isValidHttpUrl(value);
  const example = valid ? sampleBookingLink(value) : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await saveBookingLink.mutateAsync(value.trim());
      toast.success("Link de reservas salvo.");
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <IntegrationCard
      icon={Link2}
      title="Link de reservas"
      description="Cole o endereço do seu motor de reservas (hbook ou outro). A MarIA envia o link já com as datas e os hóspedes."
      integration={integration}
    >
      <form onSubmit={submit} className="space-y-3">
        <Input
          label="Endereço do motor de reservas"
          placeholder="https://hbook.hsystem.com.br/Booking?companyId=…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          error={value && !valid ? "Cole um endereço que comece com https://" : undefined}
        />
        {example && (
          <div className="rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-900">
            <p className="mb-1 font-medium text-slate-600 dark:text-slate-300">Exemplo do que o hóspede recebe (próximo fim de semana, 2 adultos):</p>
            <a href={example} target="_blank" rel="noreferrer" className="inline-flex items-start gap-1 break-all text-brand hover:underline">
              {example} <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" />
            </a>
          </div>
        )}
        <Button type="submit" size="sm" loading={saveBookingLink.isPending} disabled={disabled || !valid || value.trim() === saved}>
          Salvar link
        </Button>
      </form>
    </IntegrationCard>
  );
}

// ---------------------------------------------------------------- hbook (conector legado)
// A HSystem não permite consultas automáticas: o hbook só fornece o link de reserva.
function HbookCard({ workspaceId, integration }: { workspaceId: string; integration: Integration }) {
  const { disconnect } = useIntegrationActions(workspaceId);
  const toast = useToast();
  return (
    <IntegrationCard
      icon={CalendarSearch}
      title="Motor de reservas hbook"
      description="A HSystem não permite consulta automática de disponibilidade. A MarIA envia o link de reserva com as datas e os valores da tabela de preços."
      integration={integration}
      actions={
        <ConfirmButton
          size="sm"
          variant="ghost"
          title="Desconectar o hbook?"
          description="Salve antes o endereço em Link de reservas para a MarIA continuar enviando o link."
          confirmLabel="Desconectar"
          onConfirm={async () => {
            try {
              await disconnect.mutateAsync("hbook");
              toast.success("hbook desconectado.");
            } catch (err) {
              toast.error(err);
            }
          }}
        >
          Desconectar
        </ConfirmButton>
      }
    />
  );
}
