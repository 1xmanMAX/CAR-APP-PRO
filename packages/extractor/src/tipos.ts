export type Confianza = "segura" | "dudosa";

export interface Campo<T> {
  valor: T | null;
  confianza: Confianza;
}

export interface GuiaExtraida {
  serieNumero: Campo<string>;
  remitente: Campo<{ numeroDoc: string; razonSocial: string }>;
  destinatario: Campo<{ numeroDoc: string; razonSocial: string }>;
  transportista: Campo<{ ruc: string; razonSocial: string }>;
  partida: Campo<{ direccion: string; ubigeo: string }>;
  llegada: Campo<{ direccion: string; ubigeo: string }>;
  fechaTraslado: Campo<string>;
  pesoBruto: Campo<string>;
  unidadPeso: Campo<"KGM" | "TNE">;
  placas: Campo<{ principal: string; secundarias: string[] }>;
  conductor: Campo<{ numeroDoc: string; nombres: string; apellidos: string; licencia: string | null }>;
  items: Campo<Array<{ descripcion: string; cantidad: string; unidadMedida: string }>>;
  documentosRelacionados: string[];
}

export interface ProveedorExtraccion {
  nombre: string;
  extraer(archivo: { contenido: Buffer; mime: string }): Promise<GuiaExtraida>;
}

/** Los validadores llegan por parámetro: este paquete no depende de `@sunatapp/core`. */
export interface Validadores {
  validarRuc(ruc: string): boolean;
  obtenerUbigeo(codigo: string): { codigo: string } | undefined;
}

export class PdfSinTextoError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "PdfSinTextoError";
  }
}
