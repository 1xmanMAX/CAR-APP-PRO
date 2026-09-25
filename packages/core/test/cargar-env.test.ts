import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { guardarEnv, leerEnv } from "../src/infra/cargar-env";

describe(".env del dispositivo", () => {
  const archivo = () => join(mkdtempSync(join(tmpdir(), "env-")), ".env");

  it("lee claves, comillas y comentarios", () => {
    const a = archivo();
    writeFileSync(a, '# comentario\nA=1\nB="con espacios"\nC=valor # nota\nexport D=\'x\'\nmal linea\n');
    expect(leerEnv(a)).toEqual({ A: "1", B: "con espacios", C: "valor", D: "x" });
    expect(leerEnv(join(a, "no-existe"))).toEqual({});
  });

  it("cambia claves conservando comentarios y agrega las nuevas al final", () => {
    const a = archivo();
    writeFileSync(a, "# Bot\nTELEGRAM_BOT_TOKEN=\nBOT_HORA_AVISO=08:00\n");
    guardarEnv(a, { TELEGRAM_BOT_TOKEN: "123:abc", SUNAT_MODO: "beta", BOT_HORA_AVISO: null });
    expect(readFileSync(a, "utf8")).toBe("# Bot\nTELEGRAM_BOT_TOKEN=123:abc\nBOT_HORA_AVISO=\nSUNAT_MODO=beta\n");
    for (const clave of ['con espacio#y"comillas', "barra\\n y 'simple'", "Ñandú$1"]) {
      guardarEnv(a, { SUNAT_SOL_CLAVE: clave });
      expect(leerEnv(a).SUNAT_SOL_CLAVE).toBe(clave);
    }
  });

  it("crea el archivo si no existe", () => {
    const a = archivo();
    guardarEnv(a, { SUNAT_MODO: "real" });
    expect(leerEnv(a)).toEqual({ SUNAT_MODO: "real" });
  });
});
