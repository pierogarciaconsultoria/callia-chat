// Servidor MCP (Streamable HTTP, JSON-RPC 2.0) para assistentes externos.
// Autenticação: Bearer com o access token do usuário no Supabase Auth. Todas as leituras usam o cliente
// do próprio usuário, então a RLS garante que ele só vê os workspaces de que participa.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { corsHeaders, createHandler, json, RuntimeError } from "../_shared/http.ts";
import { aiFromEnv } from "../_shared/agent-runtime.ts";
import { searchKnowledge } from "../_shared/knowledge.ts";
import { type Db, env, optionalEnv } from "../_shared/supabase.ts";

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "callia-chat", version: "1.0.0" };

const TOOLS = [
  {
    name: "list_workspaces",
    description: "Lista os workspaces do Callia Chat aos quais o usuário pertence, com o papel dele em cada um.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_conversations",
    description: "Lista as conversas mais recentes de um workspace (contato, modo bot/humano/encerrada, não lidas, prévia).",
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: { type: "string", format: "uuid" },
        mode: { type: "string", enum: ["bot", "human", "closed"] },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      },
      required: ["workspace_id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_conversation_messages",
    description: "Retorna as mensagens de uma conversa em ordem cronológica.",
    inputSchema: {
      type: "object",
      properties: {
        conversation_id: { type: "string", format: "uuid" },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      },
      required: ["conversation_id"],
      additionalProperties: false,
    },
  },
  {
    name: "search_knowledge",
    description: "Busca na base de conhecimento de um workspace (FAQ, catálogo, documentos e páginas indexadas).",
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: { type: "string", format: "uuid" },
        query: { type: "string", minLength: 2 },
        limit: { type: "integer", minimum: 1, maximum: 20, default: 5 },
      },
      required: ["workspace_id", "query"],
      additionalProperties: false,
    },
  },
];

type JsonRpcId = string | number | null;
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

const rpcResult = (id: JsonRpcId, result: unknown) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id: JsonRpcId, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

function resourceMetadataUrl(): string {
  return `${optionalEnv("FUNCTIONS_PUBLIC_URL") ?? `${env("SUPABASE_URL")}/functions/v1`}/mcp/.well-known/oauth-protected-resource`;
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json", "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl()}"` },
  });
}

async function userClient(req: Request): Promise<{ db: Db; userId: string } | null> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return null;
  return { db, userId: data.user.id };
}

function clampInt(value: unknown, def: number, max: number): number {
  const n = Number(value ?? def);
  return Number.isFinite(n) ? Math.min(Math.max(1, Math.trunc(n)), max) : def;
}

async function callTool(db: Db, userId: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "list_workspaces": {
      const { data } = await db.from("workspace_members").select("role, workspaces(id, name, slug)").eq("user_id", userId);
      // deno-lint-ignore no-explicit-any
      return (data ?? []).map((m: any) => ({ ...m.workspaces, role: m.role }));
    }
    case "list_conversations": {
      let q = db.from("conversations")
        .select("id, channel, contact_name, contact_phone, mode, unread_count, last_message_at, last_message_preview")
        .eq("workspace_id", String(args.workspace_id))
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(clampInt(args.limit, 20, 100));
      if (typeof args.mode === "string") q = q.eq("mode", args.mode);
      const { data, error } = await q;
      if (error) throw new RuntimeError("invalid_request", error.message);
      return data;
    }
    case "get_conversation_messages": {
      const { data, error } = await db.from("messages")
        .select("direction, sender, type, content, metadata->transcript, created_at")
        .eq("conversation_id", String(args.conversation_id))
        .order("created_at", { ascending: false })
        .limit(clampInt(args.limit, 50, 200));
      if (error) throw new RuntimeError("invalid_request", error.message);
      return (data ?? []).reverse();
    }
    case "search_knowledge": {
      const query = String(args.query ?? "");
      if (query.trim().length < 2) throw new RuntimeError("invalid_request", "query muito curta");
      const { mode, results } = await searchKnowledge(db, aiFromEnv(), String(args.workspace_id), query, clampInt(args.limit, 5, 20));
      return { mode, results: results.map((r) => ({ source: r.source_title, kind: r.source_kind, content: r.content, score: r.score })) };
    }
    default:
      throw new RuntimeError("not_found", `Ferramenta desconhecida: ${name}`);
  }
}

async function handleRpc(msg: JsonRpcRequest, db: Db, userId: string): Promise<unknown | null> {
  const id = msg.id ?? null;
  switch (msg.method) {
    case "initialize": {
      const requested = String(msg.params?.protocolVersion ?? "");
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: "Ferramentas somente leitura do Callia Chat. Comece por list_workspaces para obter o workspace_id.",
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: TOOLS });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const result = await callTool(db, userId, name, args);
        return rpcResult(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: { result } });
      } catch (err) {
        return rpcResult(id, { content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }], isError: true });
      }
    }
    default:
      // Notificações (sem id) não têm resposta.
      if (msg.id === undefined) return null;
      return rpcError(id, -32601, `Método não suportado: ${msg.method}`);
  }
}

Deno.serve(createHandler("mcp", async ({ req, url }) => {
  if (url.pathname.endsWith("/.well-known/oauth-protected-resource")) {
    // Descoberta OAuth (RFC 9728): o servidor de autorização é o Supabase Auth do projeto.
    return json({
      resource: resourceMetadataUrl().replace(/\/\.well-known\/oauth-protected-resource$/, ""),
      authorization_servers: [optionalEnv("MCP_AUTHORIZATION_SERVER") ?? `${optionalEnv("SUPABASE_PUBLIC_URL") ?? env("SUPABASE_URL")}/auth/v1`],
      bearer_methods_supported: ["header"],
    });
  }
  if (req.method === "GET") return new Response("Use POST (Streamable HTTP sem stream SSE).", { status: 405, headers: corsHeaders });
  if (req.method !== "POST") throw new RuntimeError("invalid_request", "Use POST.");

  const auth = await userClient(req);
  if (!auth) return unauthorized();

  let payload: JsonRpcRequest | JsonRpcRequest[];
  try {
    payload = await req.json();
  } catch {
    return json(rpcError(null, -32700, "JSON inválido"), 400);
  }
  const batch = Array.isArray(payload) ? payload : [payload];
  const responses = (await Promise.all(batch.map((m) => handleRpc(m, auth.db, auth.userId)))).filter((r) => r !== null);
  if (!responses.length) return new Response(null, { status: 202, headers: corsHeaders });
  return json(Array.isArray(payload) ? responses : responses[0]);
}));
