// Direitos efetivos do tenant (plano + overrides + status + uso), vindos de get_workspace_entitlements.
import { RuntimeError } from "./http.ts";

export interface Entitlements {
  workspace_id: string;
  status: "trial" | "active" | "suspended" | "canceled";
  effective_status: "trial" | "active" | "suspended" | "canceled" | "trial_expired";
  active: boolean;
  trial_ends_at: string | null;
  suspended_reason: string | null;
  plan: { id: string; code: string; name: string } | null;
  limits: {
    max_instances: number | null;
    max_members: number | null;
    max_monthly_messages: number | null;
    max_knowledge_sources: number | null;
    ai_enabled: boolean;
    external_agent_enabled: boolean;
    connectors_enabled: boolean;
  };
  usage: {
    monthly_messages: number;
    monthly_inbound: number;
    monthly_ai_runs: number;
    monthly_ai_tokens: number;
    instances: number;
    members: number;
    knowledge_sources: number;
  };
}

export type CountedResource = "instances" | "members" | "knowledge_sources";
export type Feature = "ai_enabled" | "external_agent_enabled" | "connectors_enabled";

const RESOURCE_LIMIT: Record<CountedResource, keyof Entitlements["limits"]> = {
  instances: "max_instances",
  members: "max_members",
  knowledge_sources: "max_knowledge_sources",
};

const RESOURCE_LABEL: Record<CountedResource, string> = {
  instances: "instâncias de WhatsApp",
  members: "membros na equipe",
  knowledge_sources: "fontes na base de conhecimento",
};

const FEATURE_LABEL: Record<Feature, string> = {
  ai_enabled: "IA",
  external_agent_enabled: "agente externo",
  connectors_enabled: "conectores",
};

const INACTIVE_MESSAGE: Record<string, string> = {
  suspended: "Workspace suspenso. Fale com o suporte da plataforma.",
  canceled: "Workspace cancelado.",
  trial_expired: "O período de avaliação terminou. Fale com o suporte para contratar um plano.",
};

// deno-lint-ignore no-explicit-any
type Db = any;

export async function loadEntitlements(db: Db, workspaceId: string): Promise<Entitlements> {
  const { data, error } = await db.rpc("get_workspace_entitlements", { p_workspace_id: workspaceId });
  if (error || !data) throw new RuntimeError("internal_error", "Falha ao carregar o plano do workspace.", { db: error?.message });
  return data as Entitlements;
}

export function assertActive(ent: Entitlements): void {
  if (!ent.active) {
    throw new RuntimeError("tenant_inactive", INACTIVE_MESSAGE[ent.effective_status] ?? "Workspace inativo.", {
      status: ent.effective_status,
      reason: ent.suspended_reason,
    });
  }
}

export function hasFeature(ent: Entitlements, feature: Feature): boolean {
  return ent.limits[feature] !== false;
}

export function assertFeature(ent: Entitlements, feature: Feature): void {
  if (!hasFeature(ent, feature)) {
    throw new RuntimeError("feature_not_in_plan", `O plano deste workspace não inclui ${FEATURE_LABEL[feature]}.`, { feature });
  }
}

/** Para criar mais um recurso contado (instância, membro, fonte). */
export function assertCanAdd(ent: Entitlements, resource: CountedResource): void {
  const limit = ent.limits[RESOURCE_LIMIT[resource]] as number | null;
  const used = ent.usage[resource];
  if (limit !== null && limit !== undefined && used >= limit) {
    throw new RuntimeError("plan_limit_reached", `Limite do plano atingido: ${limit} ${RESOURCE_LABEL[resource]}.`, {
      resource,
      limit,
      used,
    });
  }
}

export function monthlyMessagesLeft(ent: Entitlements): number | null {
  const limit = ent.limits.max_monthly_messages;
  return limit === null || limit === undefined ? null : Math.max(0, limit - ent.usage.monthly_messages);
}

export function assertMonthlyQuota(ent: Entitlements): void {
  const left = monthlyMessagesLeft(ent);
  if (left !== null && left <= 0) {
    throw new RuntimeError("quota_exceeded", "Cota mensal de mensagens automáticas do plano esgotada.", {
      limit: ent.limits.max_monthly_messages,
      used: ent.usage.monthly_messages,
    });
  }
}

export interface PlanLimits {
  max_instances: number | null;
  max_members: number | null;
  max_monthly_messages: number | null;
  max_knowledge_sources: number | null;
  ai_enabled: boolean;
  external_agent_enabled: boolean;
  connectors_enabled: boolean;
}

/** Mesma regra de get_workspace_entitlements: plano + overrides do cliente (override vence; null = ilimitado). */
export function effectiveLimits(plan: Partial<PlanLimits> | null | undefined, overrides: Record<string, unknown> | null | undefined): PlanLimits {
  return {
    max_instances: plan?.max_instances ?? null,
    max_members: plan?.max_members ?? null,
    max_monthly_messages: plan?.max_monthly_messages ?? null,
    max_knowledge_sources: plan?.max_knowledge_sources ?? null,
    ai_enabled: plan?.ai_enabled ?? true,
    external_agent_enabled: plan?.external_agent_enabled ?? true,
    connectors_enabled: plan?.connectors_enabled ?? true,
    ...(overrides ?? {}),
  } as PlanLimits;
}
