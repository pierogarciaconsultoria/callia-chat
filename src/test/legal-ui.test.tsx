import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Legal from "@/pages/Legal";
import { LEGAL_COMPANY, LEGAL_VERSION, PRIVACY, TERMS } from "@/lib/legal";

afterEach(cleanup);

describe("Termos de Uso e Política de Privacidade", () => {
  it("as páginas mostram título, versão, seções, empresa e o link cruzado", () => {
    render(<MemoryRouter><Legal document="termos" /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1, name: "Termos de Uso" })).toBeTruthy();
    expect(screen.getByText(new RegExp(`Versão ${LEGAL_VERSION}`))).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(TERMS.sections.length);
    expect(screen.getAllByText(new RegExp(LEGAL_COMPANY.cnpj)).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("link", { name: "Política de Privacidade" }).getAttribute("href")).toBe("/privacidade");
    cleanup();
    render(<MemoryRouter><Legal document="privacidade" /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1, name: "Política de Privacidade" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(PRIVACY.sections.length);
    expect(screen.getByRole("link", { name: "Termos de Uso" }).getAttribute("href")).toBe("/termos");
  });

  it("os textos cobrem os pontos essenciais da LGPD e do serviço", () => {
    const all = [TERMS, PRIVACY].flatMap((d) => [d.intro, ...d.sections.flatMap((s) => [s.title, ...s.paragraphs, ...(s.items ?? [])])]).join("\n");
    for (const must of ["LGPD", "controladora", "operadora", "Mercado Pago", "inteligência artificial", "WhatsApp", "artigo 18", "exportação", LEGAL_COMPANY.email, "transferência internacional", "cartão"]) {
      expect(all, must).toContain(must);
    }
  });
});
