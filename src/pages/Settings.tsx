import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Palette, Save, Settings2 } from "lucide-react";
import { useWorkspace } from "@/lib/workspace";
import { normalizeCustomDomain } from "@/lib/agent-settings";
import { useWorkspaceAdmin, type WorkspaceBrandingRecord } from "@/hooks/use-workspace-admin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type BrandingForm = WorkspaceBrandingRecord & {
  workspaceName: string;
  supportNotes: string;
};

export default function SettingsPage() {
  const { currentWorkspace, role } = useWorkspace();
  const { branding, loading, saveBranding } = useWorkspaceAdmin();
  const [form, setForm] = useState<BrandingForm | null>(null);
  const [saving, setSaving] = useState(false);

  const canEdit = role === "owner" || role === "admin";

  useEffect(() => {
    if (!currentWorkspace || !branding) return;
    setForm({
      ...branding,
      workspaceName: currentWorkspace.name,
      supportNotes: "",
    });
  }, [branding, currentWorkspace]);

  if (loading || !form) {
    return <div className="p-8 text-sm text-muted-foreground">Carregando configuracoes do workspace...</div>;
  }

  if (!currentWorkspace) {
    return <div className="p-8 text-sm text-muted-foreground">Selecione um workspace para continuar.</div>;
  }

  const updateForm = <K extends keyof BrandingForm>(field: K, value: BrandingForm[K]) => {
    setForm((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await saveBranding(
        {
          workspace_id: form.workspace_id,
          display_name: form.display_name,
          logo_url: form.logo_url,
          primary_color: form.primary_color,
          secondary_color: form.secondary_color,
          custom_domain: form.custom_domain,
          support_email: form.support_email,
        },
        form.workspaceName,
      );
      toast.success("Configuracoes do workspace salvas.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel salvar as configuracoes.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 p-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Configuracoes</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Gerencie o branding do workspace, o nome exibido no white-label e os dados basicos de suporte.
          </p>
        </div>
        <Button onClick={handleSave} disabled={!canEdit || saving}>
          <Save className="h-4 w-4" />
          {saving ? "Salvando..." : "Salvar configuracoes"}
        </Button>
      </div>

      {!canEdit && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Seu perfil atual pode visualizar esta area, mas somente `owner` e `admin` podem editar o workspace.
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Settings2 className="h-5 w-5 text-primary" />
            <div>
              <CardTitle>Dados do workspace</CardTitle>
              <CardDescription>Informacoes principais do tenant no painel administrativo.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="workspaceName">Nome do workspace</Label>
            <Input
              id="workspaceName"
              value={form.workspaceName}
              onChange={(e) => updateForm("workspaceName", e.target.value)}
              disabled={!canEdit}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="displayName">Nome publico</Label>
            <Input
              id="displayName"
              value={form.display_name ?? ""}
              onChange={(e) => updateForm("display_name", e.target.value || null)}
              disabled={!canEdit}
              placeholder="Callia Chat"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="supportEmail">Email de suporte</Label>
            <Input
              id="supportEmail"
              type="email"
              value={form.support_email ?? ""}
              onChange={(e) => updateForm("support_email", e.target.value || null)}
              disabled={!canEdit}
              placeholder="suporte@empresa.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="customDomain">Dominio customizado</Label>
            <Input
              id="customDomain"
              value={form.custom_domain ?? ""}
              onChange={(e) => updateForm("custom_domain", normalizeCustomDomain(e.target.value))}
              disabled={!canEdit}
              placeholder="app.suaempresa.com"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Palette className="h-5 w-5 text-primary" />
            <div>
              <CardTitle>White-label e branding</CardTitle>
              <CardDescription>Defina logo, cores e identidade visual basica do workspace.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="logoUrl">Logo URL</Label>
            <Input
              id="logoUrl"
              value={form.logo_url ?? ""}
              onChange={(e) => updateForm("logo_url", e.target.value || null)}
              disabled={!canEdit}
              placeholder="https://empresa.com/logo.png"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="primaryColor">Cor primaria</Label>
            <div className="flex gap-3">
              <Input
                id="primaryColor"
                type="color"
                value={form.primary_color ?? "#111827"}
                onChange={(e) => updateForm("primary_color", e.target.value)}
                disabled={!canEdit}
                className="h-10 w-20 p-1"
              />
              <Input
                value={form.primary_color ?? "#111827"}
                onChange={(e) => updateForm("primary_color", e.target.value)}
                disabled={!canEdit}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="secondaryColor">Cor secundaria</Label>
            <div className="flex gap-3">
              <Input
                id="secondaryColor"
                type="color"
                value={form.secondary_color ?? "#6366f1"}
                onChange={(e) => updateForm("secondary_color", e.target.value)}
                disabled={!canEdit}
                className="h-10 w-20 p-1"
              />
              <Input
                value={form.secondary_color ?? "#6366f1"}
                onChange={(e) => updateForm("secondary_color", e.target.value)}
                disabled={!canEdit}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="previewName">Preview do branding</Label>
            <div className="rounded-xl border p-4">
              <div
                className="rounded-lg px-4 py-3 text-sm font-medium text-white"
                style={{ backgroundColor: form.primary_color ?? "#111827" }}
              >
                {form.display_name || form.workspaceName}
              </div>
              <div
                className="mt-3 rounded-lg px-4 py-3 text-sm"
                style={{
                  border: `1px solid ${form.secondary_color ?? "#6366f1"}`,
                  color: form.secondary_color ?? "#6366f1",
                }}
              >
                Botao secundario / destaque de marca
              </div>
            </div>
          </div>
          <div className="space-y-2 lg:col-span-2">
            <Label htmlFor="supportNotes">Observacoes internas</Label>
            <Textarea
              id="supportNotes"
              value={form.supportNotes}
              onChange={(e) => updateForm("supportNotes", e.target.value)}
              disabled={!canEdit}
              placeholder="Ex.: este campo pode ser expandido no futuro para orientacoes internas do time"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
