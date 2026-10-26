import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { bannerFor, createGate, hasFeature, limitState } from "@/lib/entitlements";
import { ApiError, errorMessage } from "@/lib/functions";
import { UsageBar } from "@/components/UsageBar";
import type { Entitlements } from "@/lib/database.types";

function ent(over: Partial<Entitlements> = {}, usage: Partial<Entitlements["usage"]> = {}, limits: Partial<Entitlements["limits"]> = {}): Entitlements {
  return {
    workspace_id: "w",
    status: "active",
    effective_status: "active",
    active: true,
    trial_ends_at: null,
    suspended_reason: null,
    plan: { id: "p", code: "essencial", name: "Essencial" },
    limits: {
      max_instances: 1,
      max_members: 5,
      max_monthly_messages: 1000,
      max_knowledge_sources: null,
      ai_enabled: true,
      external_agent_enabled: false,
      connectors_enabled: true,
      ...limits,
    },
    usage: {
      period_start: "2026-10-01T00:00:00Z",
      monthly_messages: 0,
      monthly_inbound: 0,
      monthly_ai_runs: 0,
      monthly_ai_tokens: 0,
      instances: 0,
      members: 1,
      knowledge_sources: 0,
      ...usage,
    },
    ...over,
  };
}

const now = new Date("2026-10-26T12:00:00Z");

describe("limites do plano", () => {
  it("calcula uso, ilimitado e bloqueio de criação", () => {
    expect(limitState(ent({}, { instances: 1 }), "max_instances")).toMatchObject({ limit: 1, used: 1, reached: true });
    expect(limitState(ent(), "max_knowledge_sources")).toMatchObject({ limit: null, ratio: null, reached: false });
    expect(createGate(ent({}, { instances: 1 }), "max_instances").allowed).toBe(false);
    expect(createGate(ent(), "max_instances")).toEqual({ allowed: true, reason: null });
    expect(createGate(undefined, "max_instances").allowed).toBe(true);
  });

  it("tenant inativo bloqueia criação mesmo dentro do limite", () => {
    const gate = createGate(ent({ status: "suspended", effective_status: "suspended", active: false, suspended_reason: "inadimplência" }), "max_members");
    expect(gate).toEqual({ allowed: false, reason: "Workspace suspenso: inadimplência." });
  });

  it("recursos do plano", () => {
    expect(hasFeature(ent(), "external_agent_enabled")).toBe(false);
    expect(hasFeature(ent(), "ai_enabled")).toBe(true);
    expect(hasFeature(undefined, "ai_enabled")).toBe(true);
  });
});

describe("aviso do topo", () => {
  it("suspensão vence tudo e mostra o motivo", () => {
    const b = bannerFor(ent({ status: "suspended", effective_status: "suspended", active: false, suspended_reason: "pagamento em atraso" }, { monthly_messages: 2000 }), now);
    expect(b?.tone).toBe("red");
    expect(b?.message).toContain("suspenso: pagamento em atraso");
  });

  it("cota: 80% avisa, 100% bloqueia", () => {
    expect(bannerFor(ent({}, { monthly_messages: 800 }), now)).toMatchObject({ tone: "amber" });
    expect(bannerFor(ent({}, { monthly_messages: 1000 }), now)).toMatchObject({ tone: "red" });
    expect(bannerFor(ent({}, { monthly_messages: 799 }), now)).toBeNull();
  });

  it("avaliação: termina em breve e vencida", () => {
    const ending = bannerFor(ent({ status: "trial", effective_status: "trial", trial_ends_at: "2026-10-28T12:00:00Z" }), now);
    expect(ending).toEqual({ tone: "amber", message: "A avaliação termina em 2 dias." });
    expect(bannerFor(ent({ status: "trial", effective_status: "trial", trial_ends_at: "2026-11-20T12:00:00Z" }), now)).toBeNull();
    expect(bannerFor(ent({ status: "trial", effective_status: "trial_expired", active: false }), now)?.tone).toBe("red");
  });
});

describe("mensagens de erro do plano", () => {
  it("traduz códigos crus das RPCs e mantém texto específico das functions", () => {
    expect(errorMessage(new ApiError("member_limit_reached", "54000"))).toContain("Limite de membros");
    expect(errorMessage(new ApiError("Limite de 1 instância(s) do plano atingido.", "plan_limit_reached", 403))).toBe("Limite de 1 instância(s) do plano atingido.");
    expect(errorMessage(new ApiError("tenant_inactive", "tenant_inactive", 403))).toContain("suspenso");
    expect(errorMessage(new Error("self_service_disabled"))).toContain("criação de workspaces está desativada");
    expect(errorMessage(new Error("outra coisa"))).toBe("outra coisa");
  });
});

describe("barra de uso", () => {
  it("mostra ilimitado e contagem", () => {
    render(
      <>
        <UsageBar label="Mensagens" used={1200} limit={null} />
        <UsageBar label="Instâncias" used={1} limit={3} />
      </>,
    );
    expect(screen.getByText("1.200 / ilimitado")).toBeTruthy();
    expect(screen.getByText("1 / 3")).toBeTruthy();
  });
});
