// Recebe eventos da Evolution: QR code, status da conexão e mensagens (com idempotência).
// URL configurada na Evolution: /functions/v1/whatsapp-webhook?instance=<uuid>&token=<token da instância>
import { createHandler, json, readJson, RuntimeError, runInBackground, sleep } from "../_shared/http.ts";
import { sha256Hex, timingSafeEqual } from "../_shared/crypto.ts";
import { type EvolutionMessageEvent, looksAutomatedFromPhone, parseEvolutionWebhook } from "../_shared/evolution.ts";
import { adminDb, type Db, functionUrl, internalHeaders, optionalEnv } from "../_shared/supabase.ts";
import { emitEvent } from "../_shared/webhooks.ts";

interface Instance {
  id: string;
  workspace_id: string;
  instance_name: string;
  webhook_token_hash: string | null;
  status: string;
}

Deno.serve(createHandler("whatsapp-webhook", async ({ req, url, correlationId, log }) => {
  if (req.method !== "POST") throw new RuntimeError("invalid_request", "Use POST.");
  const instanceId = url.searchParams.get("instance") ?? "";
  const token = url.searchParams.get("token") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(instanceId) || !token) throw new RuntimeError("unauthorized", "Webhook sem credenciais.");

  const db = adminDb();
  const { data: instance } = await db
    .from("whatsapp_instances")
    .select("id, workspace_id, instance_name, webhook_token_hash, status")
    .eq("id", instanceId)
    .maybeSingle<Instance>();
  if (!instance?.webhook_token_hash || !timingSafeEqual(await sha256Hex(token), instance.webhook_token_hash)) {
    throw new RuntimeError("unauthorized", "Token de webhook inválido.");
  }

  const body = await readJson(req);
  const events = parseEvolutionWebhook(body);
  const results: Array<Record<string, unknown>> = [];

  for (const ev of events) {
    if (ev.instanceName && ev.instanceName !== instance.instance_name) {
      results.push({ kind: "ignored", reason: "instance_mismatch" });
      continue;
    }
    if (ev.kind === "qrcode") {
      await db.from("whatsapp_instances").update({
        qr_code: ev.qrBase64,
        qr_updated_at: new Date().toISOString(),
        status: instance.status === "open" ? "open" : "qr",
      }).eq("id", instance.id);
      results.push({ kind: "qrcode" });
    } else if (ev.kind === "connection") {
      const patch: Record<string, unknown> = { status: ev.state };
      if (ev.state === "open") {
        Object.assign(patch, { qr_code: null, last_connected_at: new Date().toISOString(), last_error: null });
        if (ev.phone) patch.phone_number = ev.phone;
        if (ev.profileName) patch.profile_name = ev.profileName;
      }
      if (ev.state === "close" && ev.reason) patch.last_error = `Conexão encerrada (código ${ev.reason}).`;
      await db.from("whatsapp_instances").update(patch).eq("id", instance.id);
      await db.from("audit_logs").insert({
        workspace_id: instance.workspace_id,
        actor_type: "system",
        action: `whatsapp.connection.${ev.state}`,
        entity: "whatsapp_instance",
        entity_id: instance.id,
        correlation_id: correlationId,
      });
      results.push({ kind: "connection", state: ev.state });
    } else if (ev.kind === "message") {
      results.push(await handleMessage(db, instance, ev, correlationId, log));
    } else {
      results.push({ kind: "ignored", reason: ev.reason });
    }
  }

  // Sempre 200 para eventos válidos: a Evolution não deve reenviar o que já foi tratado.
  return json({ ok: true, results });
}));

async function handleMessage(
  db: Db,
  instance: Instance,
  ev: EvolutionMessageEvent,
  correlationId: string,
  log: { info: (m: string, e?: Record<string, unknown>) => void },
): Promise<Record<string, unknown>> {
  // Ledger: a mesma mensagem pode chegar mais de uma vez.
  const { data: ledger, error: ledgerError } = await db.from("inbound_events").insert({
    workspace_id: instance.workspace_id,
    instance_id: instance.id,
    provider: "evolution",
    event_type: "MESSAGES_UPSERT",
    event_key: ev.externalId,
    payload: { phone: ev.phone, type: ev.type, from_me: ev.fromMe, timestamp: ev.timestamp },
    correlation_id: correlationId,
  }).select("id").single();
  if (ledgerError?.code === "23505") return { kind: "message", duplicate: true };
  if (ledgerError) throw new RuntimeError("internal_error", "Falha no ledger de eventos.", { db: ledgerError.message });

  const finish = (status: "processed" | "ignored", error?: string) =>
    db.from("inbound_events").update({ status, error: error ?? null }).eq("id", ledger.id);

  const metadata = {
    wa_key: ev.key,
    instance_name: instance.instance_name,
    ...(ev.fileName ? { file_name: ev.fileName } : {}),
  };

  if (ev.fromMe) {
    // Eco de algo que nós mesmos enviamos? O id do provedor fica em outbound_messages.
    if (await isOurOwnSend(db, instance.workspace_id, ev.externalId, ev.phone)) {
      await finish("ignored", "echo_of_outbound");
      return { kind: "message", echo: true };
    }
    const { data } = await db.rpc("record_message", {
      p_workspace_id: instance.workspace_id,
      p_instance_id: instance.id,
      p_channel: "whatsapp",
      p_contact_phone: ev.phone,
      p_contact_name: null,
      p_direction: "outbound",
      p_sender: "agent",
      p_type: ev.type,
      p_content: ev.text,
      p_media_mime: ev.mediaMime,
      p_external_id: ev.externalId,
      p_metadata: { ...metadata, echo: true, from_device: true },
      p_created_at: ev.timestamp,
      p_status: "sent",
    });
    const row = data?.[0];
    // Saudação/ausência automática do WhatsApp Business não é a equipe respondendo.
    let automated = false;
    if (row && !row.duplicate && row.conversation_mode === "bot") {
      const { data: lastIn } = await db.from("messages").select("created_at").eq("conversation_id", row.conversation_id)
        .eq("direction", "inbound").lte("created_at", ev.timestamp).order("created_at", { ascending: false }).limit(1).maybeSingle();
      automated = looksAutomatedFromPhone(ev.text, ev.timestamp, lastIn?.created_at ?? null);
      if (automated) await db.from("messages").update({ metadata: { ...metadata, echo: true, from_device: true, auto_reply: true } }).eq("id", row.message_id);
    }
    // Equipe respondeu pelo celular: pausa o bot para não atropelar a conversa.
    if (row && !row.duplicate && row.conversation_mode === "bot" && !automated) {
      await db.from("conversations").update({ mode: "human", handoff_at: new Date().toISOString() }).eq("id", row.conversation_id);
      await emitEvent(db, {
        workspaceId: instance.workspace_id,
        event: "conversation.handoff",
        correlationId,
        masterKey: optionalEnv("CALLIA_ENCRYPTION_KEY"),
        data: { conversation_id: row.conversation_id, reason: "agent_replied_from_phone" },
      });
    }
    await finish("processed");
    return { kind: "message", from_me: true };
  }

  const { data, error } = await db.rpc("record_message", {
    p_workspace_id: instance.workspace_id,
    p_instance_id: instance.id,
    p_channel: "whatsapp",
    p_contact_phone: ev.phone,
    p_contact_name: ev.contactName,
    p_direction: "inbound",
    p_sender: "customer",
    p_type: ev.type,
    p_content: ev.text,
    p_media_mime: ev.mediaMime,
    p_external_id: ev.externalId,
    p_metadata: metadata,
    p_created_at: ev.timestamp,
  });
  const row = data?.[0];
  if (error || !row) {
    await finish("ignored", error?.message ?? "record_message sem retorno");
    throw new RuntimeError("internal_error", "Falha ao gravar mensagem.", { db: error?.message });
  }
  await finish("processed");
  if (row.duplicate) return { kind: "message", duplicate: true };

  await emitEvent(db, {
    workspaceId: instance.workspace_id,
    event: "message.received",
    correlationId,
    masterKey: optionalEnv("CALLIA_ENCRYPTION_KEY"),
    data: {
      conversation_id: row.conversation_id,
      message_id: row.message_id,
      instance_id: instance.id,
      from: ev.phone,
      contact_name: ev.contactName,
      type: ev.type,
      text: ev.text,
      timestamp: ev.timestamp,
    },
  });

  if (row.conversation_mode === "bot") {
    log.info("dispatch_process_message", { message_id: row.message_id });
    runInBackground(
      fetch(functionUrl("process-message"), {
        method: "POST",
        headers: { ...internalHeaders(), "x-correlation-id": correlationId },
        body: JSON.stringify({ message_id: row.message_id }),
      }).then((r) => r.body?.cancel()),
    );
  }
  return { kind: "message", message_id: row.message_id, mode: row.conversation_mode };
}

async function isOurOwnSend(db: Db, workspaceId: string, providerId: string, phone: string): Promise<boolean> {
  // O eco pode chegar antes de gravarmos o id do envio: um envio ainda "queued" para o mesmo número conta como nosso.
  for (const wait of [0, 1500]) {
    if (wait) await sleep(wait);
    const { data: byId } = await db
      .from("outbound_messages")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("provider_message_id", providerId)
      .limit(1);
    if (byId?.length) return true;
    const { data: inFlight } = await db
      .from("outbound_messages")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("to_phone", phone)
      .eq("status", "queued")
      .gte("created_at", new Date(Date.now() - 60_000).toISOString())
      .limit(1);
    if (inFlight?.length) return true;
  }
  return false;
}
