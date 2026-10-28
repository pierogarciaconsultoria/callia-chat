import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { SiteInfo } from "@/lib/site";

const trial = { code: "trial", name: "Avaliação", description: "Período de teste.", price_cents: null, currency: "BRL", max_instances: 1, max_members: 3, max_monthly_messages: 500, max_knowledge_sources: 20, connectors_enabled: true, external_agent_enabled: true };
const essencial = { ...trial, code: "essencial", name: "Essencial", description: null, price_cents: 14900, max_members: 5, max_monthly_messages: 3000, max_knowledge_sources: 100 };
const premium = { ...trial, code: "premium", name: "Premium", description: null, price_cents: null, max_instances: null, max_members: null, max_monthly_messages: null, max_knowledge_sources: null };
const site = { data: { platform_name: "Callia Chat", support_email: "oi@callia.com", self_service: true, trial_days: 14, plans: [trial, essencial, premium] } as SiteInfo, isLoading: false };
const auth = { user: null as null | { id: string }, loading: false };
vi.mock("@/lib/site", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/site")>()), useSiteInfo: () => site }));
vi.mock("@/lib/auth", () => ({ useAuth: () => auth }));

import Landing from "@/pages/Landing";

const show = () => render(<MemoryRouter><Landing /></MemoryRouter>);

afterEach(() => {
  cleanup();
  site.data = { ...site.data, self_service: true, support_email: "oi@callia.com" };
  auth.user = null;
});

describe("landing comercial", () => {
  it("chamada principal leva ao cadastro quando o autoatendimento está ligado", () => {
    show();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/Responda cada cliente em segundos/);
    const ctas = screen.getAllByRole("link", { name: /Começar teste grátis/ });
    expect(ctas.length).toBeGreaterThan(1);
    expect(ctas.every((a) => a.getAttribute("href") === "/cadastro")).toBe(true);
    expect(screen.getAllByText(/14 dias grátis/).length).toBeGreaterThan(0);
    // Cabeçalho e rodapé têm "Entrar"; os dois levam ao login.
    expect(screen.getAllByRole("link", { name: "Entrar" }).map((a) => a.getAttribute("href"))).toEqual(["/entrar", "/entrar"]);
  });

  it("planos vêm da plataforma, com limites em frases e preço formatado", () => {
    show();
    expect(screen.getByText("Essencial")).toBeTruthy();
    expect(screen.getByText("R$ 149/mês")).toBeTruthy();
    expect(screen.getByText("3.000 mensagens automáticas por mês")).toBeTruthy();
    expect(screen.getByText("Comece por aqui")).toBeTruthy(); // plano de avaliação em destaque
    // Plano sob consulta: chamada de contato em vez de cadastro.
    expect(screen.getByText("Sob consulta")).toBeTruthy();
    expect(screen.getByText("números de WhatsApp sem limite")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /Falar com a gente/ })[0].getAttribute("href")).toMatch(/^mailto:/);
  });

  it("sem autoatendimento: chamada vira contato por e-mail; logado: vai para o painel", () => {
    site.data = { ...site.data, self_service: false };
    show();
    expect(screen.queryByRole("link", { name: /Começar teste grátis/ })).toBeNull();
    expect(screen.getAllByRole("link", { name: /Falar com a gente/ })[0].getAttribute("href")).toMatch(/^mailto:oi@callia\.com/);
    cleanup();
    auth.user = { id: "u1" };
    show();
    expect(screen.getByRole("link", { name: /Ir para o painel/ }).getAttribute("href")).toBe("/dashboard");
  });

  it("perguntas frequentes e segmentos aparecem", () => {
    show();
    expect(screen.getByText("Preciso trocar de número ou de chip?")).toBeTruthy();
    expect(screen.getByText("Hotelaria e hospedagem")).toBeTruthy();
  });
});
