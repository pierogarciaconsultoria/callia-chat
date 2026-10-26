// API pública autenticada por x-api-key. O workspace vem sempre da chave, nunca do corpo.
import { z } from "npm:zod@3.23.8";
import { createHandler, errorResponse, json, readJson, RuntimeError } from "../_shared/http.ts";
import { hashApiKey, maskApiKey, parseApiKey, timingSafeEqual } from "../_shared/crypto.ts";
import { normalizePhone } from "../_shared/evolution.ts";
import { sendOutbound } from "../_shared/channel.ts";
import { aiFromEnv, loadAgentConfig } from "../_shared/agent-runtime.ts";
import { loadAvailabilityProvider } from "../_shared/availability.ts";
import { searchKnowledge } from "../_shared/knowledge.ts";
import { formatBusinessHours } from "../_shared/agent-core.ts";
import { adminDb, type Db, optionalEnv } from "../_shared/supabase.ts";
import { emitEvent } from "../_shared/webhooks.ts";
import { assertActive, assertFeature, type Entitlements, hasFeature, loadEntitlements } from "../_shared/entitlements.ts";

interface ApiContext {
  db: Db;
  workspaceId: string;
  apiKeyId: string;
  correlationId: string;
  entitlements: Entitlements;
}

async function authenticate(db: Db, req: Request): Promise<{ workspaceId: string; apiKeyId: string }> {
  const parsed = parseApiKey(req.headers.get("x-api-key"));
  if (!parsed) throw new RuntimeError("unauthorized", "Header x-api-key ausente ou em formato inválido.");
  const { data: key } = await db
    .from("api_keys")
    .select("id, workspace_id, key_hash, revoked_at, expires_at, last_used_at")
    .eq("prefix", parsed.prefix)
    .maybeSingle();
  const expected = key?.key_hash ?? "0".repeat(64);
  const provided = await hashApiKey(parsed.raw, optionalEnv("API_KEY_PEPPER") ?? "");
  if (!key || !timingSafeEqual(provided, expected)) throw new RuntimeError("unauthorized", "API key inválida.");
  if (key.revoked_at) throw new RuntimeError("forbidden", "API key revogada.");
  if (key.expires_at && new Date(key.expires_at) <= new Date()) throw new RuntimeError("forbidden", "API key expirada.");
  if (!key.last_used_at || Date.now() - new Date(key.last_used_at).getTime() > 60_000) {
    await db.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", key.id);
  }
  return { workspaceId: key.workspace_id, apiKeyId: key.id };
}

function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new RuntimeError("invalid_request", "Payload inválido.", {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return parsed.data;
}

const phoneSchema = z.string().min(8).max(25).transform((v, ctx) => {
  const phone = normalizePhone(v);
  if (!phone) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "telefone inválido" });
  return phone ?? "";
});

const sendSchema = z.object({
  to: z.union([phoneSchema, z.object({ phone: phoneSchema, name: z.string().max(120).optional() })]),
  type: z.enum(["text", "image", "video", "document", "audio"]).default("text"),
  text: z.string().max(4096).optional(),
  mediaUrl: z.string().url().optional(),
  fileName: z.string().max(200).optional(),
  mimetype: z.string().max(100).optional(),
  instanceSelection: z.enum(["explicit", "default"]).default("default"),
  instanceId: z.string().uuid().optional(),
  externalId: z.string().min(1).max(200).optional(),
}).superRefine((v, ctx) => {
  if (v.type === "text" && !v.text?.trim()) ctx.addIssue({ code: "custom", path: ["text"], message: "obrigatório para type=text" });
  if (v.type !== "text" && !v.mediaUrl) ctx.addIssue({ code: "custom", path: ["mediaUrl"], message: "obrigatório para mídia" });
  if (v.instanceSelection === "explicit" && !v.instanceId) ctx.addIssue({ code: "custom", path: ["instanceId"], message: "obrigatório com instanceSelection=explicit" });
});

const ingestSchema = z.object({
  externalId: z.string().min(1).max(200),
  channel: z.string().regex(/^[a-z0-9_]{2,40}$/).default("whatsapp_cloud")
    .refine((c) => c !== "whatsapp", "use outro nome de canal; 'whatsapp' é reservado à Evolution"),
  direction: z.enum(["inbound", "outbound"]),
  sender: z.enum(["customer", "bot", "agent"]),
  contact: z.object({ phone: phoneSchema, name: z.string().max(120).optional() }),
  type: z.enum(["text", "image", "audio", "video", "document", "sticker", "location", "contact", "unknown"]).default("text"),
  content: z.string().max(10000).nullish(),
  mediaUrl: z.string().url().nullish(),
  mediaMime: z.string().max(100).nullish(),
  timestamp: z.string().datetime({ offset: true }).optional(),
  metadata: z.record(z.unknown()).optional(),
}).superRefine((v, ctx) => {
  if (v.direction === "inbound" && v.sender !== "customer") ctx.addIssue({ code: "custom", path: ["sender"], message: "inbound deve ser do customer" });
  if (v.direction === "outbound" && v.sender === "customer") ctx.addIssue({ code: "custom", path: ["sender"], message: "outbound não pode ser do customer" });
});

const eventSchema = z.object({
  externalId: z.string().min(1).max(200),
  type: z.string().min(1).max(100),
  payload: z.record(z.unknown()).default({}),
});

function intParam(url: URL, name: string, def: number, max: number): number {
  const n = Number(url.searchParams.get(name) ?? def);
  return Number.isFinite(n) ? Math.min(Math.max(1, Math.trunc(n)), max) : def;
}

async function route(ctx: ApiContext, req: Request, url: URL, path: string): Promise<Response> {
  const { db, workspaceId } = ctx;
  const method = req.method;

  if (method === "POST" && path === "/messages") {
    const body = validate(sendSchema, await readJson(req));
    const to = typeof body.to === "string" ? { phone: body.to, name: undefined } : body.to;
    const result = await sendOutbound(db, {
      workspaceId,
      origin: "public_api",
      sender: "system",
      type: body.type ?? "text",
      text: body.text ?? null,
      mediaUrl: body.mediaUrl ?? null,
      fileName: body.fileName ?? null,
      mimetype: body.mimetype ?? null,
      toPhone: to.phone,
      contactName: to.name ?? null,
      instanceId: body.instanceSelection === "explicit" ? body.instanceId : null,
      idempotencyKey: body.externalId ?? null,
      correlationId: ctx.correlationId,
      metadata: { source: "public_api", api_key_id: ctx.apiKeyId },
    });
    const payload = {
      ok: result.status === "sent",
      duplicate: result.duplicate,
      status: result.status,
      conversationId: result.conversationId,
      messageId: result.messageId,
      providerMessageId: result.providerMessageId,
      ...(result.error ? { error: { code: "upstream_unavailable", message: "Falha no envio pelo WhatsApp." } } : {}),
    };
    return json(payload, result.status === "sent" ? (result.duplicate ? 200 : 202) : 502);
  }

  if (method === "POST" && path === "/messages/ingest") {
    // Somente registro: nunca envia pelo WhatsApp e nunca aciona o agente.
    const body = validate(ingestSchema, await readJson(req));
    const { data, error } = await db.rpc("record_message", {
      p_workspace_id: workspaceId,
      p_instance_id: null,
      p_channel: body.channel,
      p_contact_phone: body.contact.phone,
      p_contact_name: body.contact.name ?? null,
      p_direction: body.direction,
      p_sender: body.sender,
      p_type: body.type,
      p_content: body.content ?? null,
      p_media_url: body.mediaUrl ?? null,
      p_media_mime: body.mediaMime ?? null,
      p_external_id: body.externalId,
      p_metadata: { ...(body.metadata ?? {}), source: "external", channel: body.channel },
      p_created_at: body.timestamp ?? new Date().toISOString(),
      p_conversation_metadata: { source: "external" },
      p_status: body.direction === "inbound" ? "received" : "sent",
    });
    const row = data?.[0];
    if (error || !row) throw new RuntimeError("internal_error", "Falha ao registrar mensagem.", { db: error?.message });
    if (row.duplicate) return json({ ok: true, duplicate: true, conversationId: row.conversation_id, messageId: row.message_id, sent: false });
    if (body.direction === "inbound") {
      await emitEvent(db, {
        workspaceId,
        event: "message.received",
        correlationId: ctx.correlationId,
        masterKey: optionalEnv("CALLIA_ENCRYPTION_KEY"),
        data: { conversation_id: row.conversation_id, message_id: row.message_id, channel: body.channel, from: body.contact.phone, type: body.type, text: body.content ?? null, source: "external" },
      });
    }
    return json({ ok: true, duplicate: false, conversationId: row.conversation_id, messageId: row.message_id, sent: false }, 201);
  }

  if (method === "POST" && path === "/events") {
    const body = validate(eventSchema, await readJson(req));
    const { data, error } = await db.from("public_api_events")
      .insert({ workspace_id: workspaceId, external_id: body.externalId, event_type: body.type, payload: body.payload })
      .select("id, created_at").single();
    if (error?.code === "23505") return json({ ok: true, duplicate: true });
    if (error) throw new RuntimeError("internal_error", "Falha ao registrar evento.", { db: error.message });
    await emitEvent(db, {
      workspaceId,
      event: "public_api.event.received",
      correlationId: ctx.correlationId,
      masterKey: optionalEnv("CALLIA_ENCRYPTION_KEY"),
      data: { event_id: data.id, external_id: body.externalId, type: body.type, payload: body.payload },
    });
    return json({ ok: true, duplicate: false, eventId: data.id }, 202);
  }

  if (method === "GET" && path === "/conversations") {
    let query = db.from("conversations")
      .select("id, channel, instance_id, contact_phone, contact_name, mode, unread_count, last_message_at, last_message_preview, created_at")
      .eq("workspace_id", workspaceId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(intParam(url, "limit", 50, 200));
    const mode = url.searchParams.get("mode");
    if (mode && ["bot", "human", "closed"].includes(mode)) query = query.eq("mode", mode);
    const phone = normalizePhone(url.searchParams.get("phone"));
    if (phone) query = query.eq("contact_phone", phone);
    const before = url.searchParams.get("before");
    if (before && !Number.isNaN(Date.parse(before))) query = query.lt("last_message_at", before);
    const { data, error } = await query;
    if (error) throw new RuntimeError("internal_error", "Falha ao listar conversas.");
    return json({ data, next_before: data?.length ? data[data.length - 1].last_message_at : null });
  }

  const messagesMatch = /^\/conversations\/([0-9a-f-]{36})\/messages$/i.exec(path);
  if (method === "GET" && messagesMatch) {
    const { data: conv } = await db.from("conversations").select("id").eq("id", messagesMatch[1]).eq("workspace_id", workspaceId).maybeSingle();
    if (!conv) throw new RuntimeError("not_found", "Conversa não encontrada.");
    let query = db.from("messages")
      .select("id, direction, sender, type, content, media_url, media_mime, status, external_id, created_at")
      .eq("conversation_id", conv.id)
      .order("created_at", { ascending: false })
      .limit(intParam(url, "limit", 50, 200));
    const before = url.searchParams.get("before");
    if (before && !Number.isNaN(Date.parse(before))) query = query.lt("created_at", before);
    const { data, error } = await query;
    if (error) throw new RuntimeError("internal_error", "Falha ao listar mensagens.");
    return json({ data: (data ?? []).reverse() });
  }

  if (method === "GET" && path === "/knowledge/search") {
    const q = url.searchParams.get("q")?.trim() ?? "";
    if (q.length < 2) throw new RuntimeError("invalid_request", "Parâmetro q obrigatório (mínimo 2 caracteres).");
    const ai = hasFeature(ctx.entitlements, "ai_enabled") ? aiFromEnv() : null;
    const { mode, results } = await searchKnowledge(db, ai, workspaceId, q, intParam(url, "limit", 5, 20));
    return json({
      query: q,
      mode,
      results: results.map((r) => ({
        content: r.content,
        source: { id: r.source_id, title: r.source_title, kind: r.source_kind },
        score: r.score,
        keyword_rank: r.keyword_rank,
        similarity: r.similarity,
      })),
    });
  }

  if (method === "GET" && path === "/agent/context") {
    const cfg = await loadAgentConfig(db, workspaceId);
    return json({
      agent_name: cfg.agent_name,
      persona: cfg.persona_prompt,
      guardrails: cfg.guardrails,
      language: cfg.language,
      timezone: cfg.timezone,
      business_hours: cfg.business_hours,
      business_hours_text: formatBusinessHours(cfg.business_hours),
      out_of_hours_message: cfg.out_of_hours_message,
      website_url: cfg.website_url,
      payment_links: cfg.payment_links,
      handoff: { keywords: cfg.handoff_keywords, message: cfg.handoff_message },
    });
  }

  // Disponibilidade e valores pelo sistema conectado (Hospedin ou hbook). A rota antiga do hbook continua valendo.
  if (method === "GET" && (path === "/availability" || path === "/connectors/hbook/availability")) {
    assertFeature(ctx.entitlements, "connectors_enabled");
    const provider = await loadAvailabilityProvider(db, workspaceId);
    if (!provider) throw new RuntimeError("unprocessable", "Nenhum sistema de reservas conectado neste workspace.");
    const adults = url.searchParams.get("adults");
    const children = url.searchParams.get("children");
    // children_ages=5,8 (idade de cada criança; o hbook exige)
    const childrenAges = (url.searchParams.get("children_ages") ?? "").split(",").map((v) => v.trim()).filter(Boolean).map(Number);
    return json(await provider.fn({
      checkin: url.searchParams.get("checkin") ?? "",
      checkout: url.searchParams.get("checkout") ?? "",
      adults: adults ? Number(adults) : undefined,
      children: children ? Number(children) : undefined,
      childrenAges,
    }));
  }

  throw new RuntimeError("not_found", `Rota ${method} ${path} não existe.`);
}

Deno.serve(createHandler("public-api", async ({ req, url, correlationId, log }) => {
  const started = Date.now();
  const path = url.pathname.replace(/^.*?\/public-api/, "").replace(/\/+$/, "") || "/";
  const db = adminDb();
  let auth: { workspaceId: string; apiKeyId: string } | null = null;
  let response: Response;
  let errorCode: string | null = null;
  try {
    auth = await authenticate(db, req);
    // Chave válida de tenant suspenso, cancelado ou com trial vencido: nada passa.
    const entitlements = await loadEntitlements(db, auth.workspaceId);
    assertActive(entitlements);
    response = await route({ db, ...auth, correlationId, entitlements }, req, url, path);
  } catch (err) {
    errorCode = err instanceof RuntimeError ? err.code : "internal_error";
    if (errorCode === "unauthorized") log.warn("auth_failed", { key: maskApiKey(req.headers.get("x-api-key")) });
    if (errorCode === "internal_error") log.error("public_api_error", { error: err instanceof Error ? err.message : String(err) });
    response = errorResponse(err, correlationId);
  }
  // Trilha de toda chamada autenticada.
  if (auth) {
    await db.from("public_api_requests").insert({
      workspace_id: auth.workspaceId,
      api_key_id: auth.apiKeyId,
      method: req.method,
      path,
      status_code: response.status,
      error_code: errorCode,
      duration_ms: Date.now() - started,
      correlation_id: correlationId,
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    });
  }
  return response;
}));
