// Regras de exibição dos direitos do tenant (plano, limites, status). Sem I/O: testável.
import type { EffectiveTenantStatus, Entitlements, FeatureKey, NumericLimitKey, TenantStatus } from "./database.types";

export const USAGE_BY_LIMIT: Record<NumericLimitKey, keyof Entitlements["usage"]> = {
  max_instances: "instances",
  max_members: "members",
  max_monthly_messages: "monthly_messages",
  max_knowledge_sources: "knowledge_sources",
};

export const LIMIT_LABEL: Record<NumericLimitKey, string> = {
  max_instances: "Instâncias de WhatsApp",
  max_members: "Membros da equipe",
  max_monthly_messages: "Mensagens automáticas no mês",
  max_knowledge_sources: "Fontes de conhecimento",
};

export const FEATURE_LABEL: Record<FeatureKey, string> = {
  ai_enabled: "IA (respostas, áudio e imagem)",
  external_agent_enabled: "Agente externo (n8n etc.)",
  connectors_enabled: "Conectores (hbook)",
};

export const STATUS_LABEL: Record<EffectiveTenantStatus, string> = {
  trial: "Avaliação",
  active: "Ativo",
  suspended: "Suspenso",
  canceled: "Cancelado",
  trial_expired: "Avaliação vencida",
};

export function statusToneOf(status: EffectiveTenantStatus | TenantStatus): "green" | "amber" | "red" | "neutral" | "blue" {
  switch (status) {
    case "active":
      return "green";
    case "trial":
      return "blue";
    case "trial_expired":
    case "suspended":
      return "red";
    default:
      return "neutral";
  }
}

export interface LimitState {
  limit: number | null;
  used: number;
  /** null = ilimitado */
  ratio: number | null;
  reached: boolean;
}

export function limitState(ent: Entitlements | null | undefined, key: NumericLimitKey): LimitState {
  const used = Number(ent?.usage?.[USAGE_BY_LIMIT[key]] ?? 0);
  const raw = ent?.limits?.[key];
  const limit = raw === null || raw === undefined ? null : Number(raw);
  if (limit === null) return { limit, used, ratio: null, reached: false };
  return { limit, used, ratio: limit === 0 ? 1 : used / limit, reached: used >= limit };
}

export function hasFeature(ent: Entitlements | null | undefined, key: FeatureKey): boolean {
  // Enquanto carrega, não bloqueia nada: o backend é quem decide de verdade.
  return ent ? ent.limits?.[key] !== false : true;
}

export interface CreateGate {
  allowed: boolean;
  reason: string | null;
}

/** Pode criar mais um recurso deste tipo? */
export function createGate(ent: Entitlements | null | undefined, key: NumericLimitKey): CreateGate {
  if (!ent) return { allowed: true, reason: null };
  if (!ent.active) return { allowed: false, reason: inactiveReason(ent) };
  const st = limitState(ent, key);
  if (st.reached) {
    return { allowed: false, reason: `Limite do plano atingido: ${st.used} de ${st.limit} (${LIMIT_LABEL[key].toLowerCase()}). Fale com o suporte para ampliar.` };
  }
  return { allowed: true, reason: null };
}

export function inactiveReason(ent: Entitlements): string {
  switch (ent.effective_status) {
    case "suspended":
      return `Workspace suspenso${ent.suspended_reason ? `: ${ent.suspended_reason}` : ""}.`;
    case "canceled":
      return "Workspace cancelado.";
    case "trial_expired":
      return "O período de avaliação terminou.";
    default:
      return "Workspace inativo.";
  }
}

export function daysUntil(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - now.getTime()) / 86_400_000);
}

export interface Banner {
  tone: "red" | "amber";
  message: string;
}

/** Aviso do topo do painel; o mais grave vence. */
export function bannerFor(ent: Entitlements | null | undefined, now: Date): Banner | null {
  if (!ent) return null;
  if (ent.effective_status === "suspended" || ent.effective_status === "canceled") {
    const what = ent.effective_status === "suspended" ? "suspenso" : "cancelado";
    return {
      tone: "red",
      message: `Workspace ${what}${ent.suspended_reason ? `: ${ent.suspended_reason}` : ""}. Fale com o suporte. O bot, os envios e a API estão pausados; as mensagens recebidas continuam sendo guardadas.`,
    };
  }
  if (ent.effective_status === "trial_expired") {
    return {
      tone: "red",
      message: "O período de avaliação terminou. O bot, os envios e a API estão pausados até a contratação de um plano. Fale com o suporte.",
    };
  }
  const quota = limitState(ent, "max_monthly_messages");
  if (quota.ratio !== null && quota.ratio >= 1) {
    return {
      tone: "red",
      message: `Cota mensal de mensagens automáticas esgotada (${quota.used} de ${quota.limit}). O bot parou de responder e as conversas novas vão para a equipe até o próximo mês ou a ampliação do plano.`,
    };
  }
  if (quota.ratio !== null && quota.ratio >= 0.8) {
    return {
      tone: "amber",
      message: `Você já usou ${Math.round(quota.ratio * 100)}% da cota mensal de mensagens automáticas (${quota.used} de ${quota.limit}).`,
    };
  }
  if (ent.effective_status === "trial") {
    const days = daysUntil(ent.trial_ends_at, now);
    if (days !== null && days <= 3) {
      return {
        tone: "amber",
        message: days <= 0 ? "A avaliação termina hoje." : `A avaliação termina em ${days} dia${days === 1 ? "" : "s"}.`,
      };
    }
  }
  return null;
}

export function formatLimit(limit: number | null | undefined): string {
  return limit === null || limit === undefined ? "ilimitado" : new Intl.NumberFormat("pt-BR").format(limit);
}
