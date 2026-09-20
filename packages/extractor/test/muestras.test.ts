import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { obtenerUbigeo, validarRuc } from "@sunatapp/core";
import { describe, expect, it } from "vitest";
import { crearExtractor } from "../src/index";
import type { GuiaExtraida } from "../src/tipos";

/**
 * Prueba con guías reales de clientes: viven en `referencias/` (git-ignorado) y no se versionan.
 * Cada PDF necesita al lado un `<mismo nombre>.esperado.json` con los valores correctos.
 */
const carpeta = fileURLToPath(new URL("../../../referencias/muestras/", import.meta.url));

function paresDeMuestras(): Array<{ pdf: string; esperado: string; nombre: string }> {
  if (!existsSync(carpeta)) return [];
  return readdirSync(carpeta)
    .filter((n) => n.toLowerCase().endsWith(".pdf"))
    .map((n) => ({
      nombre: n,
      pdf: `${carpeta}${n}`,
      esperado: `${carpeta}${n.slice(0, -4)}.esperado.json`,
    }))
    .filter((p) => existsSync(p.esperado));
}

const muestras = paresDeMuestras();
const extractor = crearExtractor({ tipo: "reglas" }, { validarRuc, obtenerUbigeo });

const CAMPOS = [
  "serieNumero",
  "remitente",
  "destinatario",
  "transportista",
  "partida",
  "llegada",
  "fechaTraslado",
  "pesoBruto",
  "unidadPeso",
  "placas",
  "conductor",
  "items",
] as const satisfies ReadonlyArray<keyof GuiaExtraida>;

describe("muestras reales", () => {
  if (muestras.length === 0) {
    it.skip("sin muestras locales", () => {});
    return;
  }

  for (const muestra of muestras) {
    it(`extrae ${muestra.nombre}`, async () => {
      const esperado = JSON.parse(readFileSync(muestra.esperado, "utf8")) as Record<string, unknown>;
      const guia = await extractor.extraer({
        contenido: readFileSync(muestra.pdf),
        mime: "application/pdf",
      });

      const fallos: string[] = [];
      let aciertos = 0;
      for (const campo of CAMPOS) {
        const obtenido = guia[campo].valor;
        if (JSON.stringify(obtenido) === JSON.stringify(esperado[campo])) aciertos += 1;
        else fallos.push(`${campo}: esperado ${JSON.stringify(esperado[campo])}, obtenido ${JSON.stringify(obtenido)}`);
      }
      if (JSON.stringify(guia.documentosRelacionados) === JSON.stringify(esperado["documentosRelacionados"])) {
        aciertos += 1;
      } else {
        fallos.push(
          `documentosRelacionados: esperado ${JSON.stringify(esperado["documentosRelacionados"])}, obtenido ${JSON.stringify(guia.documentosRelacionados)}`,
        );
      }

      const total = CAMPOS.length + 1;
      console.log(`${muestra.nombre}: ${aciertos}/${total} campos acertados`);
      expect(fallos, fallos.join("\n")).toEqual([]);
    });
  }
});
