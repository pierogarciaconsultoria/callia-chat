import { describe, expect, it } from "vitest";
import { albumAssets, driveFolderId, fitWithin, isAcceptedImage } from "@/lib/media";
import type { MediaAsset } from "@/lib/database.types";

describe("fotos: helpers do painel", () => {
  it("reduz mantendo a proporção só quando passa de 1600 px", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200, resized: true });
    expect(fitWithin(1080, 1920)).toEqual({ width: 900, height: 1600, resized: true });
    expect(fitWithin(1200, 800)).toEqual({ width: 1200, height: 800, resized: false });
  });

  it("aceita só JPG, PNG e WebP", () => {
    expect(isAcceptedImage({ type: "image/jpeg", name: "a.jpg" })).toBe(true);
    expect(isAcceptedImage({ type: "", name: "foto.WEBP" })).toBe(true);
    expect(isAcceptedImage({ type: "image/heic", name: "a.heic" })).toBe(false);
    expect(isAcceptedImage({ type: "application/pdf", name: "a.pdf" })).toBe(false);
  });

  it("reconhece links de pasta do Google Drive", () => {
    expect(driveFolderId("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?usp=sharing")).toBe("1AbCdEfGhIjKlMnOp");
    expect(driveFolderId("https://drive.google.com/drive/u/0/folders/1AbCdEfGhIjKlMnOp")).toBe("1AbCdEfGhIjKlMnOp");
    expect(driveFolderId("https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp")).toBe("1AbCdEfGhIjKlMnOp");
    expect(driveFolderId("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view")).toBeNull();
    expect(driveFolderId("qualquer coisa")).toBeNull();
  });

  it("ordena as fotos do álbum por posição e data", () => {
    const base = { workspace_id: "w", product_id: null, caption: null, public_url: "u", mime_type: "image/jpeg", size_bytes: 1, source: "upload" as const };
    const assets: MediaAsset[] = [
      { ...base, id: "3", album: "Família", position: 1, created_at: "2026-10-26T10:00:00Z" },
      { ...base, id: "1", album: "Família", position: 0, created_at: "2026-10-26T12:00:00Z" },
      { ...base, id: "2", album: "Família", position: 0, created_at: "2026-10-26T11:00:00Z" },
      { ...base, id: "x", album: "Churrasqueira", position: 0, created_at: "2026-10-26T09:00:00Z" },
    ];
    expect(albumAssets(assets, "Família").map((a) => a.id)).toEqual(["2", "1", "3"]);
    expect(albumAssets(undefined, "Família")).toEqual([]);
  });
});
