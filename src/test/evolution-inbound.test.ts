import { describe, expect, it } from "vitest";
import { jidToPhone, normalizeEventName, normalizePhone, parseEvolutionWebhook } from "../../supabase/functions/_shared/evolution.ts";

const upsert = (data: Record<string, unknown>) => ({ event: "messages.upsert", instance: "loja-01", data });

describe("normalização de eventos da Evolution", () => {
  it("aceita nomes pontuados e em caixa alta", () => {
    expect(normalizeEventName("messages.upsert")).toBe("MESSAGES_UPSERT");
    expect(normalizeEventName("CONNECTION_UPDATE")).toBe("CONNECTION_UPDATE");
  });

  it("extrai telefone de JIDs", () => {
    expect(jidToPhone("5548999990000@s.whatsapp.net")).toBe("5548999990000");
    expect(jidToPhone("5548999990000:12@s.whatsapp.net")).toBe("5548999990000");
    expect(jidToPhone(null)).toBeNull();
  });

  it("normaliza telefones brasileiros sem DDI", () => {
    expect(normalizePhone("(48) 99999-0000")).toBe("5548999990000");
    expect(normalizePhone("+55 48 99999-0000")).toBe("5548999990000");
    expect(normalizePhone("123")).toBeNull();
  });

  it("converte texto simples", () => {
    const [ev] = parseEvolutionWebhook(upsert({
      key: { remoteJid: "5548999990000@s.whatsapp.net", fromMe: false, id: "ABC123" },
      pushName: "Ana",
      message: { conversation: "Oi, tudo bem?" },
      messageTimestamp: 1792900000,
    }));
    expect(ev).toMatchObject({
      kind: "message",
      instanceName: "loja-01",
      externalId: "ABC123",
      fromMe: false,
      phone: "5548999990000",
      contactName: "Ana",
      type: "text",
      text: "Oi, tudo bem?",
    });
    expect(ev.kind === "message" && ev.timestamp).toBe(new Date(1792900000 * 1000).toISOString());
  });

  it("desembrulha mensagem efêmera com imagem e legenda", () => {
    const [ev] = parseEvolutionWebhook(upsert({
      key: { remoteJid: "5548999990000@s.whatsapp.net", fromMe: false, id: "IMG1" },
      message: { ephemeralMessage: { message: { imageMessage: { caption: "Esse modelo tem?", mimetype: "image/jpeg" } } } },
    }));
    expect(ev).toMatchObject({ kind: "message", type: "image", text: "Esse modelo tem?", mediaMime: "image/jpeg" });
  });

  it("reconhece áudio e documento", () => {
    const [audio] = parseEvolutionWebhook(upsert({
      key: { remoteJid: "5548999990000@s.whatsapp.net", id: "AUD1" },
      message: { audioMessage: { mimetype: "audio/ogg; codecs=opus", ptt: true } },
    }));
    expect(audio).toMatchObject({ type: "audio", text: null, mediaMime: "audio/ogg; codecs=opus" });

    const [doc] = parseEvolutionWebhook(upsert({
      key: { remoteJid: "5548999990000@s.whatsapp.net", id: "DOC1" },
      message: { documentWithCaptionMessage: { message: { documentMessage: { fileName: "comprovante.pdf", mimetype: "application/pdf", caption: "segue" } } } },
    }));
    expect(doc).toMatchObject({ type: "document", fileName: "comprovante.pdf", text: "segue" });
  });

  it("resolve número real de contatos @lid", () => {
    const [ev] = parseEvolutionWebhook(upsert({
      key: { remoteJid: "182736455@lid", remoteJidAlt: "5511988887777@s.whatsapp.net", id: "LID1" },
      message: { conversation: "oi" },
    }));
    expect(ev).toMatchObject({ kind: "message", phone: "5511988887777" });
  });

  it("ignora grupos, status, reações e mensagens de protocolo", () => {
    const reasons = [
      { key: { remoteJid: "1203630@g.us", id: "G" }, message: { conversation: "x" } },
      { key: { remoteJid: "status@broadcast", id: "S" }, message: { conversation: "x" } },
      { key: { remoteJid: "5548999990000@s.whatsapp.net", id: "R" }, message: { reactionMessage: { text: "👍" } } },
      { key: { remoteJid: "5548999990000@s.whatsapp.net", id: "P" }, message: { protocolMessage: { type: 0 } } },
    ].map((d) => {
      const [ev] = parseEvolutionWebhook(upsert(d));
      return ev.kind === "ignored" ? ev.reason : "not-ignored";
    });
    expect(reasons).toEqual(["group_message", "broadcast", "reaction", "protocol_message"]);
  });

  it("marca mensagens enviadas pelo próprio aparelho como fromMe", () => {
    const [ev] = parseEvolutionWebhook(upsert({
      key: { remoteJid: "5548999990000@s.whatsapp.net", fromMe: true, id: "ME1" },
      pushName: "Loja",
      message: { extendedTextMessage: { text: "Já te respondo" } },
    }));
    expect(ev).toMatchObject({ kind: "message", fromMe: true, contactName: null, text: "Já te respondo" });
  });

  it("converte QR code e status de conexão", () => {
    const [qr] = parseEvolutionWebhook({ event: "qrcode.updated", instance: "loja-01", data: { qrcode: { base64: "iVBORw0KGgo=", pairingCode: "ABCD-1234" } } });
    expect(qr).toEqual({ kind: "qrcode", instanceName: "loja-01", qrBase64: "data:image/png;base64,iVBORw0KGgo=", pairingCode: "ABCD-1234" });

    const [conn] = parseEvolutionWebhook({ event: "connection.update", instance: "loja-01", data: { state: "open", wuid: "5548999990000@s.whatsapp.net", profileName: "Loja" } });
    expect(conn).toMatchObject({ kind: "connection", state: "open", phone: "5548999990000", profileName: "Loja" });
  });

  it("ignora eventos desconhecidos", () => {
    const [ev] = parseEvolutionWebhook({ event: "presence.update", instance: "loja-01", data: {} });
    expect(ev).toMatchObject({ kind: "ignored", reason: "event_presence_update" });
  });
});
