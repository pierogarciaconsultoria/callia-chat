import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { QuickReply } from "@/lib/database.types";

const replies: QuickReply[] = [
  { id: "q1", workspace_id: "ws", shortcut: "pix", title: "Chave PIX", content: "Chave PIX: CNPJ 00.000.000/0001-00", media_path: null, media_name: null, media_mime: null, created_by: null, created_at: "", updated_at: "" },
  { id: "q2", workspace_id: "ws", shortcut: "mapa", title: "Como chegar", content: "Segue o mapa, {primeiro_nome}.", media_path: "ws/outbound/mapa.pdf", media_name: "mapa.pdf", media_mime: "application/pdf", created_by: null, created_at: "", updated_at: "" },
];
const mocks = vi.hoisted(() => ({ save: vi.fn(async (v: unknown) => v), remove: vi.fn(async () => null), toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/use-quick-replies", () => ({
  useQuickReplies: () => ({ data: replies, isLoading: false }),
  useQuickReplyActions: () => ({ save: { mutateAsync: mocks.save }, remove: { mutateAsync: mocks.remove } }),
}));
vi.mock("@/components/ui", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui")>()), useToast: () => mocks.toast }));

import { QuickReplyPicker } from "@/components/inbox/QuickReplyPicker";
import { QuickRepliesCard } from "@/components/settings/QuickRepliesCard";

afterEach(() => { cleanup(); mocks.save.mockClear(); });

describe("respostas rápidas (interface)", () => {
  it("seletor: filtra, navega com setas e escolhe com Enter", () => {
    const onPick = vi.fn();
    const { rerender } = render(<QuickReplyPicker replies={replies} query="" onPick={onPick} onClose={() => {}} />);
    expect(screen.getAllByRole("option")).toHaveLength(2);
    fireEvent.keyDown(document, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ shortcut: "pix" }));
    rerender(<QuickReplyPicker replies={replies} query="ma" onPick={onPick} onClose={() => {}} />);
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByText("Como chegar")).toBeTruthy();
    expect(screen.getByLabelText("com anexo")).toBeTruthy();
  });

  it("seletor vazio orienta a cadastrar; sem resultado avisa", () => {
    render(<QuickReplyPicker replies={[]} query="" onPick={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/Nenhuma resposta rápida cadastrada/)).toBeTruthy();
    cleanup();
    render(<QuickReplyPicker replies={replies} query="zzz" onPick={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/Nada encontrado/)).toBeTruthy();
  });

  it("cadastro: lista, valida atalho repetido e salva normalizado", async () => {
    render(<QuickRepliesCard workspaceId="ws" />);
    expect(screen.getByText("/pix")).toBeTruthy();
    expect(screen.getByText("mapa.pdf")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Nova resposta/ }));
    const save = screen.getByRole("button", { name: /Salvar/ });
    fireEvent.change(screen.getByLabelText("Atalho"), { target: { value: "PIX" } });
    expect(screen.getByText("Já existe uma resposta com esse atalho.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Atalho"), { target: { value: "Endereço" } });
    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "Endereço" } });
    fireEvent.change(screen.getByLabelText("Texto"), { target: { value: "Rua das Flores, 100" } });
    expect(save.hasAttribute("disabled")).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ shortcut: "endereco", title: "Endereço", content: "Rua das Flores, 100", media_path: null })));
    expect(mocks.toast.success).toHaveBeenCalledWith("Resposta criada.");
  });
});
