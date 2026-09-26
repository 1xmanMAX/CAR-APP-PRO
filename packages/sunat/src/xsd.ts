import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import xmllint from "xmllint-wasm";

const DIR = process.env.CF_XSD || fileURLToPath(new URL("../xsd/2.1/", import.meta.url));

function leerXsd(ruta: string): string {
  // Los imports "../common/X.xsd" se aplanan porque xmllint-wasm usa un sistema de archivos plano.
  return readFileSync(ruta, "utf8").replace(/schemaLocation="(\.\.\/)+common\//g, 'schemaLocation="');
}

const comunes = readdirSync(join(DIR, "common")).map((f) => ({ fileName: f, contents: leerXsd(join(DIR, "common", f)) }));

export async function validarXsd(xml: string, tipo: "DespatchAdvice" | "Invoice"): Promise<{ valido: boolean; errores: string[] }> {
  const principal = `UBL-${tipo}-2.1.xsd`;
  const resultado = await xmllint.validateXML({
    xml: [{ fileName: "documento.xml", contents: xml }],
    schema: [{ fileName: principal, contents: leerXsd(join(DIR, "maindoc", principal)) }],
    preload: comunes,
  });
  return { valido: resultado.valid, errores: resultado.errors.map((e) => e.message) };
}
