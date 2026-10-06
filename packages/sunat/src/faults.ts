export type ClaseFault = "rechazo" | "ya_registrado" | "credenciales" | "no_disponible" | "otro";

/**
 * Qué hacer con el código de un SOAP Fault de SUNAT (catálogo de errores 0100–3999):
 * - credenciales: usuario/clave/perfil SOL → pausar todo, nunca reintentar solo;
 * - ya_registrado: el número ya está en SUNAT → recuperar su CDR;
 * - no_disponible: servicio caído o error interno → reintento normal;
 * - rechazo: contenido, nombre o ZIP inválido → reintentar no lo arregla.
 */
export function clasificarFault(codigo: string): ClaseFault {
  if (!/^\d{4}$/.test(codigo)) return "otro";
  const n = Number(codigo);
  if (n === 1032 || n === 1033) return "ya_registrado";
  if ((n >= 101 && n <= 106) || (n >= 110 && n <= 113)) return "credenciales";
  if (n === 109 || (n >= 130 && n <= 149) || (n >= 200 && n <= 299)) return "no_disponible";
  if ((n >= 150 && n <= 199) || (n >= 1000 && n <= 3999)) return "rechazo";
  return "otro";
}
