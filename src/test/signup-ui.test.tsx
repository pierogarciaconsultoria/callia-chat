import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { SiteInfo } from "@/lib/site";

const site = { data: { platform_name: "Callia Chat", support_email: "oi@callia.com", self_service: true, trial_days: 14, plans: [] } as SiteInfo, isLoading: false };
const signUp = vi.fn(async () => ({ needsConfirmation: true }));
vi.mock("@/lib/site", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/site")>()), useSiteInfo: () => site }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: null, loading: false, signUp }) }));
vi.mock("@/lib/workspace", () => ({ useWorkspace: () => ({ workspaceId: null, loading: false }) }));

import Signup from "@/pages/Signup";

const show = () => render(
  <MemoryRouter initialEntries={["/cadastro"]}>
    <Routes>
      <Route path="/cadastro" element={<Signup />} />
      <Route path="/bem-vindo" element={<p>boas-vindas</p>} />
    </Routes>
  </MemoryRouter>,
);

afterEach(() => {
  cleanup();
  site.data = { ...site.data, self_service: true };
  signUp.mockClear();
  signUp.mockResolvedValue({ needsConfirmation: true });
});

describe("cadastro de nova empresa", () => {
  it("cria a conta com os dados da empresa nos metadados e pede a confirmação do e-mail", async () => {
    show();
    fireEvent.change(screen.getByLabelText("Nome da empresa"), { target: { value: "Pousada Alfa" } });
    fireEvent.change(screen.getByLabelText("Segmento"), { target: { value: "hotelaria" } });
    fireEvent.change(screen.getByLabelText("Site (opcional)"), { target: { value: "https://pousadaalfa.com.br" } });
    fireEvent.change(screen.getByLabelText("Seu e-mail"), { target: { value: "ana@pousadaalfa.com.br" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "segredo123" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Criar conta grátis" }));
    await waitFor(() => expect(signUp).toHaveBeenCalledWith("ana@pousadaalfa.com.br", "segredo123", { company_name: "Pousada Alfa", segment: "hotelaria", website: "https://pousadaalfa.com.br" }));
    expect(await screen.findByText(/Enviamos um link de confirmação para ana@pousadaalfa\.com\.br/)).toBeTruthy();
    expect(screen.getByText("Pousada Alfa")).toBeTruthy();
  });

  it("sem aceitar o uso dos dados, não cria; conta já confirmada vai direto para as boas-vindas", async () => {
    show();
    fireEvent.change(screen.getByLabelText("Nome da empresa"), { target: { value: "Loja Beta" } });
    fireEvent.change(screen.getByLabelText("Seu e-mail"), { target: { value: "b@loja.com" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "segredo123" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar conta grátis" }));
    expect(await screen.findByText(/aceite o uso dos dados/)).toBeTruthy();
    expect(signUp).not.toHaveBeenCalled();

    signUp.mockResolvedValue({ needsConfirmation: false });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Criar conta grátis" }));
    expect(await screen.findByText("boas-vindas")).toBeTruthy();
  });

  it("autoatendimento desligado: cadastro por convite com o e-mail de suporte", () => {
    site.data = { ...site.data, self_service: false };
    show();
    expect(screen.getByText(/cadastro é feito por convite/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "oi@callia.com" }).getAttribute("href")).toBe("mailto:oi@callia.com");
    expect(screen.queryByLabelText("Nome da empresa")).toBeNull();
  });
});
