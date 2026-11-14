import { describe, expect, it } from "vitest";
import { assertPublicHttpUrl, isInternalHost } from "../../supabase/functions/_shared/net.ts";

describe("URLs informadas pelo cliente", () => {
  it("bloqueia hosts internos e aceita públicos", () => {
    expect(isInternalHost("kong")).toBe(true);
    expect(isInternalHost("10.0.0.5")).toBe(true);
    expect(isInternalHost("api.exemplo.com.br")).toBe(false);
    expect(assertPublicHttpUrl("https://api.exemplo.com.br/hook")).toBe("https://api.exemplo.com.br/hook");
    expect(() => assertPublicHttpUrl("https://db/x")).toThrow(/interno/);
  });

  it("webhooks exigem https; outras URLs ainda aceitam http", () => {
    expect(assertPublicHttpUrl("http://site.exemplo.com.br")).toBe("http://site.exemplo.com.br/");
    expect(() => assertPublicHttpUrl("http://api.exemplo.com.br/hook", "url", { requireHttps: true })).toThrow(/https/);
    expect(assertPublicHttpUrl("https://api.exemplo.com.br/hook", "url", { requireHttps: true })).toBe("https://api.exemplo.com.br/hook");
  });
});
