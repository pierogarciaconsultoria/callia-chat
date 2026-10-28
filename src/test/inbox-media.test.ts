import { describe, expect, it } from "vitest";
import { cleanMime, inboxMediaPath, looksLikePaymentProof, mediaNote, unintelligibleTranscript } from "../../supabase/functions/_shared/inbox-media.ts";


const msg = { id: "m1", workspace_id: "ws", conversation_id: "c1" };

describe("arquivos recebidos no WhatsApp", () => {
  it("caminho por workspace/conversa/mensagem com a extensão do arquivo ou do tipo", () => {
    expect(inboxMediaPath(msg, "application/pdf", "sicredi_1793111428951.PDF")).toBe("ws/c1/m1.pdf");
    expect(inboxMediaPath(msg, "image/jpeg; charset=binary", null)).toBe("ws/c1/m1.jpg");
    expect(inboxMediaPath(msg, "application/x-estranho", "../../etc/passwd")).toBe("ws/c1/m1.bin");
    expect(cleanMime("image/jpg")).toBe("image/jpeg");
  });

  it("reconhece comprovantes (palavra de pagamento + valor), não qualquer foto", () => {
    expect(looksLikePaymentProof("Comprovante de pagamento: PIX de R$ 2.490,00 para Morada do Sol em 27/10")).toBe(true);
    expect(looksLikePaymentProof("SICREDI Comprovante de Transferência Valor 1.250,00")).toBe(true);
    expect(looksLikePaymentProof('O documento é um comprovante de transferência realizado via Pix no valor de R$ 900,00, destinatário "Morada do Sol II"')).toBe(true);
    expect(looksLikePaymentProof("Comprovante de depósito de 900 reais")).toBe(true);
    expect(looksLikePaymentProof("Foto de uma piscina com espreguiçadeiras")).toBe(false);
    expect(looksLikePaymentProof("Print da tabela: diária R$ 490,00")).toBe(false);
  });

  it("o agente lê o conteúdo do documento, ou sabe que não deu para ler", () => {
    expect(mediaNote({ type: "document", content: null, metadata: { file_name: "c.pdf", document_text: "PIX R$ 100,00" } })).toBe('[documento "c.pdf": PIX R$ 100,00]');
    expect(mediaNote({ type: "document", content: null, metadata: { file_name: "c.pdf", document_text: "" } })).toBe('[documento "c.pdf" (sem texto legível)]');
    expect(mediaNote({ type: "document", content: "segue", metadata: { file_name: "f.docx" } })).toBe('segue\n[documento "f.docx"]');
    expect(mediaNote({ type: "text", content: "oi", metadata: {} })).toBeNull();
  });

  it("áudio sem fala aproveitável: vazio ou frase curta repetida (alucinação do reconhecimento de voz)", () => {
    expect(unintelligibleTranscript("")).toBe(true);
    expect(unintelligibleTranscript("[áudio sem fala reconhecível]")).toBe(true);
    expect(unintelligibleTranscript("O que é isso? É um... O que é isso? É um... É um...")).toBe(true);
    expect(unintelligibleTranscript("O que é isso? O que é isso? O que é isso? O que é isso?")).toBe(true);
    expect(unintelligibleTranscript("quais os serviços inclusos no valor da diária?")).toBe(false);
    expect(unintelligibleTranscript("oi")).toBe(false);
    expect(unintelligibleTranscript("sim, pode ser")).toBe(false);
  });
});
