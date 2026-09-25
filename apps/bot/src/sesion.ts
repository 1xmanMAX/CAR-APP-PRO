import type { EstadoFlujoFlota } from "./flujo-flota";
import type { Borrador, CampoGuia, DatosConductor, TransporteGuia } from "@sunatapp/core";

/** Una placa o un conductor de la guía que todavía no está en la base y hay que resolver. */
export type PendienteTransporte =
  | { tipo: "placa"; placa: string; habitual: string | null }
  | { tipo: "conductor"; datos: DatosConductor };

/**
 * La conversación de una guía, desde el PDF del remitente hasta el envío a SUNAT. Vive en la
 * sesión del chat: si el bot se reinicia a medias, el dueño vuelve a enviar el PDF y no se pierde
 * nada (el documento ya quedó registrado y la guía se retoma por su id).
 */
export interface EstadoFlujoGuia {
  tipo: "guia";
  paso: "transporte" | "preguntando" | "distrito" | "resumen" | "eligiendo_campo" | "emitiendo";
  documentoId: number;
  /** Solo si se retoma una guía ya existente (rechazada o en borrador). */
  guiaId?: number;
  borrador: Borrador;
  transporte: TransporteGuia;
  pendientesTransporte: PendienteTransporte[];
  campoActual?: CampoGuia;
  /** Partida/llegada: dirección ya escrita, falta elegir el distrito. */
  direccionPendiente?: string;
}

/**
 * La conversación de una factura, desde el monto del flete hasta el envío a SUNAT. Arranca sobre
 * una guía ya aceptada, así que todo lo que hace falta recordar son las respuestas del dueño.
 */
export interface EstadoFlujoFactura {
  tipo: "factura";
  guiaId: number;
  paso: "monto" | "igv" | "cliente" | "ruc_cliente" | "pago" | "dias" | "resumen" | "emitiendo";
  montoCentimos?: number;
  incluyeIgv?: boolean;
  clienteId?: number;
  formaPago?: "contado" | "credito";
  diasCredito?: number;
  /** Solo tras confirmar: la factura ya creada, para saber si el envío sigue en curso. */
  facturaId?: number;
  /** Solo para escribir el resumen: el cliente ya elegido (remitente u otro RUC). */
  cliente?: { numeroDoc: string; razonSocial: string };
}

/** Estado por chat: una conversación a la vez, sea de guía o de factura. */
export interface Sesion {
  usuarioId?: number;
  /** Última unidad con la que trabajó este chat (para no preguntarla en cada /gasto o /km). */
  unidadId?: number;
  flujo?: EstadoFlujoGuia | EstadoFlujoFactura | EstadoFlujoFlota | { tipo: string };
}

export function flujoGuia(s: Sesion): EstadoFlujoGuia | undefined {
  return s.flujo?.tipo === "guia" ? (s.flujo as EstadoFlujoGuia) : undefined;
}

export function flujoFactura(s: Sesion): EstadoFlujoFactura | undefined {
  return s.flujo?.tipo === "factura" ? (s.flujo as EstadoFlujoFactura) : undefined;
}
