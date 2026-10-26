import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { hexToRgbTriplet, readableForeground } from "@/lib/branding";
import { formatPhone, safeFileName } from "@/lib/format";
import { Badge, EmptyState, statusTone } from "@/components/ui";

describe("branding", () => {
  it("converte hex em triplet rgb para as variáveis CSS", () => {
    expect(hexToRgbTriplet("#0f766e")).toBe("15 118 110");
    expect(hexToRgbTriplet("nope")).toBeNull();
  });
  it("escolhe texto legível sobre a cor de marca", () => {
    expect(readableForeground("#ffffff")).toBe("15 23 42");
    expect(readableForeground("#0f766e")).toBe("255 255 255");
  });
});

describe("format", () => {
  it("formata celular brasileiro", () => {
    expect(formatPhone("5548999990000")).toBe("+55 (48) 99999-0000");
  });
  it("gera nome de arquivo seguro para o storage", () => {
    expect(safeFileName("Tabela de Preços 2026 (v2).pdf")).toBe("Tabela-de-Precos-2026-v2-.pdf");
  });
});

describe("ui", () => {
  it("renderiza estado vazio e badge com tom de status", () => {
    render(
      <>
        <EmptyState title="Nenhuma conversa" description="Aguardando mensagens" />
        <Badge tone={statusTone("failed")}>falhou</Badge>
      </>,
    );
    expect(screen.getByText("Nenhuma conversa")).toBeTruthy();
    expect(screen.getByText("falhou").className).toContain("bg-red-100");
  });
});
