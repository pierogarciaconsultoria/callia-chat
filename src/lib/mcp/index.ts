import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listWorkspaces from "./tools/list-workspaces";
import listConversations from "./tools/list-conversations";
import getMessages from "./tools/get-messages";
import listKnowledge from "./tools/list-knowledge";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "callia-chat",
  title: "Callia Chat",
  version: "0.1.0",
  instructions:
    "Tools for Callia Chat, a WhatsApp AI support hub. Start with `list_workspaces`, then use `list_conversations`, `get_conversation_messages` and `list_knowledge` with a workspace ID.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listWorkspaces, listConversations, getMessages, listKnowledge],
});
