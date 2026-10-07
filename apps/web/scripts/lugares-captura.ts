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
  { nombre: "anotar", ruta: "/anotar" },
  { nombre: "inicio-con-panel", ruta: "/", clic: "[data-abrir-panel]", esperar: "#panel-anotar form", espera: 600, solo: "pc" },
  { nombre: "anotar-asi-queda", ruta: "/anotar?monto=350&categoria=combustible", solo: "pc" },
  { nombre: "anotar-chofer", ruta: "/anotar?tipo=chofer" },
  { nombre: "anotar-cobro", ruta: "/anotar?tipo=cobro" },
  { nombre: "anotar-repare", ruta: "/anotar?tipo=repare" },
  { nombre: "anotar-compra", ruta: "/anotar?tipo=repare&modo=compra" },
  { nombre: "anotar-empresa", ruta: "/anotar?tipo=empresa" },
  { nombre: "anotar-prestamo", ruta: "/anotar?tipo=prestamo" },
  { nombre: "viajes", ruta: "/viajes" },
  { nombre: "viaje", ruta: "/viajes", seguir: ".tarjeta-ruta, .fila-viaje:not(.cab)" },
  { nombre: "viaje-cerrado", ruta: "/viajes", seguir: ".fila-viaje:not(.cab)" },
  { nombre: "camion", ruta: "/camiones", espera: 2000 },
  { nombre: "camion-historial", ruta: "/camiones?tab=historial", espera: 2000 },
  { nombre: "camion-repuestos", ruta: "/camiones?tab=repuestos", espera: 2000 },
  { nombre: "camion-datos", ruta: "/camiones?tab=datos", espera: 2000 },
  { nombre: "numeros", ruta: "/finanzas" },
  { nombre: "ajustes", ruta: "/ajustes" },
];
