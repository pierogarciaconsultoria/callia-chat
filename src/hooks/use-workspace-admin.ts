import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/lib/workspace";

export type AgentConfigRecord = {
  workspace_id: string;
  persona_prompt: string;
  language: string;
  business_hours: { enabled?: boolean; timezone?: string; notes?: string };
  website_url: string | null;
  payment_links: Array<{ label: string; url: string }>;
  voice_enabled: boolean;
  voice_id: string | null;
  handoff_keywords: string[];
  follow_up_rules: Array<Record<string, unknown>>;
  ai_model: string;
  external_agent_enabled: boolean;
  external_agent_url: string | null;
  external_agent_secret_ref: string | null;
  external_agent_timeout_ms: number;
};

export type WorkspaceBrandingRecord = {
  workspace_id: string;
  display_name: string | null;
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  custom_domain: string | null;
  support_email: string | null;
};

export type FaqRecord = {
  id: string;
  workspace_id: string;
  question: string;
  answer: string;
  is_active: boolean;
};

export type ProductRecord = {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  price: number | null;
  currency: string;
  link: string | null;
  image_url: string | null;
  is_active: boolean;
};

const defaultAgentConfig: AgentConfigRecord = {
  workspace_id: "",
  persona_prompt:
    "Você é um assistente de atendimento ao cliente prestativo, gentil e objetivo. Responda em português do Brasil.",
  language: "pt-BR",
  business_hours: { enabled: false, timezone: "America/Sao_Paulo", notes: "" },
  website_url: null,
  payment_links: [],
  voice_enabled: false,
  voice_id: null,
  handoff_keywords: ["atendente", "humano", "reclamação"],
  follow_up_rules: [],
  ai_model: "google/gemini-3-flash-preview",
  external_agent_enabled: false,
  external_agent_url: null,
  external_agent_secret_ref: null,
  external_agent_timeout_ms: 25000,
};

const defaultBranding: WorkspaceBrandingRecord = {
  workspace_id: "",
  display_name: null,
  logo_url: null,
  primary_color: "#111827",
  secondary_color: "#6366f1",
  custom_domain: null,
  support_email: null,
};

export function useWorkspaceAdmin() {
  const { currentWorkspace, refresh: refreshWorkspaces } = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [agentConfig, setAgentConfig] = useState<AgentConfigRecord | null>(null);
  const [branding, setBranding] = useState<WorkspaceBrandingRecord | null>(null);
  const [faqs, setFaqs] = useState<FaqRecord[]>([]);
  const [products, setProducts] = useState<ProductRecord[]>([]);

  const refresh = useCallback(async () => {
    if (!currentWorkspace) {
      setAgentConfig(null);
      setBranding(null);
      setFaqs([]);
      setProducts([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const workspaceId = currentWorkspace.id;

    const [agentRes, brandingRes, faqRes, productRes] = await Promise.all([
      (supabase as any)
        .from("agent_configs")
        .select("*")
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
      (supabase as any)
        .from("workspace_branding")
        .select("*")
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
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
    ]);

    setAgentConfig({
      ...defaultAgentConfig,
      workspace_id: workspaceId,
      ...(agentRes.data ?? {}),
      business_hours: {
        ...defaultAgentConfig.business_hours,
        ...((agentRes.data?.business_hours as Record<string, unknown> | null) ?? {}),
      },
      payment_links: Array.isArray(agentRes.data?.payment_links)
        ? agentRes.data.payment_links
        : [],
      follow_up_rules: Array.isArray(agentRes.data?.follow_up_rules)
        ? agentRes.data.follow_up_rules
        : [],
      handoff_keywords: Array.isArray(agentRes.data?.handoff_keywords)
        ? agentRes.data.handoff_keywords
        : defaultAgentConfig.handoff_keywords,
    });

    setBranding({
      ...defaultBranding,
      workspace_id: workspaceId,
      display_name: currentWorkspace.name,
      ...(brandingRes.data ?? {}),
    });
    setFaqs((faqRes.data ?? []) as FaqRecord[]);
    setProducts((productRes.data ?? []) as ProductRecord[]);
    setLoading(false);
  }, [currentWorkspace]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const saveAgentConfig = useCallback(
    async (value: AgentConfigRecord) => {
      await (supabase as any).from("agent_configs").upsert(value);
      setAgentConfig(value);
    },
    [],
  );

  const saveBranding = useCallback(
    async (
      nextBranding: WorkspaceBrandingRecord,
      workspaceName?: string,
    ) => {
      await (supabase as any).from("workspace_branding").upsert(nextBranding);

      if (workspaceName && currentWorkspace) {
        await (supabase as any)
          .from("workspaces")
          .update({ name: workspaceName })
          .eq("id", currentWorkspace.id);
        await refreshWorkspaces();
      }

      setBranding(nextBranding);
    },
    [currentWorkspace, refreshWorkspaces],
  );

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

      const { data } = await (supabase as any)
        .from("faqs")
        .upsert(payload)
        .select("*")
        .single();

      setFaqs((prev) => {
        const filtered = prev.filter((item) => item.id !== data.id);
        return [...filtered, data].sort((a, b) => a.question.localeCompare(b.question));
      });
    },
    [currentWorkspace],
  );

  const removeFaq = useCallback(async (faqId: string) => {
    await (supabase as any).from("faqs").delete().eq("id", faqId);
    setFaqs((prev) => prev.filter((faq) => faq.id !== faqId));
  }, []);

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

      const { data } = await (supabase as any)
        .from("products")
        .upsert(payload)
        .select("*")
        .single();

      setProducts((prev) => {
        const filtered = prev.filter((item) => item.id !== data.id);
        return [...filtered, data].sort((a, b) => a.name.localeCompare(b.name));
      });
    },
    [currentWorkspace],
  );

  const removeProduct = useCallback(async (productId: string) => {
    await (supabase as any).from("products").delete().eq("id", productId);
    setProducts((prev) => prev.filter((product) => product.id !== productId));
  }, []);

  return {
    currentWorkspace,
    loading,
    agentConfig,
    branding,
    faqs,
    products,
    refresh,
    saveAgentConfig,
    saveBranding,
    upsertFaq,
    removeFaq,
    upsertProduct,
    removeProduct,
  };
}
