import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

export interface Almacen {
  guardar(ruta: string, contenido: string | Buffer): Promise<string>;
  leer(ruta: string): Promise<Buffer>;
  leerTexto(ruta: string): Promise<string>;
  rutaAbsoluta(ruta: string): string;
}

export function crearAlmacenLocal(base: string): Almacen {
  const raiz = resolve(base);
  const absoluta = (ruta: string) => {
    const destino = resolve(raiz, ruta);
    if (destino !== raiz && !destino.startsWith(raiz + sep)) throw new Error(`Ruta no permitida: ${ruta}`);
    return destino;
  };
  return {
    async guardar(ruta, contenido) {
      const destino = absoluta(ruta);
      await mkdir(dirname(destino), { recursive: true });
      await writeFile(destino, contenido);
      return relative(raiz, destino).split(sep).join("/");
    },
    leer: (ruta) => readFile(absoluta(ruta)),
    leerTexto: (ruta) => readFile(absoluta(ruta), "utf8"),
    rutaAbsoluta: absoluta,
  };
}
