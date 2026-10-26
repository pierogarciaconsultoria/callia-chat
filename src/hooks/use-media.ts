import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invokeFunction } from "@/lib/functions";
import type { Album, MediaAsset, MediaImport } from "@/lib/database.types";

export const mediaKey = (workspaceId: string) => ["media", workspaceId] as const;
export const mediaImportsKey = (workspaceId: string) => ["media-imports", workspaceId] as const;

export function useMedia(workspaceId: string) {
  return useQuery({
    queryKey: mediaKey(workspaceId),
    queryFn: () => invokeFunction<{ albums: Album[]; assets: MediaAsset[] }>("media", { action: "list", workspace_id: workspaceId }),
  });
}

/** Importações recentes; atualiza a cada 3 s enquanto alguma estiver em andamento. */
export function useMediaImports(workspaceId: string, enabled = true) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: mediaImportsKey(workspaceId),
    enabled,
    queryFn: async () => {
      const res = await invokeFunction<{ imports: MediaImport[] }>("media", { action: "import_status", workspace_id: workspaceId });
      // Novas fotos aparecem na galeria conforme a importação avança.
      if (res.imports?.some((i) => i.status === "running")) void qc.invalidateQueries({ queryKey: mediaKey(workspaceId) });
      return res.imports ?? [];
    },
    refetchInterval: (q) => (q.state.data?.some((i) => i.status === "running") ? 3000 : false),
  });
}

export function useMediaActions(workspaceId: string) {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: mediaKey(workspaceId) });
  const refreshImports = () => void qc.invalidateQueries({ queryKey: mediaImportsKey(workspaceId) });
  const call = <T,>(action: string, vars: Record<string, unknown> = {}) =>
    invokeFunction<T>("media", { action, workspace_id: workspaceId, ...vars });

  const update = useMutation({
    mutationFn: (vars: { asset_id: string; album?: string; caption?: string | null; product_id?: string | null; position?: number }) =>
      call<{ asset: MediaAsset }>("update", vars),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (asset_id: string) => call<{ deleted: true }>("delete", { asset_id }),
    onSuccess: refresh,
  });
  const renameAlbum = useMutation({
    mutationFn: (vars: { from: string; to: string; product_id?: string | null }) => call<{ updated: number }>("rename_album", vars),
    onSuccess: refresh,
  });
  const importDrive = useMutation({
    mutationFn: (folder_url: string) => call<{ import: MediaImport }>("import_drive", { folder_url }),
    onSuccess: refreshImports,
  });
  const importHospedin = useMutation({
    mutationFn: () => call<{ import: MediaImport }>("import_hospedin"),
    onSuccess: refreshImports,
  });
  return { update, remove, renameAlbum, importDrive, importHospedin, refresh };
}
