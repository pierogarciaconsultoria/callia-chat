import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { invokeFunction, unwrap } from "@/lib/functions";
import type { Faq, KnowledgeSource, Product, SearchResult } from "@/lib/database.types";
import { invalidateEntitlements } from "./use-entitlements";

export const faqsKey = (ws: string) => ["faqs", ws] as const;
export const productsKey = (ws: string) => ["products", ws] as const;
export const sourcesKey = (ws: string) => ["knowledge_sources", ws] as const;

export function useFaqs(workspaceId: string) {
  return useQuery({
    queryKey: faqsKey(workspaceId),
    queryFn: async () =>
      unwrap(
        await supabase.from("faqs").select("*").eq("workspace_id", workspaceId).order("position").order("created_at"),
      ) as Faq[],
  });
}

export function useProducts(workspaceId: string) {
  return useQuery({
    queryKey: productsKey(workspaceId),
    queryFn: async () =>
      unwrap(await supabase.from("products").select("*").eq("workspace_id", workspaceId).order("name")) as Product[],
  });
}

// Faz polling sozinho enquanto alguma fonte estiver na fila ou indexando.
export function useKnowledgeSources(workspaceId: string, pollMs = 4000) {
  return useQuery({
    queryKey: sourcesKey(workspaceId),
    refetchInterval: (q) =>
      (q.state.data as KnowledgeSource[] | undefined)?.some((s) => s.status === "pending" || s.status === "indexing") ? pollMs : false,
    queryFn: async () =>
      unwrap(
        await supabase
          .from("knowledge_sources")
          .select("id, workspace_id, kind, title, origin_id, url, storage_path, mime_type, status, error, chunk_count, embedded, indexed_at, created_at, updated_at, metadata")
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false }),
      ) as unknown as KnowledgeSource[],
  });
}

// Mutação genérica para tabelas simples com RLS (faqs, products).
export function useTableCrud<T extends { id: string }>(table: "faqs" | "products", workspaceId: string) {
  const qc = useQueryClient();
  const key = table === "faqs" ? faqsKey(workspaceId) : productsKey(workspaceId);
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: sourcesKey(workspaceId) });
  };
  const save = useMutation({
    mutationFn: async (row: Partial<T> & { id?: string }) => {
      const { id, ...rest } = row;
      if (id) return unwrap(await supabase.from(table).update(rest).eq("id", id).select("*").single()) as T;
      return unwrap(await supabase.from(table).insert({ ...rest, workspace_id: workspaceId }).select("*").single()) as T;
    },
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      unwrap(await supabase.from(table).delete().eq("id", id));
    },
    onSuccess: invalidate,
  });
  return { save, remove };
}

export function useKnowledgeActions(workspaceId: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: sourcesKey(workspaceId) });
    invalidateEntitlements(qc, workspaceId);
  };
  const run = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      invokeFunction<{ source?: KnowledgeSource; deleted?: boolean; embedded?: number }>("knowledge-index", body),
    onSuccess: invalidate,
  });
  return run;
}

export function useSearchPreview(workspaceId: string) {
  return useMutation({
    mutationFn: (vars: { query: string; limit: number }) =>
      invokeFunction<{ mode: "hybrid" | "keyword"; results: SearchResult[] }>("knowledge-index", {
        action: "search_preview",
        workspace_id: workspaceId,
        query: vars.query,
        limit: vars.limit,
      }),
  });
}
