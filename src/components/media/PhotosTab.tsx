import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import { ArrowDown, ArrowUp, CloudDownload, FolderInput, ImagePlus, Images, Trash2, Upload } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useRequiredWorkspace } from "@/lib/workspace";
import { useProducts } from "@/hooks/use-knowledge";
import { findIntegration, useIntegrations } from "@/hooks/use-integrations";
import { mediaKey, useMedia, useMediaActions, useMediaImports } from "@/hooks/use-media";
import { albumAssets, driveFolderId, isAcceptedImage, MEDIA_ACCEPT, uploadPhoto } from "@/lib/media";
import { errorMessage } from "@/lib/functions";
import type { Album, MediaAsset, MediaImport, Product } from "@/lib/database.types";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmButton,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  Notice,
  Select,
  Spinner,
  useToast,
} from "@/components/ui";

const NEW_ALBUM = "__new__";
const SOURCE_LABEL: Record<string, string> = { upload: "Enviada", drive: "Google Drive", hospedin: "Hospedin" };

export function PhotosTab() {
  const { workspaceId, isAdmin } = useRequiredWorkspace();
  const media = useMedia(workspaceId);
  const products = useProducts(workspaceId);
  const integrations = useIntegrations(workspaceId, isAdmin);
  const hospedinConnected = findIntegration(integrations.data, "hospedin")?.status === "connected";
  const { importHospedin } = useMediaActions(workspaceId);
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [openAlbum, setOpenAlbumState] = useState<string | null>(params.get("album"));
  const setOpenAlbum = (name: string | null) => {
    setOpenAlbumState(name);
    const next = new URLSearchParams(params);
    if (name) next.set("album", name);
    else next.delete("album");
    setParams(next, { replace: true });
  };
  // O nome oficial vem do catálogo: recarrega ao abrir a aba para não mostrar nome antigo.
  useEffect(() => {
    void products.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [driveOpen, setDriveOpen] = useState(false);

  const albums = media.data?.albums ?? [];
  const productName = (id: string | null) => (id ? products.data?.find((p) => p.id === id)?.name ?? null : null);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Fotos"
          description="Quando o hóspede pede fotos, a MarIA envia até 5 do álbum certo direto no WhatsApp."
          actions={
            isAdmin && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setUploadOpen(true)}>
                  <Upload className="h-4 w-4" /> Enviar fotos
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setDriveOpen(true)}>
                  <FolderInput className="h-4 w-4" /> Importar do Google Drive
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!hospedinConnected}
                  loading={importHospedin.isPending}
                  title={hospedinConnected ? undefined : "Conecte o Hospedin em Integrações para importar as fotos das categorias"}
                  onClick={() => importHospedin.mutate(undefined, { onError: (e) => toast.error(e) })}
                >
                  <CloudDownload className="h-4 w-4" /> Importar do Hospedin
                </Button>
              </div>
            )
          }
        />
        <CardBody className="space-y-3">
          <ImportProgress workspaceId={workspaceId} enabled={isAdmin} />
          {media.isLoading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : media.error ? (
            <ErrorState error={media.error} onRetry={() => void media.refetch()} />
          ) : albums.length === 0 ? (
            <EmptyState
              icon={Images}
              title="Nenhuma foto ainda"
              description="Adicione fotos de três jeitos: envie do computador ou celular, importe uma pasta do Google Drive (uma subpasta por acomodação) ou traga as fotos das categorias do Hospedin. A MarIA envia até 5 fotos quando o hóspede pedir."
              action={isAdmin && <Button onClick={() => setUploadOpen(true)}><ImagePlus className="h-4 w-4" /> Enviar fotos</Button>}
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {albums.map((a) => (
                <AlbumCard key={a.name} album={a} productName={productName(a.product_id)} onOpen={() => setOpenAlbum(a.name)} />
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {openAlbum && (
        <AlbumModal
          album={albums.find((a) => a.name === openAlbum) ?? { name: openAlbum, product_id: null, count: 0, cover_url: null }}
          albums={albums}
          assets={albumAssets(media.data?.assets, openAlbum)}
          products={products.data ?? []}
          canEdit={isAdmin}
          onClose={() => setOpenAlbum(null)}
          onRenamed={setOpenAlbum}
        />
      )}
      {uploadOpen && <UploadModal albums={albums} products={products.data ?? []} onClose={() => setUploadOpen(false)} />}
      {driveOpen && <DriveImportModal onClose={() => setDriveOpen(false)} />}
    </div>
  );
}

function AlbumCard({ album, productName, onOpen }: { album: Album; productName: string | null; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group overflow-hidden rounded-lg border border-slate-200 bg-white text-left transition hover:border-brand dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="aspect-[4/3] w-full overflow-hidden bg-slate-100 dark:bg-slate-800">
        {album.cover_url ? (
          <img src={album.cover_url} alt={album.name} loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" />
        ) : (
          <div className="flex h-full items-center justify-center text-slate-400">
            <Images className="h-8 w-8" />
          </div>
        )}
      </div>
      <div className="space-y-1 p-2.5">
        {/* Ligado ao catálogo: o nome do catálogo é o oficial; a pasta de origem fica como detalhe. */}
        <p className="truncate text-sm font-medium" title={productName ?? album.name}>{productName ?? album.name}</p>
        {productName && <p className="truncate text-xs text-slate-400" title={album.name}>Pasta: {album.name}</p>}
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs text-slate-500">{album.count} foto(s)</span>
          {productName ? <Badge tone="brand">No catálogo</Badge> : <Badge>Área / sem item</Badge>}
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------- Progresso de importação
function ImportProgress({ workspaceId, enabled }: { workspaceId: string; enabled: boolean }) {
  const imports = useMediaImports(workspaceId, enabled);
  const qc = useQueryClient();
  const toast = useToast();
  const running = useRef<Set<string>>(new Set());

  // Avisa quando uma importação acompanhada termina.
  useEffect(() => {
    for (const imp of imports.data ?? []) {
      if (imp.status === "running") running.current.add(imp.id);
      else if (running.current.has(imp.id)) {
        running.current.delete(imp.id);
        void qc.invalidateQueries({ queryKey: mediaKey(workspaceId) });
        if (imp.status === "done") toast.success(`Importação concluída: ${imp.imported} foto(s) nova(s)${imp.skipped ? `, ${imp.skipped} ignorada(s)` : ""}.`);
        else toast.error(new Error(imp.error ?? "A importação falhou."));
      }
    }
  }, [imports.data, qc, toast, workspaceId]);

  const active = (imports.data ?? []).filter((i) => i.status === "running");
  const lastFailed = (imports.data ?? []).find((i) => i.status === "failed");
  if (!active.length && !lastFailed) return null;
  return (
    <div className="space-y-2">
      {active.map((i) => <ImportRow key={i.id} imp={i} />)}
      {!active.length && lastFailed && (
        <Notice tone="warn">
          Última importação ({lastFailed.source === "drive" ? "Google Drive" : "Hospedin"}) falhou: {lastFailed.error ?? "erro desconhecido"}
        </Notice>
      )}
    </div>
  );
}

function ImportRow({ imp }: { imp: MediaImport }) {
  const pct = imp.total > 0 ? Math.min(100, Math.round(((imp.imported + imp.skipped) / imp.total) * 100)) : 0;
  return (
    <div className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-medium">
          <Spinner className="h-4 w-4" /> Importando do {imp.source === "drive" ? "Google Drive" : "Hospedin"}…
        </span>
        <span className="text-xs text-slate-500">
          {imp.total ? `${imp.imported} de ${imp.total}` : "listando arquivos"}
          {imp.skipped ? ` · ${imp.skipped} ignorada(s)` : ""}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${imp.total ? pct : 8}%` }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Álbum
function AlbumModal({
  album,
  albums,
  assets,
  products,
  canEdit,
  onClose,
  onRenamed,
}: {
  album: Album;
  albums: Album[];
  assets: MediaAsset[];
  products: Product[];
  canEdit: boolean;
  onClose: () => void;
  onRenamed: (name: string) => void;
}) {
  const { workspaceId } = useRequiredWorkspace();
  const { update, remove, renameAlbum } = useMediaActions(workspaceId);
  const toast = useToast();
  const [name, setName] = useState(album.name);

  async function saveName(e: FormEvent) {
    e.preventDefault();
    const to = name.trim();
    if (!to || to === album.name) return;
    try {
      await renameAlbum.mutateAsync({ from: album.name, to, product_id: album.product_id });
      onRenamed(to);
      toast.success("Álbum renomeado.");
    } catch (err) {
      toast.error(err);
    }
  }

  async function linkProduct(productId: string) {
    try {
      await renameAlbum.mutateAsync({ from: album.name, to: album.name, product_id: productId || null });
      toast.success(productId ? "Álbum vinculado ao catálogo." : "Vínculo removido.");
    } catch (err) {
      toast.error(err);
    }
  }

  // Troca a posição com a vizinha (posições renumeradas pela ordem atual).
  async function move(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= assets.length) return;
    try {
      await Promise.all([
        update.mutateAsync({ asset_id: assets[index].id, position: j }),
        update.mutateAsync({ asset_id: assets[j].id, position: index }),
      ]);
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={products.find((p) => p.id === album.product_id)?.name ?? album.name}
      description={`${assets.length} foto(s)${album.product_id ? ` · pasta "${album.name}"` : ""}`}
    >
      <div className="space-y-4">
        {canEdit && (
          <div className="grid gap-3 sm:grid-cols-2">
            <form onSubmit={saveName} className="flex items-end gap-2">
              <Input label="Nome do álbum" value={name} onChange={(e) => setName(e.target.value)} wrapperClassName="flex-1" maxLength={80} />
              <Button type="submit" variant="secondary" loading={renameAlbum.isPending} disabled={!name.trim() || name.trim() === album.name}>
                Salvar
              </Button>
            </form>
            <Select
              label="Acomodação do catálogo"
              hint="Ajuda a MarIA a escolher este álbum quando falar dessa acomodação."
              value={album.product_id ?? ""}
              onChange={(e) => void linkProduct(e.target.value)}
            >
              <option value="">Sem vínculo</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </div>
        )}
        {assets.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">Este álbum está vazio.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {assets.map((a, i) => (
              <PhotoCard
                key={a.id}
                asset={a}
                albums={albums}
                canEdit={canEdit}
                first={i === 0}
                last={i === assets.length - 1}
                onUp={() => void move(i, -1)}
                onDown={() => void move(i, 1)}
                onCaption={(caption) => update.mutateAsync({ asset_id: a.id, caption }).catch((e) => toast.error(e))}
                onMove={async (to) => {
                  try {
                    await update.mutateAsync({ asset_id: a.id, album: to });
                    toast.success(`Foto movida para "${to}".`);
                  } catch (err) {
                    toast.error(err);
                  }
                }}
                onDelete={() => remove.mutateAsync(a.id).catch((e) => toast.error(e))}
              />
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function PhotoCard({
  asset,
  albums,
  canEdit,
  first,
  last,
  onUp,
  onDown,
  onCaption,
  onMove,
  onDelete,
}: {
  asset: MediaAsset;
  albums: Album[];
  canEdit: boolean;
  first: boolean;
  last: boolean;
  onUp: () => void;
  onDown: () => void;
  onCaption: (caption: string | null) => unknown;
  onMove: (album: string) => unknown;
  onDelete: () => Promise<unknown>;
}) {
  const [caption, setCaption] = useState(asset.caption ?? "");
  const [moving, setMoving] = useState(false);
  const [newAlbum, setNewAlbum] = useState("");
  useEffect(() => setCaption(asset.caption ?? ""), [asset.caption]);

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
      <a href={asset.public_url} target="_blank" rel="noreferrer" className="block aspect-[4/3] bg-slate-100 dark:bg-slate-800">
        <img src={asset.public_url} alt={asset.caption ?? asset.album} loading="lazy" className="h-full w-full object-cover" />
      </a>
      <div className="space-y-2 p-2.5">
        <div className="flex items-center justify-between gap-1">
          <Badge>{SOURCE_LABEL[asset.source] ?? asset.source}</Badge>
          {canEdit && (
            <div className="flex items-center gap-0.5">
              <Button size="sm" variant="ghost" onClick={onUp} disabled={first} aria-label="Mover para cima">
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="ghost" onClick={onDown} disabled={last} aria-label="Mover para baixo">
                <ArrowDown className="h-4 w-4" />
              </Button>
              <ConfirmButton size="sm" variant="ghost" aria-label="Excluir foto" title="Excluir esta foto?" confirmLabel="Excluir" onConfirm={onDelete}>
                <Trash2 className="h-4 w-4" />
              </ConfirmButton>
            </div>
          )}
        </div>
        {canEdit ? (
          <>
            <Input
              placeholder="Legenda (opcional)"
              value={caption}
              maxLength={200}
              onChange={(e) => setCaption(e.target.value)}
              onBlur={() => caption.trim() !== (asset.caption ?? "") && onCaption(caption.trim() || null)}
            />
            {moving ? (
              <div className="space-y-2">
                <Select
                  value=""
                  onChange={(e) => {
                    if (e.target.value === NEW_ALBUM) return setNewAlbum(" ");
                    if (e.target.value) {
                      onMove(e.target.value);
                      setMoving(false);
                    }
                  }}
                >
                  <option value="">Mover para…</option>
                  {albums.filter((a) => a.name !== asset.album).map((a) => (
                    <option key={a.name} value={a.name}>{a.name}</option>
                  ))}
                  <option value={NEW_ALBUM}>Novo álbum…</option>
                </Select>
                {newAlbum !== "" && (
                  <div className="flex gap-2">
                    <Input placeholder="Nome do novo álbum" value={newAlbum.trimStart()} onChange={(e) => setNewAlbum(e.target.value)} wrapperClassName="flex-1" />
                    <Button
                      size="sm"
                      disabled={!newAlbum.trim()}
                      onClick={() => {
                        onMove(newAlbum.trim());
                        setNewAlbum("");
                        setMoving(false);
                      }}
                    >
                      Mover
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <button type="button" className="text-xs font-medium text-brand hover:underline" onClick={() => setMoving(true)}>
                Mover para outro álbum
              </button>
            )}
          </>
        ) : (
          asset.caption && <p className="text-xs text-slate-600 dark:text-slate-300">{asset.caption}</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Upload
type UploadItem = { file: File; status: "pending" | "uploading" | "done" | "error"; error?: string };

function UploadModal({ albums, products, onClose }: { albums: Album[]; products: Product[]; onClose: () => void }) {
  const { workspaceId } = useRequiredWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [albumChoice, setAlbumChoice] = useState(albums[0]?.name ?? NEW_ALBUM);
  const [newAlbum, setNewAlbum] = useState("");
  const [productId, setProductId] = useState("");
  const [items, setItems] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const album = albumChoice === NEW_ALBUM ? newAlbum.trim() : albumChoice;
  const existing = albums.find((a) => a.name === albumChoice);
  const pending = items.filter((i) => i.status === "pending" || i.status === "error");

  function addFiles(list: FileList | File[]) {
    const files = Array.from(list);
    const rejected = files.filter((f) => !isAcceptedImage(f));
    if (rejected.length) toast.error(new Error(`${rejected.length} arquivo(s) ignorado(s): use JPG, PNG ou WebP.`));
    setItems((prev) => [...prev, ...files.filter(isAcceptedImage).map((file) => ({ file, status: "pending" as const }))]);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  }

  async function start() {
    if (!album) return toast.error(new Error("Escolha ou crie um álbum."));
    setBusy(true);
    let ok = 0;
    const link = existing ? existing.product_id : productId || null;
    for (let i = 0; i < items.length; i++) {
      if (items[i].status === "done") continue;
      setItems((prev) => prev.map((it, j) => (j === i ? { ...it, status: "uploading", error: undefined } : it)));
      try {
        await uploadPhoto(workspaceId, items[i].file, album, link);
        ok++;
        setItems((prev) => prev.map((it, j) => (j === i ? { ...it, status: "done" } : it)));
      } catch (err) {
        setItems((prev) => prev.map((it, j) => (j === i ? { ...it, status: "error", error: errorMessage(err) } : it)));
      }
    }
    setBusy(false);
    void qc.invalidateQueries({ queryKey: mediaKey(workspaceId) });
    if (ok) toast.success(`${ok} foto(s) enviada(s) para "${album}".`);
  }

  const allDone = items.length > 0 && items.every((i) => i.status === "done");

  return (
    <Modal
      open
      onClose={() => !busy && onClose()}
      title="Enviar fotos"
      description="As fotos são reduzidas no seu navegador (até 1600 px) antes de enviar."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>{allDone ? "Fechar" : "Cancelar"}</Button>
          {!allDone && (
            <Button onClick={() => void start()} loading={busy} disabled={!pending.length || !album}>
              <Upload className="h-4 w-4" /> Enviar {pending.length || ""}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Álbum" value={albumChoice} onChange={(e) => setAlbumChoice(e.target.value)} disabled={busy}>
            {albums.map((a) => (
              <option key={a.name} value={a.name}>{a.name}</option>
            ))}
            <option value={NEW_ALBUM}>Novo álbum…</option>
          </Select>
          {albumChoice === NEW_ALBUM && (
            <Input label="Nome do novo álbum" placeholder="Ex.: Apto Família" value={newAlbum} onChange={(e) => setNewAlbum(e.target.value)} maxLength={80} disabled={busy} />
          )}
        </div>
        {albumChoice === NEW_ALBUM && products.length > 0 && (
          <Select label="Acomodação do catálogo (opcional)" value={productId} onChange={(e) => setProductId(e.target.value)} disabled={busy}>
            <option value="">Sem vínculo</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
        )}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
          className={
            "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-8 text-center text-sm transition " +
            (dragging ? "border-brand bg-brand/5" : "border-slate-300 hover:border-brand dark:border-slate-700")
          }
        >
          <ImagePlus className="mb-2 h-7 w-7 text-slate-400" />
          <p className="font-medium">Arraste as fotos aqui ou toque para escolher</p>
          <p className="mt-1 text-xs text-slate-500">JPG, PNG ou WebP · várias de uma vez</p>
          <input
            ref={inputRef}
            type="file"
            accept={MEDIA_ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
        {items.length > 0 && (
          <ul className="max-h-60 space-y-1 overflow-y-auto text-sm">
            {items.map((it, i) => (
              <li key={i} className="flex items-center justify-between gap-2 rounded border border-slate-200 px-2 py-1.5 dark:border-slate-800">
                <span className="min-w-0 truncate">{it.file.name}</span>
                <span className="shrink-0 text-xs">
                  {it.status === "pending" && <span className="text-slate-500">aguardando</span>}
                  {it.status === "uploading" && <span className="flex items-center gap-1 text-slate-500"><Spinner className="h-3 w-3" /> enviando</span>}
                  {it.status === "done" && <span className="text-emerald-600">enviada</span>}
                  {it.status === "error" && <span className="text-red-600" title={it.error}>erro: {it.error}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Google Drive
function DriveImportModal({ onClose }: { onClose: () => void }) {
  const { workspaceId } = useRequiredWorkspace();
  const { importDrive } = useMediaActions(workspaceId);
  const toast = useToast();
  const [link, setLink] = useState("");
  const valid = useMemo(() => Boolean(driveFolderId(link)), [link]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await importDrive.mutateAsync(link.trim());
      toast.success("Importação iniciada. As fotos aparecem aqui conforme forem chegando.");
      onClose();
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Importar do Google Drive"
      description="Cada subpasta vira um álbum. Fotos já importadas não são duplicadas."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" form="drive-import" loading={importDrive.isPending} disabled={!valid}>
            <FolderInput className="h-4 w-4" /> Importar
          </Button>
        </>
      }
    >
      <form id="drive-import" onSubmit={submit} className="space-y-4">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700 dark:text-slate-300">
          <li>
            No Google Drive, crie uma pasta com <strong>uma subpasta por acomodação ou área</strong> (ex.: "Apto Família", "Churrasqueira").
          </li>
          <li>
            Na pasta principal, clique em <strong>Compartilhar</strong> → <strong>Acesso geral</strong> → <strong>"Qualquer pessoa com o link"</strong> (Leitor).
          </li>
          <li>Copie o link e cole aqui.</li>
        </ol>
        <Input
          label="Link da pasta"
          placeholder="https://drive.google.com/drive/folders/…"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          error={link.trim() && !valid ? "Cole o link de uma pasta do Google Drive (drive.google.com/drive/folders/…)." : undefined}
          autoFocus
        />
      </form>
    </Modal>
  );
}
