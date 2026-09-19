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

/** Estado por chat. La Task 10 añade su propio flujo de factura con otro `tipo`. */
export interface Sesion {
  usuarioId?: number;
  flujo?: EstadoFlujoGuia | { tipo: string };
}

export function flujoGuia(s: Sesion): EstadoFlujoGuia | undefined {
  return s.flujo?.tipo === "guia" ? (s.flujo as EstadoFlujoGuia) : undefined;
}
