// Fotos do workspace: álbuns, envio pelo painel e importação do Google Drive e do Hospedin.
import { createHandler, json, readJson, RuntimeError, runInBackground } from "../_shared/http.ts";
import { hospedinClientFor, loadConnectors } from "../_shared/availability.ts";
import { assertActive, loadEntitlements } from "../_shared/entitlements.ts";
import { parseDriveFolderId } from "../_shared/gdrive.ts";
import { cleanAlbumName, groupAlbums, importFromDrive, importFromHospedin, publicMediaUrl } from "../_shared/media.ts";
import { adminDb, audit, type Db, optionalEnv, requireUser, requireWorkspaceRole } from "../_shared/supabase.ts";

type Body = Record<string, unknown> & { action?: string; workspace_id?: string };
const ASSET_COLUMNS = "id, workspace_id, album, product_id, caption, public_url, mime_type, size_bytes, source, position, created_at";
const IMPORT_COLUMNS = "id, source, status, total, imported, skipped, error, created_at, finished_at";

function albumName(value: unknown): string {
  const name = typeof value === "string" ? cleanAlbumName(value) : "";
  if (!name) throw new RuntimeError("invalid_request", "Informe o nome do álbum.");
  return name;
}

async function productInWorkspace(db: Db, workspaceId: string, productId: unknown): Promise<string | null> {
  if (productId === null || productId === undefined || productId === "") return null;
  const { data } = await db.from("products").select("id").eq("id", String(productId)).eq("workspace_id", workspaceId).maybeSingle();
  if (!data) throw new RuntimeError("invalid_request", "Produto do catálogo não encontrado.");
  return data.id;
}

async function startImport(db: Db, workspaceId: string, source: "drive" | "hospedin", userId: string, details: Record<string, unknown>) {
  const { data: running } = await db.from("media_imports").select("id").eq("workspace_id", workspaceId).eq("status", "running")
    .gte("created_at", new Date(Date.now() - 15 * 60_000).toISOString()).limit(1);
  if (running?.length) throw new RuntimeError("conflict", "Já existe uma importação de fotos em andamento.");
  const { data, error } = await db.from("media_imports").insert({ workspace_id: workspaceId, source, created_by: userId, details }).select(IMPORT_COLUMNS).single();
  if (error) throw new RuntimeError("internal_error", "Falha ao iniciar a importação.", { db: error.message });
  return data;
}

Deno.serve(createHandler("media", async ({ req, correlationId }) => {
  if (req.method !== "POST") throw new RuntimeError("invalid_request", "Use POST.");
  const user = await requireUser(req);
  const body = await readJson<Body>(req);
  const db = adminDb();

  // Ações sobre uma foto existente identificam o workspace pela própria foto.
  if (body.action === "update" || body.action === "delete") {
    if (typeof body.asset_id !== "string") throw new RuntimeError("invalid_request", "asset_id obrigatório.");
    const { data: asset } = await db.from("media_assets").select("id, workspace_id, storage_path, album").eq("id", body.asset_id).maybeSingle();
    if (!asset) throw new RuntimeError("not_found", "Foto não encontrada.");
    await requireWorkspaceRole(user.id, asset.workspace_id);
    if (body.action === "delete") {
      await db.storage.from("media").remove([asset.storage_path]);
      await db.from("media_assets").delete().eq("id", asset.id);
      await audit(db, { workspace_id: asset.workspace_id, actor_user_id: user.id, action: "media.deleted", entity: "media_asset", entity_id: asset.id, details: { album: asset.album }, correlation_id: correlationId });
      return json({ deleted: true });
    }
    const patch: Record<string, unknown> = {};
    if (body.album !== undefined) patch.album = albumName(body.album);
    if (body.caption !== undefined) patch.caption = body.caption === null ? null : String(body.caption).slice(0, 500);
    if (body.product_id !== undefined) patch.product_id = await productInWorkspace(db, asset.workspace_id, body.product_id);
    if (body.position !== undefined) {
      const pos = Number(body.position);
      if (!Number.isInteger(pos) || pos < 0) throw new RuntimeError("invalid_request", "position inválida.");
      patch.position = pos;
    }
    const { data } = await db.from("media_assets").update(patch).eq("id", asset.id).select(ASSET_COLUMNS).single();
    return json({ asset: data });
  }

  const isRead = body.action === "list";
  await requireWorkspaceRole(user.id, body.workspace_id, isRead ? ["owner", "admin", "agent"] : ["owner", "admin"]);
  const workspaceId = body.workspace_id as string;
  const log = (action: string, details: Record<string, unknown> = {}) =>
    audit(db, { workspace_id: workspaceId, actor_user_id: user.id, action: `media.${action}`, entity: "media", details, correlation_id: correlationId });

  switch (body.action) {
    case "list": {
      const [{ data }, { data: products }] = await Promise.all([
        db.from("media_assets").select(ASSET_COLUMNS).eq("workspace_id", workspaceId).order("album").order("position").order("created_at"),
        db.from("products").select("id, name").eq("workspace_id", workspaceId),
      ]);
      // Álbum ligado ao catálogo exibe o nome do catálogo (fonte única de nome e capacidade).
      const productName = new Map((products ?? []).map((p: { id: string; name: string }) => [p.id, p.name]));
      const albums = groupAlbums(data ?? []).map((a) => {
        const name = a.product_id ? productName.get(a.product_id) ?? null : null;
        return { ...a, product_name: name, display_name: name ?? a.name };
      });
      return json({ albums, assets: data ?? [] });
    }

    case "register_upload": {
      assertActive(await loadEntitlements(db, workspaceId));
      const path = typeof body.storage_path === "string" ? body.storage_path : "";
      if (!path.startsWith(`${workspaceId}/`) || path.includes("..")) throw new RuntimeError("forbidden", "Arquivo fora da pasta do workspace.");
      const ext = path.split(".").pop()?.toLowerCase();
      const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : null;
      if (!mime) throw new RuntimeError("invalid_request", "Use JPG, PNG ou WEBP.");
      const album = albumName(body.album);
      const { data: last } = await db.from("media_assets").select("position").eq("workspace_id", workspaceId).eq("album", album).order("position", { ascending: false }).limit(1);
      const { data, error } = await db.from("media_assets").insert({
        workspace_id: workspaceId,
        album,
        product_id: await productInWorkspace(db, workspaceId, body.product_id),
        caption: typeof body.caption === "string" ? body.caption.slice(0, 500) : null,
        storage_path: path,
        public_url: publicMediaUrl(path),
        mime_type: mime,
        source: "upload",
        position: (last?.[0]?.position ?? -1) + 1,
      }).select(ASSET_COLUMNS).single();
      if (error) throw new RuntimeError("internal_error", "Falha ao registrar a foto.", { db: error.message });
      return json({ asset: data });
    }

    case "import_drive": {
      assertActive(await loadEntitlements(db, workspaceId));
      const folderId = parseDriveFolderId(typeof body.folder_url === "string" ? body.folder_url : "");
      if (!folderId) throw new RuntimeError("invalid_request", "Cole o link da pasta do Google Drive (drive.google.com/drive/folders/...).");
      const row = await startImport(db, workspaceId, "drive", user.id, { folder_id: folderId });
      runInBackground(importFromDrive(db, row.id, workspaceId, folderId, {
        apiKey: optionalEnv("GOOGLE_DRIVE_API_KEY"),
        embedBase: optionalEnv("GDRIVE_EMBED_BASE_URL"),
        thumbBase: optionalEnv("GDRIVE_THUMB_BASE_URL"),
      }));
      await log("drive_import_started", { folder_id: folderId, import_id: row.id });
      return json({ import: row });
    }

    case "import_hospedin": {
      assertActive(await loadEntitlements(db, workspaceId));
      const hospedin = (await loadConnectors(db, workspaceId)).get("hospedin");
      if (!hospedin?.secret_ciphertext || !hospedin.config?.account_id) throw new RuntimeError("unprocessable", "Conecte o Hospedin em Integrações primeiro.");
      const row = await startImport(db, workspaceId, "hospedin", user.id, {});
      runInBackground(importFromHospedin(db, row.id, workspaceId, await hospedinClientFor(hospedin.secret_ciphertext), String(hospedin.config.account_id)));
      await log("hospedin_import_started", { import_id: row.id });
      return json({ import: row });
    }

    case "import_status": {
      const { data } = await db.from("media_imports").select(IMPORT_COLUMNS).eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(5);
      return json({ imports: data ?? [] });
    }

    case "rename_album": {
      const from = typeof body.from === "string" ? body.from : "";
      const to = albumName(body.to ?? body.from);
      const patch: Record<string, unknown> = { album: to };
      if (body.product_id !== undefined) patch.product_id = await productInWorkspace(db, workspaceId, body.product_id);
      const { data } = await db.from("media_assets").update(patch).eq("workspace_id", workspaceId).eq("album", from).select("id");
      await log("album_renamed", { from, to, product_id: patch.product_id ?? undefined });
      return json({ updated: data?.length ?? 0 });
    }

    default:
      throw new RuntimeError("invalid_request", "Ação desconhecida.");
  }
}));
