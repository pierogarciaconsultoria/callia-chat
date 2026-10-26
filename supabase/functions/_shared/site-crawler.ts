// Leitura do site da empresa: percorre páginas do próprio domínio, respeitando robots.txt, com limite de páginas e tempo.
import { extractHtmlTitle, htmlToText } from "./knowledge.ts";
import { assertPublicHttpUrl } from "./net.ts";

export const CRAWLER_USER_AGENT = "CalliaChat-SiteReader/1.0 (+atendimento; lê o site para configurar o assistente)";

export interface CrawledPage {
  url: string;
  title: string | null;
  text: string;
}

export interface CrawlResult {
  pages: CrawledPage[];
  skipped: { robots: number; errors: number; nonHtml: number };
}

/** Páginas que costumam ter o que o atendimento precisa vêm primeiro. */
const PRIORITY = /sobre|quem-somos|about|historia|contato|contact|fale|quarto|acomoda|suite|chale|apartamento|room|tarifa|preco|valor|pacote|reserva|booking|politica|regra|termo|faq|duvida|pergunta|servico|estrutura|lazer|gastronomia|restaurante|cafe|localiza|como-chegar|endereco|pet|check|cardapio|menu|produto|loja|horario|funcionamento|pagamento/i;
const LOW_VALUE = /\/(tag|tags|categoria|category|author|autor|feed|wp-json|wp-admin|wp-login|login|entrar|cadastro|carrinho|cart|checkout|minha-conta|my-account|search|busca)(\/|$)|\/page\/\d+|\/\d{4}\/\d{2}\//i;
const NON_HTML = /\.(jpe?g|png|gif|webp|svg|ico|css|js|json|xml|zip|rar|mp4|mp3|webm|woff2?|ttf|eot|pdf|docx?|xlsx?|pptx?)$/i;

/** Mesmo site: compara o host ignorando "www.". */
export function sameSite(a: URL, b: URL): boolean {
  const strip = (h: string) => h.toLowerCase().replace(/^www\./, "");
  return strip(a.hostname) === strip(b.hostname);
}

/** URL canônica para deduplicar: sem fragmento, sem query, sem barra final (exceto raiz). */
export function canonicalUrl(raw: string, base?: string): string | null {
  try {
    const u = new URL(raw, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    u.search = "";
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "");
    return u.toString();
  } catch {
    return null;
  }
}

export function extractLinks(html: string, pageUrl: string): Array<{ url: string; text: string }> {
  const out: Array<{ url: string; text: string }> = [];
  const re = /<a\b[^>]*\bhref\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (/^(mailto|tel|javascript|whatsapp):/i.test(m[1])) continue;
    const url = canonicalUrl(m[1].replace(/&amp;/g, "&"), pageUrl);
    if (url) out.push({ url, text: m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) });
  }
  return out;
}

export function linkScore(url: string, anchorText = ""): number {
  const path = new URL(url).pathname;
  let score = 0;
  if (PRIORITY.test(path) || PRIORITY.test(anchorText)) score += 10;
  if (LOW_VALUE.test(path)) score -= 20;
  score -= path.split("/").filter(Boolean).length; // páginas rasas antes
  return score;
}

/** Regras de robots.txt para "*" e para o nosso agente (Disallow/Allow por prefixo; vence o padrão mais longo). */
export function parseRobots(text: string): { allow: string[]; disallow: string[]; sitemaps: string[] } {
  const rules = { allow: [] as string[], disallow: [] as string[], sitemaps: [] as string[] };
  let applies = false;
  let sawRuleInGroup = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "sitemap") {
      if (value) rules.sitemaps.push(value);
      continue;
    }
    if (key === "user-agent") {
      if (sawRuleInGroup) {
        applies = false;
        sawRuleInGroup = false;
      }
      const ua = value.toLowerCase();
      if (ua === "*" || ua.includes("calliachat")) applies = true;
      continue;
    }
    if (key === "allow" || key === "disallow") {
      sawRuleInGroup = true;
      if (applies && value) (key === "allow" ? rules.allow : rules.disallow).push(value);
    }
  }
  return rules;
}

export function robotsAllows(rules: { allow: string[]; disallow: string[] }, path: string): boolean {
  // "*" = qualquer sequência; "$" no fim = fim da URL.
  const matches = (pattern: string) => {
    const anchored = pattern.endsWith("$");
    const body = anchored ? pattern.slice(0, -1) : pattern;
    const re = new RegExp("^" + body.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + (anchored ? "$" : ""));
    return re.test(path);
  };
  const d = rules.disallow.filter(matches).sort((a, b) => b.length - a.length)[0];
  if (!d) return true;
  const a = rules.allow.filter(matches).sort((x, y) => y.length - x.length)[0];
  return Boolean(a && a.length >= d.length);
}

export function sitemapUrls(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
}

/** Contatos e textos de exemplo que construtores de site deixam no modelo (nunca são dados reais). */
const PLACEHOLDER = /555[-. ]?555[-. ]?5555|\b(meu|seu|your)e?-?mail@(e-?mail|email|exemplo|example)\.|@(exemplo|example)\.(com|org)|\bemail@email\.|lorem ipsum|\(00\)\s?0000|0000[-. ]0000|123[-. ]?456[-. ]?7890/i;

export function isPlaceholderLine(line: string): boolean {
  return PLACEHOLDER.test(line);
}

/**
 * Remove o que se repete em quase todas as páginas (menu, cabeçalho, rodapé, widgets) e linhas de modelo.
 * O que é comum e útil (endereço, telefone reais) fica uma vez só, numa página "Informações comuns do site".
 */
export function cleanPages(pages: CrawledPage[]): CrawledPage[] {
  const norm = (l: string) => l.trim().replace(/\s+/g, " ").toLowerCase();
  const linesOf = (p: CrawledPage) => p.text.split("\n").map((l) => l.trim()).filter(Boolean);
  const threshold = pages.length >= 3 ? Math.ceil(pages.length * 0.6) : Infinity;
  const count = new Map<string, number>();
  for (const p of pages) for (const l of new Set(linesOf(p).map(norm))) count.set(l, (count.get(l) ?? 0) + 1);
  const isBoilerplate = (l: string) => l.length <= 300 && (count.get(norm(l)) ?? 0) >= threshold;

  const shared: string[] = [];
  const seenShared = new Set<string>();
  const cleaned = pages.map((p) => {
    const kept: string[] = [];
    for (const line of linesOf(p)) {
      if (isPlaceholderLine(line)) continue;
      if (isBoilerplate(line)) {
        if (!seenShared.has(norm(line))) {
          seenShared.add(norm(line));
          shared.push(line);
        }
        continue;
      }
      kept.push(line);
    }
    return { ...p, text: kept.join("\n") };
  }).filter((p) => p.text.length >= 40);

  const sharedText = shared.join("\n");
  if (sharedText.length >= 40) cleaned.push({ url: pages[0].url, title: "Informações comuns do site", text: sharedText });
  return cleaned;
}

export async function crawlSite(
  startUrl: string,
  opts: { maxPages?: number; fetchImpl?: typeof fetch; timeoutMs?: number; deadlineMs?: number; concurrency?: number } = {},
): Promise<CrawlResult> {
  const maxPages = Math.min(Math.max(1, opts.maxPages ?? 20), 40);
  const doFetch = opts.fetchImpl ?? fetch;
  const deadline = Date.now() + (opts.deadlineMs ?? 120_000);
  const start = new URL(canonicalUrl(assertPublicHttpUrl(startUrl))!);
  const result: CrawlResult = { pages: [], skipped: { robots: 0, errors: 0, nonHtml: 0 } };

  const get = async (url: string, accept = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1") => {
    try {
      const res = await doFetch(url, {
        headers: { "User-Agent": CRAWLER_USER_AGENT, Accept: accept, "Accept-Language": "pt-BR,pt;q=0.9" },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 12_000),
        redirect: "follow",
      });
      return res;
    } catch {
      return null;
    }
  };

  let robots = { allow: [] as string[], disallow: [] as string[], sitemaps: [] as string[] };
  const robotsRes = await get(`${start.origin}/robots.txt`, "text/plain");
  if (robotsRes?.ok) robots = parseRobots((await robotsRes.text()).slice(0, 200_000));
  else await robotsRes?.body?.cancel();

  const seen = new Set<string>();
  const queue: Array<{ url: string; score: number }> = [];
  const enqueue = (url: string, anchor = "", bonus = 0) => {
    const canon = canonicalUrl(url);
    if (!canon || seen.has(canon)) return;
    const u = new URL(canon);
    if (!sameSite(u, start) || NON_HTML.test(u.pathname)) return;
    seen.add(canon);
    queue.push({ url: canon, score: linkScore(canon, anchor) + bonus });
  };
  enqueue(start.toString(), "", 1000);

  // Sitemap ajuda a achar páginas que não estão no menu.
  for (const sm of (robots.sitemaps.length ? robots.sitemaps : [`${start.origin}/sitemap.xml`]).slice(0, 2)) {
    const smRes = await get(sm, "application/xml,text/xml");
    if (!smRes?.ok) {
      await smRes?.body?.cancel();
      continue;
    }
    const locs = sitemapUrls((await smRes.text()).slice(0, 2_000_000));
    const nested = locs.filter((l) => /\.xml(\.gz)?$/i.test(l)).slice(0, 3);
    for (const n of nested) {
      const nRes = await get(n, "application/xml,text/xml");
      if (nRes?.ok) sitemapUrls((await nRes.text()).slice(0, 2_000_000)).slice(0, 300).forEach((l) => enqueue(l));
      else await nRes?.body?.cancel();
    }
    locs.filter((l) => !/\.xml(\.gz)?$/i.test(l)).slice(0, 300).forEach((l) => enqueue(l));
  }

  const textHashes = new Set<string>();
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  while (queue.length && result.pages.length < maxPages && Date.now() < deadline) {
    queue.sort((a, b) => b.score - a.score);
    const batch = queue.splice(0, Math.min(concurrency, maxPages - result.pages.length));
    await Promise.all(batch.map(async ({ url }) => {
      const path = new URL(url).pathname;
      if (!robotsAllows(robots, path)) {
        result.skipped.robots++;
        return;
      }
      const res = await get(url);
      if (!res?.ok) {
        await res?.body?.cancel();
        result.skipped.errors++;
        return;
      }
      // Redirecionamento para fora do site ou para a rede interna é descartado.
      try {
        const finalUrl = new URL(res.url || url);
        if (!sameSite(finalUrl, start)) throw new Error("fora do site");
        assertPublicHttpUrl(finalUrl.toString());
      } catch {
        await res.body?.cancel();
        result.skipped.errors++;
        return;
      }
      if (!(res.headers.get("content-type") ?? "text/html").includes("html")) {
        await res.body?.cancel();
        result.skipped.nonHtml++;
        return;
      }
      const html = (await res.text()).slice(0, 3_000_000);
      const text = htmlToText(html);
      // Mesma página publicada em dois endereços entra uma vez só.
      if (text.length >= 80 && !textHashes.has(text) && result.pages.length < maxPages) {
        textHashes.add(text);
        result.pages.push({ url, title: extractHtmlTitle(html), text });
      }
      for (const link of extractLinks(html, url)) enqueue(link.url, link.text);
    }));
  }
  result.pages = cleanPages(result.pages);
  return result;
}
