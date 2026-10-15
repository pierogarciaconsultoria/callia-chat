import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/lib/workspace";
import type {
  FaqRecord,
  KnowledgeSearchHit,
  KnowledgeSourceRecord,
  ProductRecord,
} from "@/lib/knowledge";

export type KnowledgeSourceInput = {
  id?: string;
  title: string;
  type: "text" | "url";
  content?: string;
  source_url?: string | null;
  category?: string | null;
  is_active?: boolean;
};

async function invokeKnowledge(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("knowledge-index", { body });
  if (error) throw error;
  return data as Record<string, unknown>;
}

// Mirrors what the browser would send as a storage object name: anything that
// is not a plain filename character becomes an underscore, so a crafted name
// can never climb out of the workspace folder.
function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "") || "arquivo";
}

export function useKnowledge() {
  const { currentWorkspace, canManage: canEdit } = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [faqs, setFaqs] = useState<FaqRecord[]>([]);
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [sources, setSources] = useState<KnowledgeSourceRecord[]>([]);

  const refresh = useCallback(async () => {
    if (!currentWorkspace) {
      setFaqs([]);
      setProducts([]);
      setSources([]);
      setLoadError(null);
      setLoading(false);
      return;
    }

    setLoading(true);

    const workspaceId = currentWorkspace.id;

    const [faqRes, productRes, sourceRes] = await Promise.all([
      (supabase as any)
        .from("faqs")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: true }),
      (supabase as any)
        .from("products")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: true }),
      (supabase as any)
        .from("knowledge_sources")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false }),
    ]);

    const failure = faqRes.error || productRes.error || sourceRes.error;
    if (failure) {
      setLoadError(failure.message || "Nao foi possivel carregar a base de conhecimento.");
      setLoading(false);
      throw new Error(failure.message || "Nao foi possivel carregar a base de conhecimento.");
    }

    setLoadError(null);
    setFaqs((faqRes.data ?? []) as FaqRecord[]);
    setProducts((productRes.data ?? []) as ProductRecord[]);
    setSources((sourceRes.data ?? []) as KnowledgeSourceRecord[]);
    setLoading(false);
  }, [currentWorkspace]);

  useEffect(() => {
    refresh().catch(() => {
      setFaqs([]);
      setProducts([]);
      setSources([]);
      setLoading(false);
    });
  }, [refresh]);

  // faqs and products mirror into knowledge_sources through database triggers,
  // so a write here only has to drain whatever the database marked as pending.
  const reindexPending = useCallback(async () => {
    if (!currentWorkspace) return null;
    setSubmitting(true);
    try {
      const data = await invokeKnowledge({ workspaceId: currentWorkspace.id });
      await refresh();
      return data;
    } finally {
      setSubmitting(false);
    }
  }, [currentWorkspace, refresh]);

  const upsertFaq = useCallback(
    async (faq: Partial<FaqRecord> & Pick<FaqRecord, "question" | "answer">) => {
      if (!currentWorkspace) return;
      const payload = {
        id: faq.id,
        workspace_id: currentWorkspace.id,
        question: faq.question,
        answer: faq.answer,
        is_active: faq.is_active ?? true,
      };

      const { data, error } = await (supabase as any)
        .from("faqs")
        .upsert(payload)
        .select("*")
        .single();

      if (error) throw new Error(error.message);
      setFaqs((prev) => {
        const filtered = prev.filter((item) => item.id !== data.id);
        return [...filtered, data].sort((a, b) => a.question.localeCompare(b.question));
      });
    },
    [currentWorkspace],
  );

  const removeFaq = useCallback(
    async (faqId: string) => {
      const { error } = await (supabase as any).from("faqs").delete().eq("id", faqId);
      if (error) throw new Error(error.message);
      setFaqs((prev) => prev.filter((faq) => faq.id !== faqId));
      setSources((prev) => prev.filter((item) => item.record_id !== faqId));
    },
    [],
  );

  const upsertProduct = useCallback(
    async (product: Partial<ProductRecord> & Pick<ProductRecord, "name">) => {
      if (!currentWorkspace) return;
      const payload = {
        id: product.id,
        workspace_id: currentWorkspace.id,
        name: product.name,
        description: product.description ?? null,
        price: product.price ?? null,
        currency: product.currency ?? "BRL",
        link: product.link ?? null,
        image_url: product.image_url ?? null,
        is_active: product.is_active ?? true,
      };

      const { data, error } = await (supabase as any)
        .from("products")
        .upsert(payload)
        .select("*")
        .single();

      if (error) throw new Error(error.message);
      setProducts((prev) => {
        const filtered = prev.filter((item) => item.id !== data.id);
        return [...filtered, data].sort((a, b) => a.name.localeCompare(b.name));
      });
    },
    [currentWorkspace],
  );

  const removeProduct = useCallback(
    async (productId: string) => {
      const { error } = await (supabase as any).from("products").delete().eq("id", productId);
      if (error) throw new Error(error.message);
      setProducts((prev) => prev.filter((product) => product.id !== productId));
      setSources((prev) => prev.filter((item) => item.record_id !== productId));
    },
    [],
  );

  const saveSource = useCallback(
    async (input: KnowledgeSourceInput) => {
      if (!currentWorkspace) return;
      const payload = {
        id: input.id,
        workspace_id: currentWorkspace.id,
        title: input.title,
        type: input.type,
        content: input.content ?? "",
        source_url: input.type === "url" ? input.source_url ?? null : null,
        category: input.category ?? null,
        is_active: input.is_active ?? true,
        index_status: "pending",
      };

      const { data, error } = await (supabase as any)
        .from("knowledge_sources")
        .upsert(payload)
        .select("*")
        .single();

      if (error) throw new Error(error.message);
      return data as KnowledgeSourceRecord;
    },
    [currentWorkspace],
  );

  const uploadSource = useCallback(
    async (file: File, title: string, category: string | null) => {
      if (!currentWorkspace) return;

      const path = `${currentWorkspace.id}/${Date.now()}-${safeFileName(file.name)}`;
      const { error: uploadError } = await supabase.storage
        .from("knowledge-files")
        .upload(path, file, { cacheControl: "3600", upsert: false });

      if (uploadError) throw new Error(uploadError.message);

      const { data, error } = await (supabase as any)
        .from("knowledge_sources")
        .insert({
          workspace_id: currentWorkspace.id,
          title,
          type: "file",
          content: "",
          file_path: path,
          category,
          index_status: "pending",
        })
        .select("*")
        .single();

      if (error) {
        await supabase.storage.from("knowledge-files").remove([path]);
        throw new Error(error.message);
      }

      return data as KnowledgeSourceRecord;
    },
    [currentWorkspace],
  );

  const removeSource = useCallback(
    async (source: KnowledgeSourceRecord) => {
      const { error } = await (supabase as any)
        .from("knowledge_sources")
        .delete()
        .eq("id", source.id);

      if (error) throw new Error(error.message);
      if (source.file_path) {
        await supabase.storage.from("knowledge-files").remove([source.file_path]);
      }
      setSources((prev) => prev.filter((item) => item.id !== source.id));
    },
    [],
  );

  const toggleSource = useCallback(
    async (source: KnowledgeSourceRecord, isActive: boolean) => {
      const { error } = await (supabase as any)
        .from("knowledge_sources")
        .update({ is_active: isActive })
        .eq("id", source.id);

      if (error) throw new Error(error.message);
      setSources((prev) =>
        prev.map((item) => (item.id === source.id ? { ...item, is_active: isActive } : item)),
      );
    },
    [],
  );

  const search = useCallback(
    async (query: string, limit = 5) => {
      if (!currentWorkspace) return [] as KnowledgeSearchHit[];
      const data = await invokeKnowledge({
        workspaceId: currentWorkspace.id,
        action: "search",
        query,
        limit,
      });
      return (data.results ?? []) as KnowledgeSearchHit[];
    },
    [currentWorkspace],
  );

  return {
    currentWorkspace,
    canEdit,
    loading,
    loadError,
    submitting,
    faqs,
    products,
    sources,
    refresh,
    reindexPending,
    upsertFaq,
    removeFaq,
    upsertProduct,
    removeProduct,
    saveSource,
    uploadSource,
    removeSource,
    toggleSource,
    search,
  };
}
