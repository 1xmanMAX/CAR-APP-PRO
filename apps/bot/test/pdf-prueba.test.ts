import { describe, expect, it } from "vitest";
import { obtenerUbigeo, validarRuc } from "@sunatapp/core";
import { leerGuiaDeTexto, textoDePdf } from "@sunatapp/extractor";
import { lineasFixture, pdfConLineas } from "./pdf-prueba";

const v = { validarRuc, obtenerUbigeo };

describe("pdfConLineas", () => {
  it("el PDF de prueba se lee igual que el fixture de texto", async () => {
    const lineas = lineasFixture();
    const texto = await textoDePdf(await pdfConLineas(lineas));
    const g = leerGuiaDeTexto(texto, v);
    expect(g).toEqual(leerGuiaDeTexto(lineas.join("\n"), v));
    // Además de coincidir, la lectura tiene que ser la completa: si unpdf juntara o partiera
    // líneas, ambos lados podrían coincidir "en vacío" y las pruebas del flujo no valdrían nada.
    expect(g.serieNumero).toEqual({ valor: "EG07-5531", confianza: "segura" });
    expect(g.transportista.valor).toEqual({ ruc: "20606433094", razonSocial: "TRANSPORTES DEMO SAC" });
    expect(g.placas.valor).toEqual({ principal: "ABC-123", secundarias: ["XYZ-987"] });
    expect(g.partida.valor).toEqual({ direccion: "AV. 28 DE JULIO 1275 LIMA", ubigeo: "150115" });
    expect(g.llegada.valor).toEqual({ direccion: "CARRETERA FEDERICO BASADRE KM 86 PUCALLPA", ubigeo: "250101" });
    expect(g.fechaTraslado).toEqual({ valor: "2026-09-14", confianza: "segura" });
    expect(g.pesoBruto).toEqual({ valor: "1500.5", confianza: "segura" });
    expect(g.items.valor).toEqual([{ descripcion: "CAJAS DE CERAMICA", cantidad: "120", unidadMedida: "BX" }]);
    expect(g.conductor.valor).toEqual({ numeroDoc: "45288569", nombres: "JHON LARRY", apellidos: "VELEZMORO SOZA", licencia: "Q45288569" });
  });
});
