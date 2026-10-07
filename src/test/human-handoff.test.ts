import { describe, expect, it } from "vitest";
import {
  buildBotResumeMetadata,
  buildPhoneHandoffMetadata,
  findMatchingRecentOutbound,
  isPhoneHumanReply,
  markMessageAsPhoneReply,
  shouldReturnConversationToBot,
} from "../../supabase/functions/_shared/human-handoff";

describe("phone reply handoff", () => {
  const now = new Date("2026-10-07T12:00:00.000Z");

  it("classifies an unmatched fromMe message as a human phone reply", () => {
    expect(
      isPhoneHumanReply({
        fromMe: true,
        existingMessage: null,
        matchingRecentOutbound: null,
      }),
    ).toBe(true);

    const metadata = buildPhoneHandoffMetadata({ channel: "whatsapp" }, 12, now);
    expect(metadata).toMatchObject({
      channel: "whatsapp",
      handoff_reason: "phone_reply",
      handoff_at: "2026-10-07T12:00:00.000Z",
      human_until: "2026-10-08T00:00:00.000Z",
    });

    expect(markMessageAsPhoneReply({ sender: "bot", metadata: { fromMe: true } })).toEqual({
      sender: "agent",
      metadata: { fromMe: true, source: "phone" },
    });
  });

  it("does not classify Callia echoes as human replies", () => {
    const recent = findMatchingRecentOutbound(
      [
        {
          queued_at: "2026-10-07T11:59:45.000Z",
          payload: { text: "Olá, como posso ajudar?" },
          message_id: "message-1",
        },
      ],
      "  Olá,  como posso ajudar? ",
      now,
    );

    expect(recent?.message_id).toBe("message-1");
    expect(
      isPhoneHumanReply({
        fromMe: true,
        existingMessage: null,
        matchingRecentOutbound: recent,
      }),
    ).toBe(false);
    expect(
      isPhoneHumanReply({
        fromMe: true,
        existingMessage: { id: "message-1" },
        matchingRecentOutbound: null,
      }),
    ).toBe(false);
  });

  it("ignores matching outbound messages older than 30 seconds", () => {
    expect(
      findMatchingRecentOutbound(
        [{ queued_at: "2026-10-07T11:59:29.000Z", payload: { text: "Mesmo texto" } }],
        "Mesmo texto",
        now,
      ),
    ).toBeNull();
  });
});

describe("automatic return to bot", () => {
  const now = new Date("2026-10-07T12:00:00.000Z");

  it("returns an expired human conversation to bot", () => {
    expect(
      shouldReturnConversationToBot({
        mode: "human",
        metadata: { human_until: "2026-10-07T11:59:59.000Z" },
        now,
      }),
    ).toBe(true);

    expect(
      buildBotResumeMetadata(
        { human_until: "2026-10-07T11:59:59.000Z", handoff_reason: "phone_reply" },
        now,
      ),
    ).toEqual({
      handoff_reason: "phone_reply",
      returned_to_bot_at: "2026-10-07T12:00:00.000Z",
      returned_to_bot_reason: "human_pause_expired",
    });
  });

  it("keeps active or manually handed-off conversations in human mode", () => {
    expect(
      shouldReturnConversationToBot({
        mode: "human",
        metadata: { human_until: "2026-10-07T12:00:01.000Z" },
        now,
      }),
    ).toBe(false);
    expect(
      shouldReturnConversationToBot({
        mode: "human",
        metadata: { handoff_reason: "manual" },
        now,
      }),
    ).toBe(false);
  });
});
