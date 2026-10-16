import { describe, expect, it } from "vitest";
// @ts-ignore - Deno edge module with pure logic, no Deno APIs
import {
  buildBookingLink,
  mapAvailability,
  parseStayNights,
  resolveAvailabilityQuery,
} from "../../supabase/functions/_shared/hbook.ts";

const COMPANY_ID = "5c38b782e74ff268604a8655";

// Capturado em 2026-10-15 no POST /Booking/GetAvailability com 25/12/2026 -> 30/12/2026,
// 2 adultos e 0 criancas. Campos e nomes preservados porque e o que o parser le.
const livePayload = {
  Success: false,
  ValidationErrors: [],
  Rooms: [
    {
      RoomTypeId: "1478221351",
      RoomTypeName: "CASAL + UMA PESSOA",
      RoomTypeMaxAdults: 3,
      Availability: 9,
      NextAvailabilityDate: "25/12/2026",
      RoomTypeIndex: 0,
      BestPrice: { RoomTypeId: "1478221351", RateTypeId: "1439464231", FullTotalValue: 3900, TotalValue: 3900 },
      Rates: [
        {
          RateTypeId: "1439464231",
          RateTypeName: "MELHOR TARIFA DISPONÍVEL ",
          FullDailyPrice: 780,
          DailyPrice: 780,
          FullTotalValue: 3900,
          TotalValue: 3900,
          AppliedOffer: null,
          PerDayRates: [{ FullFormatedDate: "25/12/2026", Rate: 780 }],
        },
      ],
    },
    {
      RoomTypeId: "102948562",
      RoomTypeName: "CASAL + UMA CRIANÇA",
      RoomTypeMaxAdults: 3,
      Availability: 3,
      NextAvailabilityDate: "25/12/2026",
      RoomTypeIndex: 0,
      BestPrice: { RoomTypeId: "102948562", RateTypeId: "1439464231", FullTotalValue: 3900, TotalValue: 3900 },
      Rates: [
        {
          RateTypeId: "1439464231",
          RateTypeName: "MELHOR TARIFA DISPONÍVEL ",
          FullDailyPrice: 780,
          DailyPrice: 780,
          FullTotalValue: 3900,
          TotalValue: 3900,
          AppliedOffer: null,
          PerDayRates: [{ FullFormatedDate: "25/12/2026", Rate: 780 }],
        },
      ],
    },
    {
      RoomTypeId: "1451960947",
      RoomTypeName: "APARTAMENTO COM ACESSIBILIDADE",
      RoomTypeMaxAdults: 3,
      Availability: 0,
      NextAvailabilityDate: "06/01/2027",
      RoomTypeIndex: 0,
      BestPrice: null,
      Rates: [
        {
          RateTypeId: "1439464231",
          RateTypeName: "MELHOR TARIFA DISPONÍVEL ",
          FullDailyPrice: 780,
          DailyPrice: 780,
          FullTotalValue: 3900,
          TotalValue: 3900,
          AppliedOffer: null,
          PerDayRates: [{ FullFormatedDate: "25/12/2026", Rate: 780 }],
        },
      ],
    },
  ],
  UnavailabilityMessages: [],
};

function context(nights: number) {
  return {
    nights,
    currency: "BRL",
    bookingLink: buildBookingLink({ companyId: COMPANY_ID, checkin: "25/12/2026", checkout: "30/12/2026", adults: 2, children: 0 }),
  };
}

describe("conector hbook", () => {
  it("calcula as noites a partir de datas DD/MM/AAAA", () => {
    expect(parseStayNights("25/12/2026", "30/12/2026")).toBe(5);
    expect(parseStayNights("30/12/2026", "25/12/2026")).toBeNull();
    expect(parseStayNights("25/12/2026", "25/12/2026")).toBeNull();
    expect(parseStayNights("2026-12-25", "2026-12-30")).toBeNull();
    expect(parseStayNights("31/02/2027", "05/03/2027")).toBeNull();
  });

  it("recusa datas invalidas antes de chamar o hbook", () => {
    const params = new URLSearchParams({ checkin: "25/12/2026", checkout: "25/12/2026", adults: "2", children: "0" });
    expect(() => resolveAvailabilityQuery(params, COMPANY_ID)).toThrow("invalid_stay_dates");
  });

  it("monta o corpo e o link que o motor realmente espera", () => {
    const params = new URLSearchParams({ checkin: "05/03/2027", checkout: "12/03/2027", adults: "2", children: "1" });
    const stay = resolveAvailabilityQuery(params, COMPANY_ID);

    expect(stay.nights).toBe(7);
    expect(stay.request).toEqual({
      CompanyId: COMPANY_ID,
      ArrivalDateString: "05/03/2027",
      DepartureDateString: "12/03/2027",
      PromotionalCode: null,
      AmountAdults: 2,
      AmountChildren: 1,
      ChildrenAges: [],
      IsReturningAbandonedBooking: false,
      IsReturningBudgetBooking: false,
      Language: "pt",
      AvailabilityToken: null,
    });
    expect(stay.bookingLink).toContain("checkin=05%2F03%2F2027");
    expect(stay.bookingLink).toContain("checkout=12%2F03%2F2027");
  });

  it("extrai do payload real as acomodacoes disponiveis com total e diaria", () => {
    const result = mapAvailability(livePayload, context(5));

    expect(result).toEqual({
      available: true,
      nights: 5,
      rooms: [
        {
          name: "CASAL + UMA PESSOA",
          rate: "MELHOR TARIFA DISPONÍVEL",
          total_price: 3900,
          price_per_night: 780,
          currency: "BRL",
          units_available: 9,
        },
        {
          name: "CASAL + UMA CRIANÇA",
          rate: "MELHOR TARIFA DISPONÍVEL",
          total_price: 3900,
          price_per_night: 780,
          currency: "BRL",
          units_available: 3,
        },
      ],
      booking_link: `https://hbook.hsystem.com.br/Booking?companyId=${COMPANY_ID}&checkin=25%2F12%2F2026&checkout=30%2F12%2F2026&adults=2&children=0&language=pt`,
    });
  });

  it("devolve available false quando nenhuma acomodacao tem unidade", () => {
    const soldOut = { ...livePayload, Rooms: [livePayload.Rooms[2]] };
    const result = mapAvailability(soldOut, context(5));

    expect(result.available).toBe(false);
    expect(result.rooms).toEqual([]);
    expect(result.nights).toBe(5);
  });

  it("segue a escolha do BestPrice e ignora tarifa sem preco", () => {
    // Caso sintetico: o motor real devolveu uma unica tarifa por acomodacao nesta consulta.
    const payload = {
      Rooms: [
        {
          RoomTypeName: "CHALE",
          Availability: 2,
          BestPrice: { RateTypeId: "promo" },
          Rates: [
            { RateTypeId: "normal", RateTypeName: "TARIFA NORMAL", TotalValue: 4000 },
            { RateTypeId: "promo", RateTypeName: "PROMO DE ANO NOVO", TotalValue: 3200 },
            { RateTypeId: "sem-preco", RateTypeName: "SEM PRECO" },
          ],
        },
      ],
    };

    const result = mapAvailability(payload, context(4));

    expect(result.rooms).toHaveLength(1);
    expect(result.rooms[0]).toMatchObject({ rate: "PROMO DE ANO NOVO", total_price: 3200, price_per_night: 800 });
  });
});
