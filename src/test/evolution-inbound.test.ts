import { describe, expect, it } from "vitest";
import { parseEvolutionMessageUpsert } from "@/lib/evolution-inbound";

describe("evolution inbound parser", () => {
  it("parses inbound text messages", () => {
    const parsed = parseEvolutionMessageUpsert({
      event: "MESSAGES_UPSERT",
      instance: "comercial-01",
      data: {
        pushName: "Maria",
        key: {
          id: "msg-1",
          remoteJid: "5511999999999@s.whatsapp.net",
          fromMe: false,
        },
        message: {
          conversation: "Oi, quero saber o preço",
        },
      },
    });

    expect(parsed).toEqual({
      providerEventId: "msg-1",
      customerPhone: "5511999999999",
      customerName: "Maria",
      direction: "inbound",
      sender: "customer",
      messageType: "text",
      content: "Oi, quero saber o preço",
      mediaUrl: null,
      mimeType: null,
      transcription: null,
      externalMessageId: "msg-1",
      metadata: expect.objectContaining({
        event: "MESSAGES_UPSERT",
        fromMe: false,
        instanceName: "comercial-01",
      }),
    });
  });

  it("parses outbound image messages", () => {
    const parsed = parseEvolutionMessageUpsert({
      event: "MESSAGES_UPSERT",
      data: {
        key: {
          id: "msg-2",
          remoteJid: "5511888888888@s.whatsapp.net",
          fromMe: true,
        },
        message: {
          imageMessage: {
            caption: "Segue catálogo",
            mimetype: "image/jpeg",
            url: "https://cdn.exemplo/imagem.jpg",
          },
        },
      },
    });

    expect(parsed?.direction).toBe("outbound");
    expect(parsed?.sender).toBe("bot");
    expect(parsed?.messageType).toBe("image");
    expect(parsed?.content).toBe("Segue catálogo");
    expect(parsed?.mediaUrl).toBe("https://cdn.exemplo/imagem.jpg");
    expect(parsed?.mimeType).toBe("image/jpeg");
  });

  it("returns null for unrelated events or malformed payloads", () => {
    expect(parseEvolutionMessageUpsert({ event: "CONNECTION_UPDATE" })).toBeNull();
    expect(parseEvolutionMessageUpsert({ event: "MESSAGES_UPSERT", data: {} })).toBeNull();
  });

  it("parses payloads where data arrives as an array", () => {
    const parsed = parseEvolutionMessageUpsert({
      event: "MESSAGES_UPSERT",
      data: [
        {
          key: {
            id: "msg-3",
            remoteJid: "5511777777777@s.whatsapp.net",
            fromMe: false,
          },
          message: {
            extendedTextMessage: {
              text: "Mensagem em lote",
            },
          },
        },
      ],
    });

    expect(parsed?.providerEventId).toBe("msg-3");
    expect(parsed?.content).toBe("Mensagem em lote");
  });
});
