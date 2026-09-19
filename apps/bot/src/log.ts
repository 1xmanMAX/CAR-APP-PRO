import { mkdirSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";

export interface Logger {
  info(m: string, d?: unknown): void;
  error(m: string, d?: unknown): void;
}

/** Los errores no se serializan solos con JSON.stringify: se convierten a un objeto plano. */
function plano(d: unknown): unknown {
  if (d instanceof Error) return { nombre: d.name, mensaje: d.message, pila: d.stack };
  return d;
}

function linea(nivel: "info" | "error", mensaje: string, detalle: unknown): string {
  const evento: Record<string, unknown> = { hora: new Date().toISOString(), nivel, mensaje };
  if (detalle !== undefined) evento.detalle = plano(detalle);
  try {
    return `${JSON.stringify(evento)}\n`;
  } catch {
    return `${JSON.stringify({ hora: evento.hora, nivel, mensaje, detalle: String(detalle) })}\n`;
  }
}

/** Una línea JSON por evento en <dir>/bot.log y una copia en consola. Nunca lanza. */
export function crearLogger(dir: string): Logger {
  const archivo = join(dir, "bot.log");
  let listo = false;
  const escribir = (nivel: "info" | "error", mensaje: string, detalle: unknown): void => {
    const texto = linea(nivel, mensaje, detalle);
    if (nivel === "error") console.error(texto.trimEnd());
    else console.log(texto.trimEnd());
    try {
      if (!listo) {
        mkdirSync(dir, { recursive: true });
        listo = true;
      }
      void appendFile(archivo, texto).catch(() => {});
    } catch {
      // Si no se puede escribir en disco, basta con la consola.
    }
  };
  return {
    info: (m, d) => escribir("info", m, d),
    error: (m, d) => escribir("error", m, d),
  };
}
