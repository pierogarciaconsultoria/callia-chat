import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useRequiredWorkspace } from "@/lib/workspace";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/functions";
import { applyBranding, DEFAULT_PRIMARY, DEFAULT_SECONDARY } from "@/lib/branding";
import { PlanUsageCard } from "@/components/PlanUsageCard";
import { SubscriptionCard } from "@/components/SubscriptionCard";
import { QuickRepliesCard } from "@/components/settings/QuickRepliesCard";
import type { WorkspaceBranding } from "@/lib/database.types";
import { Button, Card, CardBody, CardHeader, Input, PageHeader, useToast } from "@/components/ui";

const HEX = /^#[0-9a-fA-F]{6}$/;

export default function Settings() {
  const { workspaceId } = useRequiredWorkspace();
  return (
    <>
      <PageHeader title="Configurações" description="Plano, identidade visual, respostas rápidas e conectores. Dados, políticas e preços do negócio ficam em Informações da empresa." />
      <div className="space-y-6">
        <PlanUsageCard />
        <SubscriptionCard />
        <WorkspaceNameCard />
        <QuickRepliesCard workspaceId={workspaceId} />
        <BrandingCard />
        <ConnectorsPointer />
      </div>
    </>
  );
}

function WorkspaceNameCard() {
  const { workspace, workspaceId, refresh } = useRequiredWorkspace();
  const toast = useToast();
  const [name, setName] = useState(workspace?.name ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => setName(workspace?.name ?? ""), [workspace?.name]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      unwrap(await supabase.from("workspaces").update({ name: name.trim() }).eq("id", workspaceId));
      await refresh();
      toast.success("Nome atualizado.");
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Workspace" description={workspace ? `Identificador: ${workspace.slug}` : undefined} />
      <CardBody>
        <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Input wrapperClassName="flex-1" label="Nome" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={120} required />
          <Button type="submit" loading={busy} disabled={name.trim() === workspace?.name}>Salvar</Button>
        </form>
      </CardBody>
    </Card>
  );
}

function BrandingCard() {
  const { workspaceId, branding } = useRequiredWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<Partial<WorkspaceBranding>>({});

  useEffect(() => {
    setForm({
      display_name: branding?.display_name ?? "",
      logo_url: branding?.logo_url ?? "",
      primary_color: branding?.primary_color ?? DEFAULT_PRIMARY,
      secondary_color: branding?.secondary_color ?? DEFAULT_SECONDARY,
      custom_domain: branding?.custom_domain ?? "",
      support_email: branding?.support_email ?? "",
    });
  }, [branding]);

  // Pré-visualização ao vivo no shell; volta ao salvo ao sair da página.
  useEffect(() => {
    if (HEX.test(form.primary_color ?? "") && HEX.test(form.secondary_color ?? "")) applyBranding(form.primary_color, form.secondary_color);
  }, [form.primary_color, form.secondary_color]);
  useEffect(() => () => applyBranding(branding?.primary_color, branding?.secondary_color), [branding]);

  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await supabase
          .from("workspace_branding")
          .upsert({
            workspace_id: workspaceId,
            display_name: form.display_name?.trim() || null,
            logo_url: form.logo_url?.trim() || null,
            primary_color: form.primary_color,
            secondary_color: form.secondary_color,
            custom_domain: form.custom_domain?.trim().toLowerCase() || null,
            support_email: form.support_email?.trim() || null,
          })
          .select("*")
          .single(),
      ) as WorkspaceBranding,
    onSuccess: (row) => {
      qc.setQueryData(["branding", workspaceId], row);
      toast.success("Identidade visual salva.");
    },
    onError: (e) => toast.error(/duplicate|unique/i.test(String((e as Error).message)) ? "Este domínio já está em uso por outro workspace." : e),
  });

  const colorsValid = HEX.test(form.primary_color ?? "") && HEX.test(form.secondary_color ?? "");

  return (
    <Card>
      <CardHeader title="Identidade visual" description="Nome, logo e cores exibidos no painel (white-label)." />
      <CardBody>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (colorsValid) save.mutate();
          }}
          className="space-y-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Nome exibido" value={form.display_name ?? ""} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
            <Input label="URL do logo" type="url" value={form.logo_url ?? ""} onChange={(e) => setForm({ ...form, logo_url: e.target.value })} placeholder="https://" />
            <ColorField label="Cor principal" value={form.primary_color ?? ""} onChange={(v) => setForm({ ...form, primary_color: v })} />
            <ColorField label="Cor de destaque" value={form.secondary_color ?? ""} onChange={(v) => setForm({ ...form, secondary_color: v })} />
            <Input
              label="Domínio personalizado"
              value={form.custom_domain ?? ""}
              onChange={(e) => setForm({ ...form, custom_domain: e.target.value })}
              placeholder="atendimento.suaempresa.com"
              hint="Requer apontamento DNS e certificado no servidor."
            />
            <Input label="E-mail de suporte" type="email" value={form.support_email ?? ""} onChange={(e) => setForm({ ...form, support_email: e.target.value })} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-brand-fg">Botão principal</span>
            <span className="rounded-lg bg-brand/10 px-3 py-1.5 text-sm font-medium text-brand">Item ativo</span>
            <span className="rounded-lg bg-brand-accent px-3 py-1.5 text-sm font-medium text-slate-900">Destaque</span>
            <Button type="submit" className="ml-auto" loading={save.isPending} disabled={!colorsValid}>Salvar</Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const valid = HEX.test(value);
  return (
    <div className="space-y-1.5">
      <span className="block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={valid ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-900"
          aria-label={label}
        />
        <Input value={value} onChange={(e) => onChange(e.target.value)} wrapperClassName="flex-1" error={valid ? undefined : "Use #RRGGBB"} aria-label={`${label} (hex)`} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- conectores
function ConnectorsPointer() {
  return (
    <Card>
      <CardHeader
        title="Conectores"
        description="As integrações agora ficam em Integrações: WhatsApp, sistema de reservas (Hospedin) e link de reservas."
        actions={
          <Link to="/integrations" className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
            Abrir Integrações <ArrowRight className="h-4 w-4" />
          </Link>
        }
      />
    </Card>
  );
}
