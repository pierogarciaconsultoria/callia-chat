// Regras de moderação de mensagens na inbox (espelho do que a function message-actions valida no servidor).
import type { Message } from "@/lib/database.types";

/** Janela em que o WhatsApp aceita "apagar para todos" (usamos 60 h, um pouco abaixo do limite real). */
export const DELETE_FOR_EVERYONE_WINDOW_MS = 60 * 60 * 60 * 1000;

/** Mensagem nossa (equipe ou bot), entregue pelo WhatsApp, ainda não apagada e dentro da janela. */
export function canDeleteForEveryone(m: Pick<Message, "direction" | "sender" | "status" | "external_id" | "created_at" | "deleted_at">, now = Date.now()): boolean {
  if (m.deleted_at) return false;
  if (m.direction !== "outbound" || (m.sender !== "agent" && m.sender !== "bot")) return false;
  if (!m.external_id || m.status === "failed" || m.status === "pending") return false;
  return now - new Date(m.created_at).getTime() <= DELETE_FOR_EVERYONE_WINDOW_MS;
}

export type MessageAction = "delete_for_everyone" | "hide" | "unhide";

export const ACTION_COPY: Record<MessageAction, { title: string; description: string; confirm: string; success: string }> = {
  delete_for_everyone: {
    title: "Apagar para todos?",
    description: "A mensagem some do WhatsApp do cliente, que vê o aviso \"Esta mensagem foi apagada\". No Callia ela continua registrada, riscada, para auditoria.",
    confirm: "Apagar para todos",
    success: "Mensagem apagada no WhatsApp do cliente.",
  },
  hide: {
    title: "Ocultar esta mensagem no painel?",
    description: "A equipe deixa de ver o conteúdo na inbox. Nada muda no WhatsApp do cliente. Administradores podem restaurar depois.",
    confirm: "Ocultar",
    success: "Mensagem oculta da equipe.",
  },
  unhide: {
    title: "Restaurar esta mensagem?",
    description: "A mensagem volta a aparecer para toda a equipe.",
    confirm: "Restaurar",
    success: "Mensagem restaurada.",
  },
};
