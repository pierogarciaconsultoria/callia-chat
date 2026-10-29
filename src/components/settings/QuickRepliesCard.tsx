// Cadastro das respostas rápidas (admin): atalho, título, texto com {nome}/{primeiro_nome} e anexo opcional.
import { useState, type FormEvent } from "react";
import { Paperclip, Pencil, Plus, Zap } from "lucide-react";
import { useQuickReplies, useQuickReplyActions, type QuickReplyInput } from "@/hooks/use-quick-replies";
import { normalizeShortcut, QUICK_REPLY_VARIABLES, SHORTCUT_RE } from "@/lib/quick-replies";
import { uploadAttachment, validateUpload } from "@/lib/inbox-send";
import type { QuickReply } from "@/lib/database.types";
import { Button, Card, CardBody, CardHeader, ConfirmButton, Input, Modal, Spinner, Textarea, useToast } from "@/components/ui";

export function QuickRepliesCard({ workspaceId }: { workspaceId: string }) {
  const replies = useQuickReplies(workspaceId);
  const { remove } = useQuickReplyActions(workspaceId);
  const toast = useToast();
  const [editing, setEditing] = useState<QuickReply | "new" | null>(null);
  const list = replies.data ?? [];

  return (
    <Card>
      <CardHeader
        title="Respostas rápidas"
        description="Textos prontos para a equipe: na inbox, digite / e o atalho (ex.: /pix). Chave PIX, endereço, horários, como chegar."
        actions={<Button size="sm" onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> Nova resposta</Button>}
      />
      <CardBody>
        {replies.isLoading ? (
          <div className="flex justify-center py-4"><Spinner /></div>
        ) : list.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhuma resposta cadastrada ainda. Comece pela chave PIX e pelo endereço.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {list.map((r) => (
              <li key={r.id} className="flex items-start gap-3 py-2.5">
                <code className="mt-0.5 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">/{r.shortcut}</code>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.title}</p>
                  <p className="line-clamp-2 whitespace-pre-line text-xs text-slate-500">{r.content}</p>
                  {r.media_name && <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-400"><Paperclip className="h-3 w-3" /> {r.media_name}</p>}
                </div>
                <Button size="sm" variant="ghost" onClick={() => setEditing(r)} aria-label={`Editar ${r.title}`}><Pencil className="h-4 w-4" /></Button>
                <ConfirmButton size="sm" variant="ghost" title="Excluir resposta rápida?" description={`"/${r.shortcut} · ${r.title}" some da lista da equipe.`} confirmLabel="Excluir"
                  onConfirm={async () => { try { await remove.mutateAsync(r.id); toast.success("Resposta excluída."); } catch (e) { toast.error(e); } }}>
                  Excluir
                </ConfirmButton>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      {editing && <QuickReplyModal workspaceId={workspaceId} reply={editing === "new" ? null : editing} existing={list} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function QuickReplyModal({ workspaceId, reply, existing, onClose }: { workspaceId: string; reply: QuickReply | null; existing: QuickReply[]; onClose: () => void }) {
  const toast = useToast();
  const { save } = useQuickReplyActions(workspaceId);
  const [shortcut, setShortcut] = useState(reply?.shortcut ?? "");
  const [title, setTitle] = useState(reply?.title ?? "");
  const [content, setContent] = useState(reply?.content ?? "");
  const [media, setMedia] = useState<{ path: string; name: string; mime: string } | null>(reply?.media_path ? { path: reply.media_path, name: reply.media_name ?? "anexo", mime: reply.media_mime ?? "" } : null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const slug = normalizeShortcut(shortcut);
  const duplicate = existing.some((r) => r.shortcut === slug && r.id !== reply?.id);
  const shortcutError = shortcut && !SHORTCUT_RE.test(slug) ? "Use de 2 a 30 letras, números, _ ou -." : duplicate ? "Já existe uma resposta com esse atalho." : undefined;
  const ready = SHORTCUT_RE.test(slug) && !duplicate && title.trim().length > 0 && content.trim().length > 0;

  function pickFile(f: File | null) {
    if (!f) return setFile(null);
    const problem = validateUpload(f);
    if (problem) return toast.error(problem);
    setFile(f);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    try {
      let input: QuickReplyInput = { shortcut: slug, title: title.trim(), content: content.trim(), media_path: media?.path ?? null, media_name: media?.name ?? null, media_mime: media?.mime || null };
      if (file) {
        const up = await uploadAttachment(workspaceId, file);
        input = { ...input, media_path: up.mediaPath, media_name: up.fileName, media_mime: up.mimetype };
      }
      await save.mutateAsync({ id: reply?.id, ...input });
      toast.success(reply ? "Resposta atualizada." : "Resposta criada.");
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={reply ? "Editar resposta rápida" : "Nova resposta rápida"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" form="quick-reply-form" disabled={!ready} loading={busy}><Zap className="h-4 w-4" /> Salvar</Button>
        </>
      }
    >
      <form id="quick-reply-form" onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <Input label="Atalho" placeholder="pix" value={shortcut} onChange={(e) => setShortcut(e.target.value)} error={shortcutError} hint={slug ? `Na inbox: /${slug}` : "Sem espaços."} required />
          <Input label="Título" placeholder="Chave PIX" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} required />
        </div>
        <Textarea label="Texto" rows={5} value={content} onChange={(e) => setContent(e.target.value)} maxLength={4096} required
          hint={`Variáveis: ${QUICK_REPLY_VARIABLES.join(" e ")} viram o nome do contato.`} />
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Anexo (opcional)</p>
          {file ? (
            <p className="flex items-center gap-2 text-sm"><Paperclip className="h-4 w-4 text-slate-400" /> <span className="truncate">{file.name}</span> <button type="button" className="text-xs underline" onClick={() => pickFile(null)}>Remover</button></p>
          ) : media ? (
            <p className="flex items-center gap-2 text-sm"><Paperclip className="h-4 w-4 text-slate-400" /> <span className="truncate">{media.name}</span> <button type="button" className="text-xs underline" onClick={() => setMedia(null)}>Remover</button></p>
          ) : null}
          <input type="file" aria-label="Anexo" className="block text-sm" accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
          <p className="text-xs text-slate-500">Foto, PDF ou outro arquivo de até 20 MB, enviado junto com o texto.</p>
        </div>
      </form>
    </Modal>
  );
}
