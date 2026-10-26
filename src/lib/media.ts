// Fotos: redimensionamento no navegador antes do upload e helpers de álbum.
import { supabase } from "./supabase";
import { invokeFunction } from "./functions";
import type { MediaAsset } from "./database.types";

export const MEDIA_MAX_SIDE = 1600;
export const MEDIA_JPEG_QUALITY = 0.82;
export const MEDIA_MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
export const MEDIA_ACCEPT = ACCEPTED.join(",");

export function isAcceptedImage(file: { type: string; name: string }): boolean {
  if (ACCEPTED.includes(file.type)) return true;
  return !file.type && /\.(jpe?g|png|webp)$/i.test(file.name);
}

/** Novas dimensões mantendo a proporção, com o lado maior ≤ maxSide. */
export function fitWithin(width: number, height: number, maxSide = MEDIA_MAX_SIDE): { width: number; height: number; resized: boolean } {
  const longest = Math.max(width, height);
  if (longest <= maxSide) return { width, height, resized: false };
  const scale = maxSide / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale), resized: true };
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Não foi possível ler a imagem."));
    };
    img.src = url;
  });
}

/** Reduz para ≤ 1600 px (JPEG 0.82). Imagens já pequenas e leves seguem como estão. */
export async function prepareImage(file: File): Promise<{ blob: Blob; ext: string; mime: string }> {
  const img = await loadImage(file);
  const target = fitWithin(img.naturalWidth, img.naturalHeight);
  const small = !target.resized && file.size <= 1.5 * 1024 * 1024 && ACCEPTED.includes(file.type);
  if (small) {
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    return { blob: file, ext, mime: file.type };
  }
  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Navegador sem suporte para redimensionar imagens.");
  // Fundo branco: PNG transparente vira JPEG sem fundo preto.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, target.width, target.height);
  ctx.drawImage(img, 0, 0, target.width, target.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", MEDIA_JPEG_QUALITY));
  if (!blob) throw new Error("Falha ao converter a imagem.");
  return { blob, ext: "jpg", mime: "image/jpeg" };
}

/** Sobe em media/<workspace>/<uuid>.<ext> e registra a foto no álbum. */
export async function uploadPhoto(
  workspaceId: string,
  file: File,
  album: string,
  productId: string | null,
): Promise<MediaAsset> {
  if (!isAcceptedImage(file)) throw new Error("Use JPG, PNG ou WebP.");
  const { blob, ext, mime } = await prepareImage(file);
  if (blob.size > MEDIA_MAX_BYTES) throw new Error("Imagem acima de 5 MB mesmo após reduzir.");
  const path = `${workspaceId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("media").upload(path, blob, { contentType: mime, upsert: false });
  if (error) throw new Error(error.message);
  const res = await invokeFunction<{ asset: MediaAsset }>("media", {
    action: "register_upload",
    workspace_id: workspaceId,
    storage_path: path,
    album,
    ...(productId ? { product_id: productId } : {}),
  });
  return res.asset;
}

/** Link de pasta do Google Drive válido (drive.google.com/drive/folders/<id> ou ?id=). */
export function driveFolderId(link: string): string | null {
  const v = link.trim();
  const m = /drive\.google\.com\/(?:drive\/(?:u\/\d+\/)?folders\/|open\?id=|embeddedfolderview\?id=)([A-Za-z0-9_-]{10,})/.exec(v);
  return m ? m[1] : null;
}

/** Fotos do álbum em ordem de exibição. */
export function albumAssets(assets: MediaAsset[] | undefined, album: string): MediaAsset[] {
  return (assets ?? []).filter((a) => a.album === album).sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
}
