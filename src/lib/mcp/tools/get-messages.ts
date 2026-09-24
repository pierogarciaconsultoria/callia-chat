import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_conversation_messages",
  title: "Ver mensagens da conversa",
  description: "Get the messages of one conversation in chronological order.",
  inputSchema: {
    conversation_id: z.string().uuid().describe("Conversation ID (from list_conversations)."),
    limit: z.number().int().min(1).max(200).optional().describe("Max messages (default 50, most recent)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ conversation_id, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const { data, error } = await supabaseForUser(ctx)
      .from("messages")
      .select("id, direction, sender, type, content, transcription, created_at")
      .eq("conversation_id", conversation_id)
      .order("created_at", { ascending: false })
      .limit(limit ?? 50);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const messages = (data ?? []).reverse().map((m) => ({
      id: String(m.id),
      direction: String(m.direction),
      sender: String(m.sender),
      type: String(m.type),
      content: m.content ? String(m.content) : m.transcription ? String(m.transcription) : null,
      created_at: String(m.created_at),
    }));
    return { content: [{ type: "text", text: JSON.stringify(messages) }], structuredContent: { messages } };
  },
});
