import { extractText, getDocumentProxy } from "unpdf";

export async function textoDePdf(contenido: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(contenido));
  const { text } = await extractText(pdf, { mergePages: true });
  return text.trim();
}
