import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { email: "dono@exemplo.com.br" }, signOut: vi.fn() }) }));
vi.mock("@/lib/workspace", () => ({
  useWorkspace: () => ({
    workspaces: [{ id: "w1", name: "Pousada Exemplo" }],
    workspace: { id: "w1", name: "Pousada Exemplo" },
    selectWorkspace: vi.fn(),
    isAdmin: true,
    isPlatformAdmin: false,
    branding: null,
    role: "owner",
  }),
}));
vi.mock("@/components/PlanBanner", () => ({ PlanBanner: () => null }));
vi.mock("@/components/onboarding/Journey", () => ({ JourneyBar: () => null }));

import { AppLayout } from "@/components/AppLayout";

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<p>conteúdo</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("menu lateral recolhível", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("recolhe para só ícones (nome no title) e lembra a escolha", () => {
    renderLayout();
    const painel = screen.getByRole("link", { name: "Painel" });
    expect(painel.getAttribute("title")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Recolher menu lateral" }));
    expect(screen.getByRole("link", { name: "Painel" }).getAttribute("title")).toBe("Painel");
    expect(localStorage.getItem("callia.sidebar.collapsed")).toBe("1");

    cleanup();
    renderLayout();
    fireEvent.click(screen.getByRole("button", { name: "Expandir menu lateral" }));
    expect(screen.getByRole("link", { name: "Painel" }).getAttribute("title")).toBeNull();
    expect(localStorage.getItem("callia.sidebar.collapsed")).toBe("0");
  });

  it("sem localStorage (aba privada) continua funcionando", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    renderLayout();
    fireEvent.click(screen.getByRole("button", { name: "Recolher menu lateral" }));
    expect(screen.getByRole("button", { name: "Expandir menu lateral" })).toBeTruthy();
    get.mockRestore();
    set.mockRestore();
  });
});
