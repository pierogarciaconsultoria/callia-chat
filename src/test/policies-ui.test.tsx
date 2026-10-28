import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { normalizeTopic, policyTopicLabel } from "@/lib/policies";

const mocks = vi.hoisted(() => ({
  save: { mutateAsync: vi.fn(async (row: Record<string, unknown>) => row), isPending: false },
  remove: { mutateAsync: vi.fn(async () => {}) },
  list: { data: [] as Array<Record<string, unknown>>, isLoading: false },
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/hooks/use-knowledge", () => ({ usePolicies: () => mocks.list, useTableCrud: () => mocks }));
vi.mock("@/components/ui", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui")>()), useToast: () => mocks.toast }));

import { PoliciesCard } from "@/components/PoliciesCard";

afterEach(() => {
  cleanup();
  mocks.save.mutateAsync.mockClear();
  mocks.list.data = [];
});

describe("políticas da empresa", () => {
  it("assuntos: rótulo conhecido, normalização do assunto livre", () => {
    expect(policyTopicLabel("checkin")).toBe("Check-in");
    expect(policyTopicLabel("toalhas")).toBe("toalhas");
    expect(normalizeTopic("Troca de Toalhas!")).toBe("troca_de_toalhas");
    expect(normalizeTopic("  Ação ")).toBe("acao");
  });

  it("cria uma política com assunto, título e texto", async () => {
    render(<PoliciesCard workspaceId="ws" />);
    expect(screen.getByText("Nenhuma política cadastrada")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Nova política/ }));
    fireEvent.change(screen.getByLabelText("Assunto"), { target: { value: "checkin" } });
    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "Check-in" } });
    fireEvent.change(screen.getByLabelText("Texto"), { target: { value: "Das 14h às 22h." } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(mocks.save.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ topic: "checkin", title: "Check-in", content: "Das 14h às 22h.", active: true, position: 0 })));
  });

  it("assunto livre vira identificador normalizado; lista mostra rótulo e texto", async () => {
    mocks.list.data = [{ id: "p1", workspace_id: "ws", topic: "pets", title: "Animais de estimação", content: "Não é permitido trazer animais.", active: true, position: 0, created_at: "", updated_at: "" }];
    render(<PoliciesCard workspaceId="ws" />);
    expect(screen.getByText("Animais de estimação")).toBeTruthy();
    expect(screen.getByText("Animais")).toBeTruthy(); // rótulo do assunto
    expect(screen.getByText("Não é permitido trazer animais.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Nova política/ }));
    fireEvent.change(screen.getByLabelText("Assunto"), { target: { value: "__outro" } });
    fireEvent.change(screen.getByLabelText("Qual assunto?"), { target: { value: "Troca de toalhas" } });
    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "Toalhas" } });
    fireEvent.change(screen.getByLabelText("Texto"), { target: { value: "Troca diária." } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(mocks.save.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ topic: "troca_de_toalhas", position: 1 })));
  });
});
