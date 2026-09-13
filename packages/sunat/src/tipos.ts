export type EstadoRespuesta = "aceptada" | "observada" | "rechazada" | "en_proceso";

export interface RespuestaSunat {
  estado: EstadoRespuesta;
  codigo: string;
  mensaje: string;
  notas: string[];
  cdrZip?: Buffer;
  urlQr?: string;
}

export interface DocumentoFirmado {
  nombreArchivo: string;
  xml: string;
}

export interface SunatGateway {
  enviarGuia(doc: DocumentoFirmado): Promise<{ ticket: string }>;
  consultarTicket(ticket: string): Promise<RespuestaSunat>;
  enviarFactura(doc: DocumentoFirmado): Promise<RespuestaSunat>;
}

export class SunatNoDisponibleError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "SunatNoDisponibleError";
  }
}

export function nombreArchivo(ruc: string, tipo: "01" | "31", serie: string, numero: number): string {
  return `${ruc}-${tipo}-${serie}-${numero}`;
}
