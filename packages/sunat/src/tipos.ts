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
  /** CDR de una factura ya registrada en SUNAT; null si SUNAT no la tiene o no se puede consultar. */
  consultarCdrFactura(c: { ruc: string; serie: string; numero: number }): Promise<RespuestaSunat | null>;
}

/** SUNAT rechazó el usuario/clave SOL o las credenciales API: no se debe reintentar solo. */
export class SunatCredencialesError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "SunatCredencialesError";
  }
}

export class SunatNoDisponibleError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "SunatNoDisponibleError";
  }
}

/**
 * SUNAT dice que ese número ya está registrado (1032/1033) y no se pudo recuperar su CDR: no es
 * un rechazo (puede estar aceptado) ni se debe reenviar solo. El dueño lo verifica en SOL.
 */
export class SunatYaRegistradoError extends Error {
  constructor(readonly codigo: string, mensaje: string) {
    super(mensaje);
    this.name = "SunatYaRegistradoError";
  }
}

export function nombreArchivo(ruc: string, tipo: "01" | "31", serie: string, numero: number): string {
  return `${ruc}-${tipo}-${serie}-${numero}`;
}
