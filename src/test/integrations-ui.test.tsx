import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { isoToBr, isValidHttpUrl, maskBrPhone, nextWeekend, parseChildrenAges, phoneDigits, sampleBookingLink } from "@/lib/integrations";
import { AvailabilityTable } from "@/components/integrations/AvailabilityTest";
import type { AvailabilityTest } from "@/lib/database.types";

describe("utilidades das integrações", () => {
  it("próximo fim de semana é sexta → domingo, sempre no futuro", () => {
    // 26/10/2026 é segunda; 30/10 é sexta.
    expect(nextWeekend(new Date(2026, 9, 26))).toEqual({ checkin: "2026-10-30", checkout: "2026-11-01" });
    // Numa sexta, vai para a sexta seguinte.
    expect(nextWeekend(new Date(2026, 9, 30))).toEqual({ checkin: "2026-11-06", checkout: "2026-11-08" });
    expect(isoToBr("2026-12-20")).toBe("20/12/2026");
  });

  it("idades das crianças", () => {
    expect(parseChildrenAges("")).toEqual([]);
    expect(parseChildrenAges("5, 8")).toEqual([5, 8]);
    expect(parseChildrenAges("5;12 3")).toEqual([5, 12, 3]);
    expect(parseChildrenAges("5, 18")).toBeNull();
    expect(parseChildrenAges("cinco")).toBeNull();
  });

  it("telefone: máscara enquanto digita e dígitos com DDI para a Evolution", () => {
    expect(maskBrPhone("48")).toBe("(48");
    expect(maskBrPhone("48999990000")).toBe("(48) 99999-0000");
    expect(maskBrPhone("4833334444")).toBe("(48) 3333-4444");
    expect(phoneDigits("(48) 99999-0000")).toBe("5548999990000");
    expect(phoneDigits("+55 48 3333-4444")).toBe("554833334444");
    expect(phoneDigits("9999")).toBeNull();
  });

  it("link de exemplo preserva o companyId e preenche datas e hóspedes", () => {
    const link = sampleBookingLink("https://hbook.hsystem.com.br/Booking?companyId=abc", { checkin: "2026-12-20", checkout: "2026-12-27" });
    expect(link).toBe("https://hbook.hsystem.com.br/Booking?companyId=abc&checkin=20%2F12%2F2026&checkout=27%2F12%2F2026&adults=2&children=0");
    expect(sampleBookingLink("ftp://x")).toBeNull();
    expect(isValidHttpUrl("https://x.com")).toBe(true);
    expect(isValidHttpUrl("x.com")).toBe(false);
  });
});

describe("tabela de disponibilidade", () => {
  const base: AvailabilityTest = {
    provider: "hospedin",
    checkin: "20/12/2026",
    checkout: "22/12/2026",
    nights: 2,
    adults: 2,
    children_ages: [6],
    currency: "BRL",
    sold_out: false,
    booking_link: "https://hbook.example/Booking?x=1",
    rooms: [{ name: "Apartamento 101 a 204", rate: null, total_price: 900, price_per_night: 450, available_units: 3, capacity: 3 }],
  };

  it("mostra categoria, capacidade, valores e link", () => {
    render(<AvailabilityTable data={base} />);
    expect(screen.getByText("Apartamento 101 a 204")).toBeTruthy();
    expect(screen.getByText("3 pessoa(s)")).toBeTruthy();
    expect(screen.getByText(/crianças: 6 anos/)).toBeTruthy();
    expect(screen.getByText("Link de reserva").closest("a")?.getAttribute("href")).toBe("https://hbook.example/Booking?x=1");
  });

  it("avisa quando não há disponibilidade", () => {
    render(<AvailabilityTable data={{ ...base, sold_out: true, rooms: [] }} />);
    expect(screen.getByText("Sem disponibilidade")).toBeTruthy();
  });
});
