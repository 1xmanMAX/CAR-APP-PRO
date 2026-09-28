import { and, categoriaGasto, eq, gasto, guiaTransportista, inArray, ingreso, sql, vehiculo, viaje } from "@sunatapp/db";
import { rangoMes } from "../dominio/fechas";
import type { Contexto } from "../infra/contexto";
import { asegurarFijos } from "../finanzas/costos-fijos";
import { hoy } from "../flota/unidades";
import { facturasPorViaje } from "../flota/viajes-flota";

export interface FilaRentViaje {
  viajeId: number; codigo: string; guia: string | null; vehiculoId: number; unidad: string; ruta: string; mes: string;
  flete: number; variables: number; contribucion: number; fijoAsignado: number; ganancia: number; margenPct: number | null; provisional: boolean;
}
export interface FilaRentMes {
  mes: string; vehiculoId: number | null; unidad: string; viajes: number; ingresos: number; variables: number; contribucion: number;
  fijos: number; ganancia: number; margenPct: number | null; provisional: boolean; fijosDetalle: Array<{ categoria: string; nombre: string; monto: number }>;
}

const pct = (g: number, base: number) => (base > 0 ? Math.round((g / base) * 100) : null);

function mesesDe(desde: string, hasta: string): string[] {
  const r: string[] = [];
  let m = desde.slice(0, 7);
  while (m <= hasta.slice(0, 7)) {
    r.push(m);
    const [y, mm] = m.split("-").map(Number);
    m = new Date(Date.UTC(y!, mm!, 1)).toISOString().slice(0, 7);
  }
  return r;
}

/** Viajes cerrados cuyo mes de cierre cae en el rango, con su flete y sus gastos variables. */
async function viajesCerrados(ctx: Contexto, desde: string, hasta: string) {
  const filas = await ctx.db.select({ v: viaje, codigo: vehiculo.codigo, placa: vehiculo.placa }).from(viaje)
    .innerJoin(vehiculo, eq(vehiculo.id, viaje.vehiculoId))
    .where(and(eq(viaje.estado, "cerrado"), sql`${viaje.fechaRegreso} >= ${desde}`, sql`${viaje.fechaRegreso} <= ${hasta}`));
  const ids = filas.map((f) => f.v.id);
  const variables = new Map<number, number>();
  const guias = new Map<number, string>();
  if (ids.length) {
    const vs = await ctx.db.select({ id: gasto.viajeId, t: sql<string>`sum(${gasto.monto})` }).from(gasto)
      .innerJoin(categoriaGasto, eq(categoriaGasto.clave, gasto.categoria))
      .where(and(inArray(gasto.viajeId, ids), eq(categoriaGasto.tipo, "variable"))).groupBy(gasto.viajeId);
    for (const x of vs) variables.set(x.id!, Number(x.t));
    const gs = await ctx.db.select({ id: guiaTransportista.viajeId, serie: guiaTransportista.serie, num: guiaTransportista.numero, tramo: guiaTransportista.tramo })
      .from(guiaTransportista).where(inArray(guiaTransportista.viajeId, ids));
    for (const g of gs) if (g.tramo === "ida" || !guias.has(g.id!)) guias.set(g.id!, `${g.serie}-${g.num ?? "?"}`);
  }
  const facturas = await facturasPorViaje(ctx, ids);
  return filas.map(({ v, codigo, placa }) => ({
    id: v.id, codigo: v.codigo, vehiculoId: v.vehiculoId, unidad: codigo ?? placa, mes: v.fechaRegreso!.slice(0, 7),
    ruta: v.origenLugar && v.destinoLugar ? `${v.origenLugar} → ${v.destinoLugar}` : (v.nota ?? "—"), guia: guias.get(v.id) ?? null,
    flete: v.flete ?? (facturas.get(v.id) ?? []).reduce((s, x) => s + x.subtotal, 0), variables: variables.get(v.id) ?? 0,
  }));
}

/** Fijos por mes y unidad (null = general), con su detalle por categoría. */
async function fijosPorMes(ctx: Contexto, desde: string, hasta: string) {
  const mesExpr = sql<string>`coalesce(${gasto.periodo}, to_char(${gasto.fecha}, 'YYYY-MM'))`;
  const filas = await ctx.db.select({
    mes: mesExpr, vehiculoId: gasto.vehiculoId, categoria: gasto.categoria, nombre: categoriaGasto.nombre, t: sql<string>`sum(${gasto.monto})`,
  }).from(gasto).innerJoin(categoriaGasto, eq(categoriaGasto.clave, gasto.categoria))
    .where(and(eq(categoriaGasto.tipo, "fijo"), sql`${mesExpr} >= ${desde.slice(0, 7)}`, sql`${mesExpr} <= ${hasta.slice(0, 7)}`))
    .groupBy(mesExpr, gasto.vehiculoId, gasto.categoria, categoriaGasto.nombre);
  return filas.map((f) => ({ mes: f.mes, vehiculoId: f.vehiculoId, categoria: f.categoria, nombre: f.nombre, monto: Number(f.t) }));
}

/**
 * Ganancia de cada viaje cerrado: flete − variables = contribución; menos el fijo asignado (fijos de
 * su unidad en el mes ÷ viajes de esa unidad en el mes + fijos generales ÷ todos los viajes del mes).
 */
export async function rentabilidadPorViaje(ctx: Contexto, o: { desde: string; hasta: string; vehiculoId?: number }): Promise<FilaRentViaje[]> {
  const desde = rangoMes(o.desde).desde, hasta = rangoMes(o.hasta).hasta;
  await asegurarFijos(ctx, desde, hasta);
  const todos = await viajesCerrados(ctx, desde, hasta);
  const fijos = await fijosPorMes(ctx, desde, hasta);
  const actual = hoy(ctx).slice(0, 7);
  const n = (mes: string, vehiculoId?: number) => todos.filter((v) => v.mes === mes && (vehiculoId === undefined || v.vehiculoId === vehiculoId)).length;
  const suma = (mes: string, vehiculoId: number | null) => fijos.filter((f) => f.mes === mes && f.vehiculoId === vehiculoId).reduce((s, f) => s + f.monto, 0);
  return todos.filter((v) => o.vehiculoId === undefined || v.vehiculoId === o.vehiculoId).map((v) => {
    const fijoAsignado = Math.round(suma(v.mes, v.vehiculoId) / n(v.mes, v.vehiculoId)) + Math.round(suma(v.mes, null) / n(v.mes));
    const contribucion = v.flete - v.variables;
    const ganancia = contribucion - fijoAsignado;
    return {
      viajeId: v.id, codigo: v.codigo, guia: v.guia, vehiculoId: v.vehiculoId, unidad: v.unidad, ruta: v.ruta, mes: v.mes,
      flete: v.flete, variables: v.variables, contribucion, fijoAsignado, ganancia, margenPct: pct(ganancia, v.flete), provisional: v.mes === actual,
    };
  }).sort((a, b) => b.mes.localeCompare(a.mes) || b.viajeId - a.viajeId);
}

export async function rentabilidadDeViaje(ctx: Contexto, viajeId: number): Promise<FilaRentViaje | null> {
  const [v] = await ctx.db.select({ f: viaje.fechaRegreso, e: viaje.estado }).from(viaje).where(eq(viaje.id, viajeId));
  if (!v || v.e !== "cerrado" || !v.f) return null;
  return (await rentabilidadPorViaje(ctx, { desde: v.f, hasta: v.f })).find((x) => x.viajeId === viajeId) ?? null;
}

/**
 * Ganancia neta por mes (de toda la empresa, de una unidad o de cada unidad): fletes y otros ingresos,
 * menos variables (con o sin viaje) y fijos. En la vista por unidad, los fijos generales se reparten
 * según los viajes de cada unidad (sin viajes en el mes, en partes iguales).
 */
export async function rentabilidadPorMes(
  ctx: Contexto, o: { desde: string; hasta: string; vehiculoId?: number; porUnidad?: boolean },
): Promise<FilaRentMes[]> {
  const desde = rangoMes(o.desde).desde, hasta = rangoMes(o.hasta).hasta;
  await asegurarFijos(ctx, desde, hasta);
  const viajes = await viajesCerrados(ctx, desde, hasta);
  const fijos = await fijosPorMes(ctx, desde, hasta);
  const actual = hoy(ctx).slice(0, 7);
  const unidades = await ctx.db.select({ id: vehiculo.id, codigo: vehiculo.codigo, placa: vehiculo.placa }).from(vehiculo).where(eq(vehiculo.tipo, "tracto"));
  const mesGasto = sql<string>`to_char(${gasto.fecha}, 'YYYY-MM')`;
  const variablesSinViaje = await ctx.db.select({ mes: mesGasto, vehiculoId: gasto.vehiculoId, t: sql<string>`sum(${gasto.monto})` })
    .from(gasto).innerJoin(categoriaGasto, eq(categoriaGasto.clave, gasto.categoria))
    .where(and(eq(categoriaGasto.tipo, "variable"), sql`${gasto.viajeId} is null`, sql`${gasto.fecha} >= ${desde}`, sql`${gasto.fecha} <= ${hasta}`))
    .groupBy(mesGasto, gasto.vehiculoId);
  const mesIngreso = sql<string>`to_char(${ingreso.fecha}, 'YYYY-MM')`;
  const otrosIngresos = await ctx.db.select({ mes: mesIngreso, vehiculoId: ingreso.vehiculoId, t: sql<string>`sum(${ingreso.monto})` })
    .from(ingreso).where(and(sql`${ingreso.fecha} >= ${desde}`, sql`${ingreso.fecha} <= ${hasta}`)).groupBy(mesIngreso, ingreso.vehiculoId);

  const grupos: Array<{ vehiculoId: number | null; unidad: string }> = o.porUnidad
    ? unidades.filter((u) => o.vehiculoId === undefined || u.id === o.vehiculoId).map((u) => ({ vehiculoId: u.id, unidad: u.codigo ?? u.placa }))
    : [{ vehiculoId: o.vehiculoId ?? null, unidad: o.vehiculoId ? (unidades.find((u) => u.id === o.vehiculoId)?.codigo ?? "—") : "Todas" }];
  const r: FilaRentMes[] = [];
  for (const mes of mesesDe(desde, hasta)) {
    const delMes = viajes.filter((v) => v.mes === mes);
    for (const gr of grupos) {
      const es = (id: number | null) => gr.vehiculoId === null || id === gr.vehiculoId;
      const vs = delMes.filter((v) => es(v.vehiculoId));
      const propios = fijos.filter((f) => f.mes === mes && f.vehiculoId !== null && es(f.vehiculoId));
      const generales = fijos.filter((f) => f.mes === mes && f.vehiculoId === null);
      const parte = gr.vehiculoId === null ? 1 : delMes.length ? vs.length / delMes.length : 1 / Math.max(1, unidades.length);
      const detalle = new Map<string, { categoria: string; nombre: string; monto: number }>();
      for (const f of [...propios, ...generales.map((g) => ({ ...g, monto: Math.round(g.monto * parte) }))]) {
        const d = detalle.get(f.categoria) ?? { categoria: f.categoria, nombre: f.nombre, monto: 0 };
        d.monto += f.monto;
        detalle.set(f.categoria, d);
      }
      const fijosMes = [...detalle.values()].reduce((s, d) => s + d.monto, 0);
      const ingresos = vs.reduce((s, v) => s + v.flete, 0)
        + otrosIngresos.filter((x) => x.mes === mes && es(x.vehiculoId)).reduce((s, x) => s + Number(x.t), 0);
      const variables = vs.reduce((s, v) => s + v.variables, 0)
        + variablesSinViaje.filter((x) => x.mes === mes && es(x.vehiculoId)).reduce((s, x) => s + Number(x.t), 0);
      const contribucion = ingresos - variables;
      const ganancia = contribucion - fijosMes;
      r.push({
        mes, vehiculoId: gr.vehiculoId, unidad: gr.unidad, viajes: vs.length, ingresos, variables, contribucion, fijos: fijosMes, ganancia,
        margenPct: pct(ganancia, ingresos), provisional: mes === actual, fijosDetalle: [...detalle.values()].filter((d) => d.monto > 0).sort((a, b) => b.monto - a.monto),
      });
    }
  }
  return r;
}
