// Instagram: leitura só do que é público, sem login nem disfarce. Se a plataforma bloquear, usa o texto colado pelo admin.

export function parseInstagramHandle(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  const fromUrl = /instagram\.com\/([A-Za-z0-9._]{1,30})/i.exec(raw)?.[1];
  const handle = (fromUrl ?? raw.replace(/^@/, "")).replace(/\/+$/, "");
  if (!/^[A-Za-z0-9._]{1,30}$/.test(handle) || ["p", "reel", "reels", "stories", "explore", "accounts"].includes(handle.toLowerCase())) return null;
  return handle.toLowerCase();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, c) => String.fromCodePoint(Number(c)))
    .replace(/&#x([0-9a-f]+);/gi, (_, c) => String.fromCodePoint(parseInt(c, 16)));
}

function meta(html: string, attr: "property" | "name", key: string): string | null {
  const re = new RegExp(`<meta[^>]+${attr}=["']${key}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*${attr}=["']${key}["']`, "i");
  const m = re.exec(html);
  const value = m?.[1] ?? m?.[2];
  return value ? decodeEntities(value).trim() : null;
}

/** Extrai nome, resumo público e bio (quando presente) das metatags da página pública do perfil. */
export function parseInstagramMeta(html: string): { title: string | null; summary: string | null; bio: string | null } {
  const title = meta(html, "property", "og:title");
  const description = meta(html, "property", "og:description") ?? meta(html, "name", "description");
  // Formato comum: '... on Instagram: "bio"' / '... no Instagram: "bio"'
  const bio = description ? /Instagram:\s*["“](.+)["”]\s*$/s.exec(description)?.[1]?.trim() ?? null : null;
  return { title, summary: description, bio };
}

export async function fetchInstagramProfile(
  handle: string,
  opts: { fetchImpl?: typeof fetch; baseUrl?: string } = {},
): Promise<{ fetched: boolean; text: string | null; note: string | null }> {
  const base = (opts.baseUrl ?? "https://www.instagram.com").replace(/\/$/, "");
  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(`${base}/${handle}/`, {
      headers: { "User-Agent": "CalliaChat-SiteReader/1.0", Accept: "text/html", "Accept-Language": "pt-BR,pt;q=0.9" },
      signal: AbortSignal.timeout(12_000),
      redirect: "follow",
    });
  } catch {
    return { fetched: false, text: null, note: "Não foi possível acessar o Instagram agora." };
  }
  if (!res.ok || /\/accounts\/login/.test(res.url)) {
    await res.body?.cancel();
    return { fetched: false, text: null, note: `O Instagram não liberou a leitura pública do perfil (HTTP ${res.status}). Cole a bio e os destaques.` };
  }
  const { title, summary, bio } = parseInstagramMeta((await res.text()).slice(0, 2_000_000));
  if (!title && !summary) return { fetched: false, text: null, note: "O Instagram não mostrou dados públicos do perfil. Cole a bio e os destaques." };
  const lines = [title && `Perfil: ${title}`, bio && `Bio: ${bio}`, summary && !bio && `Resumo público: ${summary}`].filter(Boolean);
  return {
    fetched: true,
    text: lines.join("\n"),
    note: bio ? null : "Só foi possível ler o resumo público (sem a bio completa). Colar a bio e os destaques melhora o resultado.",
  };
}
