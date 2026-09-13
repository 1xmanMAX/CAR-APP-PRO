import { leerCdrZip } from "./cdr";
import type { DocumentoFirmado, RespuestaSunat, SunatGateway } from "./tipos";
import { zipArchivo } from "./zip";

export interface OpcionesSimulado {
  demoraMs?: number;
  rechazo?: { codigo: string; mensaje: string };
  ahora?: () => number;
}

export class SunatSimulado implements SunatGateway {
  private readonly demoraMs: number;
  private readonly ahora: () => number;

  constructor(private readonly o: OpcionesSimulado = {}) {
    this.demoraMs = o.demoraMs ?? 3000;
    this.ahora = o.ahora ?? Date.now;
  }

  async enviarGuia(doc: DocumentoFirmado): Promise<{ ticket: string }> {
    // El ticket codifica nombre y hora: no hace falta memoria y sobrevive reinicios.
    return { ticket: `SIM.${this.ahora()}.${doc.nombreArchivo}` };
  }

  async consultarTicket(ticket: string): Promise<RespuestaSunat> {
    const m = ticket.match(/^SIM\.(\d+)\.(.+)$/);
    if (!m) throw new Error(`Ticket simulado inválido: ${ticket}`);
    if (this.ahora() - Number(m[1]) < this.demoraMs) {
      return { estado: "en_proceso", codigo: "0098", mensaje: "En proceso", notas: [] };
    }
    return this.responder(m[2]!, true);
  }

  async enviarFactura(doc: DocumentoFirmado): Promise<RespuestaSunat> {
    return this.responder(doc.nombreArchivo, false);
  }

  private async responder(nombre: string, esGuia: boolean): Promise<RespuestaSunat> {
    if (this.o.rechazo) return { estado: "rechazada", codigo: this.o.rechazo.codigo, mensaje: this.o.rechazo.mensaje, notas: [] };
    const serieNumero = nombre.split("-").slice(2).join("-");
    const url = esGuia ? `<cbc:DocumentDescription>https://simulado.local/qr?doc=SIMULADO-${nombre}</cbc:DocumentDescription>` : "";
    const cdr = `<?xml version="1.0" encoding="UTF-8"?>
<ar:ApplicationResponse xmlns:ar="urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>SIMULADO</cbc:ID>
  <cac:DocumentResponse>
    <cac:Response><cbc:ResponseCode>0</cbc:ResponseCode><cbc:Description>(SIMULADO) El comprobante ${serieNumero} ha sido aceptado</cbc:Description></cac:Response>
    <cac:DocumentReference><cbc:ID>${serieNumero}</cbc:ID>${url}</cac:DocumentReference>
  </cac:DocumentResponse>
</ar:ApplicationResponse>`;
    return leerCdrZip(await zipArchivo(`R-${nombre}.xml`, cdr));
  }
}
