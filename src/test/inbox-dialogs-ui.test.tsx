import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Conversation, Message } from "@/lib/database.types";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(async (_fn: string, _body: Record<string, unknown>) => ({ message: null, conversation_id: "c-dest", created: true })),
  toast: { success: vi.fn(), error: vi.fn() },
  navigate: vi.fn(),
}));
vi.mock("@/lib/functions", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/functions")>()), invokeFunction: mocks.invoke }));
vi.mock("@/components/ui", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui")>()), useToast: () => mocks.toast }));
vi.mock("react-router-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-router-dom")>()), useNavigate: () => mocks.navigate }));
vi.mock("@/hooks/use-inbox", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-inbox")>()),
  useConversations: () => ({
    data: [
      { id: "c-ana", channel: "whatsapp", contact_phone: "5548999990001", contact_name: "Ana", conversation_id: "c-ana" },
      { id: "c-origem", channel: "whatsapp", contact_phone: "5548999990002", contact_name: "Origem" },
      { id: "c-ext", channel: "site", contact_phone: "5548999990003", contact_name: "Externa" },
    ] as unknown as Conversation[],
  }),
}));

import { ForwardDialog } from "@/components/inbox/ForwardDialog";
import { NewConversationDialog } from "@/components/inbox/NewConversationDialog";

const wrap = (el: React.ReactElement) => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>{el}</MemoryRouter></QueryClientProvider>);
const message = { id: "m1", conversation_id: "c-origem", type: "document", content: null, media_url: null, metadata: { media_path: "ws/c-origem/m1.pdf", file_name: "contrato.pdf" } } as unknown as Message;

afterEach(() => {
  cleanup();
  mocks.invoke.mockClear();
  mocks.navigate.mockClear();
  mocks.toast.success.mockClear();
});

describe("diálogos da inbox", () => {
  it("encaminha para uma conversa escolhida (sem listar a origem nem as externas) e abre o destino", async () => {
    wrap(<ForwardDialog workspaceId="ws" message={message} onClose={() => {}} />);
    expect(screen.getByText("contrato.pdf")).toBeTruthy();
    expect(screen.queryByText("Origem")).toBeNull();
    expect(screen.queryByText("Externa")).toBeNull();
    const button = screen.getByRole("button", { name: /Encaminhar$/ });
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByText("Ana"));
    fireEvent.click(button);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("send-message", expect.objectContaining({ conversation_id: "c-ana", forward_message_id: "m1" })));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/inbox/c-dest"));
    expect(mocks.toast.success).toHaveBeenCalledWith("Encaminhado para Ana.");
  });

  it("encaminha para um número novo", async () => {
    wrap(<ForwardDialog workspaceId="ws" message={message} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Ou para um número novo"), { target: { value: "(48) 98888-7777" } });
    fireEvent.click(screen.getByRole("button", { name: /Encaminhar$/ }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("send-message", expect.objectContaining({ workspace_id: "ws", to_phone: "48988887777", forward_message_id: "m1" })));
  });

  it("nova conversa exige número e texto, envia e abre a conversa", async () => {
    wrap(<NewConversationDialog workspaceId="ws" open onClose={() => {}} />);
    const submit = screen.getByRole("button", { name: /Enviar/ });
    expect(submit.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("WhatsApp do cliente"), { target: { value: "48 99999 0000" } });
    fireEvent.change(screen.getByLabelText("Nome (opcional)"), { target: { value: "Bia" } });
    fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "Olá, tudo bem?" } });
    expect(submit.hasAttribute("disabled")).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("send-message", expect.objectContaining({ workspace_id: "ws", to_phone: "48999990000", contact_name: "Bia", text: "Olá, tudo bem?", type: "text" })));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/inbox/c-dest"));
    expect(mocks.toast.success).toHaveBeenCalledWith("Conversa iniciada com Bia.");
  });
});
