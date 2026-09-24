import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_knowledge",
  title: "Ver FAQs e produtos",
  description: "List the FAQs and products the AI agent uses in a workspace.",
  inputSchema: {
    workspace_id: z.string().uuid().describe("Workspace ID (from list_workspaces)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ workspace_id }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const sb = supabaseForUser(ctx);
    const [faqRes, prodRes] = await Promise.all([
      sb.from("faqs").select("id, question, answer, is_active").eq("workspace_id", workspace_id),
      sb.from("products").select("id, name, description, price, currency, link, is_active").eq("workspace_id", workspace_id),
    ]);
    const err = faqRes.error ?? prodRes.error;
    if (err) return { content: [{ type: "text", text: err.message }], isError: true };
    const faqs = (faqRes.data ?? []).map((f) => ({
      id: String(f.id), question: String(f.question), answer: String(f.answer), is_active: Boolean(f.is_active),
    }));
    const products = (prodRes.data ?? []).map((p) => ({
      id: String(p.id),
      name: String(p.name),
      description: p.description ? String(p.description) : null,
      price: p.price === null ? null : Number(p.price),
      currency: String(p.currency),
      link: p.link ? String(p.link) : null,
      is_active: Boolean(p.is_active),
    }));
    return { content: [{ type: "text", text: JSON.stringify({ faqs, products }) }], structuredContent: { faqs, products } };
  },
});
