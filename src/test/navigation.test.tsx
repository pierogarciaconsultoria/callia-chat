import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { NAV_ITEMS } from "@/components/nav";
import { Moved } from "@/components/Moved";
import { AgentNav, IntegrationsNav } from "@/components/SectionNav";

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search + l.hash}</p>;
}

afterEach(cleanup);

describe("módulos unificados", () => {
  it("menu principal tem sete itens, um por pergunta", () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual(["Painel", "Inbox", "Agente de IA", "Integrações", "Equipe", "Logs", "Configurações"]);
    expect(NAV_ITEMS.filter((i) => !i.adminOnly).map((i) => i.to)).toEqual(["/dashboard", "/inbox", "/team"]);
  });

  it("endereços antigos redirecionam mantendo aba e âncora", () => {
    render(
      <MemoryRouter initialEntries={["/knowledge-base?tab=docs#x"]}>
        <Routes>
          <Route path="/knowledge-base" element={<Moved to="/agent/conhecimento" />} />
          <Route path="/agent/conhecimento" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("where").textContent).toBe("/agent/conhecimento?tab=docs#x");
  });

  it("navegação de seções marca a atual; o simulador é âncora", () => {
    render(<MemoryRouter initialEntries={["/agent/conhecimento?tab=faq"]}><AgentNav /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Conhecimento" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Comportamento" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: "Simulador" }).getAttribute("href")).toBe("/agent#simulador");
    cleanup();
    render(<MemoryRouter initialEntries={["/integrations/webhooks"]}><IntegrationsNav /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Webhooks" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Conexões" }).getAttribute("aria-current")).toBeNull();
  });
});
