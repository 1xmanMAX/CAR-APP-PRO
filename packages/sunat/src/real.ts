import { createHash } from "node:crypto";
import { leerCdrZip } from "./cdr";
import { SunatNoDisponibleError, type DocumentoFirmado, type RespuestaSunat, type SunatGateway } from "./tipos";
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
    if (!resp.ok) throw new Error(`SUNAT rechazó las credenciales (OAuth HTTP ${resp.status})`);
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
    if (datos.codRespuesta === "0098") return { estado: "en_proceso", codigo: "0098", mensaje: "En proceso", notas: [] };
    if (datos.arcCdr) return leerCdrZip(Buffer.from(datos.arcCdr, "base64"));
    if (datos.codRespuesta === "0001") return { estado: "aceptada", codigo: "0001", mensaje: "Aceptado", notas: [] };
    return {
      estado: "rechazada",
      codigo: datos.error?.numError ?? datos.codRespuesta,
      mensaje: datos.error?.desError ?? "Rechazado por SUNAT",
      notas: [],
    };
  }

  async enviarFactura(doc: DocumentoFirmado): Promise<RespuestaSunat> {
    const zip = await zipArchivo(`${doc.nombreArchivo}.xml`, doc.xml);
    const sobre = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.sunat.gob.pe" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
  <soapenv:Header><wsse:Security><wsse:UsernameToken>
    <wsse:Username>${escape(this.cred.ruc + this.cred.usuarioSol)}</wsse:Username>
    <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${escape(this.cred.claveSol)}</wsse:Password>
  </wsse:UsernameToken></wsse:Security></soapenv:Header>
  <soapenv:Body><ser:sendBill><fileName>${escape(doc.nombreArchivo)}.zip</fileName><contentFile>${zip.toString("base64")}</contentFile></ser:sendBill></soapenv:Body>
</soapenv:Envelope>`;
    const resp = await this.llamar(ENDPOINTS_FACTURA[this.cred.ambienteFactura], {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "urn:sendBill" },
      body: sobre,
    });
    const texto = await resp.text();
    const fault = texto.match(/<faultcode[^>]*>([\s\S]*?)<\/faultcode>[\s\S]*?<faultstring[^>]*>([\s\S]*?)<\/faultstring>/);
    if (fault) {
      const codigo = fault[1]!.match(/(\d{4})\s*$/)?.[1] ?? fault[1]!.trim();
      const numero = Number(codigo);
      if (numero >= 2000 && numero < 4000) return { estado: "rechazada", codigo, mensaje: fault[2]!.trim(), notas: [] };
      throw new Error(`SUNAT SOAP ${codigo}: ${fault[2]!.trim()}`);
    }
    if (resp.status >= 500) throw new SunatNoDisponibleError(`SUNAT SOAP HTTP ${resp.status}`);
    const cdr = texto.match(/<applicationResponse[^>]*>([\s\S]*?)<\/applicationResponse>/)?.[1];
    if (!cdr) throw new Error(`Respuesta SOAP inesperada (HTTP ${resp.status})`);
    return leerCdrZip(Buffer.from(cdr.trim(), "base64"));
  }
}
