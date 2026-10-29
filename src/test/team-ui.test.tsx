import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(async (_fn: string, _body: Record<string, unknown>) => ({ user_id: "u2", invited: true })),
  toast: { success: vi.fn(), error: vi.fn() },
  rpc: vi.fn(async () => ({ data: [], error: null })),
}));
vi.mock("@/lib/functions", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/functions")>()), invokeFunction: mocks.invoke }));
vi.mock("@/lib/workspace", () => ({ useRequiredWorkspace: () => ({ workspaceId: "ws-1", isAdmin: true, isOwner: true }) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock("@/hooks/use-entitlements", () => ({ useEntitlements: () => ({ data: null }), invalidateEntitlements: vi.fn() }));
vi.mock("@/hooks/use-routing", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/hooks/use-routing")>()), useRouting: () => ({ data: null }), useUpdateRouting: () => ({ mutate: vi.fn(), isPending: false }) }));
vi.mock("@/components/ui", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui")>()), useToast: () => mocks.toast }));

import Team from "@/pages/Team";

const show = () => render(
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter><Team /></MemoryRouter>
  </QueryClientProvider>,
);

afterEach(() => {
  cleanup();
  mocks.invoke.mockClear();
  mocks.toast.success.mockClear();
  mocks.toast.error.mockClear();
});

describe("equipe: adicionar membro", () => {
  it("convida pelo e-mail quando a pessoa ainda não tem usuário", async () => {
    show();
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: " Contato@MoradaDoSol.tur.br " } });
    fireEvent.click(screen.getByRole("button", { name: /Adicionar/ }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("team", { action: "invite", workspace_id: "ws-1", email: "Contato@MoradaDoSol.tur.br", role: "agent" }));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(expect.stringMatching(/^Convite enviado para Contato@MoradaDoSol\.tur\.br/)));
  });

  it("avisa 'Membro adicionado' quando o usuário já existia e traduz o limite do plano", async () => {
    mocks.invoke.mockResolvedValueOnce({ user_id: "u3", invited: false });
    show();
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "ana@pousada.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Adicionar/ }));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith("Membro adicionado."));

    mocks.invoke.mockRejectedValueOnce(Object.assign(new Error("member_limit_reached"), { code: "member_limit_reached" }));
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "bia@pousada.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Adicionar/ }));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(expect.stringMatching(/Limite de membros/)));
  });
});
