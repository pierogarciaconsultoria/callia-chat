import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { memberLabel, normalizePhone } from "@/hooks/use-routing";

const mocks = vi.hoisted(() => ({
  routing: { data: { workspace_id: "ws", assignment_mode: "shared", agent_visibility: "all", sticky_claim: false, updated_at: "" }, isLoading: false },
  update: { mutate: vi.fn((_patch: Record<string, unknown>, opts?: { onSuccess?: () => void }) => { opts?.onSuccess?.(); }), isPending: false },
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/hooks/use-routing", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/hooks/use-routing")>()), useRouting: () => mocks.routing, useUpdateRouting: () => mocks.update }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/components/ui", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui")>()), useToast: () => mocks.toast }));

import { RoutingSettingsCard } from "@/components/team/RoutingCards";

afterEach(() => {
  cleanup();
  mocks.update.mutate.mockClear();
});

describe("distribuição de conversas", () => {
  it("normaliza telefone e rotula o operador pelo e-mail", () => {
    expect(normalizePhone("+55 (48) 99999-0000")).toBe("5548999990000");
    expect(memberLabel([{ user_id: "u1", email: "ana@pousada.com", display_name: null, role: "agent", is_support: false, created_at: "" }], "u1")).toBe("ana");
    expect(memberLabel([{ user_id: "u1", email: "ana@pousada.com", display_name: "Ana Souza", role: "agent", is_support: false, created_at: "" }], "u1")).toBe("Ana Souza");
    expect(memberLabel([], "u9")).toBe("outro operador");
    expect(memberLabel([], null)).toBeNull();
  });

  it("muda o modo e a visibilidade; o vínculo ao assumir só aparece em carteira", async () => {
    render(<RoutingSettingsCard workspaceId="ws" />);
    expect(screen.queryByText(/Quem assume um cliente novo/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Quando a IA transfere para a equipe"), { target: { value: "portfolio" } });
    await waitFor(() => expect(mocks.update.mutate).toHaveBeenCalledWith({ assignment_mode: "portfolio" }, expect.anything()));
    fireEvent.change(screen.getByLabelText("O que o atendente vê na inbox"), { target: { value: "own" } });
    await waitFor(() => expect(mocks.update.mutate).toHaveBeenCalledWith({ agent_visibility: "own" }, expect.anything()));
    expect(mocks.toast.success).toHaveBeenCalledWith("Distribuição atualizada.");
  });
});
