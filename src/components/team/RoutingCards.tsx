// Equipe → distribuição das conversas (modo, visibilidade, vínculo ao assumir) e carteira de clientes.
import { useState, type FormEvent } from "react";
import { Trash2, UserCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { formatPhone } from "@/lib/format";
import { ROUTING_DEFAULTS, useContactAssignmentActions, useContactAssignments, useMembers, useRouting, useUpdateRouting } from "@/hooks/use-routing";
import type { MemberWithEmail, RoutingSettings } from "@/lib/database.types";
import { Button, Card, CardBody, CardHeader, ConfirmButton, EmptyState, Input, Select, Spinner, Switch, useToast } from "@/components/ui";

export const ASSIGNMENT_LABEL: Record<RoutingSettings["assignment_mode"], string> = {
  shared: "Fila compartilhada: quem assumir primeiro atende",
  portfolio: "Carteira: cada cliente tem o seu operador",
  round_robin: "Rodízio: distribui entre os operadores com menos conversas",
};

export function RoutingSettingsCard({ workspaceId }: { workspaceId: string }) {
  const routing = useRouting(workspaceId);
  const update = useUpdateRouting(workspaceId);
  const toast = useToast();
  const value = routing.data ?? { workspace_id: workspaceId, ...ROUTING_DEFAULTS, updated_at: "" };
  const set = (patch: Partial<Omit<RoutingSettings, "workspace_id" | "updated_at">>) =>
    update.mutate(patch, { onSuccess: () => toast.success("Distribuição atualizada."), onError: (e) => toast.error(e) });

  return (
    <Card>
      <CardHeader title="Distribuição das conversas" description="Como as conversas transferidas pela IA chegam à equipe e o que cada atendente vê." />
      <CardBody className="space-y-4">
        {routing.isLoading ? (
          <div className="flex justify-center"><Spinner /></div>
        ) : (
          <>
            <Select label="Quando a IA transfere para a equipe" value={value.assignment_mode} onChange={(e) => set({ assignment_mode: e.target.value as RoutingSettings["assignment_mode"] })} disabled={update.isPending}>
              {(Object.keys(ASSIGNMENT_LABEL) as RoutingSettings["assignment_mode"][]).map((k) => <option key={k} value={k}>{ASSIGNMENT_LABEL[k]}</option>)}
            </Select>
            <Select label="O que o atendente vê na inbox" value={value.agent_visibility} onChange={(e) => set({ agent_visibility: e.target.value as RoutingSettings["agent_visibility"] })} disabled={update.isPending} hint="Administradores e o proprietário sempre veem tudo.">
              <option value="all">Todas as conversas (com filtro “Minhas”)</option>
              <option value="own">Só as suas e as sem dono</option>
            </Select>
            {value.assignment_mode === "portfolio" && (
              <Switch
                checked={value.sticky_claim}
                onChange={(v) => set({ sticky_claim: v })}
                label="Quem assume um cliente novo passa a ser o operador dele"
                description="Ao assumir uma conversa de número sem operador, o número entra na carteira de quem assumiu."
              />
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}

export function ContactAssignmentsCard({ workspaceId }: { workspaceId: string }) {
  const { user } = useAuth();
  const toast = useToast();
  const members = useMembers(workspaceId);
  const list = useContactAssignments(workspaceId);
  const { add, remove } = useContactAssignmentActions(workspaceId);
  const [phone, setPhone] = useState("");
  const [userId, setUserId] = useState("");
  const [note, setNote] = useState("");
  const people = (members.data ?? []).filter((m) => !m.is_support);
  const emailOf = (id: string) => people.find((m) => m.user_id === id)?.email ?? "(removido)";

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await add.mutateAsync({ phone, user_id: userId || user!.id, note: note.trim() || undefined });
      toast.success("Cliente vinculado.");
      setPhone("");
      setNote("");
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <Card>
      <CardHeader title="Carteira de clientes" description="Número do cliente → operador. Quando a IA transferir uma conversa desse número, ela cai para esse operador." />
      <CardBody className="space-y-4">
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
          <Input label="Telefone do cliente" placeholder="(48) 99999-0000" value={phone} onChange={(e) => setPhone(e.target.value)} required />
          <Select label="Operador" value={userId || user?.id || ""} onChange={(e) => setUserId(e.target.value)}>
            {people.map((m: MemberWithEmail) => <option key={m.user_id} value={m.user_id}>{m.email}</option>)}
          </Select>
          <Input label="Observação" placeholder="opcional" value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} />
          <Button type="submit" loading={add.isPending}><UserCheck className="h-4 w-4" /> Vincular</Button>
        </form>
        {list.isLoading ? (
          <div className="flex justify-center"><Spinner /></div>
        ) : !list.data?.length ? (
          <EmptyState icon={UserCheck} title="Nenhum cliente vinculado" description="Vincule aqui ou use “Ficar com este cliente” dentro da conversa." />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {list.data.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <span className="font-medium">{formatPhone(a.phone)}</span>
                <span className="text-slate-500 dark:text-slate-400">→ {emailOf(a.user_id)}</span>
                {a.note && <span className="text-xs text-slate-400">{a.note}</span>}
                <ConfirmButton size="sm" variant="ghost" className="ml-auto" title="Desvincular cliente?" onConfirm={() => remove.mutateAsync(a.id).catch((e) => toast.error(e))} aria-label="Desvincular">
                  <Trash2 className="h-4 w-4" />
                </ConfirmButton>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
