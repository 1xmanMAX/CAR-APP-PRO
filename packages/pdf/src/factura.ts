import { campo, crearPdf, encabezado, qr, seccion } from "./comun";

export interface PdfFactura {
  emisor: { ruc: string; razonSocial: string; direccion: string };
  serieNumero: string;
  fechaEmision: string;
  fechaVencimiento: string | null;
  formaPago: string;
  cliente: { numeroDoc: string; razonSocial: string; direccion?: string };
  descripcion: string;
  subtotal: string;
  igv: string;
  total: string;
  montoEnLetras: string;
  detraccion: { porcentaje: string; monto: string; cuenta: string } | null;
  guiasRelacionadas: string[];
  textoQr: string;
  simulado: boolean;
}

export function generarPdfFactura(d: PdfFactura, o: { comprimir?: boolean } = {}): Promise<Buffer> {
  return crearPdf(async (doc) => {
    encabezado(doc, d.emisor, "FACTURA ELECTRÓNICA", d.serieNumero, d.simulado);
    campo(doc, "Fecha de emisión", d.fechaEmision);
    campo(doc, "Forma de pago", d.formaPago);
    if (d.fechaVencimiento) campo(doc, "Fecha de vencimiento", d.fechaVencimiento);
    seccion(doc, "Cliente");
    campo(doc, "Razón social", d.cliente.razonSocial);
    campo(doc, "RUC", d.cliente.numeroDoc);
    if (d.cliente.direccion) campo(doc, "Dirección", d.cliente.direccion);
    seccion(doc, "Detalle");
    doc.font("Helvetica").fontSize(9).text(`1 servicio — ${d.descripcion}`);
    if (d.guiasRelacionadas.length) campo(doc, "Guías de remisión", d.guiasRelacionadas.join(", "));
    seccion(doc, "Totales");
    campo(doc, "Op. gravada", d.subtotal);
    campo(doc, "IGV 18%", d.igv);
    campo(doc, "Importe total", d.total);
    doc.font("Helvetica").fontSize(9).text(d.montoEnLetras);
    if (d.detraccion) {
      seccion(doc, "Operación sujeta a detracción");
      campo(doc, "Porcentaje", d.detraccion.porcentaje);
      campo(doc, "Monto", d.detraccion.monto);
      campo(doc, "Cuenta Banco de la Nación", d.detraccion.cuenta);
    }
    await qr(doc, d.textoQr);
    doc.font("Helvetica").fontSize(8).text("Representación impresa de la Factura Electrónica.");
  }, o.comprimir);
}
