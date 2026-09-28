import { and, desc, eq, gasto, sql, viaje } from "@sunatapp/db";
import { gastosPorCategoria, mesAnterior, rangoMes, resumenFinanciero } from "../finanzas/finanzas";
import { listarViajesFlota } from "../flota/viajes-flota";
import type { Contexto } from "../infra/contexto";
import { rutaDeViaje } from "./rutas";

/**
 * **Estadísticas** de un rango de fechas: mes a mes, por categoría, por ruta (ganancia y desvío
 * contra la plantilla), combustible por grifo y gasto por proveedor. Todo en céntimos.
 */
export interface Estadisticas {
  desde: string;
  hasta: string;
  meses: Array<{ mes: string; ingresos: number; gastos: number; ganancia: number; viajes: number }>;
  porCategoria: Array<{ categoria: string; nombre: string; monto: number }>;
  porRuta: Array<{ ruta: string; viajes: number; flete: number; gasto: number; ganancia: number; presupuesto: number | null; desvioPct: number | null }>;
  combustiblePorGrifo: Array<{ grifo: string; veces: number; monto: number }>;
  porProveedor: Array<{ proveedor: string; veces: number; monto: number }>;
  combustiblePorViaje: Array<{ codigo: string; ruta: string; km: number | null; monto: number; solesPorKm: number | null }>;
  totales: { ingresos: number; gastos: number; ganancia: number; viajes: number };
}

/** Meses (AAAA-MM) entre dos fechas, ambas incluidas. */
export function mesesEntre(desde: string, hasta: string): string[] {
  const r: string[] = [];
  for (let m = hasta.slice(0, 7); m >= desde.slice(0, 7) && r.length < 60; m = mesAnterior(m)) r.unshift(m);
  return r;
}

export async function estadisticas(ctx: Contexto, desde: string, hasta: string): Promise<Estadisticas> {
  const meses = [];
  for (const mes of mesesEntre(desde, hasta)) {
    const r = rangoMes(`${mes}-01`);
    const f = await resumenFinanciero(ctx, r.desde < desde ? desde : r.desde, r.hasta > hasta ? hasta : r.hasta);
    meses.push({ mes, ingresos: f.ingresos, gastos: f.gastos, ganancia: f.ganancia, viajes: f.viajes });
  }
  const enRango = and(sql`${gasto.fecha} >= ${desde}`, sql`${gasto.fecha} <= ${hasta}`);

  // Por ruta: viajes cerrados que salieron en el rango, agrupados por «origen → destino».
  const viajes = (await listarViajesFlota(ctx, { desde, hasta, limite: 10000 })).filter((v) => v.estado === "cerrado");
  const grupos = new Map<string, typeof viajes>();
  for (const v of viajes) grupos.set(v.ruta, [...(grupos.get(v.ruta) ?? []), v]);
  const porRuta = [];
  for (const [ruta, vs] of grupos) {
    const flete = Math.round(vs.reduce((s, v) => s + v.flete, 0) / vs.length);
    const gastoProm = Math.round(vs.reduce((s, v) => s + v.costo, 0) / vs.length);
    const [origen, destino] = ruta.split(" → ");
    const r = origen && destino ? await rutaDeViaje(ctx.db, origen, destino) : null;
    const presupuesto = r?.plantilla.length ? r.plantilla.reduce((s, l) => s + l.monto, 0) : null;
    porRuta.push({
      ruta, viajes: vs.length, flete, gasto: gastoProm, ganancia: flete - gastoProm, presupuesto,
      desvioPct: presupuesto ? Math.round(((gastoProm - presupuesto) / presupuesto) * 100) : null,
    });
  }
  porRuta.sort((a, b) => b.viajes - a.viajes || b.ganancia - a.ganancia);

  const nombreProv = sql<string>`coalesce(nullif(trim(${gasto.proveedorNombre}), ''), 'Sin nombre')`;
  const grifos = await ctx.db.select({ grifo: nombreProv, veces: sql<number>`count(*)`, monto: sql<number>`sum(${gasto.monto})` }).from(gasto)
    .where(and(enRango, eq(gasto.categoria, "combustible"))).groupBy(nombreProv).orderBy(desc(sql`sum(${gasto.monto})`)).limit(15);
  const proveedores = await ctx.db.select({ proveedor: nombreProv, veces: sql<number>`count(*)`, monto: sql<number>`sum(${gasto.monto})` }).from(gasto)
    .where(and(enRango, sql`${gasto.proveedorNombre} is not null`)).groupBy(nombreProv).orderBy(desc(sql`sum(${gasto.monto})`)).limit(15);
  const combustible = await ctx.db.select({ codigo: viaje.codigo, origen: viaje.origenLugar, destino: viaje.destinoLugar, km: viaje.km, monto: sql<number>`sum(${gasto.monto})` })
    .from(gasto).innerJoin(viaje, eq(viaje.id, gasto.viajeId))
    .where(and(enRango, eq(gasto.categoria, "combustible"))).groupBy(viaje.id).orderBy(desc(viaje.fechaSalida)).limit(30);

  const totales = meses.reduce((t, m) => ({ ingresos: t.ingresos + m.ingresos, gastos: t.gastos + m.gastos, ganancia: t.ganancia + m.ganancia, viajes: t.viajes + m.viajes }),
    { ingresos: 0, gastos: 0, ganancia: 0, viajes: 0 });
  return {
    desde, hasta, meses,
    porCategoria: (await gastosPorCategoria(ctx, desde, hasta)).map((x) => ({ categoria: x.categoria, nombre: x.nombre, monto: x.monto })),
    porRuta,
    combustiblePorGrifo: grifos.map((g) => ({ grifo: g.grifo, veces: Number(g.veces), monto: Number(g.monto) })),
    porProveedor: proveedores.map((p) => ({ proveedor: p.proveedor, veces: Number(p.veces), monto: Number(p.monto) })),
    combustiblePorViaje: combustible.map((c) => ({
      codigo: c.codigo, ruta: c.origen && c.destino ? `${c.origen} → ${c.destino}` : "—", km: c.km, monto: Number(c.monto),
      solesPorKm: c.km ? Number(c.monto) / 100 / c.km : null,
    })),
    totales,
  };
}
