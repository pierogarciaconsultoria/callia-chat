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
import { LEGAL_VERSION } from "@/lib/legal";

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
    fireEvent.change(screen.getByLabelText("Seu nome"), { target: { value: "Ana Souza" } });
    fireEvent.change(screen.getByLabelText("Seu e-mail"), { target: { value: "ana@pousadaalfa.com.br" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "segredo123" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Criar conta grátis" }));
    await waitFor(() => expect(signUp).toHaveBeenCalledWith("ana@pousadaalfa.com.br", "segredo123", expect.objectContaining({ company_name: "Pousada Alfa", full_name: "Ana Souza", segment: "hotelaria", website: "https://pousadaalfa.com.br", terms_version: LEGAL_VERSION })));
    expect((signUp.mock.calls[0] as unknown[])[2]).toHaveProperty("terms_accepted_at", expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    expect(await screen.findByText(/Enviamos um link de confirmação para ana@pousadaalfa\.com\.br/)).toBeTruthy();
    expect(screen.getByText("Pousada Alfa")).toBeTruthy();
  });

  it("sem aceitar os Termos e a Política, não cria; conta já confirmada vai direto para as boas-vindas", async () => {
    show();
    fireEvent.change(screen.getByLabelText("Nome da empresa"), { target: { value: "Loja Beta" } });
    fireEvent.change(screen.getByLabelText("Seu nome"), { target: { value: "Bia" } });
    fireEvent.change(screen.getByLabelText("Seu e-mail"), { target: { value: "b@loja.com" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "segredo123" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar conta grátis" }));
    expect(await screen.findByText(/aceite os Termos de Uso e a Política de Privacidade/)).toBeTruthy();
    // O link do aceite e o do rodapé da tela apontam para as mesmas páginas.
    expect(screen.getAllByRole("link", { name: "Termos de Uso" }).map((a) => a.getAttribute("href"))).toEqual(["/termos", "/termos"]);
    expect(screen.getByRole("link", { name: "Política de Privacidade" }).getAttribute("href")).toBe("/privacidade");
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
