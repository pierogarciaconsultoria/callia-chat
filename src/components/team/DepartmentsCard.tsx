// Equipe → setores: cadastro e quem atende em cada um. Conversas podem ser transferidas para um setor pela inbox.
import { useState, type FormEvent } from "react";
import { Building2, Pencil, Plus } from "lucide-react";
import { useMembers } from "@/hooks/use-routing";
import { useDepartmentActions, useDepartments } from "@/hooks/use-departments";
import { Button, Card, CardBody, CardHeader, ConfirmButton, Input, Spinner, useToast } from "@/components/ui";

export function DepartmentsCard({ workspaceId }: { workspaceId: string }) {
  const toast = useToast();
  const data = useDepartments(workspaceId);
  const members = useMembers(workspaceId);
  const { save, remove, setMember } = useDepartmentActions(workspaceId);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const people = (members.data ?? []).filter((m) => !m.is_support);
  const isIn = (departmentId: string, userId: string) => data.data?.members.some((m) => m.department_id === departmentId && m.user_id === userId) ?? false;

  async function add(e: FormEvent) {
    e.preventDefault();
    try {
      await save.mutateAsync({ name });
      toast.success("Setor criado.");
      setName("");
    } catch (err) {
      toast.error(err);
    }
  }

  async function rename(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    try {
      await save.mutateAsync(editing);
      toast.success("Setor renomeado.");
      setEditing(null);
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <Card>
      <CardHeader title="Setores" description="Recepção, Reservas, Financeiro… Marque quem atende em cada setor. Na inbox, uma conversa pode ser transferida para um setor ou para um operador." />
      <CardBody className="space-y-4">
        <form onSubmit={add} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Input wrapperClassName="flex-1" label="Novo setor" placeholder="Reservas" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
          <Button type="submit" loading={save.isPending && !editing}><Plus className="h-4 w-4" /> Criar setor</Button>
        </form>
        {data.isLoading ? (
          <div className="flex justify-center"><Spinner /></div>
        ) : (data.data?.departments.length ?? 0) === 0 ? (
          <p className="flex items-center gap-2 text-sm text-slate-500"><Building2 className="h-4 w-4" /> Nenhum setor ainda. Sem setores, a transferência é só entre operadores.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.data!.departments.map((d) => (
              <li key={d.id} className="py-3">
                <div className="flex items-center gap-2">
                  {editing?.id === d.id ? (
                    <form onSubmit={rename} className="flex flex-1 items-center gap-2">
                      <Input aria-label="Nome do setor" value={editing.name} onChange={(e) => setEditing({ id: d.id, name: e.target.value })} maxLength={60} required wrapperClassName="flex-1" />
                      <Button type="submit" size="sm" loading={save.isPending}>Salvar</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
                    </form>
                  ) : (
                    <>
                      <p className="flex-1 text-sm font-medium">{d.name}</p>
                      <Button size="sm" variant="ghost" onClick={() => setEditing({ id: d.id, name: d.name })} aria-label={`Renomear ${d.name}`}><Pencil className="h-4 w-4" /></Button>
                      <ConfirmButton size="sm" variant="ghost" title={`Excluir o setor ${d.name}?`} description="As conversas desse setor ficam sem setor; ninguém perde o acesso." confirmLabel="Excluir"
                        onConfirm={async () => { try { await remove.mutateAsync(d.id); toast.success("Setor excluído."); } catch (e) { toast.error(e); } }}>
                        Excluir
                      </ConfirmButton>
                    </>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  {people.length === 0 && <span className="text-xs text-slate-500">Nenhum membro na equipe.</span>}
                  {people.map((m) => (
                    <label key={m.user_id} className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-400">
                      <input
                        type="checkbox"
                        aria-label={`${m.email} em ${d.name}`}
                        checked={isIn(d.id, m.user_id)}
                        disabled={setMember.isPending}
                        onChange={(e) => setMember.mutate({ department_id: d.id, user_id: m.user_id, member: e.target.checked }, { onError: (err) => toast.error(err) })}
                        className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
                      />
                      {m.email.split("@")[0]}
                    </label>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
