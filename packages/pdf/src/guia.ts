import { campo, crearPdf, encabezado, qr, seccion } from "./comun";

export interface PdfGuia {
  emisor: { ruc: string; razonSocial: string; direccion: string; registroMtc: string };
  serieNumero: string;
  fechaEmision: string;
  fechaTraslado: string;
  remitente: { numeroDoc: string; razonSocial: string };
  destinatario: { numeroDoc: string; razonSocial: string };
  partida: string;
  llegada: string;
  vehiculoPlaca: string;
  conductor: { nombre: string; numeroDoc: string; licencia: string };
  pesoBruto: string;
  unidadPeso: string;
  documentosRelacionados: string[];
  items: Array<{ descripcion: string; cantidad: string; unidadMedida: string }>;
  textoQr: string;
  simulado: boolean;
}

export function generarPdfGuia(d: PdfGuia, o: { comprimir?: boolean } = {}): Promise<Buffer> {
  return crearPdf(async (doc) => {
    encabezado(doc, d.emisor, "GUÍA DE REMISIÓN ELECTRÓNICA TRANSPORTISTA", d.serieNumero, d.simulado);
    campo(doc, "Fecha de emisión", d.fechaEmision);
    campo(doc, "Inicio de traslado", d.fechaTraslado);
    campo(doc, "Registro MTC", d.emisor.registroMtc);
    seccion(doc, "Remitente y destinatario");
    campo(doc, "Remitente", `${d.remitente.razonSocial} (${d.remitente.numeroDoc})`);
    campo(doc, "Destinatario", `${d.destinatario.razonSocial} (${d.destinatario.numeroDoc})`);
    seccion(doc, "Traslado");
    campo(doc, "Punto de partida", d.partida);
    campo(doc, "Punto de llegada", d.llegada);
    campo(doc, "Peso bruto", `${d.pesoBruto} ${d.unidadPeso}`);
    if (d.documentosRelacionados.length) campo(doc, "Documentos relacionados", d.documentosRelacionados.join(", "));
    seccion(doc, "Vehículo y conductor");
    campo(doc, "Placa", d.vehiculoPlaca);
    campo(doc, "Conductor", `${d.conductor.nombre} - DNI ${d.conductor.numeroDoc}`);
    campo(doc, "Licencia", d.conductor.licencia);
    seccion(doc, "Bienes trasladados");
    d.items.forEach((it, i) => {
      doc.font("Helvetica").fontSize(9).text(`${i + 1}. ${it.descripcion} — ${it.cantidad} ${it.unidadMedida}`);
    });
    await qr(doc, d.textoQr);
    doc.font("Helvetica").fontSize(8).text("Representación impresa de la Guía de Remisión Electrónica Transportista.");
  }, o.comprimir);
}
