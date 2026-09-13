import { describe, expect, it } from "vitest";
import { leerCdr } from "../src/cdr";
import { SunatSimulado } from "../src/simulado";
import { nombreArchivo } from "../src/tipos";
import { leerXmlDeZip, zipArchivo } from "../src/zip";

describe("zip", () => {
  it("lee el XML de un ZIP simple y de uno anidado", async () => {
    const simple = await zipArchivo("R-a.xml", "<x>1</x>");
    expect(await leerXmlDeZip(simple)).toBe("<x>1</x>");
    const anidado = await zipArchivo("R-a.zip", simple);
    expect(await leerXmlDeZip(anidado)).toBe("<x>1</x>");
  });
});

describe("leerCdr", () => {
  const cdr = (codigo: string, notas = "") => `<?xml version="1.0"?>
<ar:ApplicationResponse xmlns:ar="urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  ${notas}
  <cac:DocumentResponse>
    <cac:Response><cbc:ResponseCode>${codigo}</cbc:ResponseCode><cbc:Description>Mensaje ${codigo}</cbc:Description></cac:Response>
    <cac:DocumentReference><cbc:ID>V001-1</cbc:ID><cbc:DocumentDescription>https://qr.sunat/abc</cbc:DocumentDescription></cac:DocumentReference>
  </cac:DocumentResponse>
</ar:ApplicationResponse>`;

  it("0 es aceptada y extrae la URL del QR", () => {
    expect(leerCdr(cdr("0"))).toMatchObject({ estado: "aceptada", codigo: "0", mensaje: "Mensaje 0", urlQr: "https://qr.sunat/abc" });
  });
  it("con notas es observada", () => {
    expect(leerCdr(cdr("0", "<cbc:Note>4252 - aviso</cbc:Note>"))).toMatchObject({ estado: "observada", notas: ["4252 - aviso"] });
  });
  it("2xxx es rechazada", () => {
    expect(leerCdr(cdr("2800")).estado).toBe("rechazada");
  });
});

describe("SunatSimulado", () => {
  it("la guía queda en proceso durante la demora y luego se acepta con CDR", async () => {
    let reloj = 1_000;
    const sunat = new SunatSimulado({ demoraMs: 3000, ahora: () => reloj });
    const nombre = nombreArchivo("20606433094", "31", "V001", 1);
    expect(nombre).toBe("20606433094-31-V001-1");
    const { ticket } = await sunat.enviarGuia({ nombreArchivo: nombre, xml: "<x/>" });
    expect((await sunat.consultarTicket(ticket)).estado).toBe("en_proceso");
    reloj += 3000;
    const r = await sunat.consultarTicket(ticket);
    expect(r.estado).toBe("aceptada");
    expect(r.cdrZip).toBeInstanceOf(Buffer);
    expect(r.urlQr).toContain("SIMULADO");
  });

  it("es sin estado: otra instancia puede consultar el ticket", async () => {
    const { ticket } = await new SunatSimulado({ demoraMs: 0 }).enviarGuia({ nombreArchivo: "20606433094-31-V001-2", xml: "<x/>" });
    expect((await new SunatSimulado({ demoraMs: 0 }).consultarTicket(ticket)).estado).toBe("aceptada");
  });

  it("puede forzar rechazo", async () => {
    const sunat = new SunatSimulado({ demoraMs: 0, rechazo: { codigo: "2556", mensaje: "Placa inválida" } });
    const { ticket } = await sunat.enviarGuia({ nombreArchivo: "20606433094-31-V001-3", xml: "<x/>" });
    expect(await sunat.consultarTicket(ticket)).toMatchObject({ estado: "rechazada", codigo: "2556", mensaje: "Placa inválida" });
    expect((await sunat.enviarFactura({ nombreArchivo: "20606433094-01-F001-1", xml: "<x/>" })).estado).toBe("rechazada");
  });

  it("acepta facturas al instante", async () => {
    const r = await new SunatSimulado().enviarFactura({ nombreArchivo: "20606433094-01-F001-1", xml: "<x/>" });
    expect(r).toMatchObject({ estado: "aceptada", codigo: "0" });
  });
});
