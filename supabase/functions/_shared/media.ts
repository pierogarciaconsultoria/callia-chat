// Fotos do workspace: álbuns por acomodação/área, gravação no bucket público "media" e importadores (Drive, Hospedin).
import { RuntimeError } from "./http.ts";
import { collectDriveImages, downloadDriveImage, type DriveOptions } from "./gdrive.ts";
import type { HospedinClient } from "./hospedin.ts";
import type { Db } from "./supabase.ts";

export const MAX_PHOTOS_PER_SEND = 5;
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export interface AlbumSummary {
  name: string;
  product_id: string | null;
  /** Nome do item do catálogo ligado (fonte única quando há ligação). */
  product_name?: string | null;
  /** O que mostrar: o nome do catálogo se ligado, senão o nome do álbum. */
  display_name?: string;
  count: number;
  cover_url: string | null;
}

export function normalizeName(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Nome limpo de álbum a partir de pasta/categoria (remove numeração tipo "01 - "). */
export function cleanAlbumName(raw: string): string {
  return raw.replace(/^\s*\d+\s*[-_.)]\s*/, "").replace(/\s+/g, " ").trim().slice(0, 80) || "Geral";
}

/**
 * Acha o álbum pedido: igual, contido ("família" → "Apto Família") ou com mais palavras em comum.
 * Retorna null se nada for parecido.
 */
export function matchAlbum(query: string, albums: string[]): string | null {
  const q = normalizeName(query);
  if (!q) return null;
  const exact = albums.find((a) => normalizeName(a) === q);
  if (exact) return exact;
  const contained = albums.find((a) => normalizeName(a).includes(q) || q.includes(normalizeName(a)));
  if (contained) return contained;
  const words = new Set(q.split(" ").filter((w) => w.length >= 3 && !["apto", "apartamento", "fotos", "foto", "quarto", "para"].includes(w)));
  let best: { album: string; score: number } | null = null;
  for (const a of albums) {
    const score = normalizeName(a).split(" ").filter((w) => words.has(w)).length;
    if (score > 0 && (!best || score > best.score)) best = { album: a, score };
  }
  return best?.album ?? null;
}

const GENERIC_WORDS = new Set(["apartamento", "apartamentos", "apto", "aptos", "pessoas", "pessoa", "ate", "para", "com", "casal", "crianca", "anos"]);

/**
 * Álbuns citados num texto: os números do nome ("205 e 206") ou, sem números, as palavras distintivas ("Verdes Mares").
 * Usa só a parte antes de " - " (ex.: "Apartamento 205 e 206 - Até 4 pessoas" → "Apartamento 205 e 206").
 */
export function mentionedAlbums(text: string, albums: string[]): string[] {
  const t = ` ${normalizeName(text)} `;
  return albums.filter((album) => {
    const key = normalizeName(album.split(" - ")[0].replace(/\([^)]*\)/g, " "));
    const numbers = key.match(/\d+/g) ?? [];
    if (numbers.length) return numbers.every((n) => t.includes(` ${n} `));
    const words = key.split(" ").filter((w) => w.length >= 4 && !GENERIC_WORDS.has(w));
    return words.length > 0 && words.every((w) => t.includes(` ${w} `));
  });
}

/**
 * Fotos como a MarIA as vê: álbuns ligados ao catálogo são agrupados e nomeados pelo item do catálogo
 * (duas pastas do mesmo apartamento viram uma opção só); os demais pelo nome do álbum.
 */
export function photoGroups(rows: Array<{ album: string; product_id: string | null; product_name: string | null }>) {
  const groups = new Map<string, { name: string; product_id: string | null; albums: Set<string>; count: number }>();
  for (const r of rows) {
    const linked = Boolean(r.product_id && r.product_name);
    const key = linked ? `p:${r.product_id}` : `a:${r.album}`;
    const g = groups.get(key) ?? { name: linked ? r.product_name! : r.album, product_id: linked ? r.product_id : null, albums: new Set<string>(), count: 0 };
    g.albums.add(r.album);
    g.count++;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export function groupAlbums(assets: Array<{ album: string; product_id: string | null; public_url: string; position: number }>): AlbumSummary[] {
  const map = new Map<string, AlbumSummary & { minPos: number }>();
  for (const a of assets) {
    const cur = map.get(a.album);
    if (!cur) map.set(a.album, { name: a.album, product_id: a.product_id, count: 1, cover_url: a.public_url, minPos: a.position });
    else {
      cur.count++;
      cur.product_id ??= a.product_id;
      if (a.position < cur.minPos) {
        cur.minPos = a.position;
        cur.cover_url = a.public_url;
      }
    }
  }
  return [...map.values()].sort((x, y) => x.name.localeCompare(y.name, "pt-BR")).map(({ minPos: _m, ...rest }) => rest);
}

function env(name: string): string | undefined {
  // deno-lint-ignore no-explicit-any
  return (globalThis as any).Deno?.env?.get(name) || undefined;
}

export function publicMediaUrl(path: string): string {
  const base = (env("SUPABASE_PUBLIC_URL") ?? env("SUPABASE_URL") ?? "").replace(/\/$/, "");
  return `${base}/storage/v1/object/public/media/${path}`;
}

export async function storeImage(
  db: Db,
  workspaceId: string,
  file: { bytes: Uint8Array; mime: string },
  meta: { album: string; product_id?: string | null; caption?: string | null; source: "drive" | "hospedin"; source_ref: string; position: number },
): Promise<"imported" | "skipped"> {
  const { data: existing } = await db.from("media_assets").select("id").eq("workspace_id", workspaceId).eq("source", meta.source).eq("source_ref", meta.source_ref).maybeSingle();
  if (existing) return "skipped";
  const ext = EXT[file.mime];
  if (!ext) throw new RuntimeError("unprocessable", `Formato não suportado: ${file.mime}.`);
  const path = `${workspaceId}/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await db.storage.from("media").upload(path, file.bytes, { contentType: file.mime, upsert: false });
  if (upErr) throw new RuntimeError("internal_error", "Falha ao gravar a foto.", { storage: upErr.message });
  const { error } = await db.from("media_assets").insert({
    workspace_id: workspaceId,
    album: meta.album,
    product_id: meta.product_id ?? null,
    caption: meta.caption ?? null,
    storage_path: path,
    public_url: publicMediaUrl(path),
    mime_type: file.mime,
    size_bytes: file.bytes.length,
    source: meta.source,
    source_ref: meta.source_ref,
    position: meta.position,
  });
  if (error?.code === "23505") {
    await db.storage.from("media").remove([path]);
    return "skipped";
  }
  if (error) throw new RuntimeError("internal_error", "Falha ao registrar a foto.", { db: error.message });
  return "imported";
}

/** Liga álbuns a produtos do catálogo pelo nome (ex.: subpasta "Apto Família" ↔ produto "Apto Família"). */
async function productIndex(db: Db, workspaceId: string): Promise<(album: string) => string | null> {
  const { data } = await db.from("products").select("id, name").eq("workspace_id", workspaceId);
  const products = (data ?? []) as Array<{ id: string; name: string }>;
  return (album) => {
    const name = matchAlbum(album, products.map((p) => p.name));
    return name ? products.find((p) => p.name === name)!.id : null;
  };
}

type ImportItem = { album: string; ref: string; caption?: string | null; load: () => Promise<{ bytes: Uint8Array; mime: string }> };

async function runImport(db: Db, importId: string, workspaceId: string, source: "drive" | "hospedin", items: ImportItem[]) {
  const productFor = await productIndex(db, workspaceId);
  const { data: existing } = await db.from("media_assets").select("album, position").eq("workspace_id", workspaceId);
  const positions = new Map<string, number>();
  for (const a of (existing ?? []) as Array<{ album: string; position: number }>) positions.set(a.album, Math.max(positions.get(a.album) ?? 0, a.position + 1));
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];
  await db.from("media_imports").update({ total: items.length }).eq("id", importId);
  for (const item of items) {
    try {
      const pos = positions.get(item.album) ?? 0;
      const result = await storeImage(db, workspaceId, await item.load(), {
        album: item.album, product_id: productFor(item.album), caption: item.caption ?? null, source, source_ref: item.ref, position: pos,
      });
      if (result === "imported") {
        imported++;
        positions.set(item.album, pos + 1);
      } else skipped++;
    } catch (err) {
      skipped++;
      if (errors.length < 5) errors.push(err instanceof Error ? err.message : String(err));
    }
    if ((imported + skipped) % 5 === 0) await db.from("media_imports").update({ imported, skipped }).eq("id", importId);
  }
  await db.from("media_imports").update({
    status: imported === 0 && errors.length > 0 ? "failed" : "done",
    imported,
    skipped,
    error: errors.length ? errors.join(" | ").slice(0, 500) : null,
    finished_at: new Date().toISOString(),
  }).eq("id", importId);
}

async function failImport(db: Db, importId: string, err: unknown) {
  await db.from("media_imports").update({
    status: "failed",
    error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
    finished_at: new Date().toISOString(),
  }).eq("id", importId);
}

/** Pasta do Drive: subpastas viram álbuns; reimportar não duplica (source_ref = id do arquivo). */
export async function importFromDrive(db: Db, importId: string, workspaceId: string, folderId: string, opts: DriveOptions = {}) {
  try {
    const images = await collectDriveImages(folderId, opts);
    if (!images.length) throw new RuntimeError("unprocessable", "Nenhuma foto encontrada na pasta (JPG, PNG, WEBP ou HEIC).");
    await runImport(db, importId, workspaceId, "drive", images.map((img) => ({
      album: cleanAlbumName(img.album),
      ref: img.id,
      load: () => downloadDriveImage(img.id, opts),
    })));
  } catch (err) {
    await failImport(db, importId, err);
  }
}

/** Fotos das categorias do Hospedin: um álbum por categoria. */
export async function importFromHospedin(db: Db, importId: string, workspaceId: string, client: HospedinClient, accountId: string, fetchImpl: typeof fetch = fetch) {
  try {
    const placeTypes = await client.placeTypes(accountId);
    const items: ImportItem[] = placeTypes.flatMap((p) => (p.attachments ?? []).filter((a) => a?.file).slice(0, 15).map((a) => ({
      album: cleanAlbumName(p.title),
      ref: `${p.id}:${a.id}`,
      load: async () => {
        const res = await fetchImpl(a.file, { signal: AbortSignal.timeout(20_000), redirect: "follow" });
        const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim().replace("image/jpg", "image/jpeg");
        if (!res.ok || !EXT[mime]) {
          await res.body?.cancel();
          throw new RuntimeError("unprocessable", `Foto do Hospedin inacessível (${res.status}).`);
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.length > 5 * 1024 * 1024) throw new RuntimeError("unprocessable", "Foto do Hospedin acima de 5 MB.");
        return { bytes, mime };
      },
    })));
    if (!items.length) throw new RuntimeError("unprocessable", "As categorias do Hospedin não têm fotos cadastradas.");
    await runImport(db, importId, workspaceId, "hospedin", items);
  } catch (err) {
    await failImport(db, importId, err);
  }
}
