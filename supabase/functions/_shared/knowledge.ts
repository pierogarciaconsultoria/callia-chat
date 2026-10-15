// @ts-nocheck
// Pure text helpers shared by the knowledge-index edge function and its tests.
export const CHUNK_SIZE = 700;
export const CHUNK_OVERLAP = 150;

export function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// Paragraphs first, then a sliding window for anything longer than the budget,
// so a chunk never starts in the middle of a short paragraph.
export function chunkText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const clean = (text ?? "").replace(/\r\n/g, "\n").trim();
  if (!clean) return [];

  const paragraphs = clean.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const blocks: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph.length <= size) {
      blocks.push(paragraph);
      continue;
    }

    const words = paragraph.split(/\s+/);
    let current = "";

    for (const word of words) {
      if (current && `${current} ${word}`.length > size) {
        blocks.push(current);
        // Keep the tail of the previous window so a fact cut in half still
        // appears in full in one of the two neighbours.
        const tail = current.slice(Math.max(0, current.length - overlap));
        current = `${tail} ${word}`.trim();
        continue;
      }
      current = current ? `${current} ${word}` : word;
    }

    if (current) blocks.push(current);
  }

  // Merge tiny neighbours so the catalog of a short page does not become
  // twenty chunks of thirty characters.
  const merged: string[] = [];
  for (const block of blocks) {
    const last = merged[merged.length - 1];
    if (last !== undefined && `${last} ${block}`.length <= size) {
      merged[merged.length - 1] = `${last} ${block}`;
      continue;
    }
    merged.push(block);
  }

  return merged.map((content, position) => ({ content, position }));
}
