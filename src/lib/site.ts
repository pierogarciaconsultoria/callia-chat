// Informações públicas do site (landing e cadastro): planos ativos e configurações da plataforma, sem login.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { unwrap } from "./functions";

export interface SitePlan {
  code: string;
  name: string;
  description: string | null;
  price_cents: number | null;
  currency: string;
  max_instances: number | null;
  max_members: number | null;
  max_monthly_messages: number | null;
  max_knowledge_sources: number | null;
  connectors_enabled: boolean;
  external_agent_enabled: boolean;
}

export interface SiteInfo {
  platform_name: string;
  support_email: string | null;
  /** Cadastro aberto (platform_settings.allow_self_service_workspaces). */
  self_service: boolean;
  trial_days: number;
  plans: SitePlan[];
}

export const SITE_FALLBACK: SiteInfo = { platform_name: "Callia Chat", support_email: null, self_service: false, trial_days: 14, plans: [] };

export function useSiteInfo() {
  return useQuery({
    queryKey: ["site-info"],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<SiteInfo> => ({ ...SITE_FALLBACK, ...(unwrap(await supabase.rpc("public_site_info")) as Partial<SiteInfo>) }),
  });
}

/** "R$ 149/mês", "Grátis" ou "Sob consulta" (plano sem preço cadastrado). */
export function formatPlanPrice(plan: Pick<SitePlan, "price_cents" | "currency">): string {
  if (plan.price_cents === null || plan.price_cents === undefined) return "Sob consulta";
  if (plan.price_cents === 0) return "Grátis";
  const value = (plan.price_cents / 100).toLocaleString("pt-BR", { style: "currency", currency: plan.currency || "BRL", maximumFractionDigits: plan.price_cents % 100 ? 2 : 0 });
  return `${value}/mês`;
}

/** Limites do plano em frases curtas para o cartão de preço. */
export function planHighlights(plan: SitePlan): string[] {
  const n = (v: number) => v.toLocaleString("pt-BR");
  const count = (v: number | null, one: string, many: string) => (v === null ? `${many} sem limite` : v === 1 ? `1 ${one}` : `${n(v)} ${many}`);
  return [
    count(plan.max_instances, "número de WhatsApp", "números de WhatsApp"),
    count(plan.max_members, "pessoa na equipe", "pessoas na equipe"),
    plan.max_monthly_messages === null ? "Mensagens automáticas sem limite" : `${n(plan.max_monthly_messages)} mensagens automáticas por mês`,
    count(plan.max_knowledge_sources, "fonte na base de conhecimento", "fontes na base de conhecimento"),
    ...(plan.connectors_enabled ? ["Integração com sistema de reservas"] : []),
  ];
}
