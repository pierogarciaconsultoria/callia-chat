import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { buildJourney } from "@/lib/onboarding";

type RpcResult = { data: string | null; error: { message: string } | null };
const mocks = vi.hoisted(() => ({
  rpc: vi.fn<(name: string, params: Record<string, unknown>) => Promise<RpcResult>>(async () => ({ data: "ws-1", error: null })),
  refresh: vi.fn(async () => {}),
  auth: { user: { id: "u1", user_metadata: { company_name: "Pousada Alfa", segment: "hotelaria" } as Record<string, string> }, loading: false },
  ws: { workspace: null as null | { name: string; status: string; trial_ends_at: string | null }, loading: false, refresh: vi.fn(async () => {}) },
}));
mocks.ws.refresh = mocks.refresh;
const journey = buildJourney({ businessInfo: false, agentGenerated: false, segment: "hotelaria", ownKnowledge: 0, bookingConnected: false, tested: false, whatsapp: false, members: 1, conversations: 0 });
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: mocks.rpc }, isSupabaseConfigured: true }));
vi.mock("@/lib/auth", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/lib/workspace", () => ({ useWorkspace: () => mocks.ws }));
vi.mock("@/lib/site", () => ({ useSiteInfo: () => ({ data: undefined, isLoading: false }) }));
vi.mock("@/hooks/use-journey", () => ({ useJourney: () => ({ journey, hidden: false, setHidden: vi.fn(), skip: vi.fn() }) }));

import Welcome from "@/pages/Welcome";

const show = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    <MemoryRouter><Welcome /></MemoryRouter>
  </QueryClientProvider>,
);

afterEach(() => {
  cleanup();
  mocks.rpc.mockClear();
  mocks.refresh.mockClear();
  mocks.ws.workspace = null;
  mocks.auth.user = { id: "u1", user_metadata: { company_name: "Pousada Alfa", segment: "hotelaria" } };
});

describe("boas-vindas e onboarding", () => {
  it("sem workspace e com os dados do cadastro: cria sozinho e recarrega", async () => {
    show();
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("create_workspace_from_signup", {}));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });

  it("login social sem dados do cadastro: pede o nome da empresa", async () => {
    mocks.auth.user = { id: "u2", user_metadata: {} };
    show();
    fireEvent.change(screen.getByLabelText("Nome da empresa"), { target: { value: "Clínica Google" } });
    fireEvent.change(screen.getByLabelText("Segmento"), { target: { value: "saude" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar meu espaço" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("create_workspace_from_signup", { p_name: "Clínica Google", p_segment: "saude" }));
  });

  it("autoatendimento desligado: explica em vez de quebrar", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "self_service_disabled" } });
    show();
    expect(await screen.findByText(/disponível por convite/)).toBeTruthy();
  });

  it("com workspace em trial: mostra o prazo, as etapas e o primeiro passo da jornada", () => {
    mocks.ws.workspace = { name: "Pousada Alfa", status: "trial", trial_ends_at: "2026-11-11T12:00:00Z" };
    show();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Tudo pronto, Pousada Alfa!");
    expect(screen.getByText(/Seu teste grátis vai até 11 de novembro/)).toBeTruthy();
    expect(screen.getByText("Dados da empresa")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Começar: Dados da empresa/ }).getAttribute("href")).toBe("/knowledge-base?tab=empresa");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
