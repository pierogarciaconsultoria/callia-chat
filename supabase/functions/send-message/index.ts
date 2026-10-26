// Envio manual pela inbox (sender = agent). Mesma trilha outbound do bot.
import { createHandler, json, readJson, RuntimeError } from "../_shared/http.ts";
import { sendOutbound } from "../_shared/channel.ts";
import { adminDb, requireUser, requireWorkspaceRole } from "../_shared/supabase.ts";

Deno.serve(createHandler("send-message", async ({ req, correlationId }) => {
  if (req.method !== "POST") throw new RuntimeError("invalid_request", "Use POST.");
  const user = await requireUser(req);
  const body = await readJson<{ conversation_id?: string; type?: string; text?: string }>(req);
  if (typeof body.conversation_id !== "string") throw new RuntimeError("invalid_request", "conversation_id obrigatório.");
  if ((body.type ?? "text") !== "text") throw new RuntimeError("invalid_request", "A inbox envia apenas texto por enquanto.");
  const text = body.text?.trim() ?? "";
  if (!text) throw new RuntimeError("invalid_request", "Mensagem vazia.");
  if (text.length > 4096) throw new RuntimeError("invalid_request", "Mensagem acima de 4096 caracteres.");

  const db = adminDb();
  const { data: conversation } = await db
    .from("conversations")
    .select("id, workspace_id, instance_id, channel, contact_phone, mode")
    .eq("id", body.conversation_id)
    .maybeSingle();
  if (!conversation) throw new RuntimeError("not_found", "Conversa não encontrada.");
  await requireWorkspaceRole(user.id, conversation.workspace_id, ["owner", "admin", "agent"]);
  if (conversation.channel !== "whatsapp") {
    throw new RuntimeError("channel_not_supported", "Conversa via integração: a resposta manual fica bloqueada até existir adaptador do canal.");
  }

  // Quem responde pela inbox assume a conversa, para o bot não responder por cima.
  if (conversation.mode !== "human") {
    await db.from("conversations").update({ mode: "human", assigned_user_id: user.id, handoff_at: new Date().toISOString() })
      .eq("id", conversation.id);
  }

  const result = await sendOutbound(db, {
    workspaceId: conversation.workspace_id,
    origin: "agent",
    sender: "agent",
    type: "text",
    text,
    conversation,
    agentUserId: user.id,
    correlationId,
  });

  const [{ data: message }, { data: outbound }] = await Promise.all([
    db.from("messages").select("*").eq("id", result.messageId).single(),
    db.from("outbound_messages").select("id, status, error, provider_message_id, created_at, sent_at").eq("id", result.outboundId).single(),
  ]);
  if (result.status === "failed") {
    throw new RuntimeError("upstream_unavailable", "Não foi possível enviar pelo WhatsApp.", { message_id: result.messageId, reason: result.error?.slice(0, 300) });
  }
  return json({ message, outbound });
}));
