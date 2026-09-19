import { leerGuiaDeTexto } from "./lector-reglas";
import { textoDePdf } from "./texto-pdf";
import { PdfSinTextoError, type ProveedorExtraccion, type Validadores } from "./tipos";

export * from "./tipos";
export { leerGuiaDeTexto } from "./lector-reglas";
export { textoDePdf } from "./texto-pdf";

const MINIMO_CARACTERES = 50;

export function crearExtractor(config: { tipo: "reglas" | "ia" }, v: Validadores): ProveedorExtraccion {
  if (config.tipo === "ia") throw new Error("Lector con IA no disponible aún");
  return {
    nombre: "reglas",
    async extraer(archivo) {
      if (archivo.mime !== "application/pdf") throw new PdfSinTextoError("Solo PDF por ahora");
      let texto: string;
      try {
        texto = await textoDePdf(archivo.contenido);
      } catch {
        throw new PdfSinTextoError("El PDF no tiene texto");
      }
      if (texto.length < MINIMO_CARACTERES) throw new PdfSinTextoError("El PDF no tiene texto");
      return leerGuiaDeTexto(texto, v);
    },
  };
}
