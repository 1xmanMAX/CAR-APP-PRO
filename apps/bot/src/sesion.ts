/**
 * Estado por chat. `flujo` lo refinan las Tasks 9 y 10 con EstadoFlujoGuia / EstadoFlujoFactura;
 * por ahora solo se sabe que cada flujo se identifica por su `tipo`.
 */
export interface Sesion {
  usuarioId?: number;
  flujo?: { tipo: string };
}
