import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SunatMixto } from "../src/mixto";
import { ENDPOINTS_FACTURA, SunatReal, type CredencialesSunat } from "../src/real";
import { SunatSimulado } from "../src/simulado";
import { SunatNoDisponibleError } from "../src/tipos";
import { leerXmlDeZip, zipArchivo } from "../src/zip";

const cred: CredencialesSunat = {
  ruc: "20606433094", usuarioSol: "USUARIO1", claveSol: "clave1",
  greClientId: "cid", greClientSecret: "csecret", ambienteFactura: "beta",
};

const CDR_OK = `<ar:ApplicationResponse xmlns:ar="urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cac:DocumentResponse><cac:Response><cbc:ResponseCode>0</cbc:ResponseCode><cbc:Description>Aceptado</cbc:Description></cac:Response></cac:DocumentResponse></ar:ApplicationResponse>`;

type Llamada = { url: string; init: RequestInit };

function fetchFalso(respuestas: Array<(l: Llamada) => Response | Promise<Response>>) {
  const llamadas: Llamada[] = [];
  const fn = (async (url: string | URL, init: RequestInit = {}) => {
    const llamada = { url: String(url), init };
    llamadas.push(llamada);
    const siguiente = respuestas.shift();
    if (!siguiente) throw new Error(`Llamada inesperada a ${url}`);
    return siguiente(llamada);
  }) as typeof fetch;
  return { fn, llamadas };
}

const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });
const token = () => json({ access_token: "TOKEN1", expires_in: 3600 });

describe("SunatReal — guías", () => {
  it("pide token con password grant y envía el ZIP con hash SHA-256", async () => {
    const { fn, llamadas } = fetchFalso([token, () => json({ numTicket: "T-1" })]);
    const sunat = new SunatReal(cred, { fetch: fn });
    const r = await sunat.enviarGuia({ nombreArchivo: "20606433094-31-V001-1", xml: "<guia/>" });
    expect(r).toEqual({ ticket: "T-1" });

    expect(llamadas[0]!.url).toBe("https://api-seguridad.sunat.gob.pe/v1/clientessol/cid/oauth2/token/");
    const form = new URLSearchParams(String(llamadas[0]!.init.body));
    expect(form.get("grant_type")).toBe("password");
    expect(form.get("username")).toBe("20606433094USUARIO1");
    expect(form.get("scope")).toBe("https://api-cpe.sunat.gob.pe");

    expect(llamadas[1]!.url).toBe("https://api-cpe.sunat.gob.pe/v1/contribuyente/gem/comprobantes/20606433094-31-V001-1");
    const cuerpo = JSON.parse(String(llamadas[1]!.init.body));
    const zip = Buffer.from(cuerpo.archivo.arcGreZip, "base64");
    expect(cuerpo.archivo.nomArchivo).toBe("20606433094-31-V001-1.zip");
    expect(cuerpo.archivo.hashZip).toBe(createHash("sha256").update(zip).digest("hex"));
    expect(await leerXmlDeZip(zip)).toBe("<guia/>");
    expect((llamadas[1]!.init.headers as Record<string, string>).Authorization).toBe("Bearer TOKEN1");
  });

  it("reutiliza el token y lo renueva ante 401", async () => {
    const { fn, llamadas } = fetchFalso([
      token,
      () => json({ numTicket: "T-1" }),
      () => new Response("", { status: 401 }),
      () => json({ access_token: "TOKEN2", expires_in: 3600 }),
      () => json({ numTicket: "T-2" }),
    ]);
    const sunat = new SunatReal(cred, { fetch: fn });
    await sunat.enviarGuia({ nombreArchivo: "a", xml: "<a/>" });
    expect(await sunat.enviarGuia({ nombreArchivo: "b", xml: "<b/>" })).toEqual({ ticket: "T-2" });
    expect(llamadas.filter((l) => l.url.includes("oauth2")).length).toBe(2);
  });

  it("consultarTicket: 0098 en proceso, 0001 aceptada con CDR, 0003 rechazada con error", async () => {
    const cdrZip = (await zipArchivo("R-x.xml", CDR_OK)).toString("base64");
    const { fn } = fetchFalso([
      token,
      () => json({ codRespuesta: "0098" }),
      () => json({ codRespuesta: "0001", indCdrGenerado: "1", arcCdr: cdrZip }),
      () => json({ codRespuesta: "0003", error: { numError: "2556", desError: "Placa no válida" } }),
    ]);
    const sunat = new SunatReal(cred, { fetch: fn });
    expect((await sunat.consultarTicket("T")).estado).toBe("en_proceso");
    expect(await sunat.consultarTicket("T")).toMatchObject({ estado: "aceptada", codigo: "0" });
    expect(await sunat.consultarTicket("T")).toMatchObject({ estado: "rechazada", codigo: "2556", mensaje: "Placa no válida" });
  });

  it("error de red o HTTP 5xx se reporta como SUNAT no disponible", async () => {
    const caida = fetchFalso([() => { throw new TypeError("fetch failed"); }]);
    await expect(new SunatReal(cred, { fetch: caida.fn }).enviarGuia({ nombreArchivo: "a", xml: "<a/>" })).rejects.toBeInstanceOf(SunatNoDisponibleError);
    const http500 = fetchFalso([token, () => new Response("boom", { status: 503 })]);
    await expect(new SunatReal(cred, { fetch: http500.fn }).enviarGuia({ nombreArchivo: "a", xml: "<a/>" })).rejects.toBeInstanceOf(SunatNoDisponibleError);
  });

  it("sin credenciales GRE falla con mensaje claro", async () => {
    const sunat = new SunatReal({ ...cred, greClientId: undefined }, { fetch: fetchFalso([]).fn });
    await expect(sunat.enviarGuia({ nombreArchivo: "a", xml: "<a/>" })).rejects.toThrow("credenciales API SUNAT");
  });
});

describe("SunatReal — facturas (SOAP)", () => {
  it("envía sendBill al endpoint beta con WS-Security y lee el CDR", async () => {
    const cdr = (await zipArchivo("R-f.xml", CDR_OK)).toString("base64");
    const { fn, llamadas } = fetchFalso([
      () => new Response(`<soap-env:Envelope xmlns:soap-env="http://schemas.xmlsoap.org/soap/envelope/"><soap-env:Body><br:sendBillResponse xmlns:br="http://service.sunat.gob.pe"><applicationResponse>${cdr}</applicationResponse></br:sendBillResponse></soap-env:Body></soap-env:Envelope>`),
    ]);
    const r = await new SunatReal(cred, { fetch: fn }).enviarFactura({ nombreArchivo: "20606433094-01-F001-1", xml: "<f/>" });
    expect(r).toMatchObject({ estado: "aceptada", codigo: "0" });
    expect(llamadas[0]!.url).toBe(ENDPOINTS_FACTURA.beta);
    const sobre = String(llamadas[0]!.init.body);
    expect(sobre).toContain("<wsse:Username>20606433094USUARIO1</wsse:Username>");
    expect(sobre).toContain("<fileName>20606433094-01-F001-1.zip</fileName>");
  });

  it("un SOAP Fault con código 2xxx es rechazo; otro código es error", async () => {
    const fault = (codigo: string) => () =>
      new Response(`<soap-env:Envelope xmlns:soap-env="http://schemas.xmlsoap.org/soap/envelope/"><soap-env:Body><soap-env:Fault><faultcode>soap-env:Client.${codigo}</faultcode><faultstring>Detalle ${codigo}</faultstring></soap-env:Fault></soap-env:Body></soap-env:Envelope>`, { status: 500 });
    const rechazo = fetchFalso([fault("2800")]);
    expect(await new SunatReal(cred, { fetch: rechazo.fn }).enviarFactura({ nombreArchivo: "a", xml: "<a/>" })).toMatchObject({ estado: "rechazada", codigo: "2800", mensaje: "Detalle 2800" });
    const auth = fetchFalso([fault("0102")]);
    await expect(new SunatReal(cred, { fetch: auth.fn }).enviarFactura({ nombreArchivo: "a", xml: "<a/>" })).rejects.toThrow("0102");
  });
});

describe("SunatMixto", () => {
  it("usa un gateway para guías y otro para facturas", async () => {
    const guias = new SunatSimulado({ demoraMs: 0 });
    const facturas = new SunatSimulado({ rechazo: { codigo: "2000", mensaje: "no" } });
    const mixto = new SunatMixto(guias, facturas);
    const { ticket } = await mixto.enviarGuia({ nombreArchivo: "20606433094-31-V001-1", xml: "<x/>" });
    expect((await mixto.consultarTicket(ticket)).estado).toBe("aceptada");
    expect((await mixto.enviarFactura({ nombreArchivo: "20606433094-01-F001-1", xml: "<x/>" })).estado).toBe("rechazada");
  });
});
