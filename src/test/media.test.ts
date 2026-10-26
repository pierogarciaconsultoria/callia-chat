import { describe, expect, it, vi } from "vitest";
import { cleanAlbumName, groupAlbums, matchAlbum, mentionedAlbums, photoGroups } from "../../supabase/functions/_shared/media.ts";
import { collectDriveImages, downloadDriveImage, parseDriveFolderId, parseEmbeddedFolder } from "../../supabase/functions/_shared/gdrive.ts";

const entry = (id: string, name: string, folder = false) =>
  `<div class="flip-entry" id="entry-${id}" tabindex="0" role="link"><div class="flip-entry-info"><a href="https://drive.google.com/${folder ? `drive/folders/${id}` : `file/d/${id}/view?usp=drive_web`}" target="_blank"><div class="flip-entry-visual"></div><div class="flip-entry-list-icon"></div><div class="flip-entry-title">${name}</div></a></div></div>`;

describe("álbuns de fotos", () => {
  it("limpa nomes de pasta", () => {
    expect(cleanAlbumName("01 - Apto Família ")).toBe("Apto Família");
    expect(cleanAlbumName("  ")).toBe("Geral");
  });

  it("acha o álbum pedido pelo hóspede", () => {
    const albums = ["Apto Casal", "Apto Família", "Área da churrasqueira", "Fachada"];
    expect(matchAlbum("apto família", albums)).toBe("Apto Família");
    expect(matchAlbum("familia", albums)).toBe("Apto Família");
    expect(matchAlbum("fotos da churrasqueira", albums)).toBe("Área da churrasqueira");
    expect(matchAlbum("apartamento para casal", albums)).toBe("Apto Casal");
    expect(matchAlbum("piscina", albums)).toBeNull();
  });

  it("identifica álbuns citados no texto da resposta", () => {
    const albums = ["Apartamento 205 e 206 - Até 4 pessoas", "Apartamento 207 a 209 - Até 3 pessoas", "Condomínio Verdes Mares - 7 Pessoas", "Kitnet - Até 2 pessoas", "Estrutura"];
    const text = "Para 4 adultos temos: *Apartamentos 205 e 206* e o *Condomínio Verdes Mares*. Seguem as fotos 👇";
    expect(mentionedAlbums(text, albums)).toEqual(["Apartamento 205 e 206 - Até 4 pessoas", "Condomínio Verdes Mares - 7 Pessoas"]);
    expect(mentionedAlbums("Temos a kitnet para o casal", albums)).toEqual(["Kitnet - Até 2 pessoas"]);
    expect(mentionedAlbums("O apartamento 205 é ótimo", albums)).toEqual([]); // falta o 206
  });

  it("nomes do catálogo: ignora a capacidade entre parênteses ao achar citações", () => {
    const albums = ["Apartamento 207, 208 e 209 (até 3 pessoas)", "Kitnet (até 2 pessoas)"];
    expect(mentionedAlbums("Temos os Apartamentos 207, 208 e 209 e a Kitnet. Seguem as fotos 👇", albums)).toEqual(albums);
  });

  it("MarIA vê as fotos pelo catálogo: pastas do mesmo item viram uma opção", () => {
    const groups = photoGroups([
      { album: "207 a 209 - quartos", product_id: "p207", product_name: "Apartamento 207, 208 e 209 (até 3 pessoas)" },
      { album: "207 a 209 - banheiro", product_id: "p207", product_name: "Apartamento 207, 208 e 209 (até 3 pessoas)" },
      { album: "Estrutura", product_id: null, product_name: null },
      { album: "Estrutura", product_id: null, product_name: null },
    ]);
    expect(groups.map((g) => [g.name, g.count, [...g.albums].length])).toEqual([
      ["Apartamento 207, 208 e 209 (até 3 pessoas)", 2, 2],
      ["Estrutura", 2, 1],
    ]);
  });

  it("agrupa com capa na primeira posição", () => {
    const g = groupAlbums([
      { album: "Fachada", product_id: null, public_url: "f2", position: 1 },
      { album: "Fachada", product_id: null, public_url: "f1", position: 0 },
      { album: "Apto Casal", product_id: "p1", public_url: "c1", position: 0 },
    ]);
    expect(g).toEqual([
      { name: "Apto Casal", product_id: "p1", count: 1, cover_url: "c1" },
      { name: "Fachada", product_id: null, count: 2, cover_url: "f1" },
    ]);
  });
});

describe("Google Drive", () => {
  it("extrai o id da pasta de links comuns", () => {
    expect(parseDriveFolderId("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUv?usp=sharing")).toBe("1AbCdEfGhIjKlMnOpQrStUv");
    expect(parseDriveFolderId("https://drive.google.com/drive/u/0/folders/1AbCdEfGhIjKlMnOpQrStUv")).toBe("1AbCdEfGhIjKlMnOpQrStUv");
    expect(parseDriveFolderId("https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUv")).toBe("1AbCdEfGhIjKlMnOpQrStUv");
    expect(parseDriveFolderId("https://exemplo.com")).toBeNull();
  });

  it("lê pastas e arquivos da visualização pública", () => {
    const html = entry("F1aaaaaaaaaa", "Apto Família", true) + entry("I1aaaaaaaaaa", "fachada.jpg") + entry("D1aaaaaaaaaa", "contrato.pdf");
    expect(parseEmbeddedFolder(html)).toEqual([
      { id: "F1aaaaaaaaaa", name: "Apto Família", isFolder: true },
      { id: "I1aaaaaaaaaa", name: "fachada.jpg", isFolder: false },
      { id: "D1aaaaaaaaaa", name: "contrato.pdf", isFolder: false },
    ]);
  });

  it("subpastas viram álbuns, sub-subpastas são achatadas e não-fotos são ignoradas", async () => {
    const folders: Record<string, string> = {
      ROOT: entry("FAM", "01 - Apto Família", true) + entry("CHU", "Churrasqueira", true) + entry("IMG0", "fachada.HEIC") + entry("PDF", "regras.pdf"),
      FAM: entry("IMG1", "sala.jpg") + entry("IMG2", "quarto.png") + entry("SUB", "extras", true),
      SUB: entry("IMG3", "varanda.webp"),
      CHU: entry("IMG4", "churras.jpeg"),
    };
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const id = new URL(String(input)).searchParams.get("id")!;
      return folders[id] ? new Response(`<html>${folders[id]}</html>`) : new Response("not found", { status: 404 });
    });
    const images = await collectDriveImages("ROOT", { fetchImpl: fetchImpl as unknown as typeof fetch, rootAlbum: "Geral" });
    expect(images).toEqual([
      { id: "IMG0", name: "fachada.HEIC", album: "Geral" },
      { id: "IMG1", name: "sala.jpg", album: "01 - Apto Família" },
      { id: "IMG2", name: "quarto.png", album: "01 - Apto Família" },
      { id: "IMG3", name: "varanda.webp", album: "01 - Apto Família" },
      { id: "IMG4", name: "churras.jpeg", album: "Churrasqueira" },
    ]);
  });

  it("pasta não compartilhada vira orientação clara", async () => {
    const err = await collectDriveImages("X", { fetchImpl: (async () => new Response("no", { status: 404 })) as unknown as typeof fetch }).catch((e) => e);
    expect(err.message).toMatch(/Qualquer pessoa com o link/);
  });

  it("baixa a miniatura de 1600 px e recusa arquivo privado (HTML de login)", async () => {
    const ok = await downloadDriveImage("IMG1", { fetchImpl: (async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } })) as unknown as typeof fetch });
    expect(ok).toEqual({ bytes: new Uint8Array([1, 2, 3]), mime: "image/jpeg" });
    await expect(downloadDriveImage("IMG1", { fetchImpl: (async () => new Response("<html>login</html>", { headers: { "content-type": "text/html" } })) as unknown as typeof fetch }))
      .rejects.toThrow(/privado/);
  });
});
