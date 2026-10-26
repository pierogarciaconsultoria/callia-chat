import { describe, expect, it } from "vitest";
import { chunkText, decodeEntities, extractHtmlTitle, htmlToText } from "../../supabase/functions/_shared/knowledge.ts";

describe("chunking da base de conhecimento", () => {
  it("mantém texto curto em um único bloco", () => {
    expect(chunkText("  Olá mundo.  ")).toEqual(["Olá mundo."]);
    expect(chunkText("")).toEqual([]);
  });

  it("respeita o tamanho máximo e sobrepõe o final do bloco anterior", () => {
    const paragraphs = Array.from({ length: 12 }, (_, i) => `Parágrafo ${i + 1}. ` + "palavra ".repeat(25).trim() + ".");
    const chunks = chunkText(paragraphs.join("\n\n"), { size: 400, overlap: 80 });
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(400);
    // A sobreposição repete o fim do bloco anterior no início do próximo.
    for (let i = 1; i < chunks.length; i++) {
      const tail = chunks[i - 1].slice(-30).trim().split(/\s+/).slice(-3).join(" ");
      expect(chunks[i]).toContain(tail);
    }
    // Nenhum parágrafo se perde.
    const all = chunks.join("\n");
    for (let i = 1; i <= 12; i++) expect(all).toContain(`Parágrafo ${i}.`);
  });

  it("quebra frases gigantes sem espaço em fatias fixas", () => {
    const chunks = chunkText("x".repeat(2500), { size: 1000, overlap: 100 });
    expect(chunks.every((c) => c.length <= 1000)).toBe(true);
    expect(chunks.join("").replace(/\s/g, "").length).toBeGreaterThanOrEqual(2500);
  });

  it("rejeita sobreposição maior que o bloco", () => {
    expect(() => chunkText("abc", { size: 100, overlap: 100 })).toThrow();
  });
});

describe("limpeza de HTML", () => {
  const html = `<html><head><title>Pousada Alfa &amp; Cia</title><style>.x{}</style></head>
    <body><nav>Menu Início Contato</nav><h1>Bem-vindo</h1><p>Café das 7h&nbsp;às 10h.</p>
    <ul><li>Wi-Fi</li><li>Piscina</li></ul><script>alert(1)</script><footer>© 2026</footer></body></html>`;

  it("remove scripts, estilos, navegação e rodapé", () => {
    const text = htmlToText(html);
    expect(text).toContain("Bem-vindo");
    expect(text).toContain("Café das 7h às 10h.");
    expect(text).toContain("- Wi-Fi");
    expect(text).not.toMatch(/alert|\.x\{\}|Menu Início|© 2026/);
  });

  it("extrai o título", () => {
    expect(extractHtmlTitle(html)).toBe("Pousada Alfa & Cia");
  });

  it("decodifica acentos codificados como entidades (sites Duda/Wix)", () => {
    expect(htmlToText("<p>Acomoda&ccedil;&otilde;es &agrave; beira-mar &ndash; d&uacute;vidas? Ol&aacute;! &#233; &#xE7;</p>"))
      .toBe("Acomodações à beira-mar – dúvidas? Olá! é ç");
    expect(decodeEntities("&Aacute;rea &ecirc; &inexistente;")).toBe("Área ê &inexistente;");
  });
});
