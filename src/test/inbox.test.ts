import { describe, expect, it } from "vitest";
import {
  formatPhoneLabel,
  getConversationPreviewFromConversation,
  getMessageContent,
} from "@/lib/inbox";
import { buildInboxClaimMetadata } from "@/lib/inbox-handoff";

describe("inbox helpers", () => {
  it("normaliza telefone para exibicao", () => {
    expect(formatPhoneLabel("5511999999999")).toBe("+5511999999999");
    expect(formatPhoneLabel("+5511888888888")).toBe("+5511888888888");
  });

  it("usa media_summary como fallback de conteudo", () => {
    expect(
      getMessageContent({
        id: "m1",
        workspace_id: "w1",
        conversation_id: "c1",
        direction: "inbound",
        sender: "customer",
        type: "image",
        content: null,
        media_url: "https://example.com/image.png",
        transcription: null,
        ai_model: null,
        tokens_used: null,
        agent_user_id: null,
        external_id: null,
        metadata: {
          media_summary: "Cliente enviou foto do produto azul",
        },
        created_at: new Date().toISOString(),
      }),
    ).toBe("Cliente enviou foto do produto azul");
  });

  it("monta preview da conversa com base no metadata", () => {
    expect(
      getConversationPreviewFromConversation({
        id: "c1",
        workspace_id: "w1",
        whatsapp_instance_id: "wa1",
        customer_phone: "5511999999999",
        customer_name: "Maria",
        mode: "human",
        assigned_agent_id: null,
        last_message_at: new Date().toISOString(),
        unread_count: 1,
        is_closed: false,
        metadata: {
          last_message_type: "audio",
          last_message_direction: "inbound",
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        whatsapp_instance: null,
      }),
    ).toBe("Ultima mensagem com audio recebida");
  });

  it("define a pausa humana ao assumir uma conversa", () => {
    expect(
      buildInboxClaimMetadata(
        { origin: "inbox" },
        "user-1",
        6,
        new Date("2026-10-07T12:00:00.000Z"),
      ),
    ).toEqual({
      origin: "inbox",
      claimed_at: "2026-10-07T12:00:00.000Z",
      claimed_by: "user-1",
      human_until: "2026-10-07T18:00:00.000Z",
    });
  });
});
