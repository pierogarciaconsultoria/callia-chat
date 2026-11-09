// Moderação de mensagens pela inbox.
//  * delete_for_everyone (membro): apaga no WhatsApp do cliente uma mensagem enviada pela equipe ou pelo bot
//    (Evolution chat/deleteMessageForEveryone), dentro da janela do WhatsApp; o registro fica com deleted_at.
//  * hide / unhide (admin): oculta a mensagem da inbox da equipe sem mexer no WhatsApp; reversível.
import { createHandler, json, readJson, RuntimeError } from "../_shared/http.ts";
import { evolutionFor, resolveInstance } from "../_shared/channel.ts";
import { adminDb, audit, type Db, requireUser, requireWorkspaceRole } from "../_shared/supabase.ts";

/** Janela em que o WhatsApp aceita "apagar para todos" (cerca de 2 dias e meio; usamos 60 h). */
export const DELETE_FOR_EVERYONE_WINDOW_MS = 60 * 60 * 60 * 1000;

interface Body {
  action?: "delete_for_everyone" | "hide" | "unhide";
  message_id?: string;
}

interface MessageRow {
  id: string;
  workspace_id: string;
  conversation_id: string;
  direction: string;
  sender: string;
  status: string;
  external_id: string | null;
  created_at: string;
  deleted_at: string | null;
  hidden_at: string | null;
  metadata: Record<string, unknown> | null;
}

/** Por que uma mensagem não pode ser apagada para todos (null = pode). */
export function deleteForEveryoneBlocker(m: Pick<MessageRow, "direction" | "sender" | "status" | "external_id" | "created_at" | "deleted_at">, now = Date.now()): string | null {
  if (m.deleted_at) return "Esta mensagem já foi apagada.";
  if (m.direction !== "outbound" || (m.sender !== "agent" && m.sender !== "bot")) return "Só mensagens enviadas pela equipe ou pelo bot podem ser apagadas para todos.";
  if (!m.external_id || m.status === "failed" || m.status === "pending") return "Esta mensagem não chegou a ser entregue pelo WhatsApp.";
  if (now - new Date(m.created_at).getTime() > DELETE_FOR_EVERYONE_WINDOW_MS) return "O WhatsApp só permite apagar para todos por cerca de 2 dias após o envio.";
  return null;
}

/** JID da conversa no WhatsApp: o que veio na última mensagem do cliente (cobre contas @lid) ou o número. */
async function conversationJid(db: Db, conversationId: string, phone: string): Promise<string> {
  const { data } = await db.from("messages").select("metadata").eq("conversation_id", conversationId).eq("direction", "inbound")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const key = (data?.metadata as { wa_key?: { remoteJid?: unknown } } | null)?.wa_key;
  return typeof key?.remoteJid === "string" && key.remoteJid ? key.remoteJid : `${phone}@s.whatsapp.net`;
}

Deno.serve(createHandler("message-actions", async ({ req, correlationId }) => {
  if (req.method !== "POST") throw new RuntimeError("invalid_request", "Use POST.");
  const user = await requireUser(req);
  const body = await readJson<Body>(req);
  if (typeof body.message_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.message_id)) throw new RuntimeError("invalid_request", "message_id inválido.");
  const db = adminDb();
  const { data } = await db.from("messages")
    .select("id, workspace_id, conversation_id, direction, sender, status, external_id, created_at, deleted_at, hidden_at, metadata")
    .eq("id", body.message_id).maybeSingle();
  if (!data) throw new RuntimeError("not_found", "Mensagem não encontrada.");
  const msg = data as MessageRow;

  if (body.action === "delete_for_everyone") {
    await requireWorkspaceRole(user.id, msg.workspace_id, ["owner", "admin", "agent"]);
    const blocker = deleteForEveryoneBlocker(msg);
    if (blocker) throw new RuntimeError("unprocessable", blocker);
    const { data: conv } = await db.from("conversations").select("id, instance_id, contact_phone, channel").eq("id", msg.conversation_id).maybeSingle();
    if (!conv) throw new RuntimeError("not_found", "Conversa não encontrada.");
    if (conv.channel !== "whatsapp") throw new RuntimeError("channel_not_supported", "Só conversas de WhatsApp.");
    const instance = await resolveInstance(db, msg.workspace_id, conv.instance_id);
    const remoteJid = await conversationJid(db, conv.id, conv.contact_phone);
    await evolutionFor(instance).deleteMessageForEveryone(instance.instance_name, { id: msg.external_id!, remoteJid, fromMe: true });
    const deletedAt = new Date().toISOString();
    await db.from("messages").update({ deleted_at: deletedAt, deleted_by: user.id }).eq("id", msg.id);
    await audit(db, {
      workspace_id: msg.workspace_id, actor_user_id: user.id, action: "message.deleted_for_everyone", entity: "message", entity_id: msg.id,
      details: { conversation_id: msg.conversation_id, external_id: msg.external_id, sender: msg.sender }, correlation_id: correlationId,
    });
  } else if (body.action === "hide" || body.action === "unhide") {
    await requireWorkspaceRole(user.id, msg.workspace_id, ["owner", "admin"]);
    const hide = body.action === "hide";
    if (hide && msg.hidden_at) throw new RuntimeError("unprocessable", "Esta mensagem já está oculta.");
    if (!hide && !msg.hidden_at) throw new RuntimeError("unprocessable", "Esta mensagem não está oculta.");
    await db.from("messages").update(hide ? { hidden_at: new Date().toISOString(), hidden_by: user.id } : { hidden_at: null, hidden_by: null }).eq("id", msg.id);
    await audit(db, {
      workspace_id: msg.workspace_id, actor_user_id: user.id, action: hide ? "message.hidden" : "message.unhidden", entity: "message", entity_id: msg.id,
      details: { conversation_id: msg.conversation_id, sender: msg.sender }, correlation_id: correlationId,
    });
  } else {
    throw new RuntimeError("invalid_request", "action inválida.");
  }

  const { data: updated } = await db.from("messages").select("*").eq("id", msg.id).single();
  return json({ message: updated });
}));
