import { describe, expect, it, vi } from "vitest";
import { buildBookingLink, countNights, hbookLinkOnly, parseBrDate, validateQuery } from "../../supabase/functions/_shared/hbook.ts";

const cfg = { base_url: "https://motor.hbook.example", company_id: "123", booking_link: "https://reservas.example", currency: "BRL", default_adults: 2 };
const today = new Date("2026-10-25T12:00:00Z");

describe("datas e noites", () => {
  it("aceita DD/MM/AAAA e AAAA-MM-DD, rejeita datas impossíveis", () => {
    expect(parseBrDate("10/12/2026")?.toISOString()).toBe("2026-12-10T00:00:00.000Z");
    expect(parseBrDate("2026-12-10")?.toISOString()).toBe("2026-12-10T00:00:00.000Z");
    expect(parseBrDate("31/02/2026")).toBeNull();
    expect(parseBrDate("amanhã")).toBeNull();
  });

  it("conta noites e valida o período", () => {
    expect(countNights(parseBrDate("10/12/2026")!, parseBrDate("13/12/2026")!)).toBe(3);
    expect(() => validateQuery({ checkin: "13/12/2026", checkout: "10/12/2026" }, today, cfg)).toThrow(/depois/);
    expect(() => validateQuery({ checkin: "01/01/2020", checkout: "02/01/2020" }, today, cfg)).toThrow(/passado/);
    expect(validateQuery({ checkin: "10/12/2026", checkout: "12/12/2026" }, today, cfg)).toMatchObject({ nights: 2, adults: 2, children: 0 });
  });
});

describe("hbook sem consulta automática", () => {
  it("não acessa o motor: devolve o link de reserva preenchido", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const err = (() => {
      try {
        hbookLinkOnly(cfg, { checkin: "10/12/2026", checkout: "11/12/2026", adults: 3, children: 1 }, today);
      } catch (e) {
        return e as { code: string; details: { booking_link: string } };
      }
    })();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    expect(err?.code).toBe("unprocessable");
    expect(err?.details.booking_link).toContain("checkin=10%2F12%2F2026");
    expect(err?.details.booking_link).toContain("adults=3");
  });

  it("exige a idade de cada criança", () => {
    expect(() => validateQuery({ checkin: "10/12/2026", checkout: "12/12/2026", children: 2 }, today, cfg)).toThrow(/idade de cada criança/);
    expect(() => validateQuery({ checkin: "10/12/2026", checkout: "12/12/2026", childrenAges: [5, 19] }, today, cfg)).toThrow(/0 e 17/);
    expect(validateQuery({ checkin: "10/12/2026", checkout: "12/12/2026", childrenAges: [5, 8] }, today, cfg)).toMatchObject({ children: 2, childrenAges: [5, 8] });
  });
});

describe("link de reserva", () => {
  it("reproduz o formato da página de reservas do hbook", () => {
    const link = buildBookingLink(
      { base_url: "https://hbook.hsystem.com.br", company_id: "000000000000000000000001", booking_link: null },
      { checkin: "26/10/2026", checkout: "27/10/2026", adults: 2, children: 0 },
    );
    expect(link).toBe("https://hbook.hsystem.com.br/Booking?companyId=000000000000000000000001&checkin=26%2F10%2F2026&checkout=27%2F10%2F2026&adults=2&children=0");
  });

  it("respeita companyId já presente no link configurado e troca as datas", () => {
    const link = buildBookingLink(
      { base_url: "", company_id: "999", booking_link: "https://hbook.hsystem.com.br/Booking?companyId=abc&checkin=01%2F01%2F2026" },
      { checkin: "05/01/2027", checkout: "07/01/2027", adults: 3, children: 1 },
    );
    expect(link).toBe("https://hbook.hsystem.com.br/Booking?companyId=abc&checkin=05%2F01%2F2027&checkout=07%2F01%2F2027&adults=3&children=1");
  });
});
