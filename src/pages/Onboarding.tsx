import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useWorkspace } from "@/lib/workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export default function Onboarding() {
  const { user } = useAuth();
  const { refresh } = useWorkspace();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const slugify = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") +
    "-" + Math.random().toString(36).slice(2, 6);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    const { error } = await (supabase as any)
      .from("workspaces")
      .insert({ name, slug: slugify(name), owner_id: user.id });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Workspace criado!");
    await refresh();
    navigate("/inbox");
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Criar workspace</CardTitle>
          <CardDescription>Cada workspace é um cliente/SaaS isolado.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1">
              <Label>Nome do workspace</Label>
              <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Loja XYZ" />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Criando..." : "Criar"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}