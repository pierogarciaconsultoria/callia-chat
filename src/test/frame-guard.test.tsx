import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FrameGuard, isFramed, mustBreakOut } from "@/components/FrameGuard";

describe("guarda contra exibição do painel dentro de outros sites", () => {
  afterEach(cleanup);

  it("só a página inicial pode ficar embutida", () => {
    expect(mustBreakOut("/", true)).toBe(false);
    expect(mustBreakOut("/entrar", true)).toBe(true);
    expect(mustBreakOut("/inbox", true)).toBe(true);
    expect(mustBreakOut("/inbox", false)).toBe(false);
  });

  it("detecta o quadro mesmo quando o navegador bloqueia o acesso ao topo", () => {
    const top = {};
    expect(isFramed({ self: top, top })).toBe(false);
    expect(isFramed({ self: {}, top })).toBe(true);
    expect(
      isFramed({
        self: {},
        get top(): unknown {
          throw new Error("cross-origin");
        },
      }),
    ).toBe(true);
  });

  it("fora de um quadro renderiza a página normalmente", () => {
    render(
      <MemoryRouter initialEntries={["/entrar"]}>
        <FrameGuard>
          <p>login</p>
        </FrameGuard>
      </MemoryRouter>,
    );
    expect(screen.getByText("login")).toBeTruthy();
    expect(screen.queryByText("Abrir em nova aba")).toBeNull();
  });
});
