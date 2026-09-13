import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { generarPdfFactura, type PdfFactura } from "../src/factura";
import { generarPdfGuia, type PdfGuia } from "../src/guia";

async function texto(pdf: Buffer): Promise<string> {
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const t = (await extractText(doc, { mergePages: true })).text as string;
  return t.replace(/\s+/g, " ");
}

const guia: PdfGuia = {
  emisor: { ruc: "20606433094", razonSocial: "TRANSPORTES DEMO SAC", direccion: "AV. DEMO 123", registroMtc: "15123456CNG" },
  serieNumero: "V001-1",
  fechaEmision: "2026-09-13",
  fechaTraslado: "2026-09-14",
  remitente: { numeroDoc: "20131312955", razonSocial: "DISTRIBUIDORA SAC" },
  destinatario: { numeroDoc: "20602712592", razonSocial: "CHOCANO CARGO SAC" },
  partida: "AV. 28 DE JULIO 1275 - LIMA / LIMA / LA VICTORIA",
  llegada: "CARRETERA FEDERICO BASADRE KM 86 - UCAYALI / CORONEL PORTILLO / CALLERIA",
  vehiculoPlaca: "ABC123",
  conductor: { nombre: "JHON LARRY VELEZMORO SOZA", numeroDoc: "45288569", licencia: "Q45288569" },
  pesoBruto: "1500.500",
  unidadPeso: "KGM",
  documentosRelacionados: ["GRE Remitente EG01-123"],
  items: [{ descripcion: "CAJAS DE CERAMICA", cantidad: "120", unidadMedida: "BX" }],
  textoQr: "https://simulado.local/qr",
  simulado: true,
};

const factura: PdfFactura = {
  emisor: { ruc: "20606433094", razonSocial: "TRANSPORTES DEMO SAC", direccion: "AV. DEMO 123" },
  serieNumero: "F001-1",
  fechaEmision: "2026-09-13",
  fechaVencimiento: "2026-10-13",
  formaPago: "Crédito",
  cliente: { numeroDoc: "20131312955", razonSocial: "DISTRIBUIDORA SAC" },
  descripcion: "SERVICIO DE TRANSPORTE DE CARGA SEGUN GRE V001-1",
  subtotal: "S/ 1,000.00",
  igv: "S/ 180.00",
  total: "S/ 1,180.00",
  montoEnLetras: "SON: MIL CIENTO OCHENTA CON 00/100 SOLES",
  detraccion: { porcentaje: "4%", monto: "S/ 47.00", cuenta: "00-045-091619" },
  guiasRelacionadas: ["V001-1"],
  textoQr: "20606433094|01|F001|1|180.00|1180.00|2026-09-13|6|20131312955|abc=|",
  simulado: true,
};

describe("PDF", () => {
  it("guía: PDF válido con los datos clave", async () => {
    const pdf = await generarPdfGuia(guia);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const t = await texto(pdf);
    for (const esperado of ["GUÍA DE REMISIÓN ELECTRÓNICA TRANSPORTISTA", "V001-1", "ABC123", "Q45288569", "1500.500", "CAJAS DE CERAMICA", "SIMULADO"]) {
      expect(t).toContain(esperado);
    }
  });

  it("factura: PDF válido con totales, detracción y letras", async () => {
    const t = await texto(await generarPdfFactura(factura));
    for (const esperado of ["FACTURA ELECTRÓNICA", "F001-1", "S/ 1,180.00", "SON: MIL CIENTO OCHENTA", "00-045-091619", "2026-10-13"]) {
      expect(t).toContain(esperado);
    }
  });

  it("factura sin detracción no muestra la sección", async () => {
    const t = await texto(await generarPdfFactura({ ...factura, detraccion: null }));
    expect(t).not.toContain("detracción");
  });
});
