import { describe, expect, it } from "vitest";
import { addAttachments, canForward, forwardPreview, MAX_FILES_PER_SEND, mediaTypeFor, outboundMediaPath, validateUpload } from "@/lib/inbox-send";

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

  it("vários arquivos de uma vez: soma aos já escolhidos, avisa os inválidos e corta no limite", () => {
    const f = (name: string, size = 10) => ({ name, size }) as File;
    const first = addAttachments([], [f("a.jpg"), f("vazio.jpg", 0), f("b.jpg")]);
    expect(first.list.map((x) => x.name)).toEqual(["a.jpg", "b.jpg"]);
    expect(first.problems).toEqual(["vazio.jpg: O arquivo está vazio."]);
    const more = addAttachments(first.list, [f("c.jpg")]);
    expect(more.list.map((x) => x.name)).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
    const many = addAttachments([], Array.from({ length: MAX_FILES_PER_SEND + 2 }, (_, i) => f(`p${i}.jpg`)));
    expect(many.list).toHaveLength(MAX_FILES_PER_SEND);
    expect(many.problems).toEqual([`No máximo ${MAX_FILES_PER_SEND} arquivos por envio. Os demais ficaram de fora.`]);
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
