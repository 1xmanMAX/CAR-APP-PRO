import { and, desc, entrega, eq, factura, facturaGuia, gasto, guiaTransportista, ne, sql, vehiculo, viaje, viajePresupuesto, type CategoriaGasto, type MedioEntrega } from "@sunatapp/db";
import { ErrorNegocio } from "../errores";
import { listarCategorias, nombreCategoria } from "../finanzas/categorias";
import { listarViajesFlota, viajeEnCursoDeUnidad } from "../flota/viajes-flota";
import type { Contexto } from "../infra/contexto";

/**
 * **Liquidación del viaje**: el dinero entregado al chofer (adelanto, yapes) contra lo que gastó,
 * el semáforo de cada categoría contra el presupuesto y la ganancia real (flete − gastos).
 *
 * El presupuesto es el del viaje si se cargó; si no, el promedio de los últimos viajes de la misma
 * ruta (referencial), para saber igual si este viaje se está yendo de las manos.
 */
export type Semaforo = "ok" | "alerta" | "excedido";

/** Verde hasta el 90 %, ámbar hasta el 100 %, rojo si se pasó. Sin presupuesto, cualquier gasto es rojo. */
export function semaforo(real: number, presupuesto: number): Semaforo {
  if (presupuesto <= 0) return real > 0 ? "excedido" : "ok";
  const r = real / presupuesto;
  return r < 0.9 ? "ok" : r <= 1 ? "alerta" : "excedido";
}

export interface LineaLiquidacion {
  categoria: CategoriaGasto;
  nombre: string;
  presupuesto: number;
  real: number;
  pct: number | null;
  semaforo: Semaforo;
}

export interface LiquidacionViaje {
  viaje: { id: number; codigo: string; vehiculoId: number; unidad: string; ruta: string; fechaSalida: string; fechaRegreso: string | null; estado: string };
  entregas: Array<{ id: number; fecha: string; monto: number; medio: MedioEntrega; nota: string | null }>;
  gastos: Array<{ id: number; fecha: string; categoria: CategoriaGasto; monto: number; detalle: string | null; conFoto: boolean }>;
  entregado: number;
  gastado: number;
  /** entregado − gastado: > 0 el chofer tiene que devolver; < 0 la empresa le debe. */
  saldo: number;
  lineas: LineaLiquidacion[];
  presupuestoTotal: number;
  semaforoTotal: Semaforo | "sin_presupuesto";
  /** De dónde sale el presupuesto: el del viaje, el promedio de N viajes de la ruta, o ninguno. */
  presupuestoOrigen: { tipo: "viaje" } | { tipo: "promedio"; viajes: number } | { tipo: "ninguno" };
  /** Guías del viaje (ida y retorno) con el flete facturado (sin IGV) si ya se aceptó. */
  guias: Array<{ id: number; serieNumero: string; tramo: string | null; estado: string; flete: number | null }>;
  flete: number;
  ganancia: number | null;
  margenPct: number | null;
}

const VIAJES_PROMEDIO = 5;

/** Promedio por categoría de los últimos 5 viajes cerrados con el mismo origen y destino. */
export async function promedioDeRuta(
  ctx: Contexto, origen: string | null, destino: string | null, excluirViajeId = 0,
): Promise<{ montos: Map<CategoriaGasto, number>; viajes: number }> {
  if (!origen || !destino) return { montos: new Map(), viajes: 0 };
  const previos = await ctx.db.select({ id: viaje.id }).from(viaje)
    .where(and(
      eq(viaje.estado, "cerrado"), ne(viaje.id, excluirViajeId),
      sql`lower(${viaje.origenLugar}) = lower(${origen})`, sql`lower(${viaje.destinoLugar}) = lower(${destino})`,
    ))
    .orderBy(desc(viaje.fechaSalida), desc(viaje.id)).limit(VIAJES_PROMEDIO);
  const montos = new Map<CategoriaGasto, number>();
  if (!previos.length) return { montos, viajes: 0 };
  const filas = await ctx.db.select({ categoria: gasto.categoria, total: sql<number>`coalesce(sum(${gasto.monto}), 0)` }).from(gasto)
    .where(sql`${gasto.viajeId} in (${sql.join(previos.map((p) => sql`${p.id}`), sql`, `)})`).groupBy(gasto.categoria);
  for (const f of filas) montos.set(f.categoria, Math.round(Number(f.total) / previos.length));
  return { montos, viajes: previos.length };
}

export async function liquidacionViaje(ctx: Contexto, viajeId: number): Promise<LiquidacionViaje> {
  const [f] = await ctx.db.select({ v: viaje, codigo: vehiculo.codigo, placa: vehiculo.placa }).from(viaje)
    .innerJoin(vehiculo, eq(vehiculo.id, viaje.vehiculoId)).where(eq(viaje.id, viajeId));
  if (!f) throw new ErrorNegocio("El viaje no existe");
  const v = f.v;
  const [entregas, gastos, presupuesto] = await Promise.all([
    ctx.db.select().from(entrega).where(eq(entrega.viajeId, viajeId)).orderBy(entrega.fecha, entrega.id),
    ctx.db.select().from(gasto).where(eq(gasto.viajeId, viajeId)).orderBy(gasto.fecha, gasto.id),
    ctx.db.select().from(viajePresupuesto).where(eq(viajePresupuesto.viajeId, viajeId)),
  ]);
  let origen: LiquidacionViaje["presupuestoOrigen"] = { tipo: "ninguno" };
  let montos = new Map<CategoriaGasto, number>(presupuesto.map((p) => [p.categoria, p.monto]));
  if (presupuesto.length) origen = { tipo: "viaje" };
  else {
    const prom = await promedioDeRuta(ctx, v.origenLugar, v.destinoLugar, v.id);
    if (prom.viajes) {
      montos = prom.montos;
      origen = { tipo: "promedio", viajes: prom.viajes };
    }
  }
  const realPor = new Map<CategoriaGasto, number>();
  for (const g of gastos) realPor.set(g.categoria, (realPor.get(g.categoria) ?? 0) + g.monto);
  const categorias = await listarCategorias(ctx);
  const lineas: LineaLiquidacion[] = categorias.map((c) => c.clave)
    .filter((c) => (montos.get(c) ?? 0) > 0 || (realPor.get(c) ?? 0) > 0)
    .map((c) => {
      const p = montos.get(c) ?? 0, r = realPor.get(c) ?? 0;
      return { categoria: c, nombre: nombreCategoria(c, categorias), presupuesto: p, real: r, pct: p > 0 ? Math.round((r / p) * 100) : null, semaforo: semaforo(r, p) };
    })
    .sort((a, b) => b.real - a.real || b.presupuesto - a.presupuesto);
  const entregado = entregas.reduce((s, e) => s + e.monto, 0);
  const gastado = gastos.reduce((s, g) => s + g.monto, 0);
  const presupuestoTotal = lineas.reduce((s, l) => s + l.presupuesto, 0);
  const guiasFilas = await ctx.db.select({ g: guiaTransportista, f: factura }).from(guiaTransportista)
    .leftJoin(facturaGuia, eq(facturaGuia.guiaId, guiaTransportista.id)).leftJoin(factura, eq(factura.id, facturaGuia.facturaId))
    .where(eq(guiaTransportista.viajeId, viajeId)).orderBy(guiaTransportista.id);
  const guias = guiasFilas.map(({ g, f: fac }) => ({
    id: g.id, serieNumero: `${g.serie}-${g.numero ?? "?"}`, tramo: g.tramo, estado: g.estado,
    flete: fac && (fac.estadoSunat === "aceptada" || fac.estadoSunat === "observada") ? fac.subtotal : null,
  }));
  const fila = (await listarViajesFlota(ctx, { vehiculoId: v.vehiculoId, desde: v.fechaSalida, hasta: v.fechaSalida })).find((x) => x.id === v.id);
  const flete = fila?.flete ?? v.flete ?? 0;
  return {
    viaje: {
      id: v.id, codigo: v.codigo, vehiculoId: v.vehiculoId, unidad: f.codigo ?? f.placa,
      ruta: v.origenLugar && v.destinoLugar ? `${v.origenLugar} → ${v.destinoLugar}` : (v.nota ?? "—"), fechaSalida: v.fechaSalida, fechaRegreso: v.fechaRegreso, estado: v.estado,
    },
    entregas: entregas.map((e) => ({ id: e.id, fecha: e.fecha, monto: e.monto, medio: e.medio, nota: e.nota })),
    gastos: gastos.map((g) => ({ id: g.id, fecha: g.fecha, categoria: g.categoria, monto: g.monto, detalle: [g.proveedorNombre, g.comprobante, g.nota].filter(Boolean).join(" · ") || null, conFoto: !!g.rutaFoto })),
    entregado, gastado, saldo: entregado - gastado, lineas, presupuestoTotal,
    semaforoTotal: presupuestoTotal > 0 ? semaforo(gastado, presupuestoTotal) : "sin_presupuesto",
    presupuestoOrigen: origen, guias, flete,
    ganancia: flete > 0 ? flete - gastado : null,
    margenPct: flete > 0 ? Math.round(((flete - gastado) / flete) * 100) : null,
  };
}

/** La liquidación del viaje en curso de la unidad o, si no tiene, la de su último viaje. */
export async function liquidacionDeUnidad(ctx: Contexto, vehiculoId: number): Promise<LiquidacionViaje | null> {
  const enCurso = await viajeEnCursoDeUnidad(ctx, vehiculoId);
  if (enCurso) return liquidacionViaje(ctx, enCurso.id);
  const [ultimo] = await ctx.db.select({ id: viaje.id }).from(viaje).where(eq(viaje.vehiculoId, vehiculoId)).orderBy(desc(viaje.fechaSalida), desc(viaje.id)).limit(1);
  return ultimo ? liquidacionViaje(ctx, ultimo.id) : null;
}
