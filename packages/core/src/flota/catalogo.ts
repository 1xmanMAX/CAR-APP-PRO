import { eq, tipoParte, type Ejecutor, type ZonaModelo } from "@sunatapp/db";
import { ErrorNegocio } from "../errores";
import { registrarAuditoria } from "../infra/auditoria";
import type { Contexto } from "../infra/contexto";

export interface TipoParte {
  id: number;
  codigo: string;
  nombre: string;
  nombreCorto: string;
  zona: ZonaModelo;
  vidaKm: number | null;
  vidaViajes: number | null;
  vidaDias: number | null;
  activo: boolean;
}

export const ZONAS: Record<ZonaModelo, string> = {
  motor: "Motor",
  cabina: "Cabina",
  chasis: "Chasis",
  caja: "Caja / semirremolque",
  tanque: "Tanque",
  bateria: "Batería",
  quinta: "Quinta rueda",
  llantas_del: "Llantas eje delantero",
  llantas_trac: "Llantas de tracción",
  llantas_sr: "Llantas del semirremolque",
};

/**
 * Catálogo inicial (valores de ejemplo del diseño). Se configuran en la web: son solo un punto
 * de partida razonable para un tracto con semirremolque.
 */
export const CATALOGO_INICIAL: Array<Omit<TipoParte, "id" | "activo">> = [
  { codigo: "frenos_sr", nombre: "Pastillas de freno · semirremolque", nombreCorto: "FRENOS SEMIRREMOLQUE", zona: "llantas_sr", vidaKm: 60000, vidaViajes: 24, vidaDias: 240 },
  { codigo: "aceite", nombre: "Aceite y filtro de motor", nombreCorto: "ACEITE + FILTRO", zona: "motor", vidaKm: 15000, vidaViajes: 8, vidaDias: 90 },
  { codigo: "quinta", nombre: "Quinta rueda · engrase", nombreCorto: "QUINTA RUEDA", zona: "quinta", vidaKm: 5000, vidaViajes: 3, vidaDias: 15 },
  { codigo: "llantas_trac", nombre: "Llantas de tracción (8)", nombreCorto: "LLANTAS TRACCIÓN", zona: "llantas_trac", vidaKm: 110000, vidaViajes: 50, vidaDias: 480 },
  { codigo: "llantas_sr", nombre: "Llantas semirremolque (12)", nombreCorto: "LLANTAS SEMIRREMOLQUE", zona: "llantas_sr", vidaKm: 120000, vidaViajes: 55, vidaDias: 540 },
  { codigo: "filtro_aire", nombre: "Filtro de aire", nombreCorto: "FILTRO DE AIRE", zona: "motor", vidaKm: 40000, vidaViajes: 18, vidaDias: 180 },
  { codigo: "bateria", nombre: "Batería 12V", nombreCorto: "BATERÍA", zona: "bateria", vidaKm: null, vidaViajes: null, vidaDias: 730 },
  { codigo: "amortiguadores", nombre: "Amortiguadores", nombreCorto: "AMORTIGUADORES", zona: "chasis", vidaKm: 150000, vidaViajes: 70, vidaDias: 720 },
  { codigo: "llantas_del", nombre: "Llantas delanteras (2)", nombreCorto: "LLANTAS DELANTERAS", zona: "llantas_del", vidaKm: 100000, vidaViajes: 45, vidaDias: 480 },
];

function aModelo(f: typeof tipoParte.$inferSelect): TipoParte {
  return {
    id: f.id, codigo: f.codigo, nombre: f.nombre, nombreCorto: f.nombreCorto, zona: f.zona,
    vidaKm: f.vidaKm, vidaViajes: f.vidaViajes, vidaDias: f.vidaDias, activo: f.activo,
  };
}

/** Carga el catálogo inicial si todavía está vacío. Idempotente. */
export async function sembrarCatalogoPartes(db: Ejecutor): Promise<number> {
  const existentes = await db.select({ id: tipoParte.id }).from(tipoParte).limit(1);
  if (existentes.length > 0) return 0;
  await db.insert(tipoParte).values(CATALOGO_INICIAL);
  return CATALOGO_INICIAL.length;
}

export async function listarTiposParte(ctx: Contexto, incluirInactivos = false): Promise<TipoParte[]> {
  const filas = await ctx.db.select().from(tipoParte).orderBy(tipoParte.id);
  return filas.filter((f) => incluirInactivos || f.activo).map(aModelo);
}

export async function obtenerTipoParte(ctx: Contexto, id: number): Promise<TipoParte> {
  const [f] = await ctx.db.select().from(tipoParte).where(eq(tipoParte.id, id));
  if (!f) throw new ErrorNegocio("El tipo de parte no existe");
  return aModelo(f);
}

function validarVida(v: { vidaKm: number | null; vidaViajes: number | null; vidaDias: number | null }): void {
  for (const n of [v.vidaKm, v.vidaViajes, v.vidaDias]) {
    if (n !== null && (!Number.isInteger(n) || n <= 0)) throw new ErrorNegocio("La vida útil debe ser un entero positivo");
  }
  if (v.vidaKm === null && v.vidaViajes === null && v.vidaDias === null) {
    throw new ErrorNegocio("Indica al menos una vida útil (km, viajes o días)");
  }
}

export async function guardarTipoParte(
  ctx: Contexto,
  e: Omit<TipoParte, "id" | "activo" | "codigo"> & { id?: number; codigo?: string },
  usuarioId?: number,
): Promise<number> {
  validarVida(e);
  if (!e.nombre.trim()) throw new ErrorNegocio("Falta el nombre de la parte");
  const valores = {
    nombre: e.nombre.trim(), nombreCorto: (e.nombreCorto || e.nombre).trim().toUpperCase(), zona: e.zona,
    vidaKm: e.vidaKm, vidaViajes: e.vidaViajes, vidaDias: e.vidaDias,
  };
  if (e.id !== undefined) {
    const [f] = await ctx.db.update(tipoParte).set(valores).where(eq(tipoParte.id, e.id)).returning({ id: tipoParte.id });
    if (!f) throw new ErrorNegocio("El tipo de parte no existe");
    await registrarAuditoria(ctx.db, { usuarioId, accion: "tipo_parte_editado", entidad: "tipo_parte", entidadId: f.id, detalle: valores });
    return f.id;
  }
  const codigo = e.codigo ?? valores.nombre.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const [dup] = await ctx.db.select({ id: tipoParte.id }).from(tipoParte).where(eq(tipoParte.codigo, codigo));
  if (dup) throw new ErrorNegocio("Ya existe una parte con ese nombre");
  const [f] = await ctx.db.insert(tipoParte).values({ ...valores, codigo }).returning({ id: tipoParte.id });
  await registrarAuditoria(ctx.db, { usuarioId, accion: "tipo_parte_creado", entidad: "tipo_parte", entidadId: f!.id, detalle: valores });
  return f!.id;
}
