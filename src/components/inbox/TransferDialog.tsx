// Transferir a conversa para outro operador ou para um setor, com nota opcional (vira mensagem de sistema na conversa).
import { useState } from "react";
import { ArrowRightLeft } from "lucide-react";
import { cn } from "@/lib/cn";
import { useAuth } from "@/lib/auth";
import { useMembers } from "@/hooks/use-routing";
import { useDepartments, useTransferConversation } from "@/hooks/use-departments";
import type { Conversation } from "@/lib/database.types";
import { Button, Modal, Tabs, Textarea, useToast } from "@/components/ui";

type Tab = "user" | "department";

export function TransferDialog({ workspaceId, conversation, open, onClose }: { workspaceId: string; conversation: Conversation; open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const members = useMembers(workspaceId);
  const departments = useDepartments(workspaceId);
  const transfer = useTransferConversation(workspaceId);
  const [tab, setTab] = useState<Tab>("user");
  const [userId, setUserId] = useState<string | null>(null);
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const people = (members.data ?? []).filter((m) => !m.is_support && m.user_id !== user?.id);
  const inDept = (uid: string, did: string) => departments.data?.members.some((m) => m.department_id === did && m.user_id === uid) ?? false;
  const deptList = departments.data?.departments ?? [];
  const ready = tab === "user" ? Boolean(userId) : Boolean(departmentId);
  const tabs = [{ id: "user" as Tab, label: "Para um operador" }, ...(deptList.length ? [{ id: "department" as Tab, label: "Para um setor" }] : [])];

  function close() {
    setUserId(null); setDepartmentId(null); setNote(""); setTab("user");
    onClose();
  }

  async function confirm() {
    if (!ready) return;
    try {
      const r = await transfer.mutateAsync({ conversationId: conversation.id, userId: tab === "user" ? userId : null, departmentId: tab === "user" ? null : departmentId, note });
      const who = tab === "user"
        ? people.find((p) => p.user_id === userId)?.email.split("@")[0]
        : `o setor ${deptList.find((d) => d.id === departmentId)?.name}${r.assigned_user_id ? ` (${members.data?.find((m) => m.user_id === r.assigned_user_id)?.email.split("@")[0] ?? "operador"})` : ""}`;
      toast.success(`Conversa transferida para ${who}.`);
      close();
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Transferir conversa"
      description="Quem recebe vê a nota como mensagem de sistema na conversa."
      footer={
        <>
          <Button variant="secondary" onClick={close}>Cancelar</Button>
          <Button onClick={() => void confirm()} disabled={!ready} loading={transfer.isPending}><ArrowRightLeft className="h-4 w-4" /> Transferir</Button>
        </>
      }
    >
      <div className="space-y-3">
        {tabs.length > 1 && <Tabs tabs={tabs} value={tab} onChange={setTab} />}
        {tab === "user" ? (
          <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-700" aria-label="Operadores">
            {people.length === 0 && <li className="px-3 py-3 text-sm text-slate-500">Nenhum outro operador na equipe.</li>}
            {people.map((p) => {
              const depts = deptList.filter((d) => inDept(p.user_id, d.id)).map((d) => d.name);
              return (
                <li key={p.user_id}>
                  <button type="button" onClick={() => setUserId(userId === p.user_id ? null : p.user_id)} aria-pressed={userId === p.user_id}
                    className={cn("flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50", userId === p.user_id && "bg-brand/10")}>
                    <span className="font-medium">{p.email.split("@")[0]}</span>
                    <span className="truncate text-xs text-slate-500">{depts.length ? depts.join(", ") : p.email}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-700" aria-label="Setores">
            {deptList.map((d) => {
              const count = departments.data?.members.filter((m) => m.department_id === d.id).length ?? 0;
              return (
                <li key={d.id}>
                  <button type="button" onClick={() => setDepartmentId(departmentId === d.id ? null : d.id)} aria-pressed={departmentId === d.id}
                    disabled={d.id === conversation.department_id}
                    className={cn("flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-50 dark:hover:bg-slate-800/50", departmentId === d.id && "bg-brand/10")}>
                    <span className="font-medium">{d.name}{d.id === conversation.department_id ? " (atual)" : ""}</span>
                    <span className="text-xs text-slate-500">{count} operador(es)</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <Textarea label="Nota para quem recebe (opcional)" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: cliente quer a 2ª via do boleto" />
      </div>
    </Modal>
  );
}
