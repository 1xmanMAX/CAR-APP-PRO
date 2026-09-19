import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { leerGuiaDeTexto } from "../src/lector-reglas";

const v = {
  validarRuc: (r: string) => ["20131312955", "20606433094", "20602712592"].includes(r),
  obtenerUbigeo: (c: string) => (["150115", "250101"].includes(c) ? { codigo: c } : undefined),
};
const texto = readFileSync(new URL("./fixtures/guia-desordenada.txt", import.meta.url), "utf8");

describe("leerGuiaDeTexto", () => {
  it("extrae todos los campos de una guía desordenada", () => {
    const g = leerGuiaDeTexto(texto, v);
    expect(g.serieNumero).toEqual({ valor: "EG07-5531", confianza: "segura" });
    expect(g.remitente).toEqual({ valor: { numeroDoc: "20131312955", razonSocial: "DISTRIBUIDORA SAC" }, confianza: "segura" });
    expect(g.transportista.valor).toEqual({ ruc: "20606433094", razonSocial: "TRANSPORTES DEMO SAC" });
    expect(g.destinatario.valor).toEqual({ numeroDoc: "20602712592", razonSocial: "CHOCANO CARGO SAC" });
    expect(g.placas.valor).toEqual({ principal: "ABC-123", secundarias: ["XYZ-987"] });
    expect(g.pesoBruto).toEqual({ valor: "1500.5", confianza: "segura" });
    expect(g.unidadPeso.valor).toBe("KGM");
    expect(g.conductor.valor).toEqual({ numeroDoc: "45288569", nombres: "JHON LARRY", apellidos: "VELEZMORO SOZA", licencia: "Q45288569" });
    expect(g.partida.valor).toEqual({ direccion: "AV. 28 DE JULIO 1275 LIMA", ubigeo: "150115" });
    expect(g.llegada.valor).toEqual({ direccion: "CARRETERA FEDERICO BASADRE KM 86 PUCALLPA", ubigeo: "250101" });
    expect(g.fechaTraslado).toEqual({ valor: "2026-09-14", confianza: "segura" });
    expect(g.items.valor).toEqual([{ descripcion: "CAJAS DE CERAMICA", cantidad: "120", unidadMedida: "BX" }]);
    expect(g.documentosRelacionados).toEqual(["F001-4455"]);
  });

  it("no inventa: texto vacío deja todo en null y dudoso", () => {
    const g = leerGuiaDeTexto("", v);
    expect(g.serieNumero).toEqual({ valor: null, confianza: "dudosa" });
    expect(g.items).toEqual({ valor: null, confianza: "dudosa" });
    expect(g.documentosRelacionados).toEqual([]);
  });

  it("marca dudosa la serie cuando hay dos candidatas", () => {
    expect(leerGuiaDeTexto(`${texto}\nAB12 - 99`, v).serieNumero.confianza).toBe("dudosa");
  });
});
