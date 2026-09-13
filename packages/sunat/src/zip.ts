import yauzl from "yauzl";
import yazl from "yazl";

function aBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = [];
    stream.on("data", (c: Buffer) => partes.push(c));
    stream.on("end", () => resolve(Buffer.concat(partes)));
    stream.on("error", reject);
  });
}

export async function zipArchivo(nombre: string, contenido: string | Buffer): Promise<Buffer> {
  const zip = new yazl.ZipFile();
  zip.addBuffer(typeof contenido === "string" ? Buffer.from(contenido, "utf8") : contenido, nombre);
  zip.end();
  return aBuffer(zip.outputStream as unknown as NodeJS.ReadableStream);
}

function primeraEntrada(zip: Buffer, acepta: (nombre: string) => boolean): Promise<{ nombre: string; contenido: Buffer }> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(zip, { lazyEntries: true }, (err, archivo) => {
      if (err || !archivo) return reject(err ?? new Error("ZIP vacío"));
      let encontrado = false;
      archivo.on("entry", (entrada: yauzl.Entry) => {
        if (entrada.fileName.endsWith("/") || !acepta(entrada.fileName)) return archivo.readEntry();
        archivo.openReadStream(entrada, (err2, stream) => {
          if (err2 || !stream) return reject(err2 ?? new Error("No se pudo leer el ZIP"));
          encontrado = true;
          aBuffer(stream).then((contenido) => resolve({ nombre: entrada.fileName, contenido }), reject);
        });
      });
      archivo.on("end", () => {
        if (!encontrado) reject(new Error("El ZIP no contiene XML"));
      });
      archivo.on("error", reject);
      archivo.readEntry();
    });
  });
}

export async function leerXmlDeZip(zip: Buffer): Promise<string> {
  const externo = await primeraEntrada(zip, (n) => /\.(xml|zip)$/i.test(n));
  if (/\.xml$/i.test(externo.nombre)) return externo.contenido.toString("utf8");
  const interno = await primeraEntrada(externo.contenido, (n) => /\.xml$/i.test(n));
  return interno.contenido.toString("utf8");
}
