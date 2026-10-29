import { describe, expect, it } from "vitest";
import { assertOutboundPath, outboundTypeFor, planForward, publicSignedUrl } from "../../supabase/functions/_shared/forward.ts";

const base = { id: "m1", workspace_id: "ws", media_url: null, media_mime: null, metadata: null };

describe("encaminhar pela inbox (servidor)", () => {
  it("texto, localização e contato viram texto; figurinha vira imagem", () => {
    expect(planForward({ ...base, type: "text", content: " oi " })).toMatchObject({ type: "text", text: "oi", mediaPath: null });
    expect(planForward({ ...base, type: "location", content: "Pousada (-27.1, -48.6)" }).type).toBe("text");
    expect(planForward({ ...base, type: "sticker", content: null, media_mime: "image/webp", metadata: { media_path: "ws/c1/m1.webp" } })).toMatchObject({ type: "image", mediaPath: "ws/c1/m1.webp", mimetype: "image/webp" });
  });

  it("arquivo guardado vai pelo caminho do bucket; só URL pública vai pela URL; sem nada, recusa", () => {
    expect(planForward({ ...base, type: "document", content: "segue", media_mime: "application/pdf", metadata: { media_path: "ws/c1/m1.pdf", file_name: "contrato.pdf" } }))
      .toEqual({ type: "document", text: "segue", mediaPath: "ws/c1/m1.pdf", mediaUrl: null, mimetype: "application/pdf", fileName: "contrato.pdf" });
    expect(planForward({ ...base, type: "image", content: null, media_url: "https://x/y.jpg", media_mime: "image/jpeg" })).toMatchObject({ mediaPath: null, mediaUrl: "https://x/y.jpg" });
    expect(() => planForward({ ...base, type: "audio", content: null })).toThrow(/não ficou guardado/);
    expect(() => planForward({ ...base, type: "text", content: "  " })).toThrow(/não tem conteúdo/);
    expect(() => planForward({ ...base, type: "reaction", content: "👍" })).toThrow(/não pode ser encaminhado/);
  });

  it("tipo do anexo pelo MIME, com pedido explícito prevalecendo", () => {
    expect(outboundTypeFor("image/png")).toBe("image");
    expect(outboundTypeFor("image/svg+xml")).toBe("document");
    expect(outboundTypeFor("video/mp4")).toBe("video");
    expect(outboundTypeFor("audio/ogg")).toBe("audio");
    expect(outboundTypeFor("application/pdf")).toBe("document");
    expect(outboundTypeFor("image/png", "document")).toBe("document");
    expect(outboundTypeFor(null, "sticker")).toBe("document");
  });

  it("só aceita caminhos da pasta outbound do próprio workspace", () => {
    expect(assertOutboundPath("ws/outbound/a.pdf", "ws")).toBe("ws/outbound/a.pdf");
    expect(() => assertOutboundPath("other/outbound/a.pdf", "ws")).toThrow();
    expect(() => assertOutboundPath("ws/c1/m1.pdf", "ws")).toThrow();
    expect(() => assertOutboundPath("ws/outbound/../c1/m1.pdf", "ws")).toThrow();
    expect(() => assertOutboundPath(42, "ws")).toThrow();
  });

  it("troca o host interno da URL assinada pelo público", () => {
    expect(publicSignedUrl("http://api-gw:8000/storage/v1/object/sign/x?token=t", "http://api-gw:8000", "https://callia.example.com/"))
      .toBe("https://callia.example.com/storage/v1/object/sign/x?token=t");
    expect(publicSignedUrl("/storage/v1/object/sign/x", "http://api-gw:8000", "https://callia.example.com")).toBe("https://callia.example.com/storage/v1/object/sign/x");
    expect(publicSignedUrl("http://api-gw:8000/x", "http://api-gw:8000", undefined)).toBe("http://api-gw:8000/x");
  });
});
