import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Conversation } from "@/lib/database.types";

const mocks = vi.hoisted(() => ({
  transfer: vi.fn(async (): Promise<{ assigned_user_id: string | null; department_id: string | null }> => ({ assigned_user_id: null, department_id: "d2" })),
  save: vi.fn(async (v: { name: string }) => v),
  remove: vi.fn(async () => null),
  setMember: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
const departments = {
  departments: [{ id: "d1", workspace_id: "ws", name: "Reservas", position: 0, created_at: "", updated_at: "" }, { id: "d2", workspace_id: "ws", name: "Financeiro", position: 1, created_at: "", updated_at: "" }],
  members: [{ department_id: "d1", workspace_id: "ws", user_id: "u-ana", created_at: "" }, { department_id: "d2", workspace_id: "ws", user_id: "u-bia", created_at: "" }],
};
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "u-me", email: "eu@pousada.com" } }) }));
vi.mock("@/hooks/use-routing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-routing")>()),
  useMembers: () => ({ data: [
    { user_id: "u-me", email: "eu@pousada.com", role: "owner", is_support: false, created_at: "" },
    { user_id: "u-ana", email: "ana@pousada.com", role: "agent", is_support: false, created_at: "" },
    { user_id: "u-bia", email: "bia@pousada.com", display_name: "Bia Lima", role: "agent", is_support: false, created_at: "" },
    { user_id: "u-sup", email: "suporte@callia.com", role: "admin", is_support: true, created_at: "" },
  ] }),
}));
vi.mock("@/hooks/use-departments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-departments")>()),
  useDepartments: () => ({ data: departments, isLoading: false }),
  useTransferConversation: () => ({ mutateAsync: mocks.transfer, isPending: false }),
  useDepartmentActions: () => ({ save: { mutateAsync: mocks.save, isPending: false }, remove: { mutateAsync: mocks.remove }, setMember: { mutate: mocks.setMember, isPending: false } }),
}));
vi.mock("@/components/ui", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui")>()), useToast: () => mocks.toast }));

import { TransferDialog } from "@/components/inbox/TransferDialog";
import { DepartmentsCard } from "@/components/team/DepartmentsCard";

const conversation = { id: "c1", workspace_id: "ws", department_id: "d1", assigned_user_id: "u-me", mode: "human", contact_phone: "5548999990000", contact_name: "Ana" } as unknown as Conversation;

afterEach(() => { cleanup(); mocks.transfer.mockClear(); mocks.save.mockClear(); mocks.setMember.mockClear(); mocks.toast.success.mockClear(); });

describe("transferência e setores", () => {
  it("transfere para um operador com nota (sem listar eu mesmo nem o suporte)", async () => {
    mocks.transfer.mockResolvedValueOnce({ assigned_user_id: "u-bia", department_id: "d1" });
    render(<TransferDialog workspaceId="ws" conversation={conversation} open onClose={() => {}} />);
    expect(screen.queryByText("eu")).toBeNull();
    expect(screen.queryByText("suporte")).toBeNull();
    const button = screen.getByRole("button", { name: /Transferir$/ });
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByText("Bia Lima"));
    fireEvent.change(screen.getByLabelText("Nota para quem recebe (opcional)"), { target: { value: "2ª via do boleto" } });
    fireEvent.click(button);
    await waitFor(() => expect(mocks.transfer).toHaveBeenCalledWith({ conversationId: "c1", userId: "u-bia", departmentId: null, note: "2ª via do boleto" }));
    expect(mocks.toast.success).toHaveBeenCalledWith("Conversa transferida para Bia Lima.");
  });

  it("transfere para um setor; o setor atual fica desabilitado", async () => {
    render(<TransferDialog workspaceId="ws" conversation={conversation} open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "Para um setor" }));
    expect((screen.getByRole("button", { name: /Reservas \(atual\)/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Financeiro/ }));
    fireEvent.click(screen.getByRole("button", { name: /Transferir$/ }));
    await waitFor(() => expect(mocks.transfer).toHaveBeenCalledWith({ conversationId: "c1", userId: null, departmentId: "d2", note: "" }));
    expect(mocks.toast.success).toHaveBeenCalledWith("Conversa transferida para o setor Financeiro.");
  });

  it("card de setores: cria, lista com os membros marcados e alterna vínculo", async () => {
    render(<DepartmentsCard workspaceId="ws" />);
    expect(screen.getByText("Reservas")).toBeTruthy();
    const anaEmReservas = screen.getByLabelText("ana@pousada.com em Reservas") as HTMLInputElement;
    expect(anaEmReservas.checked).toBe(true);
    expect((screen.getByLabelText("bia@pousada.com em Reservas") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByLabelText("bia@pousada.com em Reservas"));
    expect(mocks.setMember).toHaveBeenCalledWith({ department_id: "d1", user_id: "u-bia", member: true }, expect.anything());
    fireEvent.change(screen.getByLabelText("Novo setor"), { target: { value: "Recepção" } });
    fireEvent.click(screen.getByRole("button", { name: /Criar setor/ }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ name: "Recepção" }));
    expect(mocks.toast.success).toHaveBeenCalledWith("Setor criado.");
  });
});
