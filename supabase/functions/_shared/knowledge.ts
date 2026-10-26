// Base de conhecimento: limpeza de texto, chunking com sobreposição e busca híbrida.
import type { AiProvider } from "./ai.ts";
import { toPgVector } from "./ai.ts";
import type { KnowledgeHit } from "./agent-core.ts";

// Entidades nomeadas comuns em sites brasileiros (construtores como Duda e Wix codificam todos os acentos).
const ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  ccedil: "ç", Ccedil: "Ç", ntilde: "ñ", Ntilde: "Ñ", ordm: "º", ordf: "ª", deg: "°", sup2: "²", sup3: "³",
  ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", sbquo: "‚", bdquo: "„", hellip: "…",
  bull: "•", middot: "·", laquo: "«", raquo: "»", lsaquo: "‹", rsaquo: "›", copy: "©", reg: "®", trade: "™",
  euro: "€", cent: "¢", pound: "£", times: "×", divide: "÷", frac12: "½", iexcl: "¡", iquest: "¿", szlig: "ß", shy: "",
};
// Vogais acentuadas: aacute, Agrave, ecirc, otilde, uuml…
for (const [mark, marks] of Object.entries({ acute: "\u0301", grave: "\u0300", circ: "\u0302", tilde: "\u0303", uml: "\u0308" })) {
  for (const v of "aeiouyAEIOUY") ENTITIES[`${v}${mark}`] = (v + marks).normalize("NFC");
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z][a-z0-9]{1,10});/gi, (m, name) => ENTITIES[name] ?? m);
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|iframe|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(nav|footer|header)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z0-9#]+;/gi, (m) => decodeEntities(m))
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractHtmlTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? htmlToText(m[1]).slice(0, 200) || null : null;
}

export interface ChunkOptions {
  size?: number;
  overlap?: number;
}

/**
 * Divide em blocos de até `size` caracteres respeitando parágrafos e frases.
 * Cada bloco começa com o final (`overlap` caracteres) do anterior para não perder contexto na fronteira.
 */
export function chunkText(input: string, { size = 1200, overlap = 200 }: ChunkOptions = {}): string[] {
  if (overlap >= size) throw new Error("overlap deve ser menor que size");
  const text = input.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) return [];
  if (text.length <= size) return [text];

  // Unidades: parágrafos; parágrafos grandes viram frases; frases enormes viram fatias fixas.
  const units: string[] = [];
  for (const para of text.split(/\n{2,}/)) {
    if (para.length <= size) {
      units.push(para);
      continue;
    }
    for (const sentence of para.split(/(?<=[.!?…])\s+/)) {
      if (sentence.length <= size) units.push(sentence);
      else for (let i = 0; i < sentence.length; i += size - overlap) units.push(sentence.slice(i, i + size - overlap));
    }
  }

  const chunks: string[] = [];
  let current = "";
  for (const unit of units) {
    const candidate = current ? `${current}\n\n${unit}` : unit;
    if (candidate.length <= size) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    const tail = overlapTail(current, overlap);
    current = tail && tail.length + unit.length + 2 <= size ? `${tail}\n\n${unit}` : unit;
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Final do bloco anterior, começando numa fronteira de palavra. */
function overlapTail(chunk: string, overlap: number): string {
  if (!chunk || overlap <= 0) return "";
  if (chunk.length <= overlap) return chunk;
  const slice = chunk.slice(-overlap);
  const firstSpace = slice.search(/\s/);
  return (firstSpace > 0 ? slice.slice(firstSpace + 1) : slice).trim();
}

// deno-lint-ignore no-explicit-any
type Db = any;

export async function searchKnowledge(
  db: Db,
  ai: AiProvider | null,
  workspaceId: string,
  query: string,
  limit = 5,
): Promise<{ mode: "hybrid" | "keyword"; results: KnowledgeHit[] }> {
  const q = query.trim().slice(0, 1000);
  if (!q) return { mode: "keyword", results: [] };
  let embedding: string | null = null;
  if (ai?.embeddingsEnabled) {
    try {
      embedding = toPgVector((await ai.embed([q]))[0]);
    } catch (err) {
      // Sem embedding a busca segue só por palavra-chave.
      console.warn(JSON.stringify({ level: "warn", msg: "embedding_failed", error: String(err) }));
    }
  }
  const { data, error } = await db.rpc("knowledge_search", {
    p_workspace_id: workspaceId,
    p_query: q,
    p_query_embedding: embedding,
    p_limit: limit,
  });
  if (error) throw new Error(`knowledge_search: ${error.message}`);
  return { mode: embedding ? "hybrid" : "keyword", results: (data ?? []) as KnowledgeHit[] };
}
