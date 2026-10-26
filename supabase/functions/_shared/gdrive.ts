// Google Drive: lê uma pasta compartilhada ("Qualquer pessoa com o link") e baixa as fotos já redimensionadas.
// Sem chave: usa a visualização incorporável pública da pasta. Com GOOGLE_DRIVE_API_KEY: usa a Drive API v3.
import { RuntimeError } from "./http.ts";

export interface DriveEntry {
  id: string;
  name: string;
  isFolder: boolean;
}

export interface DriveImage {
  id: string;
  name: string;
  album: string;
}

const IMAGE_EXT = /\.(jpe?g|png|webp|heic|heif|gif|bmp|tiff?)$/i;

export function parseDriveFolderId(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim();
  const m = /\/folders\/([A-Za-z0-9_-]{10,})/.exec(raw) ?? /[?&]id=([A-Za-z0-9_-]{10,})/.exec(raw);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{20,}$/.test(raw) ? raw : null;
}

function decode(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}

/** Itens da página pública embeddedfolderview (cada item é um "flip-entry"). */
export function parseEmbeddedFolder(html: string): DriveEntry[] {
  const out: DriveEntry[] = [];
  const re = /<div[^>]+class="flip-entry"[^>]*id="entry-([A-Za-z0-9_-]+)"[\s\S]*?<a[^>]+href="([^"]+)"[\s\S]*?<div class="flip-entry-title">([\s\S]*?)<\/div>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    out.push({ id: m[1], name: decode(m[3].replace(/<[^>]+>/g, "")), isFolder: /\/folders\//.test(m[2]) });
  }
  return out;
}

export interface DriveOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  embedBase?: string;
  apiBase?: string;
  thumbBase?: string;
}

async function listFolder(folderId: string, opts: DriveOptions): Promise<DriveEntry[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  if (opts.apiKey) {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
    const url = `${opts.apiBase ?? "https://www.googleapis.com/drive/v3"}/files?q=${q}&fields=files(id,name,mimeType)&pageSize=1000&key=${opts.apiKey}`;
    const res = await doFetch(url, { signal: AbortSignal.timeout(15_000) });
    if (res.status === 404 || res.status === 403) {
      await res.body?.cancel();
      throw new RuntimeError("unprocessable", "Pasta não encontrada ou não compartilhada. Use Compartilhar → \"Qualquer pessoa com o link\".");
    }
    if (!res.ok) throw new RuntimeError("upstream_unavailable", "Google Drive indisponível.", { status: res.status });
    const body = await res.json();
    return (body.files ?? []).map((f: { id: string; name: string; mimeType: string }) => ({
      id: f.id,
      name: f.name,
      isFolder: f.mimeType === "application/vnd.google-apps.folder",
    }));
  }
  const res = await doFetch(`${opts.embedBase ?? "https://drive.google.com"}/embeddedfolderview?id=${encodeURIComponent(folderId)}`, {
    headers: { Accept: "text/html", "Accept-Language": "pt-BR,pt;q=0.9" },
    signal: AbortSignal.timeout(15_000),
    redirect: "follow",
  });
  if (!res.ok || /accounts\.google\.com/.test(res.url)) {
    await res.body?.cancel();
    throw new RuntimeError("unprocessable", "Não foi possível abrir a pasta. Confira se ela está compartilhada como \"Qualquer pessoa com o link\".", { status: res.status });
  }
  return parseEmbeddedFolder(await res.text());
}

/** Fotos da pasta: subpastas viram álbuns; fotos soltas na raiz vão para o álbum com o nome da pasta (ou "Geral"). */
export async function collectDriveImages(folderId: string, opts: DriveOptions & { rootAlbum?: string; limit?: number } = {}): Promise<DriveImage[]> {
  const limit = opts.limit ?? 200;
  const root = await listFolder(folderId, opts);
  if (!root.length) {
    throw new RuntimeError("unprocessable", "A pasta está vazia ou não está compartilhada como \"Qualquer pessoa com o link\".");
  }
  const images: DriveImage[] = [];
  const add = (entries: DriveEntry[], album: string) => {
    for (const e of entries) if (!e.isFolder && IMAGE_EXT.test(e.name) && images.length < limit) images.push({ id: e.id, name: e.name, album });
  };
  add(root, opts.rootAlbum ?? "Geral");
  for (const folder of root.filter((e) => e.isFolder).slice(0, 40)) {
    if (images.length >= limit) break;
    const children = await listFolder(folder.id, opts);
    add(children, folder.name);
    // Um nível a mais é achatado no álbum da subpasta.
    for (const sub of children.filter((e) => e.isFolder).slice(0, 10)) {
      if (images.length >= limit) break;
      add(await listFolder(sub.id, opts), folder.name);
    }
  }
  return images;
}

/** Baixa a foto como JPEG/PNG com lado maior até 1600 px (o Google converte HEIC e reduz o tamanho). */
export async function downloadDriveImage(fileId: string, opts: DriveOptions = {}): Promise<{ bytes: Uint8Array; mime: string }> {
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(`${opts.thumbBase ?? "https://drive.google.com"}/thumbnail?id=${encodeURIComponent(fileId)}&sz=w1600`, {
    signal: AbortSignal.timeout(20_000),
    redirect: "follow",
  });
  const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!res.ok || !mime.startsWith("image/")) {
    await res.body?.cancel();
    throw new RuntimeError("unprocessable", "Foto não acessível (arquivo privado?).", { status: res.status });
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > 5 * 1024 * 1024) throw new RuntimeError("unprocessable", "Foto acima de 5 MB.");
  return { bytes, mime: mime === "image/jpg" ? "image/jpeg" : mime };
}
