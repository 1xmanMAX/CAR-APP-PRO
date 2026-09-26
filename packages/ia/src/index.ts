import { cargarConfigIa, type ConfigIa } from "./config";
import { crearProveedorDeepSeek } from "./deepseek";
import { crearLectorReglas } from "./reglas";
import type { ProveedorIA } from "./tipos";

export * from "./tipos";
export * from "./config";
export { instruccionesSistema, EJEMPLO_JSON } from "./prompts";
export { crearLectorReglas, leerPorReglas, montoDe } from "./reglas";
export { crearProveedorDeepSeek, costoMicroUsd } from "./deepseek";
export { crearTranscriptor } from "./whisper";

export function crearProveedorIA(config: ConfigIa = cargarConfigIa()): ProveedorIA {
  return config.proveedor === "deepseek" ? crearProveedorDeepSeek(config) : crearLectorReglas();
}
