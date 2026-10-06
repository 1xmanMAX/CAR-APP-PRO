/** Lugares que fotografía `pnpm capturas`. Cada tarea del rediseño actualiza esta lista. */
export interface LugarCaptura {
  nombre: string;
  ruta: string;
  /** Sigue el primer enlace que coincida (para abrir, por ejemplo, el primer viaje). */
  seguir?: string;
  /** Hace clic aquí antes de la foto (por ejemplo, abrir el panel de Anotar). */
  clic?: string;
  /** Espera a que aparezca este selector después del clic. */
  esperar?: string;
  /** Milisegundos extra antes de la foto (el 3D necesita ~1.5 s). */
  espera?: number;
  /** Solo en un tamaño. */
  solo?: "pc" | "movil";
}

export const LUGARES: LugarCaptura[] = [
  { nombre: "inicio", ruta: "/" },
  { nombre: "viajes", ruta: "/viajes" },
  { nombre: "camiones", ruta: "/trailer", espera: 1500 },
  { nombre: "numeros", ruta: "/finanzas" },
  { nombre: "ajustes", ruta: "/ajustes" },
];
