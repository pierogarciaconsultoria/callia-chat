import { describe, expect, it } from "vitest";
import {
  normalizeCustomDomain,
  parseFollowUpRules,
  parsePaymentLinks,
  serializeFollowUpRules,
  serializePaymentLinks,
} from "@/lib/agent-settings";

describe("agent settings helpers", () => {
  it("serializes and parses payment links", () => {
    const links = [
      { label: "PIX principal", url: "https://pag.example/pix" },
      { label: "Checkout", url: "https://pag.example/checkout" },
    ];

    const serialized = serializePaymentLinks(links);

    expect(serialized).toContain("PIX principal | https://pag.example/pix");
    expect(parsePaymentLinks(serialized)).toEqual(links);
  });

  it("parses payment links with a single token as fallback url", () => {
    expect(parsePaymentLinks("https://pag.example/avulso")).toEqual([
      { label: "https://pag.example/avulso", url: "https://pag.example/avulso" },
    ]);
  });

  it("serializes and parses follow-up rules", () => {
    const rules = [{ delay_minutes: 15, message_template: "Oi, ainda posso te ajudar?" }];

    const serialized = serializeFollowUpRules(rules);

    expect(parseFollowUpRules(serialized)).toEqual(rules);
  });

  it("returns an empty list for blank follow-up input", () => {
    expect(parseFollowUpRules("")).toEqual([]);
  });

  it("normalizes custom domains", () => {
    expect(normalizeCustomDomain(" App.Cliente.com ")).toBe("app.cliente.com");
    expect(normalizeCustomDomain("   ")).toBeNull();
    expect(normalizeCustomDomain(null)).toBeNull();
  });
});
