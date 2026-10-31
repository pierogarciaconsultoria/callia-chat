import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Modal } from "@/components/ui";

// Reproduz o formulário da base de conhecimento: onClose é uma função nova a cada render (cada tecla).
function Harness() {
  const [open, setOpen] = useState(true);
  const [text, setText] = useState("");
  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Editar texto">
      <label htmlFor="t">Conteúdo</label>
      <textarea id="t" value={text} onChange={(e) => setText(e.target.value)} />
      <p data-testid="echo">{text}</p>
    </Modal>
  );
}

afterEach(cleanup);

describe("Modal", () => {
  it("mantém o foco no campo enquanto se digita, mesmo com onClose recriado a cada render", () => {
    render(<Harness />);
    const field = screen.getByLabelText("Conteúdo") as HTMLTextAreaElement;
    field.focus();
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: "a" } });
    fireEvent.change(field, { target: { value: "ab" } });
    expect(screen.getByTestId("echo").textContent).toBe("ab");
    expect(document.activeElement).toBe(field);
  });

  it("Escape fecha com a função onClose mais recente", () => {
    render(<Harness />);
    const field = screen.getByLabelText("Conteúdo");
    fireEvent.change(field, { target: { value: "x" } });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("Editar texto")).toBeNull();
  });
});
