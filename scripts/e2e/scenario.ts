// Cenário ponta a ponta contra functions reais (edge-runtime) + banco real + Evolution/OpenAI falsas.
import { encryptSecret, generateApiKey, sha256Hex, hmacSha256Hex } from "../../supabase/functions/_shared/crypto.ts";

const GATEWAY = Deno.env.get("E2E_GATEWAY")!;
const MOCK = Deno.env.get("E2E_MOCK")!;
const SERVICE = Deno.env.get("E2E_SERVICE_KEY")!;
const MASTER = Deno.env.get("E2E_MASTER_KEY")!;

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "  ✔" : "  ✘"} ${name}${!ok && detail !== undefined ? `\n      → ${JSON.stringify(detail).slice(0, 600)}` : ""}`);
  if (!ok) failures++;
}

const rest = async (method: string, path: string, body?: unknown, prefer = "return=representation") => {
  const res = await fetch(`${GATEWAY}/rest/v1${path}`, {
    method,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", Prefer: prefer },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
};
const calls = async () => (await (await fetch(`${MOCK}/__calls`)).json()) as Record<string, Array<{ path: string; headers: Record<string, string>; body: any }>>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 30000): Promise<T | null> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v as T;
    await sleep(400);
  }
  return null;
}

// ---------------------------------------------------------------- setup
console.log("Preparando workspace de teste…");
const [ws] = await rest("POST", "/workspaces", { name: "Pousada Alfa", slug: `pousada-alfa-${Date.now()}` });
await rest("POST", "/workspace_branding", { workspace_id: ws.id, display_name: "Pousada Alfa" });
await rest("POST", "/agent_configs", { workspace_id: ws.id, agent_name: "Lia", reply_debounce_ms: 600, persona_prompt: "Você é a Lia, recepcionista da Pousada Alfa." });
await rest("POST", "/faqs", { workspace_id: ws.id, question: "Qual o horário do café da manhã?", answer: "Servimos café das 7h às 10h." });
const token = "tok_" + crypto.randomUUID().replaceAll("-", "");
const [inst] = await rest("POST", "/whatsapp_instances", {
  workspace_id: ws.id, name: "Recepção", instance_name: `callia-e2e-${Date.now()}`, status: "open", is_default: true,
  webhook_token_hash: await sha256Hex(token),
});
const hookSecret = "whsec_e2e_secret_value";
await rest("POST", "/webhooks", {
  workspace_id: ws.id, name: "Receptor", url: `${Deno.env.get("E2E_MOCK_FROM_CONTAINER")}/hook`,
  events: ["message.received", "message.sent", "conversation.handoff", "public_api.event.received"],
  secret_ciphertext: await encryptSecret(hookSecret, MASTER), secret_last4: hookSecret.slice(-4),
});
const apiKey = await generateApiKey("");
await rest("POST", "/api_keys", { workspace_id: ws.id, name: "n8n", prefix: apiKey.prefix, key_hash: apiKey.hash, last4: apiKey.last4 });

const webhookUrl = `${GATEWAY}/functions/v1/whatsapp-webhook?instance=${inst.id}&token=${token}`;
const evolutionEvent = (id: string, text: string, opts: { fromMe?: boolean; phone?: string } = {}) => ({
  event: "messages.upsert",
  instance: inst.instance_name,
  data: {
    key: { remoteJid: `${opts.phone ?? "5548999990000"}@s.whatsapp.net`, fromMe: opts.fromMe ?? false, id },
    pushName: "Ana",
    message: { conversation: text },
    messageType: "conversation",
    messageTimestamp: Math.floor(Date.now() / 1000),
  },
});
const postWebhook = (body: unknown, url = webhookUrl) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// ---------------------------------------------------------------- 1. resposta da IA com RAG
console.log("\n1. Cliente pergunta → IA responde com a FAQ pelo WhatsApp");
let res = await postWebhook(evolutionEvent("WAMID-1", "Oi! Que horas é o café da manhã?"));
const first = await res.json();
check("webhook aceita evento (200)", res.status === 200 && first.results?.[0]?.message_id, first);
const run1 = await waitFor(async () => {
  const runs = await rest("GET", `/agent_runs?workspace_id=eq.${ws.id}&select=*`);
  return runs.find((r: any) => r.status !== "running");
});
check("agent_run concluído como replied/internal", run1?.status === "replied" && run1?.engine === "internal", run1);
let c = await calls();
const send1 = c.evolution.find((x) => x.path.startsWith("/message/sendText"));
check("Evolution recebeu sendText para o cliente", send1?.body?.number === "5548999990000", c.evolution);
check("resposta adaptada ao WhatsApp (*negrito*)", send1?.body?.text === "*Bom dia!* O café é servido das 7h às 10h.", send1?.body);
const sys = c.openai[0]?.body?.messages?.[0]?.content ?? "";
check("prompt de sistema tem persona, guardrails e FAQ", sys.includes("Lia, recepcionista") && sys.includes("Nunca invente preços") && sys.includes("Servimos café"), sys.slice(0, 300));
const [conv] = await rest("GET", `/conversations?workspace_id=eq.${ws.id}&contact_phone=eq.5548999990000&select=*`);
check("conversa em modo bot, 1 não lida, contato Ana", conv?.mode === "bot" && conv?.unread_count === 1 && conv?.contact_name === "Ana", conv);
const msgs1 = await rest("GET", `/messages?conversation_id=eq.${conv.id}&order=created_at&select=direction,sender,status,external_id,content`);
check("thread: inbound do cliente + outbound do bot enviado com id da Evolution",
  msgs1.length === 2 && msgs1[1].sender === "bot" && msgs1[1].status === "sent" && msgs1[1].external_id === "EVO-1", msgs1);

// ---------------------------------------------------------------- 2. idempotência e eco
console.log("\n2. Idempotência e eco do próprio envio");
await fetch(`${MOCK}/__reset`);
res = await postWebhook(evolutionEvent("WAMID-1", "Oi! Que horas é o café da manhã?"));
check("evento repetido é marcado duplicado", (await res.json()).results?.[0]?.duplicate === true);
res = await postWebhook(evolutionEvent("EVO-1", "*Bom dia!* O café é servido das 7h às 10h.", { fromMe: true }));
check("eco fromMe do bot é ignorado", (await res.json()).results?.[0]?.echo === true);
await sleep(1500);
c = await calls();
check("nenhum envio nem chamada de IA extra", c.evolution.length === 0 && c.openai.length === 0, c);
const [convAfterEcho] = await rest("GET", `/conversations?id=eq.${conv.id}&select=mode`);
check("eco não pausou o bot", convAfterEcho.mode === "bot", convAfterEcho);

// ---------------------------------------------------------------- 3. debounce
console.log("\n3. Mensagens em sequência → uma resposta só");
await fetch(`${MOCK}/__reset`);
await postWebhook(evolutionEvent("WAMID-2", "outra coisa"));
await sleep(150);
await postWebhook(evolutionEvent("WAMID-3", "vocês têm estacionamento?"));
await waitFor(async () => (await rest("GET", `/agent_runs?workspace_id=eq.${ws.id}&status=neq.running&select=id`)).length >= 3);
const runs3 = await rest("GET", `/agent_runs?workspace_id=eq.${ws.id}&order=created_at&select=status,reason`);
check("primeira execução superada pela segunda", runs3.slice(-2).map((r: any) => r.status).join(",") === "superseded,replied", runs3);
c = await calls();
check("exatamente 1 resposta enviada", c.evolution.filter((x) => x.path.startsWith("/message/sendText")).length === 1, c.evolution);
const lastUserMsg = c.openai[0]?.body?.messages?.at(-1)?.content;
check("IA recebeu as duas mensagens juntas", lastUserMsg === "outra coisa\nvocês têm estacionamento?", lastUserMsg);

// ---------------------------------------------------------------- 4. handoff
console.log("\n4. Handoff por palavra-chave e bot pausado");
await fetch(`${MOCK}/__reset`);
await postWebhook(evolutionEvent("WAMID-4", "Quero falar com um ATENDENTE"));
const handed = await waitFor(async () => {
  const [cv] = await rest("GET", `/conversations?id=eq.${conv.id}&select=mode,handoff_at`);
  return cv.mode === "human" ? cv : null;
});
check("conversa passou para humano", handed?.mode === "human" && handed?.handoff_at, handed);
await sleep(500);
c = await calls();
check("mensagem de handoff enviada sem chamar IA", c.openai.length === 0 && c.evolution.some((x) => String(x.body?.text).startsWith("Certo! Vou chamar alguém")), c);
await fetch(`${MOCK}/__reset`);
await postWebhook(evolutionEvent("WAMID-5", "alô?"));
await sleep(2000);
c = await calls();
check("em modo humano o bot não responde", c.evolution.length === 0 && c.openai.length === 0, c);

// ---------------------------------------------------------------- 5. handoff decidido pela IA (tool)
console.log("\n5. IA transfere via ferramenta");
await fetch(`${MOCK}/__reset`);
await postWebhook(evolutionEvent("WAMID-6", "Tenho uma reclamação séria", { phone: "5548988887777" }));
const toolRun = await waitFor(async () => (await rest("GET", `/agent_runs?workspace_id=eq.${ws.id}&status=eq.handoff&reason=like.tool*&select=*`))[0]);
check("agent_run com handoff por ferramenta", toolRun?.reason === "tool:reclamação", toolRun);

// ---------------------------------------------------------------- 6. API pública
console.log("\n6. API pública");
const api = (method: string, path: string, body?: unknown, key = apiKey.raw) =>
  fetch(`${GATEWAY}/functions/v1/public-api${path}`, { method, headers: { "x-api-key": key, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
await fetch(`${MOCK}/__reset`);
const ingest = { externalId: "wamid.cloud.1", channel: "whatsapp_cloud", direction: "inbound", sender: "customer", contact: { phone: "+55 11 99999-9999", name: "Bia" }, type: "text", content: "Oi, qual o horário de vocês?" };
res = await api("POST", "/messages/ingest", ingest);
const ing1 = await res.json();
check("ingest cria (201, sent=false)", res.status === 201 && ing1.sent === false && ing1.duplicate === false, ing1);
res = await api("POST", "/messages/ingest", ingest);
check("ingest repetido → 200 duplicate", res.status === 200 && (await res.json()).duplicate === true);
await sleep(1200);
c = await calls();
check("ingest nunca envia nem aciona IA", c.evolution.length === 0 && c.openai.length === 0, c);
const [ingConv] = await rest("GET", `/conversations?id=eq.${ing1.conversationId}&select=channel,metadata,unread_count,contact_phone`);
check("conversa externa marcada (source=external, telefone normalizado)", ingConv.channel === "whatsapp_cloud" && ingConv.metadata?.source === "external" && ingConv.contact_phone === "5511999999999" && ingConv.unread_count === 1, ingConv);

res = await api("POST", "/messages", { to: { phone: "48 97777-6666", name: "Caio" }, type: "text", text: "Sua reserva está confirmada!", externalId: "pedido-42" });
const sent = await res.json();
check("envio proativo → 202 pela instância padrão", res.status === 202 && sent.status === "sent", sent);
res = await api("POST", "/messages", { to: "48 97777-6666", text: "Sua reserva está confirmada!", externalId: "pedido-42" });
check("mesmo externalId não reenvia (idempotente)", res.status === 200 && (await res.json()).duplicate === true);
c = await calls();
check("Evolution recebeu 1 envio para 5548977776666", c.evolution.filter((x) => x.body?.number === "5548977776666").length === 1, c.evolution);

res = await api("POST", "/messages", { to: "48 97777-6666" });
check("payload inválido → 400 com issues", res.status === 400 && (await res.json()).error?.details?.issues?.length > 0);
res = await api("GET", "/knowledge/search?q=horario%20do%20cafe");
const search = await res.json();
check("busca na base (sem acento) encontra a FAQ", res.status === 200 && search.results?.[0]?.source?.kind === "faq", search);
res = await api("GET", "/agent/context");
check("contexto do agente", res.status === 200 && (await res.json()).agent_name === "Lia");
res = await api("GET", "/conversations?limit=10");
check("lista conversas do workspace", res.status === 200 && (await res.json()).data.length >= 3);
res = await api("GET", "/messages", undefined, "ck_live_" + "x".repeat(32));
check("chave inválida → 401", res.status === 401);
res = await api("GET", "/conversations", undefined, "lixo");
check("formato inválido → 401", res.status === 401);
const reqs = await rest("GET", `/public_api_requests?workspace_id=eq.${ws.id}&select=path,status_code`);
check("trilha em public_api_requests", reqs.length >= 8 && reqs.some((r: any) => r.status_code === 400), reqs.length);

// ---------------------------------------------------------------- 7. webhooks de saída
console.log("\n7. Webhooks de saída assinados");
await sleep(1000);
const deliveries = await rest("GET", `/webhook_deliveries?workspace_id=eq.${ws.id}&select=event,status,attempts`);
const failed = deliveries.filter((d: any) => d.status !== "success");
check("todas as entregas com sucesso", deliveries.length > 0 && failed.length === 0, failed);
const events = new Set(deliveries.map((d: any) => d.event));
check("eventos message.received, message.sent e conversation.handoff emitidos",
  ["message.received", "message.sent", "conversation.handoff"].every((e) => events.has(e)), [...events]);
const hooks = (await (await fetch(`${MOCK}/__calls`)).json()).hook as Array<{ headers: Record<string, string>; body: unknown }>;
const allValid = hooks.length > 0 && (await Promise.all(hooks.map(async (h) =>
  h.headers["x-callia-signature"] === `sha256=${await hmacSha256Hex(hookSecret, `${h.headers["x-callia-timestamp"]}.${JSON.stringify(h.body)}`)}`
))).every(Boolean);
check("assinatura HMAC confere no receptor", allValid, hooks[0]?.headers);

// ---------------------------------------------------------------- 8. segurança do webhook de entrada
console.log("\n8. Segurança do webhook de entrada");
res = await postWebhook(evolutionEvent("WAMID-X", "oi"), webhookUrl.replace(token, "tok_errado"));
check("token errado → 401", res.status === 401);
res = await postWebhook({ ...evolutionEvent("WAMID-Y", "oi"), instance: "outra-instancia" });
check("instância divergente é ignorada", (await res.json()).results?.[0]?.reason === "instance_mismatch");

// ---------------------------------------------------------------- 9. plataforma SaaS
console.log("\n9. Plataforma SaaS: console central, planos, limites, suspensão e cota");
const ANON = Deno.env.get("E2E_ANON_KEY")!;
const authAdmin = (path: string, body: unknown) => fetch(`${GATEWAY}/auth/v1${path}`, {
  method: "POST", headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
}).then((r) => r.json());
const signIn = async (email: string) => {
  const r = await fetch(`${GATEWAY}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "Senha-forte-123" }),
  });
  return (await r.json()).access_token as string;
};
const rootUser = await authAdmin("/admin/users", { email: "root@plataforma.test", password: "Senha-forte-123", email_confirm: true });
const ownerUser = await authAdmin("/admin/users", { email: "dono@cliente.test", password: "Senha-forte-123", email_confirm: true });
await rest("POST", "/user_roles", { user_id: rootUser.id, role: "platform_admin" });
const rootToken = await signIn("root@plataforma.test");
const ownerToken = await signIn("dono@cliente.test");
check("login real pelo GoTrue", Boolean(rootToken && ownerToken), { rootUser, ownerUser });
const fn = (name: string, token: string, body: unknown) => fetch(`${GATEWAY}/functions/v1/${name}`, {
  method: "POST", headers: { Authorization: `Bearer ${token}`, apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json() }));
const platform = (body: unknown, token = rootToken) => fn("platform-admin", token, body);

let r = await platform({ action: "overview" }, ownerToken);
check("usuário comum não acessa o console (403)", r.status === 403, r);
r = await platform({ action: "overview" });
check("admin da plataforma vê a visão geral", r.status === 200 && r.body.totals?.tenants >= 1, r.body);

r = await platform({ action: "upsert_plan", plan: { code: "e2e", name: "Plano E2E", max_instances: 1, max_members: 2, max_monthly_messages: 1000, max_knowledge_sources: 5, ai_enabled: true, external_agent_enabled: false, connectors_enabled: false, active: true } });
const plan = r.body.plan;
check("cria plano", r.status === 200 && plan?.code === "e2e", r.body);
r = await platform({ action: "create_tenant", name: "Cliente E2E", owner_email: "dono@cliente.test", plan_id: plan.id, status: "active" });
const tenantId = r.body.workspace_id;
check("cria cliente com dono existente (sem convite)", r.status === 200 && tenantId && r.body.owner_invited === false, r.body);

const entRes = await fetch(`${GATEWAY}/rest/v1/rpc/get_workspace_entitlements`, {
  method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ p_workspace_id: tenantId }),
});
const ent = await entRes.json();
check("dono lê plano e limites do próprio workspace", ent?.plan?.code === "e2e" && ent?.limits?.max_instances === 1 && ent?.usage?.members === 1, ent);

r = await fn("evolution-connect", ownerToken, { action: "create", workspace_id: tenantId, name: "Recepção" });
check("cria a 1ª instância dentro do limite", r.status === 200 && r.body.instance?.status === "qr", r.body);
r = await fn("evolution-connect", ownerToken, { action: "create", workspace_id: tenantId, name: "Vendas" });
check("2ª instância bloqueada pelo plano (plan_limit_reached)", r.status === 403 && r.body.error?.code === "plan_limit_reached", r.body);
r = await fn("manage-connectors", ownerToken, { action: "test_hbook", workspace_id: tenantId, checkin: "10/12/2026", checkout: "11/12/2026" });
check("conector fora do plano (feature_not_in_plan)", r.status === 403 && r.body.error?.code === "feature_not_in_plan", r.body);

r = await platform({ action: "set_status", workspace_id: tenantId, status: "suspended" });
check("suspender exige motivo", r.status === 400, r.body);
r = await platform({ action: "set_status", workspace_id: tenantId, status: "suspended", reason: "teste e2e" });
check("suspende cliente", r.status === 200 && r.body.tenant?.status === "suspended", r.body);
r = await fn("manage-api-keys", ownerToken, { action: "create", workspace_id: tenantId, name: "chave" });
check("tenant suspenso não cria API key (tenant_inactive)", r.status === 403 && r.body.error?.code === "tenant_inactive", r.body);
r = await platform({ action: "set_status", workspace_id: tenantId, status: "active" });
check("reativa cliente", r.status === 200 && r.body.tenant?.status === "active" && r.body.tenant?.suspended_reason === null, r.body);

r = await platform({ action: "support_access", workspace_id: tenantId, enable: true });
const support = await rest("GET", `/workspace_members?workspace_id=eq.${tenantId}&user_id=eq.${rootUser.id}&select=role,is_support`);
check("acesso de suporte explícito (admin, marcado como suporte)", r.status === 200 && support[0]?.is_support === true && support[0]?.role === "admin", support);
await platform({ action: "support_access", workspace_id: tenantId, enable: false });

r = await platform({ action: "audit", action_prefix: "platform.tenant" });
const auditActions = (r.body.entries ?? []).map((e: any) => e.action);
check("auditoria registra criação e mudança de status", auditActions.includes("platform.tenant.created") && auditActions.includes("platform.tenant.status_changed") && r.body.entries[0]?.actor_email === "root@plataforma.test", auditActions);

// Cota mensal e suspensão no workspace do cenário principal (envios automáticos já feitos acima).
await fetch(`${MOCK}/__reset`);
const [quotaPlan] = await rest("POST", "/plans", { code: "quota-e2e", name: "Cota E2E", max_monthly_messages: 1 });
await rest("PATCH", `/workspaces?id=eq.${ws.id}`, { plan_id: quotaPlan.id });
res = await api("POST", "/messages", { to: "48 96666-5555", text: "promoção" });
const quotaBody = await res.json();
check("cota esgotada: API pública → 429 quota_exceeded", res.status === 429 && quotaBody.error?.code === "quota_exceeded", quotaBody);
await postWebhook(evolutionEvent("WAMID-Q1", "oi, tudo bem?", { phone: "5548955554444" }));
const quotaRun = await waitFor(async () => (await rest("GET", `/agent_runs?workspace_id=eq.${ws.id}&reason=eq.quota_exceeded&select=status`))[0]);
const [quotaConv] = await rest("GET", `/conversations?workspace_id=eq.${ws.id}&contact_phone=eq.5548955554444&select=mode`);
c = await calls();
check("cota esgotada: bot não responde e a conversa vai para a equipe", quotaRun?.status === "skipped" && quotaConv?.mode === "human" && c.evolution.length === 0 && c.openai.length === 0, { quotaRun, quotaConv, c });

await rest("PATCH", `/workspaces?id=eq.${ws.id}`, { plan_id: null, status: "suspended", suspended_reason: "e2e" });
res = await api("GET", "/conversations");
check("tenant suspenso: API pública → 403 tenant_inactive", res.status === 403 && (await res.json()).error?.code === "tenant_inactive");
res = await postWebhook(evolutionEvent("WAMID-S1", "alguém aí?", { phone: "5548944443333" }));
const suspendedIn = await res.json();
await sleep(2000);
const runsSuspended = await rest("GET", `/agent_runs?trigger_message_id=eq.${suspendedIn.results?.[0]?.message_id}&select=id`);
c = await calls();
check("tenant suspenso: mensagem recebida é guardada, sem resposta do bot", Boolean(suspendedIn.results?.[0]?.message_id) && runsSuspended.length === 0 && c.evolution.length === 0, { suspendedIn, runsSuspended });

// ---------------------------------------------------------------- 10. assistente de configuração
console.log("\n10. Assistente de configuração: site + Instagram → persona e instruções");
await fetch(`${MOCK}/__reset`);
const setup = (body: unknown) => fn("agent-setup", ownerToken, { workspace_id: tenantId, ...(body as object) });
r = await setup({ action: "import_site", url: "http://mock:54322/", max_pages: 10 });
const siteId = r.body.source?.id;
check("importa o site (fonte kind=site)", r.status === 200 && r.body.source?.kind === "site", r.body);
const siteSrc = await waitFor(async () => {
  const [row] = await rest("GET", `/knowledge_sources?id=eq.${siteId}&select=status,error,metadata,chunk_count`);
  return row?.status === "indexed" || row?.status === "failed" ? row : null;
}, 60000);
const pageUrls = (siteSrc?.metadata?.pages ?? []).map((p: any) => p.url).sort();
check("lê as páginas do site respeitando robots.txt e o domínio", siteSrc?.status === "indexed" && JSON.stringify(pageUrls) === JSON.stringify(["http://mock:54322/", "http://mock:54322/quartos"]), siteSrc);
const siteChunks = await rest("GET", `/knowledge_chunks?source_id=eq.${siteId}&select=content,metadata`);
check("trechos do site guardam a página de origem", siteChunks.some((c: any) => c.content.startsWith("Página: Quartos (http://mock:54322/quartos)") && c.metadata?.url === "http://mock:54322/quartos"), siteChunks.map((c: any) => c.content.slice(0, 60)));

r = await setup({ action: "import_instagram", profile: "https://www.instagram.com/pousadamar/" });
const igId = r.body.source?.id;
check("lê dados públicos do Instagram", r.status === 200 && r.body.fetched === true && r.body.source?.kind === "social", r.body);
await waitFor(async () => (await rest("GET", `/knowledge_sources?id=eq.${igId}&status=eq.indexed&select=id`))[0]);
r = await setup({ action: "import_site", url: "http://mock:54322/" });
check("reimportar o mesmo site reaproveita a fonte", r.status === 200 && r.body.source?.id === siteId, r.body);
await waitFor(async () => (await rest("GET", `/knowledge_sources?id=eq.${siteId}&status=eq.indexed&select=id`))[0], 60000);

r = await setup({ action: "generate", extra_text: "Check-in às 14h e check-out às 12h." });
const draftRow = r.body.draft;
c = await calls();
const setupCall = c.openai.find((x) => x.body?.response_format?.type === "json_schema");
const setupPrompt = setupCall?.body?.messages?.[1]?.content ?? "";
check("gera rascunho com o modelo de configuração e formato estruturado", r.status === 200 && draftRow?.status === "ready" && setupCall?.body?.model === "fake-setup-model", r.body);
check("IA recebe site, Instagram e texto do dono", setupPrompt.includes("Suíte Mar com varanda") && setupPrompt.includes("Aceitamos pets") && setupPrompt.includes("Check-in às 14h"), setupPrompt.slice(0, 300));
check("rascunho normalizado (horário no formato do agente, lacunas listadas)", JSON.stringify(draftRow?.draft?.business_hours?.weekly?.mon) === '[["08:00","20:00"]]' && draftRow?.draft?.missing_information?.length === 1, draftRow?.draft);

const edited = { ...draftRow.draft, agent: { ...draftRow.draft.agent, agent_name: "Lia (revisado)" } };
r = await setup({ action: "apply", draft_id: draftRow.id, draft: edited, sections: { profile: true, guardrails: true, business_hours: true, handoff: true, faqs: [0, 1], products: [0] } });
check("aplica as seções escolhidas", r.status === 200 && r.body.applied?.faqs === 2 && r.body.applied?.products === 1, r.body);
const [cfgAfter] = await rest("GET", `/agent_configs?workspace_id=eq.${tenantId}&select=agent_name,persona_prompt,guardrails,business_hours,handoff_message,website_url`);
check("agente atualizado com a versão revisada", cfgAfter.agent_name === "Lia (revisado)" && cfgAfter.persona_prompt.startsWith("Você é a Lia") && cfgAfter.handoff_message === "Já chamo alguém da recepção!" && cfgAfter.website_url === "https://pousadamar.example", cfgAfter);
const tenantFaqs = await rest("GET", `/faqs?workspace_id=eq.${tenantId}&select=question`);
check("perguntas frequentes importadas (e indexadas na base)", tenantFaqs.length === 2, tenantFaqs);
r = await setup({ action: "apply", draft_id: draftRow.id, sections: { profile: true } });
check("rascunho não é aplicado duas vezes", r.status === 409, r.body);

// ---------------------------------------------------------------- 11. integrações simplificadas
console.log("\n11. Integrações simplificadas: Hospedin só com e-mail e senha, WhatsApp por código");
await fetch(`${MOCK}/__reset`);
const integ = (body: unknown) => fn("integrations", ownerToken, { workspace_id: tenantId, ...(body as object) });
r = await integ({ action: "connect_hospedin", email: "integracao@hotel.test", password: "senha-certa" });
check("plano sem conectores bloqueia (feature_not_in_plan)", r.status === 403 && r.body.error?.code === "feature_not_in_plan", r.body);
await platform({ action: "update_tenant", workspace_id: tenantId, limit_overrides: { connectors_enabled: true } });

r = await integ({ action: "connect_hospedin", email: "integracao@hotel.test", password: "errada" });
check("senha errada → mensagem clara", r.status === 422 && /incorretos/.test(r.body.error?.message), r.body);
r = await integ({ action: "connect_hospedin", email: "integracao@hotel.test", password: "senha-certa", checkin: "20/12/2026", checkout: "22/12/2026" });
const hosp = r.body.integration;
check("conecta só com e-mail e senha (conta descoberta pelo token)", r.status === 200 && hosp?.status === "connected" && hosp?.details?.account_id === "morada-e2e" && hosp?.details?.categories?.length === 2, r.body);
check("teste de valores já volta na conexão", r.body.test?.provider === "hospedin" && r.body.test?.rooms?.[0]?.name === "Apto Casal" && r.body.test?.rooms?.[0]?.total_price === 640, r.body.test);
const [secretRow] = await rest("GET", `/workspace_connectors?workspace_id=eq.${tenantId}&kind=eq.hospedin&select=secret_ciphertext,config`);
check("senha guardada só cifrada", String(secretRow.secret_ciphertext).startsWith("v1.") && !JSON.stringify(secretRow).includes("senha-certa"), secretRow.config);
const panelRead = await fetch(`${GATEWAY}/rest/v1/workspace_connectors?workspace_id=eq.${tenantId}&select=secret_ciphertext`, { headers: { apikey: ANON, Authorization: `Bearer ${ownerToken}` } });
check("painel não consegue ler o segredo (privilégio por coluna)", panelRead.status === 401 || panelRead.status === 403, panelRead.status);
r = await integ({ action: "list" });
check("lista as integrações sem segredo", r.status === 200 && r.body.integrations?.length === 4 && !JSON.stringify(r.body).includes("senha-certa"), r.body);

r = await integ({ action: "sync_catalog" });
const catalog = await rest("GET", `/products?workspace_id=eq.${tenantId}&name=like.Apto*&select=name,description`);
check("importa as categorias para o catálogo", r.status === 200 && r.body.created === 2 && catalog.some((p: any) => p.description === "Até 4 pessoa(s). Varanda"), { body: r.body, catalog });
r = await integ({ action: "save_booking_link", booking_link: "https://hbook.hsystem.com.br/Booking?companyId=abc123" });
check("salva o link de reservas", r.status === 200 && r.body.integration?.status === "connected", r.body);

r = await fn("process-message", ownerToken, { action: "simulate", workspace_id: tenantId, messages: [{ role: "customer", text: "Tem vaga de 20 a 22/12 para 2 adultos e uma criança de 6 anos?" }] });
const avCall = r.body.tool_calls?.find((t: any) => t.name === "consultar_disponibilidade");
check("MarIA consulta pelo Hospedin (só categorias que comportam 3 pessoas)", avCall?.result?.provider === "hospedin" && avCall?.result?.rooms?.length === 1 && avCall.result.rooms[0].name === "Apto Família", avCall?.result);
check("resposta traz valor e link preenchido", /Apto Família R\$ 960/.test(r.body.reply ?? "") && (r.body.reply ?? "").includes("checkin=20%2F12%2F2026"), r.body.reply);

const keyRes = await fn("manage-api-keys", ownerToken, { action: "create", workspace_id: tenantId, name: "n8n" });
const tenantKey = keyRes.body.raw_key;
const av = await fetch(`${GATEWAY}/functions/v1/public-api/availability?checkin=20/12/2026&checkout=22/12/2026&adults=4`, { headers: { "x-api-key": tenantKey } });
const avBody = await av.json();
check("API pública /availability usa o Hospedin", av.status === 200 && avBody.provider === "hospedin" && avBody.rooms?.length === 1, avBody);

r = await fn("evolution-connect", ownerToken, { action: "connect", instance_id: (await rest("GET", `/whatsapp_instances?workspace_id=eq.${tenantId}&select=id`))[0].id, phone: "(48) 99999-0000" });
c = await calls();
check("WhatsApp por código de 8 dígitos (sem QR)", r.status === 200 && r.body.pairing_code === "WZYX1234" && c.evolution.some((x) => x.path.includes("?number=5548999990000")), { body: r.body, paths: c.evolution.map((x) => x.path) });
r = await integ({ action: "disconnect", kind: "hospedin" });
const gone = await rest("GET", `/workspace_connectors?workspace_id=eq.${tenantId}&kind=eq.hospedin&select=id`);
check("desconectar apaga as credenciais", r.status === 200 && gone.length === 0, gone);

// ---------------------------------------------------------------- 12. fotos
console.log("\n12. Fotos: Google Drive, Hospedin, upload e envio pela MarIA");
await fetch(`${MOCK}/__reset`);
const media = (body: unknown) => fn("media", ownerToken, { workspace_id: tenantId, ...(body as object) });
const waitImport = () => waitFor(async () => {
  const st = await media({ action: "import_status" });
  const last = st.body.imports?.[0];
  return last && last.status !== "running" ? last : null;
}, 60000);

r = await media({ action: "import_drive", folder_url: "https://drive.google.com/drive/folders/ROOTFOLDER1234567890?usp=sharing" });
check("inicia importação do Drive", r.status === 200 && r.body.import?.status === "running", r.body);
let imp = await waitImport();
check("importa 3 fotos (ignora o .txt), inclusive HEIC", imp?.status === "done" && imp?.imported === 3, imp);
r = await media({ action: "list" });
const albums = r.body.albums ?? [];
const famAlbum = albums.find((a: any) => a.name === "Apto Família");
const famProduct = await rest("GET", `/products?workspace_id=eq.${tenantId}&name=eq.Apto%20Fam%C3%ADlia&select=id`);
check("subpastas viram álbuns (sem a numeração) ligados ao catálogo", famAlbum?.count === 2 && albums.some((a: any) => a.name === "Churrasqueira") && famAlbum?.product_id === famProduct[0]?.id, albums);
const photoUrl = String(famAlbum?.cover_url ?? "");
const photoRes = await fetch(photoUrl.replace("http://mock:54320", GATEWAY));
check("foto acessível pela URL pública", photoRes.status === 200 && (photoRes.headers.get("content-type") ?? "").startsWith("image/jpeg"), { url: photoUrl, status: photoRes.status });
await photoRes.body?.cancel();
r = await media({ action: "import_drive", folder_url: "https://drive.google.com/drive/folders/ROOTFOLDER1234567890" });
imp = await waitImport();
check("reimportar a mesma pasta não duplica", imp?.imported === 0 && imp?.skipped === 3, imp);

// Hospedin precisa estar conectado para importar as fotos das categorias
await integ({ action: "connect_hospedin", email: "integracao@hotel.test", password: "senha-certa" });
r = await media({ action: "import_hospedin" });
imp = await waitImport();
check("importa as fotos das categorias do Hospedin", r.status === 200 && imp?.status === "done" && imp?.imported === 2, imp);

// Upload pelo painel: arquivo no bucket público + registro
const upPath = `${tenantId}/${crypto.randomUUID()}.jpg`;
const up = await fetch(`${GATEWAY}/storage/v1/object/media/${upPath}`, {
  method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${ownerToken}`, "Content-Type": "image/jpeg" },
  body: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
});
r = await media({ action: "register_upload", storage_path: upPath, album: "Fachada" });
check("upload pelo painel e registro no álbum", up.status === 200 && r.status === 200 && r.body.asset?.source === "upload", { up: up.status, body: r.body });
const uploadedId = r.body.asset?.id;
const intruder = await fetch(`${GATEWAY}/storage/v1/object/media/${crypto.randomUUID()}/x.jpg`, {
  method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${ownerToken}`, "Content-Type": "image/jpeg" }, body: new Uint8Array([1]),
});
check("não envia arquivo para a pasta de outro workspace", intruder.status >= 400, intruder.status);
await intruder.body?.cancel();

// Simulador
r = await fn("process-message", ownerToken, { action: "simulate", workspace_id: tenantId, messages: [{ role: "customer", text: "Pode mandar fotos do apartamento família?" }] });
check("MarIA usa enviar_fotos no álbum certo (simulador)", r.body.tool_calls?.[0]?.name === "enviar_fotos" && r.body.media?.length === 2 && r.body.media.every((m: any) => m.type === "image"), r.body);

// WhatsApp de verdade: hóspede pede fotos → texto + imagens pela Evolution
const tenantToken = "tok_" + crypto.randomUUID().replaceAll("-", "");
const [tenantInst] = await rest("GET", `/whatsapp_instances?workspace_id=eq.${tenantId}&select=id,instance_name`);
await rest("PATCH", `/whatsapp_instances?id=eq.${tenantInst.id}`, { status: "open", webhook_token_hash: await sha256Hex(tenantToken) });
await rest("PATCH", `/agent_configs?workspace_id=eq.${tenantId}`, { reply_debounce_ms: 300 });
await fetch(`${MOCK}/__reset`);
await fetch(`${GATEWAY}/functions/v1/whatsapp-webhook?instance=${tenantInst.id}&token=${tenantToken}`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ event: "messages.upsert", instance: tenantInst.instance_name, data: { key: { remoteJid: "5548911112222@s.whatsapp.net", fromMe: false, id: "WAMID-PHOTO-1" }, pushName: "Rita", message: { conversation: "Oi! Tem fotos do apto família?" }, messageTimestamp: Math.floor(Date.now() / 1000) } }),
});
const sentMedia = await waitFor(async () => {
  const cc = await calls();
  const m = cc.evolution.filter((x) => x.path.startsWith("/message/sendMedia"));
  return m.length >= 2 ? { text: cc.evolution.find((x) => x.path.startsWith("/message/sendText")), media: m } : null;
}, 30000);
check("hóspede no WhatsApp recebe o texto e as fotos", Boolean(sentMedia?.text) && sentMedia!.media.length === 2 && sentMedia!.media.every((x: any) => x.body.mediatype === "image" && String(x.body.media).includes("/storage/v1/object/public/media/")), sentMedia);
const convPhotos = await rest("GET", `/messages?workspace_id=eq.${tenantId}&type=eq.image&direction=eq.outbound&select=media_url,status`);
check("fotos ficam registradas na conversa (inbox)", convPhotos.length === 2 && convPhotos.every((m: any) => m.status === "sent"), convPhotos);

// Hóspede manda o comprovante em PDF: o arquivo fica guardado para a inbox, a IA lê e a conversa vai para a equipe.
await fetch(`${MOCK}/__reset`);
await fetch(`${GATEWAY}/functions/v1/whatsapp-webhook?instance=${tenantInst.id}&token=${tenantToken}`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ event: "messages.upsert", instance: tenantInst.instance_name, data: { key: { remoteJid: "5548922223333@s.whatsapp.net", fromMe: false, id: "WAMID-PROOF-1" }, pushName: "Neli", message: { documentMessage: { mimetype: "application/pdf", fileName: "sicredi_123.pdf" } }, messageTimestamp: Math.floor(Date.now() / 1000) } }),
});
const proofSent = await waitFor(async () => {
  const cc = await calls();
  return cc.evolution.find((x) => x.path.startsWith("/message/sendText") && x.body?.number === "5548922223333") ?? null;
}, 30000);
check("comprovante: o hóspede recebe o agradecimento e que a equipe vai conferir", /Recebi o seu comprovante/.test(String(proofSent?.body?.text)), proofSent);
const [proofMsg] = await rest("GET", `/messages?workspace_id=eq.${tenantId}&type=eq.document&select=metadata,conversation_id`);
const [proofConv] = await rest("GET", `/conversations?id=eq.${proofMsg?.conversation_id}&select=mode`);
check("comprovante: PDF lido, marcado e conversa com a equipe", /Comprovante PIX/.test(proofMsg?.metadata?.document_text ?? "") && proofMsg?.metadata?.payment_proof === true && proofConv?.mode === "human", { proofMsg, proofConv });
const proofFile = await waitFor(async () => {
  const [m] = await rest("GET", `/messages?workspace_id=eq.${tenantId}&type=eq.document&select=metadata`);
  return typeof m?.metadata?.media_path === "string" ? m.metadata.media_path as string : null;
}, 15000);
const stored = proofFile ? await fetch(`${GATEWAY}/storage/v1/object/inbox-media/${proofFile}`, { headers: { Authorization: `Bearer ${ownerToken}`, apikey: ANON } }) : null;
const storedBytes = stored ? new Uint8Array(await stored.arrayBuffer()) : null;
check("comprovante: arquivo guardado na inbox e aberto pelo dono do workspace", Boolean(proofFile?.startsWith(`${tenantId}/`)) && stored?.status === 200 && new TextDecoder().decode(storedBytes!.slice(0, 5)) === "%PDF-", { proofFile, status: stored?.status });
const strangerFile = proofFile ? await fetch(`${GATEWAY}/storage/v1/object/inbox-media/${proofFile}`, { headers: { Authorization: `Bearer ${ANON}`, apikey: ANON } }) : null;
check("comprovante: anônimo não abre o arquivo", (strangerFile?.status ?? 400) >= 400, strangerFile?.status);
await strangerFile?.body?.cancel();

r = await media({ action: "delete", asset_id: uploadedId });
const gonePhoto = await fetch(`${GATEWAY}/storage/v1/object/public/media/${upPath}`);
check("excluir remove a foto e o arquivo", r.status === 200 && gonePhoto.status >= 400, gonePhoto.status);
await gonePhoto.body?.cancel();

console.log(failures ? `\n✘ ${failures} verificação(ões) falharam` : "\n✔ Cenário ponta a ponta OK");
Deno.exit(failures ? 1 : 0);
