// Políticas e informações oficiais da empresa: um fato em um só lugar, sempre no prompt do agente.
import { useState, type FormEvent } from "react";
import { Pencil, Plus, ScrollText, Trash2 } from "lucide-react";
import { usePolicies, useTableCrud } from "@/hooks/use-knowledge";
import { normalizeTopic, POLICY_TOPICS, policyTopicLabel } from "@/lib/policies";
import type { Policy } from "@/lib/database.types";
import { Badge, Button, Card, CardBody, CardHeader, ConfirmButton, EmptyState, Input, Modal, Select, Spinner, Switch, Textarea, useToast } from "@/components/ui";

type Draft = Partial<Policy> & { customTopic?: string };

export function PoliciesCard({ workspaceId }: { workspaceId: string }) {
  const policies = usePolicies(workspaceId);
  const { save, remove } = useTableCrud<Policy>("workspace_policies", workspaceId);
  const toast = useToast();
  const [editing, setEditing] = useState<Draft | null>(null);
  const known = new Set(POLICY_TOPICS.map((t) => t.id));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const topic = normalizeTopic(editing.topic === "__outro" ? editing.customTopic ?? "" : editing.topic ?? "");
    if (!topic) {
      toast.error("Informe o assunto.");
      return;
    }
    try {
      await save.mutateAsync({
        id: editing.id,
        topic,
        title: editing.title?.trim(),
        content: editing.content?.trim(),
        active: editing.active ?? true,
        position: editing.position ?? (policies.data?.length ?? 0),
      });
      toast.success("Política salva.");
      setEditing(null);
    } catch (err) {
      toast.error(err);
    }
  }

  const topicValue = editing ? (editing.topic && !known.has(editing.topic) ? "__outro" : editing.topic ?? "") : "";

  return (
    <Card>
      <CardHeader
        title="Políticas e informações oficiais"
        description="Check-in, cancelamento, crianças, pets, comodidades… O agente lê tudo isto em toda resposta; cada fato fica só aqui."
        actions={
          <Button size="sm" onClick={() => setEditing({ topic: "", title: "", content: "", active: true })}>
            <Plus className="h-4 w-4" /> Nova política
          </Button>
        }
      />
      {policies.isLoading ? (
        <CardBody className="flex justify-center"><Spinner /></CardBody>
      ) : !policies.data?.length ? (
        <CardBody>
          <EmptyState icon={ScrollText} title="Nenhuma política cadastrada" description="Comece pelo check-in, check-out e cancelamento. O agente só responde sobre o que estiver aqui ou na base." />
        </CardBody>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-800">
          {policies.data.map((p) => (
            <li key={p.id} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{p.title}</span>
                  <Badge>{policyTopicLabel(p.topic)}</Badge>
                  {!p.active && <Badge>inativa</Badge>}
                </div>
                <p className="mt-1 whitespace-pre-line text-sm text-slate-600 dark:text-slate-400">{p.content}</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setEditing(p)} aria-label="Editar"><Pencil className="h-4 w-4" /></Button>
              <ConfirmButton size="sm" variant="ghost" title="Excluir política?" onConfirm={() => remove.mutateAsync(p.id).catch((e) => toast.error(e))} aria-label="Excluir">
                <Trash2 className="h-4 w-4" />
              </ConfirmButton>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? "Editar política" : "Nova política"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button type="submit" form="policy-form" loading={save.isPending}>Salvar</Button>
          </>
        }
      >
        {editing && (
          <form id="policy-form" onSubmit={submit} className="space-y-4">
            <Select label="Assunto" value={topicValue} onChange={(e) => setEditing({ ...editing, topic: e.target.value, customTopic: e.target.value === "__outro" ? editing.customTopic ?? (editing.topic && !known.has(editing.topic) ? editing.topic : "") : undefined })} required>
              <option value="">Escolha…</option>
              {POLICY_TOPICS.filter((t) => t.id !== "outro").map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              <option value="__outro">Outro assunto…</option>
            </Select>
            {topicValue === "__outro" && (
              <Input label="Qual assunto?" value={editing.customTopic ?? ""} onChange={(e) => setEditing({ ...editing, customTopic: e.target.value })} maxLength={40} required />
            )}
            <Input label="Título" value={editing.title ?? ""} onChange={(e) => setEditing({ ...editing, title: e.target.value })} required minLength={2} maxLength={120} />
            <Textarea label="Texto" rows={5} value={editing.content ?? ""} onChange={(e) => setEditing({ ...editing, content: e.target.value })} required minLength={2} maxLength={4000} hint="Escreva o fato como ele é (ex.: 'Check-in das 14h às 22h; depois disso, só com agendamento'). Como o agente fala sobre ele fica nas regras do agente." />
            <Switch checked={editing.active ?? true} onChange={(v) => setEditing({ ...editing, active: v })} label="Ativa" description="Inativas não entram no prompt do agente." />
          </form>
        )}
      </Modal>
    </Card>
  );
}
