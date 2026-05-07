import { describe, expect, it } from "vitest";
import { formatWebhookEvents, supportedWebhookEvents } from "@/lib/webhooks";

describe("webhooks helpers", () => {
  it("expõe os eventos suportados na ordem esperada", () => {
    expect(supportedWebhookEvents).toEqual([
      "message.received",
      "message.sent",
      "conversation.handoff",
      "public_api.event.received",
    ]);
  });

  it("formata a lista de eventos para exibição", () => {
    expect(formatWebhookEvents(["message.received", "message.sent"])).toBe(
      "message.received, message.sent",
    );
  });
});
