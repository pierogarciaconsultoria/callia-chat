import { describe, expect, it } from "vitest";
import { filterQuickReplies, normalizeShortcut, renderQuickReply, slashQuery } from "@/lib/quick-replies";

const list = [
  { shortcut: "pix", title: "Chave PIX", content: "Nossa chave PIX é o CNPJ." },
  { shortcut: "endereco", title: "Endereço", content: "Rua das Flores, 100." },
  { shortcut: "checkin", title: "Horários de check-in", content: "Check-in a partir das 14h." },
];

describe("respostas rápidas (helpers)", () => {
  it("normaliza o atalho: sem barra, sem acento, sem espaço", () => {
    expect(normalizeShortcut("/Chave PIX")).toBe("chave-pix");
    expect(normalizeShortcut("endereço")).toBe("endereco");
    expect(normalizeShortcut("  --x-- ")).toBe("x");
  });

  it("só abre a lista quando o campo inteiro é /algo", () => {
    expect(slashQuery("/")).toBe("");
    expect(slashQuery("/pi")).toBe("pi");
    expect(slashQuery("oi /pix")).toBeNull();
    expect(slashQuery("/pix com legenda")).toBeNull();
    expect(slashQuery("")).toBeNull();
  });

  it("filtra por atalho ou título, com atalho exato primeiro", () => {
    expect(filterQuickReplies(list, "").map((r) => r.shortcut)).toEqual(["checkin", "endereco", "pix"]);
    expect(filterQuickReplies(list, "pi").map((r) => r.shortcut)).toEqual(["pix"]);
    expect(filterQuickReplies(list, "hor").map((r) => r.shortcut)).toEqual(["checkin"]);
    expect(filterQuickReplies(list, "endereço").map((r) => r.shortcut)).toEqual(["endereco"]);
    expect(filterQuickReplies(list, "zzz")).toEqual([]);
  });

  it("preenche {nome} e {primeiro_nome}; sem nome, o texto fica limpo", () => {
    expect(renderQuickReply("Olá {primeiro_nome}, tudo bem? {nome} confirmado.", { name: "Ana Souza" })).toBe("Olá Ana, tudo bem? Ana Souza confirmado.");
    expect(renderQuickReply("Olá {primeiro_nome}, tudo bem?", { name: null })).toBe("Olá, tudo bem?");
    expect(renderQuickReply("Sem variável.", { name: "Ana" })).toBe("Sem variável.");
  });
});
