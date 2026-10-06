import { puedeEditar, puedeVer, type RolUsuario, type Seccion } from "@sunatapp/core";

/** Los lugares del menú nuevo (spec §2). */
export type Lugar = "inicio" | "viajes" | "camiones" | "numeros" | "ajustes" | "anotar";

/** A qué lugar pertenece cada sección vieja (marca el activo del menú). */
export const LUGAR_DE_SECCION: Record<Seccion, Lugar> = {
  dashboard: "inicio", trailer: "camiones", flota: "camiones", inventario: "camiones", reparaciones: "camiones",
  viajes: "viajes", finanzas: "numeros", rentabilidad: "numeros", telegram: "ajustes", ajustes: "ajustes", sincronizar: "ajustes",
};

/**
 * Adónde llevan los enlaces a lugares que se construyen en tareas posteriores. Cada tarea cambia
 * su entrada cuando el lugar nuevo existe (Camiones: tarea 8, Números: 9, Ajustes: 10, Revisar: 11).
 */
export const RUTA = {
  camiones: "/trailer",
  camion: (id: number, q = "") => `/trailer/${id}${q}`,
  numeros: "/finanzas",
  catalogoPartes: "/ajustes",
  revisar: "/revisar",
  /** Cobrar una factura: «Me pagaron» de Anotar con la factura elegida; al guardar vuelve a Inicio. */
  cobrar: (facturaId: number) => `/anotar?tipo=cobro&facturaId=${facturaId}&volver=%2F`,
};

export interface EntradaMenu { lugar: "inicio" | "viajes" | "camiones" | "numeros"; etiqueta: string; href: string; seccion: Seccion }

/** Los lugares que ve cada rol, en el orden del menú. Inicio lo ven todos. */
export function menuDe(rol: RolUsuario): EntradaMenu[] {
  const todos: EntradaMenu[] = [
    { lugar: "inicio", etiqueta: "Inicio", href: "/", seccion: "dashboard" },
    { lugar: "viajes", etiqueta: "Viajes", href: "/viajes", seccion: "viajes" },
    { lugar: "camiones", etiqueta: "Camiones", href: RUTA.camiones, seccion: "trailer" },
    { lugar: "numeros", etiqueta: "Números", href: RUTA.numeros, seccion: "finanzas" },
  ];
  return todos.filter((e) => e.seccion === "dashboard" || puedeVer(rol, e.seccion));
}

/** Por ahora Ajustes es solo del dueño; la tarea 10 lo abre a todos (el hub filtra las tarjetas). */
export const veAjustes = (rol: RolUsuario): boolean => puedeVer(rol, "ajustes");

export type TipoAnotar = "gaste" | "chofer" | "cobro" | "repare" | "empresa" | "prestamo";

/** Los 6 botones de «¿Qué pasó?» y la sección que hay que poder editar para usar cada uno. */
export const TIPOS_ANOTAR: Record<TipoAnotar, { etiqueta: string; corta: string; seccion: Seccion }> = {
  gaste: { etiqueta: "Gasté", corta: "Gasté", seccion: "finanzas" },
  chofer: { etiqueta: "Plata al chofer", corta: "Plata al chofer", seccion: "viajes" },
  cobro: { etiqueta: "Me pagaron", corta: "Me pagaron", seccion: "viajes" },
  repare: { etiqueta: "Reparé / repuesto", corta: "Reparé / repuesto", seccion: "reparaciones" },
  empresa: { etiqueta: "Gasto de la empresa", corta: "De la empresa", seccion: "finanzas" },
  prestamo: { etiqueta: "Préstamo o cuota", corta: "Préstamo o cuota", seccion: "finanzas" },
};

/** Taller: solo Reparé / repuesto. Contador: la plata. Dueño: todo. Chofer: nada (usa Telegram). */
export function tiposAnotar(rol: RolUsuario): TipoAnotar[] {
  return (Object.keys(TIPOS_ANOTAR) as TipoAnotar[]).filter((t) => puedeEditar(rol, TIPOS_ANOTAR[t].seccion));
}

/** Tipos que ya tienen formulario en Anotar. La tarea 5 completa los demás y borra esta lista. */
export const ANOTAR_LISTOS: TipoAnotar[] = ["gaste", "chofer", "cobro"];

/** Lo que este rol puede anotar hoy (sin botón Anotar si no hay nada). */
export const tiposAnotarListos = (rol: RolUsuario): TipoAnotar[] => tiposAnotar(rol).filter((t) => ANOTAR_LISTOS.includes(t));
