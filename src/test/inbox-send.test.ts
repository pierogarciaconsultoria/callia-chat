import { describe, expect, it } from "vitest";
import { canForward, forwardPreview, mediaTypeFor, outboundMediaPath, validateUpload } from "@/lib/inbox-send";

const msg = { sender: "customer" as const, type: "text" as const, content: "oi", media_url: null, metadata: {} };

describe("envio pela inbox (painel)", () => {
  it("tipo pelo MIME e caminho do anexo na pasta outbound", () => {
    expect(mediaTypeFor("image/jpeg")).toBe("image");
    expect(mediaTypeFor("application/pdf")).toBe("document");
    expect(outboundMediaPath("ws", "Contrato Final.PDF", "id1")).toBe("ws/outbound/id1.pdf");
    expect(outboundMediaPath("ws", "semextensao", "id2")).toBe("ws/outbound/id2.bin");
  });

  it("valida tamanho e nome do arquivo", () => {
    expect(validateUpload({ size: 10, name: "a.pdf" })).toBeNull();
    expect(validateUpload({ size: 0, name: "a.pdf" })).toMatch(/vazio/);
    expect(validateUpload({ size: 21 * 1024 * 1024, name: "a.pdf" })).toMatch(/20 MB/);
  });

  it("sabe o que pode ser encaminhado e resume a mensagem", () => {
    expect(canForward(msg)).toBe(true);
    expect(canForward({ ...msg, content: " " })).toBe(false);
    expect(canForward({ ...msg, sender: "system" })).toBe(false);
    expect(canForward({ ...msg, type: "image", content: null })).toBe(false);
    expect(canForward({ ...msg, type: "image", content: null, metadata: { media_path: "ws/c/m.jpg" } })).toBe(true);
    expect(canForward({ ...msg, type: "reaction", content: "👍" })).toBe(false);
    expect(forwardPreview({ type: "document", content: null, metadata: { file_name: "contrato.pdf" } })).toBe("contrato.pdf");
    expect(forwardPreview({ type: "image", content: "olha isso", metadata: {} })).toBe("Imagem: olha isso");
    expect(forwardPreview({ type: "text", content: "x".repeat(130), metadata: {} })).toHaveLength(118);
  });
});
