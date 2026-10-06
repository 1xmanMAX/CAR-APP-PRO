import { createHash } from "node:crypto";
import { leerCdrZip } from "./cdr";
import { clasificarFault } from "./faults";
import { SunatCredencialesError, SunatNoDisponibleError, type DocumentoFirmado, type RespuestaSunat, type SunatGateway } from "./tipos";
import { zipArchivo } from "./zip";

export interface CredencialesSunat {
  ruc: string;
  usuarioSol: string;
  claveSol: string;
  greClientId?: string;
  greClientSecret?: string;
  ambienteFactura: "beta" | "produccion";
}

export const ENDPOINTS_FACTURA = {
  beta: "https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService",
  produccion: "https://e-factura.sunat.gob.pe/ol-ti-itcpfegem/billService",
} as const;

export const ENDPOINT_CONSULTA_CDR = "https://e-factura.sunat.gob.pe/ol-it-wsconscpegem/billConsultService";

const URL_TOKEN = "https://api-seguridad.sunat.gob.pe/v1/clientessol";
const URL_GRE = "https://api-cpe.sunat.gob.pe/v1/contribuyente/gem/comprobantes";

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export class SunatReal implements SunatGateway {
  private token: { valor: string; expira: number } | null = null;
  private readonly fetch: typeof fetch;

  constructor(private readonly cred: CredencialesSunat, o: { fetch?: typeof fetch } = {}) {
    this.fetch = o.fetch ?? globalThis.fetch;
  }

  private async llamar(url: string, init: RequestInit): Promise<Response> {
    let resp: Response;
    try {
      resp = await this.fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
    } catch (error) {
      throw new SunatNoDisponibleError(`No se pudo conectar con SUNAT: ${(error as Error).message}`);
    }
    return resp;
  }

  private async obtenerToken(): Promise<string> {
    if (this.token && this.token.expira > Date.now() + 60_000) return this.token.valor;
    const { greClientId, greClientSecret, ruc, usuarioSol, claveSol } = this.cred;
    if (!greClientId || !greClientSecret) throw new Error("Faltan las credenciales API SUNAT (client_id / client_secret) para guías");
    const resp = await this.llamar(`${URL_TOKEN}/${encodeURIComponent(greClientId)}/oauth2/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "password",
        scope: "https://api-cpe.sunat.gob.pe",
        client_id: greClientId,
        client_secret: greClientSecret,
        username: `${ruc}${usuarioSol}`,
        password: claveSol,
      }).toString(),
    });
    if (resp.status >= 500) throw new SunatNoDisponibleError(`SUNAT OAuth HTTP ${resp.status}`);
    if (resp.status === 400 || resp.status === 401) {
      throw new SunatCredencialesError("SUNAT rechazó las credenciales de guías (client_id, client_secret, usuario o clave SOL)");
    }
    if (!resp.ok) throw new Error(`SUNAT rechazó el pedido de token (OAuth HTTP ${resp.status})`);
    const datos = (await resp.json()) as { access_token: string; expires_in: number };
    this.token = { valor: datos.access_token, expira: Date.now() + datos.expires_in * 1000 };
    return this.token.valor;
  }

  private async llamarGre(url: string, init: RequestInit): Promise<unknown> {
    const hacer = async () =>
      this.llamar(url, { ...init, headers: { ...(init.headers as object), Authorization: `Bearer ${await this.obtenerToken()}`, Accept: "application/json" } });
    let resp = await hacer();
    if (resp.status === 401) {
      this.token = null;
      resp = await hacer();
    }
    if (resp.status === 401) throw new SunatCredencialesError("SUNAT no aceptó el permiso de las credenciales de guías");
    if (resp.status >= 500) throw new SunatNoDisponibleError(`SUNAT GRE HTTP ${resp.status}`);
    const texto = await resp.text();
    if (!resp.ok) throw new Error(`SUNAT GRE HTTP ${resp.status}: ${texto.slice(0, 300)}`);
    return texto ? JSON.parse(texto) : {};
  }

  async enviarGuia(doc: DocumentoFirmado): Promise<{ ticket: string }> {
    const zip = await zipArchivo(`${doc.nombreArchivo}.xml`, doc.xml);
    const datos = (await this.llamarGre(`${URL_GRE}/${encodeURIComponent(doc.nombreArchivo)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        archivo: {
          nomArchivo: `${doc.nombreArchivo}.zip`,
          arcGreZip: zip.toString("base64"),
          hashZip: createHash("sha256").update(zip).digest("hex"),
        },
      }),
    })) as { numTicket?: string };
    if (!datos.numTicket) throw new Error("SUNAT no devolvió número de ticket");
    return { ticket: datos.numTicket };
  }

  async consultarTicket(ticket: string): Promise<RespuestaSunat> {
    const datos = (await this.llamarGre(`${URL_GRE}/envios/${encodeURIComponent(ticket)}`, { method: "GET" })) as {
      codRespuesta: string;
      arcCdr?: string;
      error?: { numError?: string; desError?: string };
    };
    if ((datos.codRespuesta == null || datos.codRespuesta === "") && !datos.arcCdr) throw new Error("Respuesta de ticket inesperada de SUNAT");
    const cod = String(Number(datos.codRespuesta));
    if (cod === "98") return { estado: "en_proceso", codigo: "98", mensaje: "En proceso", notas: [] };
    if (datos.arcCdr) return leerCdrZip(Buffer.from(datos.arcCdr, "base64"));
    if (cod === "0" || cod === "1") return { estado: "aceptada", codigo: "0", mensaje: "Aceptado", notas: [] };
    return {
      estado: "rechazada",
      codigo: datos.error?.numError ?? datos.codRespuesta,
      mensaje: datos.error?.desError ?? "Rechazado por SUNAT",
      notas: [],
    };
  }

  private sobre(cuerpo: string): string {
    return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.sunat.gob.pe" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
  <soapenv:Header><wsse:Security><wsse:UsernameToken>
    <wsse:Username>${escape(this.cred.ruc + this.cred.usuarioSol)}</wsse:Username>
    <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${escape(this.cred.claveSol)}</wsse:Password>
  </wsse:UsernameToken></wsse:Security></soapenv:Header>
  <soapenv:Body>${cuerpo}</soapenv:Body>
</soapenv:Envelope>`;
  }

  private async soap(url: string, accion: string, cuerpo: string): Promise<{ texto: string; fault?: { codigo: string; mensaje: string } }> {
    const resp = await this.llamar(url, { method: "POST", headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: accion }, body: this.sobre(cuerpo) });
    const texto = await resp.text();
    const m = texto.match(/<faultcode[^>]*>([\s\S]*?)<\/faultcode>[\s\S]*?<faultstring[^>]*>([\s\S]*?)<\/faultstring>/);
    if (m) {
      const codigo = m[1]!.match(/(\d{4})\s*$/)?.[1] ?? m[1]!.trim();
      const mensaje = m[2]!.trim();
      const clase = clasificarFault(codigo);
      if (clase === "credenciales") throw new SunatCredencialesError(`SUNAT rechazó el usuario o la clave SOL (${codigo}: ${mensaje})`);
      if (clase === "no_disponible") throw new SunatNoDisponibleError(`SUNAT no disponible (${codigo}: ${mensaje})`);
      return { texto, fault: { codigo, mensaje } };
    }
    if (resp.status >= 500) throw new SunatNoDisponibleError(`SUNAT SOAP HTTP ${resp.status}`);
    return { texto };
  }

  async enviarFactura(doc: DocumentoFirmado): Promise<RespuestaSunat> {
    const zip = await zipArchivo(`${doc.nombreArchivo}.xml`, doc.xml);
    const { texto, fault } = await this.soap(ENDPOINTS_FACTURA[this.cred.ambienteFactura], "urn:sendBill",
      `<ser:sendBill><fileName>${escape(doc.nombreArchivo)}.zip</fileName><contentFile>${zip.toString("base64")}</contentFile></ser:sendBill>`);
    if (fault) {
      const clase = clasificarFault(fault.codigo);
      if (clase === "ya_registrado") {
        const [ruc, , serie, numero] = doc.nombreArchivo.split("-");
        const cdr = this.cred.ambienteFactura === "produccion" && ruc && serie && numero
          ? await this.consultarCdrFactura({ ruc, serie, numero: Number(numero) })
          : null;
        return cdr ?? { estado: "rechazada", codigo: fault.codigo, mensaje: fault.mensaje, notas: [] };
      }
      if (clase === "rechazo") return { estado: "rechazada", codigo: fault.codigo, mensaje: fault.mensaje, notas: [] };
      throw new Error(`SUNAT SOAP ${fault.codigo}: ${fault.mensaje}`);
    }
    const cdr = texto.match(/<applicationResponse[^>]*>([\s\S]*?)<\/applicationResponse>/)?.[1];
    if (!cdr) throw new Error("Respuesta SOAP inesperada de SUNAT");
    return leerCdrZip(Buffer.from(cdr.trim(), "base64"));
  }

  async consultarCdrFactura(c: { ruc: string; serie: string; numero: number }): Promise<RespuestaSunat | null> {
    const { texto, fault } = await this.soap(ENDPOINT_CONSULTA_CDR, "urn:getStatusCdr",
      `<ser:getStatusCdr><rucComprobante>${escape(c.ruc)}</rucComprobante><tipoComprobante>01</tipoComprobante><serieComprobante>${escape(c.serie)}</serieComprobante><numeroComprobante>${c.numero}</numeroComprobante></ser:getStatusCdr>`);
    if (fault) return null;
    const contenido = texto.match(/<content>([\s\S]*?)<\/content>/)?.[1]?.trim();
    return contenido ? leerCdrZip(Buffer.from(contenido, "base64")) : null;
  }

  /** Comprueba usuario y clave SOL sin emitir nada: consulta un comprobante que no existe. */
  async probarClaveSol(): Promise<{ ok: boolean; mensaje: string }> {
    try {
      const { texto, fault } = await this.soap(ENDPOINT_CONSULTA_CDR, "urn:getStatusCdr",
        `<ser:getStatusCdr><rucComprobante>${escape(this.cred.ruc)}</rucComprobante><tipoComprobante>01</tipoComprobante><serieComprobante>F999</serieComprobante><numeroComprobante>99999999</numeroComprobante></ser:getStatusCdr>`);
      const claseFault = fault ? clasificarFault(fault.codigo) : null;
      if (/<statusCode>/.test(texto) || claseFault === "rechazo" || claseFault === "ya_registrado") return { ok: true, mensaje: "Usuario y clave SOL correctos" };
      return { ok: false, mensaje: "SUNAT respondió algo inesperado; vuelve a probar en unos minutos" };
    } catch (e) {
      if (e instanceof SunatCredencialesError) return { ok: false, mensaje: `SUNAT no aceptó tu usuario o clave SOL. ${e.message}` };
      return { ok: false, mensaje: `No se pudo conectar con SUNAT: ${(e as Error).message}` };
    }
  }

  /** Comprueba client_id/client_secret de guías pidiendo un permiso (token) que no se usa. */
  async probarCredencialesGre(): Promise<{ ok: boolean; mensaje: string }> {
    try {
      this.token = null;
      await this.obtenerToken();
      return { ok: true, mensaje: "Credenciales de guías correctas" };
    } catch (e) {
      if (e instanceof SunatCredencialesError) return { ok: false, mensaje: "SUNAT no aceptó el client_id / client_secret de guías (o el usuario y clave SOL)" };
      return { ok: false, mensaje: `No se pudo conectar con SUNAT: ${(e as Error).message}` };
    }
  }
}
