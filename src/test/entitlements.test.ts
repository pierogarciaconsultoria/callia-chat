import { describe, expect, it } from "vitest";
import {
  assertActive, assertCanAdd, assertFeature, assertMonthlyQuota, effectiveLimits, type Entitlements, hasFeature, monthlyMessagesLeft,
} from "../../supabase/functions/_shared/entitlements.ts";

function ent(overrides: Partial<Entitlements> = {}, limits: Partial<Entitlements["limits"]> = {}, usage: Partial<Entitlements["usage"]> = {}): Entitlements {
  return {
    workspace_id: "ws", status: "active", effective_status: "active", active: true, trial_ends_at: null, suspended_reason: null,
    plan: { id: "p", code: "essencial", name: "Essencial" },
    limits: { max_instances: 1, max_members: 5, max_monthly_messages: 100, max_knowledge_sources: 10, ai_enabled: true, external_agent_enabled: true, connectors_enabled: true, ...limits },
    usage: { monthly_messages: 0, monthly_inbound: 0, monthly_ai_runs: 0, monthly_ai_tokens: 0, instances: 0, members: 1, knowledge_sources: 0, ...usage },
    ...overrides,
  };
}

describe("direitos do tenant", () => {
  it("bloqueia tenant suspenso, cancelado ou com trial vencido com mensagem própria", () => {
    expect(() => assertActive(ent())).not.toThrow();
    const err = (e: Entitlements) => { try { assertActive(e); } catch (x) { return x as { code: string; message: string; details: Record<string, unknown> }; } };
    expect(err(ent({ active: false, status: "suspended", effective_status: "suspended", suspended_reason: "inadimplência" })))
      .toMatchObject({ code: "tenant_inactive", details: { status: "suspended", reason: "inadimplência" } });
    expect(err(ent({ active: false, status: "trial", effective_status: "trial_expired" }))?.message).toMatch(/avaliação terminou/);
  });

  it("limite de recursos contados (instâncias, membros, fontes)", () => {
    expect(() => assertCanAdd(ent({}, {}, { instances: 0 }), "instances")).not.toThrow();
    expect(() => assertCanAdd(ent({}, {}, { instances: 1 }), "instances")).toThrow(/1 instâncias/);
    expect(() => assertCanAdd(ent({}, { max_knowledge_sources: null }, { knowledge_sources: 999 }), "knowledge_sources")).not.toThrow();
  });

  it("recursos do plano e cota mensal", () => {
    expect(hasFeature(ent({}, { ai_enabled: false }), "ai_enabled")).toBe(false);
    expect(() => assertFeature(ent({}, { connectors_enabled: false }), "connectors_enabled")).toThrow(/conectores/);
    expect(monthlyMessagesLeft(ent({}, {}, { monthly_messages: 40 }))).toBe(60);
    expect(monthlyMessagesLeft(ent({}, { max_monthly_messages: null }))).toBeNull();
    expect(() => assertMonthlyQuota(ent({}, {}, { monthly_messages: 100 }))).toThrow(expect.objectContaining({ code: "quota_exceeded", status: 429 }));
  });

  it("limites efetivos: override do cliente vence o plano; sem plano é ilimitado", () => {
    expect(effectiveLimits(null, {})).toMatchObject({ max_instances: null, ai_enabled: true });
    expect(effectiveLimits({ max_instances: 1, ai_enabled: true }, { max_instances: 5, ai_enabled: false }))
      .toMatchObject({ max_instances: 5, ai_enabled: false, max_members: null });
  });
});
