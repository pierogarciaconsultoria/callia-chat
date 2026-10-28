import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(async (_fn: string, body: Record<string, unknown>) => {
    if (body.action === "chat") return { reply: "Proponho a Kitnet a R$ 450 na alta. Confirma no cartão?", proposals: [{ id: "prop-1", kind: "price_table", title: "Tabela de preços", changes: ["Kitnet, até 2 pessoas, Alta temporada: R$ 420,00 → R$ 450,00"] }], navigation: null };
    return { ok: true, status: "applied" };
  }),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/functions", () => ({ invokeFunction: mocks.invoke }));
vi.mock("@/lib/workspace", () => ({ useWorkspace: () => ({ workspaceId: "ws-1", isAdmin: true }) }));
vi.mock("@/components/ui", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui")>()), useToast: () => mocks.toast }));

import { AssistantDrawer } from "@/components/assistant/AssistantDrawer";

const show = () => render(
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter><AssistantDrawer /></MemoryRouter>
  </QueryClientProvider>,
);

afterEach(() => {
  cleanup();
  mocks.invoke.mockClear();
});

describe("assistente do painel", () => {
  it("envia o pedido com o histórico, mostra a proposta e grava só ao confirmar", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Abrir assistente" }));
    fireEvent.change(screen.getByLabelText("Mensagem para o assistente"), { target: { value: "kitnet na alta vai para 450" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("assistant", { action: "chat", workspace_id: "ws-1", messages: [{ role: "user", content: "kitnet na alta vai para 450" }] }));
    expect(await screen.findByText(/Kitnet, até 2 pessoas, Alta temporada/)).toBeTruthy();
    expect(mocks.invoke).toHaveBeenCalledTimes(1); // nada gravado ainda
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("assistant", { action: "apply", workspace_id: "ws-1", proposal_id: "prop-1" }));
    expect(await screen.findByText("Aplicado")).toBeTruthy();
    expect(mocks.toast.success).toHaveBeenCalledWith("Alteração aplicada.");
  });

  it("descartar não grava", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Abrir assistente" }));
    fireEvent.click(screen.getByText("A kitnet na alta temporada passa a 450")); // sugestão
    expect(await screen.findByText("Tabela de preços")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("assistant", { action: "discard", workspace_id: "ws-1", proposal_id: "prop-1" }));
    expect(await screen.findByText("Descartado")).toBeTruthy();
  });
});
