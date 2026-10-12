import { describe, expect, it, vi } from "vitest";
// @ts-ignore - Deno edge module with pure logic, no Deno APIs
import { ingestExternalMessage, parseIngestPayload } from "../../supabase/functions/_shared/ingest.ts";
// @ts-ignore
import { buildExternalAgentPayload, isAllowedSecretRef, parseExternalAgentResponse } from "../../supabase/functions/_shared/external-agent.ts";

function createMemoryStore() {
  const conversations: any[] = [];
  const messages: any[] = [];
  const store = {
    conversations,
    messages,
    findMessageByExternalId: vi.fn(async (ws: string, ext: string) =>
      messages.find((m) => m.workspace_id === ws && m.external_id === ext) ?? null),
    findConversationByPhone: vi.fn(async (ws: string, phone: string) =>
      conversations.find((c) => c.workspace_id === ws && c.customer_phone === phone) ?? null),
    insertConversation: vi.fn(async (row: any) => {
      const c = { id: `c${conversations.length + 1}`, ...row };
      conversations.push(c);
      return c;
    }),
    updateConversation: vi.fn(async (id: string, patch: any) => {
      Object.assign(conversations.find((c) => c.id === id), patch);
    }),
    insertMessage: vi.fn(async (row: any) => {
      if (messages.some((m) => m.workspace_id === row.workspace_id && m.external_id === row.external_id)) {
        throw { code: "23505" };
      }
      const m = { id: `m${messages.length + 1}`, ...row };
      messages.push(m);
      return m;
    }),
  };
  return store;
}

const base = {
  externalId: "wamid.1",
  channel: "whatsapp_cloud",
  direction: "inbound",
  sender: "customer",
  contact: { phone: "+5511999999999", name: "Ana" },
  type: "text",
  content: "Oi",
  timestamp: "2026-10-12T12:00:00.000Z",
};

// Simulates the public-api auth gate in front of the ingest handler.
async function handleIngestRequest(apiKey: string | null, body: unknown, store: any, send: any) {
  const valid = apiKey === "ah_live_valid";
  if (!valid) return { status: 401, body: { error: apiKey ? "api_key_not_found" : "missing_api_key" } };
  const payload = parseIngestPayload(body);
  const r = await ingestExternalMessage(store, { workspaceId: "ws1", apiKeyId: "k1", payload });
  return { status: r.duplicate ? 200 : 201, body: { ok: true, ...r, sent: false } };
}

describe("public-api /messages/ingest", () => {
  it("cria conversa e mensagem marcadas como origem externa", async () => {
    const store = createMemoryStore();
    const send = vi.fn();
    const res = await handleIngestRequest("ah_live_valid", base, store, send);
    expect(res.status).toBe(201);
    expect(store.conversations).toHaveLength(1);
    expect(store.conversations[0].metadata.source).toBe("external");
    expect(store.conversations[0].unread_count).toBe(1);
    expect(store.messages[0]).toMatchObject({ direction: "inbound", sender: "customer", external_id: "wamid.1" });
    expect(store.messages[0].metadata.source).toBe("external");
    expect(send).not.toHaveBeenCalled();
  });

  it("deduplica por externalId", async () => {
    const store = createMemoryStore();
    await handleIngestRequest("ah_live_valid", base, store, vi.fn());
    const again = await handleIngestRequest("ah_live_valid", base, store, vi.fn());
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    expect(store.messages).toHaveLength(1);
    expect(store.conversations[0].unread_count).toBe(1);
  });

  it("registra outbound sem enviar e sem incrementar não lidas", async () => {
    const store = createMemoryStore();
    const send = vi.fn();
    await handleIngestRequest("ah_live_valid", base, store, send);
    const res = await handleIngestRequest(
      "ah_live_valid",
      { ...base, externalId: "wamid.2", direction: "outbound", sender: "ai", content: "Olá!" },
      store,
      send,
    );
    expect(res.status).toBe(201);
    expect(res.body.sent).toBe(false);
    expect(store.messages[1]).toMatchObject({ direction: "outbound", sender: "bot" });
    expect(store.conversations[0].unread_count).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });

  it("recusa chave inválida sem gravar nada", async () => {
    const store = createMemoryStore();
    const res = await handleIngestRequest("ah_live_wrong", base, store, vi.fn());
    expect(res.status).toBe(401);
    expect(store.messages).toHaveLength(0);
    expect(store.conversations).toHaveLength(0);
  });

  it("valida payload (externalId obrigatório, sender coerente)", () => {
    expect(() => parseIngestPayload({ ...base, externalId: undefined })).toThrow("invalid_ingest_payload");
    expect(() => parseIngestPayload({ ...base, sender: "ai" })).toThrow("invalid_ingest_payload");
  });
});

describe("agente externo", () => {
  it("valida a resposta do webhook", () => {
    expect(parseExternalAgentResponse({ reply: "oi" }).ok).toBe(true);
    expect(parseExternalAgentResponse({}).ok).toBe(false);
    expect(parseExternalAgentResponse({ reply: 1 }).ok).toBe(false);
    expect(parseExternalAgentResponse({ handoff: true }).ok).toBe(true);
    expect(parseExternalAgentResponse({ media: [{ type: "image", url: "http://x" }] }).ok).toBe(false);
  });

  it("monta payload com no máximo 20 itens de histórico", () => {
    const history = Array.from({ length: 30 }, (_, i) => ({ id: `h${i}`, direction: i % 2 ? "outbound" : "inbound", content: `${i}` }));
    const p = buildExternalAgentPayload({
      workspaceId: "ws",
      conversationId: "c",
      conversation: { customer_name: "Ana", customer_phone: "+55" },
      message: { id: "h29", type: "text" },
      messageText: "oi",
      history,
    });
    expect(p.history).toHaveLength(20);
    expect(p.history[0]).toEqual({ role: "assistant", content: "9" });
  });

  it("só aceita segredos com prefixo EXTERNAL_AGENT_", () => {
    expect(isAllowedSecretRef("EXTERNAL_AGENT_N8N")).toBe(true);
    expect(isAllowedSecretRef("SUPABASE_SERVICE_ROLE_KEY")).toBe(false);
  });
});
