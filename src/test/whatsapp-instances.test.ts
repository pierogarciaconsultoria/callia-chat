import { describe, expect, it } from "vitest";
import {
  createEmptyWhatsAppInstanceForm,
  createWhatsAppInstanceForm,
  getQrCodeSrc,
  getWebhookUrl,
  getWhatsAppStatusMeta,
} from "@/lib/whatsapp-instances";
import { buildEvolutionMediaPayload } from "../../supabase/functions/_shared/evolution";

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

  it("builds an Evolution v2 image payload", () => {
    expect(
      buildEvolutionMediaPayload({
        phoneNumber: "5511999999999",
        mediaUrl: "https://cdn.example.com/photo.jpg",
        mimeType: "image/jpeg",
        caption: "Foto do produto",
      }),
    ).toEqual({
      number: "5511999999999",
      media: "https://cdn.example.com/photo.jpg",
      mediatype: "image",
      mimetype: "image/jpeg",
      caption: "Foto do produto",
    });
  });

  it("builds an Evolution v2 PDF document payload with fileName", () => {
    expect(
      buildEvolutionMediaPayload({
        phoneNumber: "5511999999999",
        mediaUrl: "https://cdn.example.com/proposta.pdf",
        mimeType: "application/pdf",
        caption: "Proposta comercial",
      }),
    ).toEqual({
      number: "5511999999999",
      media: "https://cdn.example.com/proposta.pdf",
      mediatype: "document",
      mimetype: "application/pdf",
      fileName: "proposta.pdf",
      caption: "Proposta comercial",
    });
  });

  it("defaults extensionless Google media URLs to JPEG images", () => {
    expect(
      buildEvolutionMediaPayload({
        phoneNumber: "5511999999999",
        mediaUrl: "https://lh3.googleusercontent.com/d/ID=w1600",
      }),
    ).toEqual({
      number: "5511999999999",
      media: "https://lh3.googleusercontent.com/d/ID=w1600",
      mediatype: "image",
      mimetype: "image/jpeg",
      caption: undefined,
    });
  });
});
