// Iniciar conversa com um número que ainda não escreveu. Se o número já tiver conversa, a mensagem vai para ela.
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Send } from "lucide-react";
import { formatPhone } from "@/lib/format";
import { useSendMessage } from "@/hooks/use-inbox";
import { Button, Input, Modal, Textarea, useToast } from "@/components/ui";

export function NewConversationDialog({ workspaceId, open, onClose }: { workspaceId: string; open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const send = useSendMessage();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const digits = phone.replace(/\D/g, "");
  const ready = digits.length >= 10 && text.trim().length > 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    try {
      const res = await send.mutateAsync({ workspaceId, toPhone: digits, contactName: name.trim() || undefined, text: text.trim() });
      toast.success(res.created ? `Conversa iniciada com ${name.trim() || formatPhone(digits)}.` : `Mensagem enviada na conversa já existente de ${formatPhone(digits)}.`);
      setPhone(""); setName(""); setText("");
      onClose();
      navigate(`/inbox/${res.conversation_id}`);
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nova conversa"
      description="A conversa fica com você (modo humano) até ser devolvida ao bot."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" form="new-conversation-form" disabled={!ready} loading={send.isPending}><Send className="h-4 w-4" /> Enviar</Button>
        </>
      }
    >
      <form id="new-conversation-form" onSubmit={submit} className="space-y-3">
        <Input label="WhatsApp do cliente" placeholder="(48) 99999-0000" inputMode="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} hint="Com DDD." />
        <Input label="Nome (opcional)" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        <Textarea label="Mensagem" rows={4} required value={text} onChange={(e) => setText(e.target.value)} maxLength={4096} />
      </form>
    </Modal>
  );
}
