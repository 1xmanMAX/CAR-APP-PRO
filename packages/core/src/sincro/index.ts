export * from "./grupo";
export { CodigoDistinto } from "./canal";
export { inventario, exportarTodo, canonico, resumir, type Apunte, type Fila } from "./filas";
export { planificar, type Paso } from "./plan";
export { fusionarFila } from "./fusion";
export { recalcularDerivados } from "./derivados";
export { responder, sincronizarCon, historialSinc, OCUPADO, VERSION_PROTOCOLO, type ResultadoSinc, type Avance } from "./protocolo";
export { TABLAS as TABLAS_SINC } from "./registro";
export { RedSinc, direccionesLocales, buscarIpPorRuta, PUERTO_SINC, PUERTO_AVISOS, type Vecino, type EstadoSinc } from "./red";
