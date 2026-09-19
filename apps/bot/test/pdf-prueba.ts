import { readFileSync } from "node:fs";
import PDFDocument from "pdfkit";

/**
 * Arma un PDF con texto real (una línea por entrada) para las pruebas del flujo: así el extractor
 * de reglas recorre el mismo camino que en producción (unpdf → leerGuiaDeTexto) sin depender de
 * un PDF binario guardado en el repositorio.
 */
export function pdfConLineas(lineas: string[]): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ compress: false });
    const partes: Buffer[] = [];
    doc.on("data", (p: Buffer) => partes.push(p));
    doc.on("end", () => resolve(Buffer.concat(partes)));
    doc.font("Helvetica").fontSize(9);
    for (const l of lineas) doc.text(l);
    doc.end();
  });
}

/** Las líneas de la guía inventada del extractor, con los cambios que pida cada prueba. */
export function lineasFixture(cambios: (l: string[]) => string[] = (l) => l): string[] {
  const texto = readFileSync(
    new URL("../../../packages/extractor/test/fixtures/guia-desordenada.txt", import.meta.url),
    "utf8",
  );
  return cambios(texto.split(/\r?\n/).filter((l) => l.trim() !== ""));
}
