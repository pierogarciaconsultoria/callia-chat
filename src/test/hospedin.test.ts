import { describe, expect, it, vi } from "vitest";
import {
  accountFromClaims, decodeJwtPayload, detectPriceUnit, fetchHospedinAvailability, guestPhoneDigits, HospedinClient, quoteStay, stayNights,
} from "../../supabase/functions/_shared/hospedin.ts";
import { nextWeekend } from "../../supabase/functions/_shared/availability.ts";
import { parseBrDate } from "../../supabase/functions/_shared/hbook.ts";

const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const jwt = (claims: Record<string, unknown>) => `${b64({ alg: "HS256" })}.${b64(claims)}.sig`;

describe("Hospedin: regras puras", () => {
  it("lê claims do token e acha a conta em formatos comuns", () => {
    expect(decodeJwtPayload(jwt({ exp: 1, account_slug: "morada-sol" }))).toMatchObject({ account_slug: "morada-sol" });
    expect(accountFromClaims({ accounts: [{ slug: "morada-sol" }] })).toBe("morada-sol");
    expect(accountFromClaims({ account_id: 123 })).toBe("123");
    expect(accountFromClaims({ sub: 1 })).toBeNull();
  });

  it("noites da estadia vão do check-in até a véspera do check-out", () => {
    expect(stayNights(parseBrDate("30/12/2026")!, parseBrDate("02/01/2027")!)).toEqual(["2026-12-30", "2026-12-31", "2027-01-01"]);
  });

  it("detecta reais x centavos pela mediana", () => {
    expect(detectPriceUnit([350, 420, 480])).toBe("reais");
    expect(detectPriceUnit([35000, 42000, 48000])).toBe("cents");
    expect(detectPriceUnit([])).toBe("reais");
  });

  it("cota a estadia: soma as noites, menor disponibilidade, e recusa se faltar uma noite", () => {
    const rates = [
      { date: "2026-12-20", rate_price: 400, availability: 3 },
      { date: "2026-12-21", rate_price: 500, availability: 1 },
      { date: "2026-12-22", rate_price: 600, availability: 0 },
    ];
    expect(quoteStay(rates, ["2026-12-20", "2026-12-21"], "reais")).toEqual({ total_price: 900, price_per_night: 450, available_units: 1 });
    expect(quoteStay(rates, ["2026-12-21", "2026-12-22"], "reais")).toBeNull(); // esgotada numa noite
    expect(quoteStay(rates, ["2026-12-20", "2026-12-23"], "reais")).toBeNull(); // sem tarifa num dia
    expect(quoteStay([{ date: "2026-12-20", rate_price: 45000, availability: 2 }], ["2026-12-20"], "cents")).toMatchObject({ total_price: 450 });
  });

  it("próximo fim de semana começa numa sexta", () => {
    expect(nextWeekend(new Date("2026-10-26T12:00:00Z"))).toEqual({ checkin: "30/10/2026", checkout: "01/11/2026" }); // segunda → sexta
    expect(nextWeekend(new Date("2026-10-30T12:00:00Z"))).toEqual({ checkin: "06/11/2026", checkout: "08/11/2026" }); // sexta → próxima
  });
});

describe("Hospedin: cliente e consulta", () => {
  function fakeHospedin() {
    let logins = 0;
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v2/authentication/sessions")) {
        logins++;
        const body = JSON.parse(String(init?.body));
        if (body.password !== "certa") return new Response(JSON.stringify({ errors: ["Invalid email"] }), { status: 401 });
        return new Response(JSON.stringify({ token: jwt({ exp: Math.floor(Date.now() / 1000) + 3600, n: logins }), user: { id: 1 } }));
      }
      const auth = (init?.headers as Record<string, string>)?.Authorization ?? "";
      if (!auth.startsWith("Bearer ")) return new Response("{}", { status: 401 });
      if (url.includes("/place_types?page=1")) {
        return new Response(JSON.stringify({ pagination: { page: 1, last: 2 }, data: [{ id: 1, title: "Apto casal", occupants: 2, status: true }, { id: 2, title: "Apto família", occupants: 4, status: true }] }));
      }
      if (url.includes("/place_types?page=2")) {
        return new Response(JSON.stringify({ pagination: { page: 2, last: 2 }, data: [{ id: 3, title: "Inativo", occupants: 6, status: false }, { id: 4, title: "Chalé", occupants: 5, status: true }] }));
      }
      const m = /place_types\/(\d+)\/rates_and_availabilities\?begin_date=([\d-]+)&end_date=([\d-]+)/.exec(url);
      if (m) {
        const id = Number(m[1]);
        const days = id === 4 ? [] : ["2026-12-20", "2026-12-21"].map((date) => ({ date, rate_price: id === 1 ? 300 : 500, availability: 2 }));
        return new Response(JSON.stringify(days));
      }
      return new Response("{}", { status: 404 });
    });
    return fetchImpl;
  }

  it("senha errada vira mensagem clara", async () => {
    const client = new HospedinClient({ email: "a@b.com", password: "errada" }, { baseUrl: "https://h.test", fetchImpl: fakeHospedin() as unknown as typeof fetch });
    await expect(client.login(true)).rejects.toMatchObject({ code: "unprocessable", message: "E-mail ou senha do Hospedin incorretos." });
  });

  it("percorre páginas, ignora inativas e filtra pela capacidade do grupo", async () => {
    const fetchImpl = fakeHospedin();
    const client = new HospedinClient({ email: "c@b.com", password: "certa" }, { baseUrl: "https://h.test", fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await fetchHospedinAvailability(
      { account_id: "morada", price_unit: "reais", booking_link: "https://hbook.hsystem.com.br/Booking?companyId=abc" },
      client,
      { checkin: "20/12/2026", checkout: "22/12/2026", adults: 2, children: 1 },
      { today: new Date("2026-10-26T00:00:00Z") },
    );
    // Casal (2 lugares) não comporta 3 pessoas; chalé não tem tarifa no período; inativo é ignorado.
    expect(out.rooms).toEqual([{ name: "Apto família", category_id: 2, rate: null, capacity: 4, total_price: 1000, price_per_night: 500, available_units: 2 }]);
    expect(out).toMatchObject({ provider: "hospedin", nights: 2, adults: 2, children: 1, sold_out: false });
    expect(out.booking_link).toBe("https://hbook.hsystem.com.br/Booking?companyId=abc&checkin=20%2F12%2F2026&checkout=22%2F12%2F2026&adults=2&children=1");
    expect(out.price_note).toMatch(/tarifa base/);
    const ratesCall = fetchImpl.mock.calls.map(([u]) => String(u)).find((u) => u.includes("/place_types/2/"));
    expect(ratesCall).toContain("begin_date=2026-12-20&end_date=2026-12-21");
  });

  it("estadia mínima: lê a vaga em volta (nunca antes de hoje) e devolve por noite", async () => {
    const fetchImpl = fakeHospedin();
    const client = new HospedinClient({ email: "n@b.com", password: "certa" }, { baseUrl: "https://h.test", fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await fetchHospedinAvailability(
      { account_id: "morada", price_unit: "reais", booking_link: null },
      client,
      { checkin: "20/12/2026", checkout: "22/12/2026", adults: 2, categoryIds: [2], aroundNights: 3 },
      { today: new Date("2026-12-18T00:00:00Z") },
    );
    const ratesCall = fetchImpl.mock.calls.map(([u]) => String(u)).find((u) => u.includes("/place_types/2/"));
    expect(ratesCall).toContain("begin_date=2026-12-18&end_date=2026-12-24");
    expect(out.rooms[0].nightly).toEqual({ "2026-12-20": 2, "2026-12-21": 2 });
  });

  it("reaproveita o token e renova quando expira (401)", async () => {
    let first = true;
    const base = fakeHospedin();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes("/my_account") && first) {
        first = false;
        return new Response("{}", { status: 401 });
      }
      if (String(input).includes("/my_account")) return new Response(JSON.stringify({ data: { name: "Morada do Sol" } }));
      return base(input, init);
    });
    const client = new HospedinClient({ email: "token@b.com", password: "certa" }, { baseUrl: "https://h.test", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await client.myAccount("morada")).toEqual({ name: "Morada do Sol" });
    const logins = fetchImpl.mock.calls.filter(([u]) => String(u).endsWith("/sessions")).length;
    expect(logins).toBe(2);
  });
});

describe("Hospedin: telefone do hóspede", () => {
  it("junta DDI e número, só dígitos, sem duplicar o DDI", () => {
    expect(guestPhoneDigits("55", "(48) 99997-8131")).toBe("5548999978131");
    expect(guestPhoneDigits("+55", "5548999978131")).toBe("5548999978131");
    expect(guestPhoneDigits(null, "48 99997-8131")).toBe("5548999978131");
    expect(guestPhoneDigits("351", "912 345 678")).toBe("351912345678");
    expect(guestPhoneDigits("55", "123")).toBeNull();
  });
});
