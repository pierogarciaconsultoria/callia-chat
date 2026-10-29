// Respostas rápidas: atalho "/pix" no campo de mensagem, filtro da lista e variáveis do texto. Funções puras.
import type { QuickReply } from "@/lib/database.types";

export const SHORTCUT_RE = /^[a-z0-9][a-z0-9_-]{1,29}$/;
export const QUICK_REPLY_VARIABLES = ["{nome}", "{primeiro_nome}"] as const;

/** "/Chave PIX" → "chave-pix"; acentos e espaços viram hífen. Vazio quando não sobra nada. */
export function normalizeShortcut(raw: string): string {
  return raw
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/^\/+/, "").trim()
    .replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

/** O campo de mensagem está pedindo uma resposta rápida? Só quando o texto inteiro é "/algo" sem quebra de linha. */
export function slashQuery(text: string): string | null {
  const m = /^\/([^\s/]*)$/.exec(text);
  return m ? m[1].toLowerCase() : null;
}

/** Filtra por atalho ou título; atalho que começa com a busca vem primeiro. */
export function filterQuickReplies<T extends Pick<QuickReply, "shortcut" | "title" | "content">>(list: T[], query: string, limit = 8): T[] {
  const q = query.trim().toLowerCase();
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const scored = list
    .map((r) => {
      const shortcut = r.shortcut.toLowerCase();
      const title = norm(r.title);
      const score = !q ? 1 : shortcut.startsWith(q) ? 3 : title.startsWith(norm(q)) ? 2 : shortcut.includes(q) || title.includes(norm(q)) || norm(r.content).includes(norm(q)) ? 1 : 0;
      return { r, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.r.shortcut.localeCompare(b.r.shortcut));
  return scored.slice(0, limit).map((x) => x.r);
}

/** Troca {nome} e {primeiro_nome} pelo contato; sem nome, a variável sai e sobra o texto limpo. */
export function renderQuickReply(content: string, contact: { name?: string | null }): string {
  const name = contact.name?.trim() ?? "";
  const first = name.split(/\s+/)[0] ?? "";
  return content
    .replace(/\{nome\}/gi, name)
    .replace(/\{primeiro_nome\}/gi, first)
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[ \t]+|[ \t]+$/gm, "")
    .replace(/ ([,.!?;:])/g, "$1");
}
