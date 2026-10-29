// Enviar fotos da galeria (Informações da empresa → Fotos) na conversa atual, sem baixar nada.
import { useMemo, useState } from "react";
import { ChevronLeft, Image as ImageIcon, Send } from "lucide-react";
import { cn } from "@/lib/cn";
import { albumAssets } from "@/lib/media";
import { useMedia } from "@/hooks/use-media";
import { useSendMessage } from "@/hooks/use-inbox";
import { Button, EmptyState, Modal, Spinner, Textarea, useToast } from "@/components/ui";

/** Mesmo limite do bot: até 5 fotos por envio. */
export const MAX_PHOTOS_PER_SEND = 5;

export function PhotoPickerDialog({ workspaceId, conversationId, open, onClose, onSent }: {
  workspaceId: string;
  conversationId: string;
  open: boolean;
  onClose: () => void;
  /** Chamado depois do envio (a conversa passa a ser atendida por quem enviou). */
  onSent?: () => void;
}) {
  const toast = useToast();
  const media = useMedia(workspaceId);
  const send = useSendMessage();
  const [album, setAlbum] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [caption, setCaption] = useState("");

  const albums = media.data?.albums ?? [];
  const photos = useMemo(() => (album ? albumAssets(media.data?.assets, album) : []), [media.data?.assets, album]);
  const albumLabel = (name: string) => albums.find((a) => a.name === name)?.display_name ?? name;

  function toggle(id: string) {
    setSelected((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= MAX_PHOTOS_PER_SEND) {
        toast.error(`No máximo ${MAX_PHOTOS_PER_SEND} fotos por envio.`);
        return cur;
      }
      return [...cur, id];
    });
  }

  function close() {
    setAlbum(null);
    setSelected([]);
    setCaption("");
    onClose();
  }

  async function submit() {
    if (!selected.length) return;
    try {
      await send.mutateAsync({ conversationId, mediaAssetIds: selected, text: caption.trim() || undefined });
      toast.success(selected.length === 1 ? "Foto enviada." : `${selected.length} fotos enviadas.`);
      close();
      onSent?.();
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title={album ? albumLabel(album) : "Enviar fotos"}
      description={album ? `Escolha até ${MAX_PHOTOS_PER_SEND} fotos. Elas saem na ordem em que forem marcadas.` : "Fotos cadastradas em Informações da empresa → Fotos."}
      footer={
        <>
          {album ? (
            <Button variant="secondary" onClick={() => { setAlbum(null); setSelected([]); }}><ChevronLeft className="h-4 w-4" /> Álbuns</Button>
          ) : (
            <Button variant="secondary" onClick={close}>Cancelar</Button>
          )}
          <Button onClick={() => void submit()} disabled={selected.length === 0} loading={send.isPending}>
            <Send className="h-4 w-4" /> Enviar{selected.length > 0 ? ` ${selected.length}` : ""}
          </Button>
        </>
      }
    >
      {media.isLoading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : albums.length === 0 ? (
        <EmptyState icon={ImageIcon} title="Nenhuma foto cadastrada" description="Um administrador pode adicionar fotos em Informações da empresa → Fotos." />
      ) : !album ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Álbuns">
          {albums.map((a) => (
            <li key={a.name}>
              <button type="button" onClick={() => setAlbum(a.name)} className="group w-full overflow-hidden rounded-xl border border-slate-200 text-left hover:border-brand dark:border-slate-700">
                <div className="aspect-[4/3] bg-slate-100 dark:bg-slate-800">
                  {a.cover_url && <img src={a.cover_url} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" />}
                </div>
                <div className="px-2.5 py-2">
                  <p className="truncate text-sm font-medium">{a.display_name ?? a.name}</p>
                  <p className="text-xs text-slate-500">{a.count} foto(s)</p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="space-y-3">
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label="Fotos do álbum">
            {photos.map((p) => {
              const idx = selected.indexOf(p.id);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => toggle(p.id)}
                    aria-pressed={idx >= 0}
                    aria-label={p.caption || `Foto ${p.position + 1}`}
                    className={cn("relative block aspect-square w-full overflow-hidden rounded-lg border-2", idx >= 0 ? "border-brand" : "border-transparent hover:border-slate-300")}
                  >
                    <img src={p.public_url} alt="" loading="lazy" className="h-full w-full object-cover" />
                    {idx >= 0 && (
                      <span className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white">{idx + 1}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          <Textarea label="Legenda (opcional)" rows={2} maxLength={1024} value={caption} onChange={(e) => setCaption(e.target.value)} hint="Vai junto com a primeira foto." />
        </div>
      )}
    </Modal>
  );
}
