import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_workspaces",
  title: "Listar workspaces",
  description: "List the workspaces the signed-in user belongs to.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_args, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const { data, error } = await supabaseForUser(ctx).from("workspaces").select("id, name, created_at");
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const workspaces = (data ?? []).map((w) => ({ id: String(w.id), name: String(w.name) }));
    return { content: [{ type: "text", text: JSON.stringify(workspaces) }], structuredContent: { workspaces } };
  },
});
