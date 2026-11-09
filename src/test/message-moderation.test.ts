import { describe, expect, it } from "vitest";
import { canDeleteForEveryone, DELETE_FOR_EVERYONE_WINDOW_MS } from "@/lib/message-moderation";
import { parseEvolutionWebhook } from "../../supabase/functions/_shared/evolution.ts";

const now = Date.parse("2026-11-09T12:00:00Z");
const base = { direction: "outbound" as const, sender: "agent" as const, status: "sent" as const, external_id: "3EB0ABC", created_at: "2026-11-09T11:00:00Z", deleted_at: null };

describe("apagar para todos: quem pode", () => {
  it("mensagem nossa, entregue, recente e ainda não apagada", () => {
    expect(canDeleteForEveryone(base, now)).toBe(true);
    expect(canDeleteForEveryone({ ...base, sender: "bot" }, now)).toBe(true);
    expect(canDeleteForEveryone({ ...base, direction: "inbound", sender: "customer" }, now)).toBe(false);
    expect(canDeleteForEveryone({ ...base, status: "failed" }, now)).toBe(false);
    expect(canDeleteForEveryone({ ...base, status: "pending" }, now)).toBe(false);
    expect(canDeleteForEveryone({ ...base, external_id: null }, now)).toBe(false);
    expect(canDeleteForEveryone({ ...base, deleted_at: "2026-11-09T11:30:00Z" }, now)).toBe(false);
  });

  it("respeita a janela do WhatsApp", () => {
    const limit = new Date(now - DELETE_FOR_EVERYONE_WINDOW_MS).toISOString();
    expect(canDeleteForEveryone({ ...base, created_at: limit }, now)).toBe(true);
    expect(canDeleteForEveryone({ ...base, created_at: new Date(now - DELETE_FOR_EVERYONE_WINDOW_MS - 1000).toISOString() }, now)).toBe(false);
  });
});

describe("webhook: apagar para todos feito no celular", () => {
  it("protocolMessage REVOKE vira evento revoke com o id da mensagem apagada", () => {
    const [ev] = parseEvolutionWebhook({
      event: "messages.upsert",
      instance: "callia-x",
      data: {
        key: { remoteJid: "5548999990000@s.whatsapp.net", fromMe: true, id: "3EB0NEW" },
        message: { protocolMessage: { type: "REVOKE", key: { remoteJid: "5548999990000@s.whatsapp.net", fromMe: true, id: "3EB0OLD" } } },
        messageTimestamp: 1762689600,
      },
    });
    expect(ev).toEqual({ kind: "revoke", instanceName: "callia-x", externalId: "3EB0OLD", fromMe: true });
  });

  it("outros protocolMessage continuam ignorados", () => {
    const [ev] = parseEvolutionWebhook({
      event: "messages.upsert",
      instance: "callia-x",
      data: { key: { remoteJid: "5548999990000@s.whatsapp.net", fromMe: false, id: "3EB0X" }, message: { protocolMessage: { type: "EPHEMERAL_SETTING" } } },
    });
    expect(ev).toMatchObject({ kind: "ignored", reason: "protocol_message" });
  });
});
