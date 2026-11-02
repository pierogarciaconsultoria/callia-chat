import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { buildJourney, type JourneySignals } from "@/lib/onboarding";

const signals: JourneySignals = {
  businessInfo: true, agentGenerated: true, segment: "hotelaria", ownKnowledge: 1, bookingConnected: false,
  tested: false, whatsapp: false, members: 1, conversations: 0,
};
const state = { journey: buildJourney(signals), hidden: false, setHidden: vi.fn(), skip: vi.fn() };
vi.mock("@/hooks/use-journey", () => ({ useJourney: () => state }));

import { JourneyBar, JourneyCard } from "@/components/onboarding/Journey";

const at = (path: string, el: JSX.Element) => render(<MemoryRouter initialEntries={[path]}>{el}</MemoryRouter>);

afterEach(() => {
  cleanup();
  state.hidden = false;
  state.journey = buildJourney(signals);
  vi.clearAllMocks();
});

describe("jornada: barra no topo", () => {
  it("na tela da etapa atual: você está aqui + o que fazer + pular (opcional)", () => {
    at("/integrations", <JourneyBar />);
    expect(screen.getByText(/Você está aqui: Sistema de reservas\./)).toBeTruthy();
    expect(screen.getByText("4 de 9")).toBeTruthy();
    expect(screen.queryByText(/Próximo passo:/)).toBeNull(); // já está na tela do próximo passo
    fireEvent.click(screen.getByText("Pular esta etapa"));
    expect(state.skip).toHaveBeenCalledWith("reservas");
  });

  it("em outra tela: mostra o próximo passo com link", () => {
    at("/logs", <JourneyBar />);
    const link = screen.getByRole("link", { name: /Próximo passo: Sistema de reservas/ });
    expect(link.getAttribute("href")).toBe("/integrations");
    expect(screen.queryByText(/Você está aqui/)).toBeNull();
  });

  it("etapa já feita: confirma e aponta a seguinte", () => {
    at("/settings", <JourneyBar />);
    expect(screen.getByText(/Dados da empresa: concluída\./)).toBeTruthy();
  });

  it("oculta, concluída ou no Painel: não aparece", () => {
    state.hidden = true;
    const { container, unmount } = at("/agent", <JourneyBar />);
    expect(container.innerHTML).toBe("");
    unmount();
    state.hidden = false;
    expect(at("/dashboard", <JourneyBar />).container.innerHTML).toBe("");
  });

  it("linha do tempo marca a etapa da tela como atual", () => {
    at("/integrations", <JourneyBar />);
    const current = screen.getAllByRole("link").find((a) => a.getAttribute("aria-current") === "step");
    expect(current?.getAttribute("title")).toMatch(/Sistema de reservas \(próximo passo, opcional\)/);
  });
});

describe("jornada: cartão do Painel", () => {
  it("mostra as etapas, o tempo restante e o botão de continuar", () => {
    at("/dashboard", <JourneyCard />);
    expect(screen.getByText("Configure seu atendimento")).toBeTruthy();
    expect(screen.getByText(/4 de 9 etapas · cerca de \d+ min/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Continuar/ }).getAttribute("href")).toBe("/integrations");
  });

  it("oculta: vira um link para mostrar de novo", () => {
    state.hidden = true;
    at("/dashboard", <JourneyCard />);
    fireEvent.click(screen.getByText(/Mostrar a jornada de configuração/));
    expect(state.setHidden).toHaveBeenCalledWith(false);
  });
});
