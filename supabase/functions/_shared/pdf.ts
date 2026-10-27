// Texto de PDF (base de conhecimento e documentos recebidos no WhatsApp).
import { extractText, getDocumentProxy } from "npm:unpdf@0.12.1";

export async function pdfToText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n\n") : text;
}
