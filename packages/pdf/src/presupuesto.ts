import { crearPdf } from "./comun";

export interface DatosPresupuesto {
  empresa: { ruc: string; razonSocial: string; direccion: string };
  numero: string;
  fecha: string;
  ruta: string;
  unidad: string | null;
  km: number;
  toneladas: number;
  lineas: Array<{ concepto: string; monto: number }>;
  costo: number;
  margenPct: number;
  flete: number;
  porTonelada: number | null;
  porKm: number | null;
}

const soles = (n: number) => `S/ ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Presupuesto de flete (no es comprobante de pago). Montos en soles con decimales. */
export function pdfPresupuesto(d: DatosPresupuesto): Promise<Buffer> {
  return crearPdf((doc) => {
    doc.font("Helvetica-Bold").fontSize(14).text(d.empresa.razonSocial);
    doc.font("Helvetica").fontSize(9).text(`RUC ${d.empresa.ruc} · ${d.empresa.direccion}`);
    doc.moveDown();
    doc.font("Helvetica-Bold").fontSize(16).fillColor("#B8236E").text(`PRESUPUESTO DE FLETE ${d.numero}`);
    doc.fillColor("black").font("Helvetica").fontSize(10).text(`Fecha: ${d.fecha}`);
    doc.moveDown();
    doc.font("Helvetica-Bold").text("Ruta: ", { continued: true }).font("Helvetica").text(d.ruta);
    if (d.unidad) doc.font("Helvetica-Bold").text("Unidad: ", { continued: true }).font("Helvetica").text(d.unidad);
    doc.font("Helvetica-Bold").text("Distancia: ", { continued: true }).font("Helvetica").text(`${d.km.toLocaleString("en-US")} km`);
    doc.font("Helvetica-Bold").text("Carga: ", { continued: true }).font("Helvetica").text(`${d.toneladas} t`);
    doc.moveDown();
    doc.font("Helvetica-Bold").fontSize(11).text("DESGLOSE DE COSTOS");
    doc.moveDown(0.3);
    for (const l of d.lineas) {
      const y = doc.y;
      doc.font("Helvetica").fontSize(10).text(l.concepto, 40, y, { width: 330 });
      doc.text(soles(l.monto), 380, y, { width: 175, align: "right" });
      doc.moveDown(0.2);
    }
    doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(0.3);
    let y = doc.y;
    doc.font("Helvetica-Bold").text("Costo del viaje", 40, y).text(soles(d.costo), 380, y, { width: 175, align: "right" });
    doc.moveDown(0.8);
    y = doc.y;
    doc.fontSize(14).fillColor("#B8236E").text("FLETE", 40, y).text(soles(d.flete), 300, y, { width: 255, align: "right" });
    doc.fillColor("black").fontSize(9).font("Helvetica").moveDown(0.5);
    doc.x = 40;
    const extra = [d.porTonelada !== null ? `${soles(d.porTonelada)} por tonelada` : null, d.porKm !== null ? `${soles(d.porKm)} por km` : null].filter(Boolean).join(" · ");
    if (extra) doc.text(extra);
    doc.text("Precio sin IGV. Válido por 7 días. No es un comprobante de pago.");
  });
}
