import { and, costoFijo, cuotaPrestamo, eq, gasto, gte, isNull, lte, or, prestamo, vehiculo, type MedioPago, type Periodicidad } from "@sunatapp/db";
import { rangoMes } from "../dominio/fechas";
import { ErrorNegocio } from "../errores";
import { registrarAuditoria } from "../infra/auditoria";
import type { Contexto } from "../infra/contexto";
import { hoy } from "../flota/unidades";
import { categoriaValida } from "./categorias";

export interface CostoFijo {
  id: number; concepto: string; categoria: string; monto: number; periodicidad: Periodicidad; vehiculoId: number | null; unidad: string | null;
  medioPago: MedioPago; desde: string; hasta: string | null; activo: boolean;
}

/** Lo que carga un fijo en un mes: el mensual completo; el anual, 1/12 (diciembre lleva el redondeo). */
export function montoDelMes(monto: number, periodicidad: Periodicidad, periodo: string): number {
  if (periodicidad === "mensual") return monto;
  const base = Math.floor(monto / 12);
  return periodo.endsWith("-12") ? monto - base * 11 : base;
}

export async function crearCostoFijo(
  ctx: Contexto,
  e: {
    concepto: string; categoria: string; monto: number; periodicidad: Periodicidad; vehiculoId?: number | null; medioPago?: MedioPago;
    desde?: string; hasta?: string | null; usuarioId?: number;
  },
): Promise<number> {
  if (!e.concepto.trim()) throw new ErrorNegocio("Falta el concepto");
  if (!Number.isInteger(e.monto) || e.monto <= 0) throw new ErrorNegocio("El monto debe ser mayor que 0");
  const cat = await categoriaValida(ctx.db, e.categoria);
  if (cat.tipo !== "fijo") throw new ErrorNegocio(`«${cat.nombre}» no es una categoría fija`);
  const desde = e.desde ?? `${hoy(ctx).slice(0, 7)}-01`;
  if (e.hasta && e.hasta < desde) throw new ErrorNegocio("La fecha de fin no puede ser anterior al inicio");
  const [f] = await ctx.db.insert(costoFijo).values({
    concepto: e.concepto.trim(), categoria: e.categoria, monto: e.monto, periodicidad: e.periodicidad, vehiculoId: e.vehiculoId ?? null,
    medioPago: e.medioPago ?? "transferencia", desde, hasta: e.hasta ?? null, usuarioId: e.usuarioId ?? null,
  }).returning({ id: costoFijo.id });
  await registrarAuditoria(ctx.db, { usuarioId: e.usuarioId, accion: "costo_fijo_creado", entidad: "costo_fijo", entidadId: f!.id, detalle: e });
  return f!.id;
}

export async function editarCostoFijo(
  ctx: Contexto, id: number,
  cambios: Partial<{ concepto: string; monto: number; periodicidad: Periodicidad; vehiculoId: number | null; medioPago: MedioPago; hasta: string | null; activo: boolean }>,
  usuarioId?: number,
): Promise<void> {
  if (cambios.monto !== undefined && (!Number.isInteger(cambios.monto) || cambios.monto <= 0)) throw new ErrorNegocio("El monto debe ser mayor que 0");
  const [f] = await ctx.db.update(costoFijo).set(cambios).where(eq(costoFijo.id, id)).returning({ id: costoFijo.id });
  if (!f) throw new ErrorNegocio("El costo fijo no existe");
  await registrarAuditoria(ctx.db, { usuarioId, accion: "costo_fijo_editado", entidad: "costo_fijo", entidadId: id, detalle: cambios });
}

export async function listarCostosFijos(ctx: Contexto, soloActivos = true): Promise<CostoFijo[]> {
  const filas = await ctx.db.select({ f: costoFijo, codigo: vehiculo.codigo, placa: vehiculo.placa }).from(costoFijo)
    .leftJoin(vehiculo, eq(vehiculo.id, costoFijo.vehiculoId))
    .where(soloActivos ? eq(costoFijo.activo, true) : undefined).orderBy(costoFijo.categoria, costoFijo.id);
  return filas.map(({ f, codigo, placa }) => ({
    id: f.id, concepto: f.concepto, categoria: f.categoria, monto: f.monto, periodicidad: f.periodicidad, vehiculoId: f.vehiculoId,
    unidad: f.vehiculoId ? (codigo ?? placa) : null, medioPago: f.medioPago, desde: f.desde, hasta: f.hasta, activo: f.activo,
  }));
}

/** Crea los gastos fijos del mes (fijos vigentes y cuotas que vencen). Idempotente: devuelve cuántos creó. */
export async function generarFijosDelMes(ctx: Contexto, periodo: string): Promise<number> {
  const { desde, hasta } = rangoMes(`${periodo}-01`);
  let creados = 0;
  const fijos = await ctx.db.select().from(costoFijo)
    .where(and(eq(costoFijo.activo, true), lte(costoFijo.desde, hasta), or(isNull(costoFijo.hasta), gte(costoFijo.hasta, desde))));
  for (const f of fijos) {
    const r = await ctx.db.insert(gasto).values({
      categoria: f.categoria, monto: montoDelMes(f.monto, f.periodicidad, periodo), fecha: desde, vehiculoId: f.vehiculoId, nota: f.concepto,
      origen: "sistema", medioPago: f.medioPago, costoFijoId: f.id, periodo,
    }).onConflictDoNothing().returning({ id: gasto.id });
    creados += r.length;
  }
  const cuotas = await ctx.db.select({ c: cuotaPrestamo, entidad: prestamo.entidad, vehiculoId: prestamo.vehiculoId }).from(cuotaPrestamo)
    .innerJoin(prestamo, eq(prestamo.id, cuotaPrestamo.prestamoId))
    .where(and(gte(cuotaPrestamo.vencimiento, desde), lte(cuotaPrestamo.vencimiento, hasta)));
  for (const q of cuotas) {
    const r = await ctx.db.insert(gasto).values({
      categoria: "cuota_prestamo", monto: q.c.monto, fecha: q.c.vencimiento, vehiculoId: q.vehiculoId, nota: `${q.entidad} · cuota ${q.c.numero}`,
      origen: "sistema", medioPago: "transferencia", cuotaId: q.c.id, periodo,
    }).onConflictDoNothing().returning({ id: gasto.id });
    creados += r.length;
  }
  return creados;
}

/** Genera los fijos de cada mes del rango, sin pasar del mes actual. */
export async function asegurarFijos(ctx: Contexto, desde: string, hasta: string): Promise<void> {
  const tope = hoy(ctx).slice(0, 7);
  const fin = hasta.slice(0, 7) < tope ? hasta.slice(0, 7) : tope;
  let mes = desde.slice(0, 7);
  while (mes <= fin) {
    await generarFijosDelMes(ctx, mes);
    const [y, m] = mes.split("-").map(Number);
    mes = new Date(Date.UTC(y!, m!, 1)).toISOString().slice(0, 7);
  }
}
