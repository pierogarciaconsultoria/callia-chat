import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MessageBubble } from "@/components/inbox/MessageBubble";
import type { Message } from "@/lib/database.types";

const msg = (over: Partial<Message> = {}): Message => ({
  id: "m1", seq: 1, workspace_id: "w1", conversation_id: "c1", direction: "outbound", sender: "agent", type: "text", content: "Segue o valor",
  media_url: null, media_mime: null, external_id: "3EB0", status: "sent", agent_user_id: "u1", metadata: {}, created_at: new Date().toISOString(),
  deleted_at: null, deleted_by: null, hidden_at: null, hidden_by: null, ...over,
});

describe("bolha da mensagem: ações de moderação", () => {
  afterEach(cleanup);

  it("mostra apagar e ocultar quando permitido e chama os handlers", () => {
    const onDelete = vi.fn();
    const onHide = vi.fn();
    render(<MessageBubble message={msg()} isAdmin onDelete={onDelete} onHide={onHide} />);
    fireEvent.click(screen.getByRole("button", { name: "Apagar para todos" }));
    fireEvent.click(screen.getByRole("button", { name: "Ocultar no painel" }));
    expect(onDelete).toHaveBeenCalled();
    expect(onHide).toHaveBeenCalled();
  });

  it("apagada para todos: fica riscada, sem botão de apagar", () => {
    render(<MessageBubble message={msg({ deleted_at: "2026-11-09T12:00:00Z", deleted_by: "u1" })} onDelete={() => {}} />);
    expect(screen.getByText("· apagada para todos")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Apagar para todos" })).toBeNull();
    expect(screen.getByText("Segue o valor").closest("div")?.className).toContain("line-through");
  });

  it("oculta: operador só vê a linha discreta; admin revela e restaura", () => {
    const hidden = msg({ hidden_at: "2026-11-09T12:00:00Z", hidden_by: "u1" });
    render(<MessageBubble message={hidden} />);
    expect(screen.queryByText("Segue o valor")).toBeNull();
    expect(screen.getByRole("note").textContent).toContain("mensagem oculta por um administrador");
    expect(screen.queryByRole("button")).toBeNull();
    cleanup();

    const onUnhide = vi.fn();
    render(<MessageBubble message={hidden} isAdmin onUnhide={onUnhide} />);
    fireEvent.click(screen.getByRole("button", { name: "mostrar" }));
    expect(screen.getByText("Segue o valor")).toBeTruthy();
    expect(screen.getByText("oculta da equipe")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restaurar mensagem" }));
    expect(onUnhide).toHaveBeenCalled();
  });
});
