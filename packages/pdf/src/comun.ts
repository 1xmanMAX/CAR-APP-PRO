import PDFDocument from "pdfkit";
import QRCode from "qrcode";

export type Doc = PDFKit.PDFDocument;

export async function crearPdf(dibujar: (doc: Doc) => Promise<void> | void, comprimir = true): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 40, compress: comprimir });
  const partes: Buffer[] = [];
  doc.on("data", (c: Buffer) => partes.push(c));
  const fin = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(partes)));
    doc.on("error", reject);
  });
  await dibujar(doc);
  doc.end();
  return fin;
}

export function encabezado(doc: Doc, emisor: { ruc: string; razonSocial: string; direccion: string }, titulo: string, serieNumero: string, simulado: boolean): void {
  const y = doc.y;
  doc.font("Helvetica-Bold").fontSize(13).text(emisor.razonSocial, 40, y, { width: 320 });
  doc.font("Helvetica").fontSize(9).text(emisor.direccion, { width: 320 });
  doc.rect(380, y, 175, 70).stroke();
  doc.font("Helvetica-Bold").fontSize(10).text(`RUC ${emisor.ruc}`, 385, y + 8, { width: 165, align: "center" });
  doc.text(titulo, { width: 165, align: "center" });
  doc.fontSize(12).text(serieNumero, { width: 165, align: "center" });
  doc.y = y + 85;
  doc.x = 40;
  if (simulado) {
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#b00020").text("DOCUMENTO SIMULADO - SIN VALOR TRIBUTARIO", { align: "center" });
    doc.fillColor("black").moveDown(0.5);
  }
}

export function campo(doc: Doc, etiqueta: string, valor: string): void {
  doc.font("Helvetica-Bold").fontSize(9).text(`${etiqueta}: `, { continued: true }).font("Helvetica").text(valor);
}

export function seccion(doc: Doc, titulo: string): void {
  doc.moveDown(0.6).font("Helvetica-Bold").fontSize(10).text(titulo.toUpperCase()).moveDown(0.2);
}

export async function qr(doc: Doc, texto: string): Promise<void> {
  const imagen = await QRCode.toBuffer(texto, { width: 110, margin: 1 });
  doc.moveDown();
  doc.image(imagen, 40, doc.y, { width: 90 });
  doc.y += 95;
}
