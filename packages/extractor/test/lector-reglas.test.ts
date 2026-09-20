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

/**
 * Regresiones: ningún campo puede devolver un valor equivocado marcado "segura" en un formato
 * de guía distinto. Preferimos un campo "dudoso" de más (una pregunta más en el chat) antes que
 * una placa o un destino equivocados dentro de un documento que se manda a SUNAT.
 */
describe("leerGuiaDeTexto: nunca da por segura una lectura ambigua", () => {
  it("no toma un código de 6 dígitos suelto como placa", () => {
    const sinPlacas = texto.replace("ABC-123 - XYZ-987", "133917");
    expect(leerGuiaDeTexto(sinPlacas, v).placas).toEqual({ valor: null, confianza: "dudosa" });
  });

  it("no elige la primera cuando hay dos líneas con forma de placa", () => {
    const dosPlacas = texto.replace("ABC-123 - XYZ-987", "ABC-123 - XYZ-987\nQ7R-551");
    expect(leerGuiaDeTexto(dosPlacas, v).placas).toEqual({ valor: null, confianza: "dudosa" });
  });

  it("no da por peso el único número que sigue a las placas", () => {
    const unSoloNumero = texto.replace("120.00\n1500.5\n", "1500.5\n");
    expect(leerGuiaDeTexto(unSoloNumero, v).pesoBruto).toEqual({ valor: null, confianza: "dudosa" });
  });

  it("marca dudosos los ítems cuando alguna línea de ítem no se pudo leer", () => {
    const itemRoto = texto.replace(
      "CAJAS DE CERAMICA BX 120.0000100200300",
      "CAJAS DE CERAMICA BX 120.0000100200300\nCAJAS DE VIDRIO 55.0000100200301",
    );
    const g = leerGuiaDeTexto(itemRoto, v);
    expect(g.items.valor).toEqual([{ descripcion: "CAJAS DE CERAMICA", cantidad: "120", unidadMedida: "BX" }]);
    expect(g.items.confianza).toBe("dudosa");
    // Un ítem sin leer también invalida el descarte del número de bultos.
    expect(g.pesoBruto).toEqual({ valor: null, confianza: "dudosa" });
  });

  it("no elige la primera unidad de peso cuando hay más de una candidata", () => {
    // Confundir TNE con KGM multiplica el peso por mil en un documento que se manda a SUNAT.
    const dosUnidades = texto.replace("KGM\nDISTRIBUIDORA SAC", "KGM\nTNE\nDISTRIBUIDORA SAC");
    expect(leerGuiaDeTexto(dosUnidades, v).unidadPeso.confianza).toBe("dudosa");
    expect(leerGuiaDeTexto(texto, v).unidadPeso).toEqual({ valor: "KGM", confianza: "segura" });
  });

  it("no confunde la línea del transportista con el destinatario", () => {
    const g = leerGuiaDeTexto(
      ["RUC 20131312955", "TRANSPORTES DEMO SAC20606433094", "20602712592", "CHOCANO CARGO SAC", "20602712592"].join("\n"),
      v,
    );
    expect(g.destinatario.valor).toEqual({ numeroDoc: "20602712592", razonSocial: "CHOCANO CARGO SAC" });
  });

  it("marca dudosos partida y llegada cuando las etiquetas no confirman el orden", () => {
    // En la muestra (formato a dos columnas) la etiqueta de llegada se imprime antes que la de partida.
    const g = leerGuiaDeTexto(texto, v);
    expect(g.partida.confianza).toBe("dudosa");
    expect(g.llegada.confianza).toBe("dudosa");
    expect(g.partida.valor?.ubigeo).toBe("150115");
    expect(g.llegada.valor?.ubigeo).toBe("250101");
  });

  it("da por seguros partida y llegada cuando las etiquetas confirman el orden", () => {
    const enOrden = texto.replace("PUNTO DE LLEGADA\nPUNTO DE PARTIDA :", "PUNTO DE PARTIDA :\nPUNTO DE LLEGADA");
    const g = leerGuiaDeTexto(enOrden, v);
    expect(g.partida).toEqual({ valor: { direccion: "AV. 28 DE JULIO 1275 LIMA", ubigeo: "150115" }, confianza: "segura" });
    expect(g.llegada.confianza).toBe("segura");
  });
});
