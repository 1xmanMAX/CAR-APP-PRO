import { XMLParser } from "fast-xml-parser";
import type { RespuestaSunat } from "./tipos";
import { leerXmlDeZip } from "./zip";

const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false, isArray: (n) => n === "Note" });

export function leerCdr(xml: string): RespuestaSunat {
  const raiz = parser.parse(xml).ApplicationResponse ?? {};
  const docResp = raiz.DocumentResponse ?? {};
  const resp = docResp.Response ?? {};
  const codigo = String(resp.ResponseCode ?? "");
  const notas: string[] = (raiz.Note ?? []).map(String);
  const numero = Number.parseInt(codigo, 10);
  const estado = Number.isNaN(numero) || numero >= 2000 ? "rechazada" : notas.length > 0 ? "observada" : "aceptada";
  const urlQr = docResp.DocumentReference?.DocumentDescription;
  return { estado, codigo, mensaje: String(resp.Description ?? ""), notas, ...(urlQr ? { urlQr: String(urlQr) } : {}) };
}

export async function leerCdrZip(zip: Buffer): Promise<RespuestaSunat> {
  return { ...leerCdr(await leerXmlDeZip(zip)), cdrZip: zip };
}
