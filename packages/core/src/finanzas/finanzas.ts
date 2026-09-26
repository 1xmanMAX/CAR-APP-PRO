import {
  and, categoriaGastoEnum, cobro, compraRepuesto, cuotaPrestamo, desc, eq, gasto, ingreso, isNull, prestamo, reinversion,
  reparacion, sql, vehiculo, viaje, type CategoriaGasto, type OrigenRegistro,
} from "@sunatapp/db";
import { sumarDias } from "../dominio/fechas";
import { ErrorNegocio } from "../errores";
import { registrarAuditoria } from "../infra/auditoria";
import type { Contexto } from "../infra/contexto";
import { hoy } from "../flota/unidades";
import { listarViajesFlota } from "../flota/viajes-flota";

export const CATEGORIAS_GASTO = categoriaGastoEnum.enumValues;
export const NOMBRE_CATEGORIA: Record<CategoriaGasto, string> = {
  combustible: "Combustible", peaje: "Peajes", viaticos: "Viáticos", hospedaje: "Hospedaje", estiba: "Estiba",
  balanza: "Balanza", cochera: "Cochera", reparacion: "Repuestos y reparación", otros: "Otros",
};

const SINONIMOS: Array<[RegExp, CategoriaGasto]> = [
  [/^(combustible|petroleo|petróleo|diesel|diésel|gasolina|grifo|gas)/i, "combustible"],
  [/^(peaje|peajes)/i, "peaje"],
  [/^(viatico|viático|viaticos|viáticos|comida|alimentos?|menu|menú)/i, "viaticos"],
  [/^(hospedaje|hotel|alojamiento)/i, "hospedaje"],
  [/^(estiba|descarga|carga)/i, "estiba"],
  [/^(balanza|pesaje)/i, "balanza"],
  [/^(cochera|parqueo|estacionamiento)/i, "cochera"],
  [/^(reparacion|reparación|repuesto|mecanico|mecánico|taller|llanta)/i, "reparacion"],
  [/^(otro|otros|varios)/i, "otros"],
];

export function categoriaDesdeTexto(texto: string): CategoriaGasto | null {
  const t = texto.trim();
  for (const [re, c] of SINONIMOS) if (re.test(t)) return c;
  return null;
}

export function rangoMes(fecha: string): { desde: string; hasta: string; mes: string } {
  const mes = fecha.slice(0, 7);
  const [y, m] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return { desde: `${mes}-01`, hasta: `${mes}-${String(ultimo).padStart(2, "0")}`, mes };
}

export function mesAnterior(mes: string, n = 1): string {
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 - n, 1));
  return d.toISOString().slice(0, 7);
}

// ── Gastos ───────────────────────────────────────────────────────────────────

export interface EntradaGasto {
  categoria: CategoriaGasto;
  monto: number;
  fecha?: string;
  vehiculoId?: number | null;
  viajeId?: number | null;
  nota?: string | null;
  proveedorNombre?: string | null;
  proveedorRuc?: string | null;
  comprobante?: string | null;
  rutaFoto?: string | null;
  /** Mensaje de Telegram del que salió (foto, texto o voz leído). */
  documentoId?: number | null;
  origen: OrigenRegistro;
  usuarioId?: number;
}

/**
 * Registra un gasto. Con unidad y sin viaje, se asocia al viaje en curso de esa unidad; con viaje
 * y sin unidad, toma la unidad del viaje.
 */
export async function registrarGasto(ctx: Contexto, e: EntradaGasto): Promise<{ id: number; viajeCodigo: string | null }> {
  if (!Number.isInteger(e.monto) || e.monto <= 0) throw new ErrorNegocio("El monto debe ser mayor que 0");
  if (e.monto > 5_000_000) throw new ErrorNegocio("El monto parece demasiado alto; revísalo");
  if (!CATEGORIAS_GASTO.includes(e.categoria)) throw new ErrorNegocio("Categoría de gasto no válida");
  let vehiculoId = e.vehiculoId ?? null;
  let viajeId = e.viajeId ?? null;
  let viajeCodigo: string | null = null;
  if (viajeId !== null) {
    const [v] = await ctx.db.select({ vehiculoId: viaje.vehiculoId, codigo: viaje.codigo }).from(viaje).where(eq(viaje.id, viajeId));
    if (!v) throw new ErrorNegocio("El viaje no existe");
    vehiculoId ??= v.vehiculoId;
    viajeCodigo = v.codigo;
  } else if (vehiculoId !== null) {
    const [v] = await ctx.db.select({ id: viaje.id, codigo: viaje.codigo }).from(viaje).where(and(eq(viaje.vehiculoId, vehiculoId), eq(viaje.estado, "en_curso")));
    if (v) {
      viajeId = v.id;
      viajeCodigo = v.codigo;
    }
  }
  const [g] = await ctx.db.insert(gasto).values({
    categoria: e.categoria, monto: e.monto, fecha: e.fecha ?? hoy(ctx), vehiculoId, viajeId, nota: e.nota ?? null,
    proveedorNombre: e.proveedorNombre ?? null, proveedorRuc: e.proveedorRuc ?? null, comprobante: e.comprobante ?? null, rutaFoto: e.rutaFoto ?? null,
    documentoId: e.documentoId ?? null, origen: e.origen, usuarioId: e.usuarioId ?? null,
  }).returning({ id: gasto.id });
  await registrarAuditoria(ctx.db, { usuarioId: e.usuarioId, accion: "gasto_registrado", entidad: "gasto", entidadId: g!.id, detalle: { ...e, vehiculoId, viajeId } });
  return { id: g!.id, viajeCodigo };
}

export async function borrarGasto(ctx: Contexto, id: number, usuarioId?: number): Promise<void> {
  const [r] = await ctx.db.select({ id: reparacion.id }).from(reparacion).where(eq(reparacion.gastoId, id));
  if (r) throw new ErrorNegocio("Este gasto viene de un cambio de parte; no se puede borrar suelto");
  const [f] = await ctx.db.delete(gasto).where(eq(gasto.id, id)).returning();
  if (!f) throw new ErrorNegocio("El gasto no existe");
  await registrarAuditoria(ctx.db, { usuarioId, accion: "gasto_borrado", entidad: "gasto", entidadId: id, detalle: f });
}

export async function obtenerGasto(ctx: Contexto, id: number) {
  const [f] = await ctx.db.select().from(gasto).where(eq(gasto.id, id));
  return f ?? null;
}

async function sumaGastos(ctx: Contexto, desde: string, hasta: string, vehiculoId?: number): Promise<number> {
  const filtros = [sql`${gasto.fecha} >= ${desde}`, sql`${gasto.fecha} <= ${hasta}`];
  if (vehiculoId !== undefined) filtros.push(eq(gasto.vehiculoId, vehiculoId));
  const [f] = await ctx.db.select({ t: sql<string>`coalesce(sum(${gasto.monto}), 0)` }).from(gasto).where(and(...filtros));
  return Number(f?.t ?? 0);
}

export async function gastosPorCategoria(ctx: Contexto, desde: string, hasta: string, vehiculoId?: number) {
  const filtros = [sql`${gasto.fecha} >= ${desde}`, sql`${gasto.fecha} <= ${hasta}`];
  if (vehiculoId !== undefined) filtros.push(eq(gasto.vehiculoId, vehiculoId));
  const filas = await ctx.db.select({ categoria: gasto.categoria, total: sql<string>`sum(${gasto.monto})` }).from(gasto)
    .where(and(...filtros)).groupBy(gasto.categoria);
  return filas.map((f) => ({ categoria: f.categoria, nombre: NOMBRE_CATEGORIA[f.categoria], monto: Number(f.total) }))
    .sort((a, b) => b.monto - a.monto);
}

// ── Ingresos y reinversiones ─────────────────────────────────────────────────

export async function registrarIngreso(
  ctx: Contexto,
  e: { concepto: string; monto: number; fecha?: string; vehiculoId?: number | null; origen: OrigenRegistro; usuarioId?: number },
): Promise<number> {
  if (!e.concepto.trim()) throw new ErrorNegocio("Falta el concepto");
  if (!Number.isInteger(e.monto) || e.monto <= 0) throw new ErrorNegocio("El monto debe ser mayor que 0");
  const [f] = await ctx.db.insert(ingreso).values({
    concepto: e.concepto.trim(), monto: e.monto, fecha: e.fecha ?? hoy(ctx), vehiculoId: e.vehiculoId ?? null, origen: e.origen, usuarioId: e.usuarioId ?? null,
  }).returning({ id: ingreso.id });
  await registrarAuditoria(ctx.db, { usuarioId: e.usuarioId, accion: "ingreso_registrado", entidad: "ingreso", entidadId: f!.id, detalle: e });
  return f!.id;
}

export async function registrarReinversion(
  ctx: Contexto,
  e: { concepto: string; monto: number; fecha?: string; vehiculoId?: number | null; origen: OrigenRegistro; usuarioId?: number },
): Promise<number> {
  if (!e.concepto.trim()) throw new ErrorNegocio("Falta el concepto");
  if (!Number.isInteger(e.monto) || e.monto <= 0) throw new ErrorNegocio("El monto debe ser mayor que 0");
  const [f] = await ctx.db.insert(reinversion).values({
    concepto: e.concepto.trim(), monto: e.monto, fecha: e.fecha ?? hoy(ctx), vehiculoId: e.vehiculoId ?? null, origen: e.origen, usuarioId: e.usuarioId ?? null,
  }).returning({ id: reinversion.id });
  await registrarAuditoria(ctx.db, { usuarioId: e.usuarioId, accion: "reinversion_registrada", entidad: "reinversion", entidadId: f!.id, detalle: e });
  return f!.id;
}

export async function listarReinversiones(ctx: Contexto, anio: string) {
  return ctx.db.select({ r: reinversion, codigo: vehiculo.codigo }).from(reinversion)
    .leftJoin(vehiculo, eq(vehiculo.id, reinversion.vehiculoId))
    .where(and(sql`${reinversion.fecha} >= ${`${anio}-01-01`}`, sql`${reinversion.fecha} <= ${`${anio}-12-31`}`)).orderBy(desc(reinversion.fecha));
}

async function sumaTabla(ctx: Contexto, tabla: typeof ingreso | typeof reinversion, desde: string, hasta: string, vehiculoId?: number): Promise<number> {
  const filtros = [sql`${tabla.fecha} >= ${desde}`, sql`${tabla.fecha} <= ${hasta}`];
  if (vehiculoId !== undefined) filtros.push(eq(tabla.vehiculoId, vehiculoId));
  const [f] = await ctx.db.select({ t: sql<string>`coalesce(sum(${tabla.monto}), 0)` }).from(tabla).where(and(...filtros));
  return Number(f?.t ?? 0);
}

// ── Préstamos ────────────────────────────────────────────────────────────────

function sumarMeses(fecha: string, n: number): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const base = new Date(Date.UTC(y!, m! - 1 + n, 1));
  const ultimo = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(d!, ultimo));
  return base.toISOString().slice(0, 10);
}

/** Cronograma francés (cuota fija) con la tasa efectiva anual convertida a mensual. */
export function cronogramaFrances(monto: number, teaPct: number, cuotas: number): Array<{ monto: number; capital: number }> {
  const i = Math.pow(1 + teaPct / 100, 1 / 12) - 1;
  const cuota = i === 0 ? monto / cuotas : (monto * i) / (1 - Math.pow(1 + i, -cuotas));
  const r: Array<{ monto: number; capital: number }> = [];
  let saldo = monto;
  for (let k = 1; k <= cuotas; k++) {
    const interes = Math.round(saldo * i);
    let capital = Math.round(cuota) - interes;
    if (k === cuotas) capital = saldo;
    saldo -= capital;
    r.push({ monto: capital + interes, capital });
  }
  return r;
}

export async function crearPrestamo(
  ctx: Contexto,
  e: { entidad: string; monto: number; tasaAnual: number; cuotas: number; fechaInicio?: string; vehiculoId?: number | null; usuarioId?: number },
): Promise<number> {
  if (!e.entidad.trim()) throw new ErrorNegocio("Falta la entidad del préstamo");
  if (!Number.isInteger(e.monto) || e.monto <= 0) throw new ErrorNegocio("El monto debe ser mayor que 0");
  if (!Number.isInteger(e.cuotas) || e.cuotas <= 0 || e.cuotas > 360) throw new ErrorNegocio("Número de cuotas no válido");
  if (e.tasaAnual < 0 || e.tasaAnual > 200) throw new ErrorNegocio("Tasa no válida");
  const inicio = e.fechaInicio ?? hoy(ctx);
  return ctx.db.transaction(async (tx) => {
    const [p] = await tx.insert(prestamo).values({
      entidad: e.entidad.trim(), montoOriginal: e.monto, tasaAnual: String(e.tasaAnual), cuotas: e.cuotas, fechaInicio: inicio, vehiculoId: e.vehiculoId ?? null,
    }).returning({ id: prestamo.id });
    const plan = cronogramaFrances(e.monto, e.tasaAnual, e.cuotas);
    await tx.insert(cuotaPrestamo).values(plan.map((c, k) => ({ prestamoId: p!.id, numero: k + 1, vencimiento: sumarMeses(inicio, k + 1), monto: c.monto, capital: c.capital })));
    await registrarAuditoria(tx, { usuarioId: e.usuarioId, accion: "prestamo_creado", entidad: "prestamo", entidadId: p!.id, detalle: e });
    return p!.id;
  });
}

/** Paga la próxima cuota pendiente del préstamo. */
export async function pagarCuota(ctx: Contexto, prestamoId: number, fecha?: string, usuarioId?: number): Promise<{ numero: number; monto: number }> {
  return ctx.db.transaction(async (tx) => {
    const [c] = await tx.select().from(cuotaPrestamo).where(and(eq(cuotaPrestamo.prestamoId, prestamoId), isNull(cuotaPrestamo.pagadaEn)))
      .orderBy(cuotaPrestamo.numero).limit(1).for("update");
    if (!c) throw new ErrorNegocio("El préstamo no tiene cuotas pendientes");
    await tx.update(cuotaPrestamo).set({ pagadaEn: fecha ?? hoy(ctx) }).where(eq(cuotaPrestamo.id, c.id));
    const [pend] = await tx.select({ n: sql<number>`count(*)` }).from(cuotaPrestamo).where(and(eq(cuotaPrestamo.prestamoId, prestamoId), isNull(cuotaPrestamo.pagadaEn)));
    if (Number(pend?.n ?? 0) === 0) await tx.update(prestamo).set({ activo: false }).where(eq(prestamo.id, prestamoId));
    await registrarAuditoria(tx, { usuarioId, accion: "cuota_pagada", entidad: "prestamo", entidadId: prestamoId, detalle: { numero: c.numero, monto: c.monto } });
    return { numero: c.numero, monto: c.monto };
  });
}

export interface ResumenPrestamo {
  id: number;
  entidad: string;
  tasaAnual: number;
  montoOriginal: number;
  saldo: number;
  pendiente: number;
  pagadas: number;
  total: number;
  proxima: { vencimiento: string; monto: number } | null;
  cuotas: Array<{ numero: number; vencimiento: string; monto: number; pagada: boolean }>;
}

export async function listarPrestamos(ctx: Contexto, soloActivos = true): Promise<ResumenPrestamo[]> {
  const ps = await ctx.db.select().from(prestamo).where(soloActivos ? eq(prestamo.activo, true) : undefined).orderBy(prestamo.id);
  const r: ResumenPrestamo[] = [];
  for (const p of ps) {
    const cs = await ctx.db.select().from(cuotaPrestamo).where(eq(cuotaPrestamo.prestamoId, p.id)).orderBy(cuotaPrestamo.numero);
    const pend = cs.filter((c) => !c.pagadaEn);
    r.push({
      id: p.id, entidad: p.entidad, tasaAnual: Number(p.tasaAnual), montoOriginal: p.montoOriginal,
      saldo: pend.reduce((s, c) => s + c.capital, 0), pendiente: pend.reduce((s, c) => s + c.monto, 0),
      pagadas: cs.length - pend.length, total: cs.length,
      proxima: pend[0] ? { vencimiento: pend[0].vencimiento, monto: pend[0].monto } : null,
      cuotas: cs.map((c) => ({ numero: c.numero, vencimiento: c.vencimiento, monto: c.monto, pagada: c.pagadaEn !== null })),
    });
  }
  return r;
}

/** Cuotas que vencen en los próximos `dias` y aún no se avisaron; las marca como avisadas. */
export async function tomarCuotasPorVencer(ctx: Contexto, dias = 3) {
  const h = hoy(ctx);
  const filas = await ctx.db.select({ c: cuotaPrestamo, entidad: prestamo.entidad }).from(cuotaPrestamo)
    .innerJoin(prestamo, eq(prestamo.id, cuotaPrestamo.prestamoId))
    .where(and(isNull(cuotaPrestamo.pagadaEn), eq(cuotaPrestamo.avisada, false), sql`${cuotaPrestamo.vencimiento} <= ${sumarDias(h, dias)}`));
  for (const f of filas) await ctx.db.update(cuotaPrestamo).set({ avisada: true }).where(eq(cuotaPrestamo.id, f.c.id));
  return filas.map((f) => ({ entidad: f.entidad, numero: f.c.numero, vencimiento: f.c.vencimiento, monto: f.c.monto }));
}

// ── Resúmenes ────────────────────────────────────────────────────────────────

export interface ResumenFinanciero {
  ingresosFletes: number;
  otrosIngresos: number;
  ingresos: number;
  gastos: number;
  ganancia: number;
  margenPct: number | null;
  viajes: number;
  km: number;
}

export async function resumenFinanciero(ctx: Contexto, desde: string, hasta: string, vehiculoId?: number): Promise<ResumenFinanciero> {
  const viajes = await listarViajesFlota(ctx, { desde, hasta, vehiculoId, limite: 10000 });
  const ingresosFletes = viajes.reduce((s, v) => s + v.flete, 0);
  const otrosIngresos = await sumaTabla(ctx, ingreso, desde, hasta, vehiculoId);
  const ingresos = ingresosFletes + otrosIngresos;
  const gastos = await sumaGastos(ctx, desde, hasta, vehiculoId);
  const ganancia = ingresos - gastos;
  return {
    ingresosFletes, otrosIngresos, ingresos, gastos, ganancia,
    margenPct: ingresos > 0 ? Math.round((ganancia / ingresos) * 100) : null,
    viajes: viajes.length, km: viajes.reduce((s, v) => s + (v.km ?? 0), 0),
  };
}

export async function deudaPrestamos(ctx: Contexto): Promise<number> {
  const [f] = await ctx.db.select({ t: sql<string>`coalesce(sum(${cuotaPrestamo.capital}), 0)` }).from(cuotaPrestamo).where(isNull(cuotaPrestamo.pagadaEn));
  return Number(f?.t ?? 0);
}

export async function reinvertidoEnAnio(ctx: Contexto, anio: string): Promise<number> {
  return sumaTabla(ctx, reinversion, `${anio}-01-01`, `${anio}-12-31`);
}

export type TipoMovimiento = "INGRESO" | "GASTO" | "REINVERSIÓN" | "CUOTA" | "COMPRA";

export interface Movimiento {
  fecha: string;
  tipo: TipoMovimiento;
  detalle: string;
  unidad: string;
  /** Positivo entra, negativo sale. */
  monto: number;
  origen: OrigenRegistro;
  ref: { entidad: string; id: number };
}

export async function listarMovimientos(ctx: Contexto, desde: string, hasta: string, limite = 100): Promise<Movimiento[]> {
  const r: Movimiento[] = [];
  const unidades = new Map((await ctx.db.select({ id: vehiculo.id, codigo: vehiculo.codigo, placa: vehiculo.placa }).from(vehiculo)).map((v) => [v.id, v.codigo ?? v.placa]));
  const u = (id: number | null) => (id === null ? "—" : (unidades.get(id) ?? "—"));
  for (const v of await listarViajesFlota(ctx, { desde, hasta, limite: 1000 })) {
    if (v.flete > 0) r.push({ fecha: v.fecha, tipo: "INGRESO", detalle: `Flete ${v.codigo} · ${v.ruta}`, unidad: v.unidad, monto: v.flete, origen: v.origen, ref: { entidad: "viaje", id: v.id } });
  }
  const rango = (col: unknown) => and(sql`${col} >= ${desde}`, sql`${col} <= ${hasta}`);
  for (const i of await ctx.db.select().from(ingreso).where(rango(ingreso.fecha))) {
    r.push({ fecha: i.fecha, tipo: "INGRESO", detalle: i.concepto, unidad: u(i.vehiculoId), monto: i.monto, origen: i.origen, ref: { entidad: "ingreso", id: i.id } });
  }
  for (const g of await ctx.db.select().from(gasto).where(rango(gasto.fecha))) {
    r.push({ fecha: g.fecha, tipo: "GASTO", detalle: `${NOMBRE_CATEGORIA[g.categoria]}${g.nota ? ` · ${g.nota}` : ""}`, unidad: u(g.vehiculoId), monto: -g.monto, origen: g.origen, ref: { entidad: "gasto", id: g.id } });
  }
  for (const x of await ctx.db.select().from(reinversion).where(rango(reinversion.fecha))) {
    r.push({ fecha: x.fecha, tipo: "REINVERSIÓN", detalle: x.concepto, unidad: u(x.vehiculoId), monto: -x.monto, origen: x.origen, ref: { entidad: "reinversion", id: x.id } });
  }
  const cuotas = await ctx.db.select({ c: cuotaPrestamo, entidad: prestamo.entidad, vehiculoId: prestamo.vehiculoId }).from(cuotaPrestamo)
    .innerJoin(prestamo, eq(prestamo.id, cuotaPrestamo.prestamoId))
    .where(and(sql`${cuotaPrestamo.pagadaEn} >= ${desde}`, sql`${cuotaPrestamo.pagadaEn} <= ${hasta}`));
  for (const c of cuotas) {
    r.push({ fecha: c.c.pagadaEn!, tipo: "CUOTA", detalle: `${c.entidad} · cuota ${c.c.numero}`, unidad: u(c.vehiculoId), monto: -c.c.monto, origen: "web", ref: { entidad: "prestamo", id: c.c.prestamoId } });
  }
  return r.sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, limite);
}

/**
 * Flujo de caja semanal (lunes a domingo) de las últimas `semanas`. Entradas: cobros de facturas,
 * otros ingresos y fletes de viajes sin factura. Salidas: gastos (sin el costo de repuestos que
 * ya salieron de caja al comprarlos), compras de repuestos, reinversiones y cuotas pagadas.
 */
export async function flujoCaja(ctx: Contexto, semanas = 12): Promise<Array<{ desde: string; hasta: string; entra: number; sale: number }>> {
  const h = hoy(ctx);
  const dow = (new Date(`${h}T00:00:00Z`).getUTCDay() + 6) % 7;
  const lunesActual = sumarDias(h, -dow);
  const inicio = sumarDias(lunesActual, -7 * (semanas - 1));
  const r = Array.from({ length: semanas }, (_, k) => ({ desde: sumarDias(inicio, 7 * k), hasta: sumarDias(inicio, 7 * k + 6), entra: 0, sale: 0 }));
  const idx = (fecha: string) => Math.floor((Date.parse(`${fecha}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / (7 * 86_400_000));
  const add = (fecha: string, campo: "entra" | "sale", monto: number) => {
    const k = idx(fecha);
    if (k >= 0 && k < semanas) r[k]![campo] += monto;
  };
  const fin = sumarDias(inicio, 7 * semanas - 1);
  const rango = (col: unknown) => and(sql`${col} >= ${inicio}`, sql`${col} <= ${fin}`);
  for (const c of await ctx.db.select().from(cobro).where(rango(cobro.fecha))) add(c.fecha, "entra", c.monto);
  for (const i of await ctx.db.select().from(ingreso).where(rango(ingreso.fecha))) add(i.fecha, "entra", i.monto);
  for (const v of await listarViajesFlota(ctx, { desde: inicio, hasta: fin, limite: 5000 })) {
    if (v.factura === "SIN FACTURA" && v.flete > 0) add(v.fecha, "entra", v.flete);
  }
  for (const g of await ctx.db.select().from(gasto).where(rango(gasto.fecha))) add(g.fecha, "sale", g.monto);
  for (const rp of await ctx.db.select().from(reparacion).where(rango(reparacion.fecha))) add(rp.fecha, "sale", -rp.costoRepuestos);
  for (const c of await ctx.db.select().from(compraRepuesto).where(rango(compraRepuesto.fecha))) add(c.fecha, "sale", c.cantidad * c.costoUnitario);
  for (const x of await ctx.db.select().from(reinversion).where(rango(reinversion.fecha))) add(x.fecha, "sale", x.monto);
  const cuotas = await ctx.db.select().from(cuotaPrestamo).where(and(sql`${cuotaPrestamo.pagadaEn} >= ${inicio}`, sql`${cuotaPrestamo.pagadaEn} <= ${fin}`));
  for (const c of cuotas) add(c.pagadaEn!, "sale", c.monto);
  return r;
}
