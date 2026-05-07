import { describe, expect, it } from "vitest";
import {
  createEmptyWhatsAppInstanceForm,
  createWhatsAppInstanceForm,
  getQrCodeSrc,
  getWebhookUrl,
  getWhatsAppStatusMeta,
} from "@/lib/whatsapp-instances";

describe("whatsapp instances helpers", () => {
  it("creates empty and filled instance forms", () => {
    expect(createEmptyWhatsAppInstanceForm()).toEqual({
      display_name: "",
      instance_name: "",
      evolution_base_url: "",
      provider_secret_ref: "",
      phone_number: "",
      is_default: false,
    });

    expect(
      createWhatsAppInstanceForm({
        display_name: "Instancia comercial",
        instance_name: "comercial-01",
        evolution_base_url: "https://evolution.example.com",
        provider_secret_ref: "EVOLUTION_SECRET",
        phone_number: "+5511999999999",
        is_default: true,
      }),
    ).toEqual({
      display_name: "Instancia comercial",
      instance_name: "comercial-01",
      evolution_base_url: "https://evolution.example.com",
      provider_secret_ref: "EVOLUTION_SECRET",
      phone_number: "+5511999999999",
      is_default: true,
    });
  });

  it("maps statuses to readable labels", () => {
    expect(getWhatsAppStatusMeta("connected")).toEqual({
      label: "Conectado",
      variant: "default",
    });
    expect(getWhatsAppStatusMeta("error")).toEqual({
      label: "Erro",
      variant: "destructive",
    });
  });

  it("builds qr code src values", () => {
    expect(getQrCodeSrc(null)).toBeNull();
    expect(getQrCodeSrc("data:image/png;base64,abc")).toBe("data:image/png;base64,abc");
    expect(getQrCodeSrc("abc")).toBe("data:image/png;base64,abc");
  });

  it("builds instance webhook urls", () => {
    expect(
      getWebhookUrl({
        supabaseUrl: "https://demo.supabase.co/",
        instanceId: "inst-1",
        token: "token-1",
      }),
    ).toBe(
      "https://demo.supabase.co/functions/v1/whatsapp-webhook?instance_id=inst-1&token=token-1",
    );
  });
});
