import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_conversations",
  title: "Listar conversas",
  description: "List recent WhatsApp conversations in a workspace, newest first.",
  inputSchema: {
    workspace_id: z.string().uuid().describe("Workspace ID (from list_workspaces)."),
    open_only: z.boolean().optional().describe("Only return open conversations."),
    limit: z.number().int().min(1).max(100).optional().describe("Max results (default 20)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ workspace_id, open_only, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    let q = supabaseForUser(ctx)
      .from("conversations")
      .select("id, customer_name, customer_phone, mode, is_closed, unread_count, last_message_at")
      .eq("workspace_id", workspace_id)
      .order("last_message_at", { ascending: false })
      .limit(limit ?? 20);
    if (open_only) q = q.eq("is_closed", false);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const conversations = (data ?? []).map((c) => ({
      id: String(c.id),
      customer_name: c.customer_name ? String(c.customer_name) : null,
      customer_phone: String(c.customer_phone),
      mode: String(c.mode),
      is_closed: Boolean(c.is_closed),
      unread_count: Number(c.unread_count),
      last_message_at: String(c.last_message_at),
    }));
    return { content: [{ type: "text", text: JSON.stringify(conversations) }], structuredContent: { conversations } };
  },
});
