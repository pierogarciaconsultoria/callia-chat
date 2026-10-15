import { describe, expect, it } from "vitest";
// @ts-ignore - Deno edge module with pure logic, no Deno APIs
import { chunkText, stripHtml } from "../../supabase/functions/_shared/knowledge.ts";

describe("knowledge chunking", () => {
  it("ignora texto vazio", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n  ")).toEqual([]);
  });

  it("mantem paragrafos curtos juntos ate o limite do trecho", () => {
    const chunks = chunkText("Politica de cancelamento.\n\nReembolso em ate 7 dias.");

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe("Politica de cancelamento. Reembolso em ate 7 dias.");
    expect(chunks[0].position).toBe(0);
  });

  it("divide texto longo com sobreposicao e numerera as posicoes", () => {
    const long = Array.from({ length: 400 }, (_, index) => `palavra${index}`).join(" ");
    const chunks = chunkText(long, 200, 50);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.content.length <= 200)).toBe(true);
    expect(chunks.map((chunk) => chunk.position)).toEqual(
      chunks.map((_, index) => index),
    );

    const tailOfFirst = chunks[0].content.split(" ").slice(-3).join(" ");
    expect(chunks[1].content).toContain(tailOfFirst);
  });

  it("limpa html antes da indexacao", () => {
    expect(
      stripHtml("<div><script>var a=1;</script><p>Ola &nbsp;mundo</p></div>"),
    ).toBe("Ola mundo");
  });
});
