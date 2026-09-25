import {
  ajuste, and, cotizacion, desc, empresa, eq, gasto, inArray, sql, vehiculo, viaje, viajePresupuesto, type CategoriaGasto,
} from "@sunatapp/db";
import { pdfPresupuesto } from "@sunatapp/pdf";
import { ErrorNegocio } from "../errores";
import type { Contexto } from "../infra/contexto";
import { hoy, listarUnidades, partesConDesgaste } from "../flota/unidades";
import { listarViajesFlota } from "../flota/viajes-flota";
import { gastosPorCategoria, mesAnterior, NOMBRE_CATEGORIA, rangoMes, resumenFinanciero } from "../finanzas/finanzas";
import { desgastePorKm } from "../reparaciones/reparaciones";

// ── Cotizador (handoff §6) ───────────────────────────────────────────────────

export interface EntradaCotizacion {
  km: number;
  toneladas: number;
  precioGal: number;
  rendimientoKmGal: number;
  peajes: number;
  viaticos: number;
  desgasteSolesKm: number;
  margenPct: number;
}

export interface ResultadoCotizacion {
  combustible: number;
  peajes: number;
  viaticos: number;
  desgaste: number;
  costo: number;
  flete: number;
  porTonelada: number | null;
  porKm: number | null;
  ganancia: number;
  margenPct: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Montos en soles (con decimales). El margen se limita a 0–90 %. */
export function cotizarFlete(e: EntradaCotizacion): ResultadoCotizacion {
  const margenPct = Math.min(90, Math.max(0, e.margenPct));
  const combustible = e.rendimientoKmGal > 0 ? (e.km / e.rendimientoKmGal) * e.precioGal : 0;
  const desgaste = e.km * e.desgasteSolesKm;
  const costo = combustible + e.peajes + e.viaticos + desgaste;
  const flete = costo / (1 - margenPct / 100);
  return {
    combustible: r2(combustible), peajes: r2(e.peajes), viaticos: r2(e.viaticos), desgaste: r2(desgaste), costo: r2(costo),
    flete: r2(flete), porTonelada: e.toneladas > 0 ? r2(flete / e.toneladas) : null, porKm: e.km > 0 ? r2(flete / e.km) : null,
    ganancia: r2(flete - costo), margenPct,
  };
}

export interface ParametrosCotizador {
  precioGal: number;
  rendimientoKmGal: number;
  viaticosDia: number;
  /** null = calcularlo del historial de cambios. */
  desgasteSolesKm: number | null;
  margenPct: number;
}

export const PARAMETROS_POR_DEFECTO: ParametrosCotizador = {
  precioGal: 16.5, rendimientoKmGal: 9, viaticosDia: 60, desgasteSolesKm: null, margenPct: 25,
};

export async function leerAjuste<T>(ctx: Contexto, clave: string, porDefecto: T): Promise<T> {
  const [f] = await ctx.db.select().from(ajuste).where(eq(ajuste.clave, clave));
  return f ? ({ ...(porDefecto as object), ...(f.valor as object) } as T) : porDefecto;
}

export async function guardarAjuste(ctx: Contexto, clave: string, valor: unknown): Promise<void> {
  await ctx.db.insert(ajuste).values({ clave, valor }).onConflictDoUpdate({ target: ajuste.clave, set: { valor, actualizadoEn: new Date() } });
}

export async function parametrosCotizador(ctx: Contexto): Promise<ParametrosCotizador & { desgasteAuto: number | null }> {
  const p = await leerAjuste(ctx, "parametros_cotizador", PARAMETROS_POR_DEFECTO);
  const auto = await desgastePorKm(ctx);
  return { ...p, desgasteAuto: auto.solesPorKm === null ? null : r2(auto.solesPorKm) };
}

export async function guardarParametrosCotizador(ctx: Contexto, p: ParametrosCotizador): Promise<void> {
  if (p.precioGal <= 0 || p.rendimientoKmGal <= 0) throw new ErrorNegocio("El precio y el rendimiento deben ser mayores que 0");
  if (p.margenPct < 0 || p.margenPct > 90) throw new ErrorNegocio("El margen debe estar entre 0 y 90 %");
  await guardarAjuste(ctx, "parametros_cotizador", p);
}

export async function guardarCotizacion(
  ctx: Contexto, e: { ruta: string; vehiculoId?: number | null; entrada: EntradaCotizacion; usuarioId?: number },
): Promise<{ id: number; resultado: ResultadoCotizacion }> {
  if (!e.ruta.trim()) throw new ErrorNegocio("Indica la ruta");
  if (e.entrada.km <= 0) throw new ErrorNegocio("La distancia debe ser mayor que 0");
  const resultado = cotizarFlete(e.entrada);
  const [f] = await ctx.db.insert(cotizacion).values({
    ruta: e.ruta.trim(), vehiculoId: e.vehiculoId ?? null, km: Math.round(e.entrada.km), toneladas: String(e.entrada.toneladas),
    datos: { entrada: e.entrada, resultado }, costo: Math.round(resultado.costo * 100), flete: Math.round(resultado.flete * 100), usuarioId: e.usuarioId ?? null,
  }).returning({ id: cotizacion.id });
  return { id: f!.id, resultado };
}

export async function obtenerCotizacion(ctx: Contexto, id: number) {
  const [f] = await ctx.db.select().from(cotizacion).where(eq(cotizacion.id, id));
  if (!f) throw new ErrorNegocio("La cotización no existe");
  return { ...f, entrada: (f.datos as { entrada: EntradaCotizacion }).entrada, resultado: (f.datos as { resultado: ResultadoCotizacion }).resultado };
}

export async function listarCotizaciones(ctx: Contexto, limite = 10) {
  return ctx.db.select().from(cotizacion).orderBy(desc(cotizacion.id)).limit(limite);
}

export async function marcarCotizacionEnviada(ctx: Contexto, id: number): Promise<void> {
  await ctx.db.update(cotizacion).set({ enviadaTelegram: true }).where(eq(cotizacion.id, id));
}

/** Distancia y peajes de la última vez que se hizo la misma ruta (para precargar el cotizador). */
export async function historialRuta(ctx: Contexto, origen: string, destino: string) {
  const filas = await ctx.db.select({ km: viaje.km, id: viaje.id }).from(viaje)
    .where(and(sql`lower(${viaje.origenLugar}) = ${origen.trim().toLowerCase()}`, sql`lower(${viaje.destinoLugar}) = ${destino.trim().toLowerCase()}`, sql`${viaje.km} is not null`))
    .orderBy(desc(viaje.id)).limit(5);
  if (!filas.length) return null;
  const ids = filas.map((f) => f.id);
  const [p] = await ctx.db.select({ t: sql<string>`coalesce(sum(${gasto.monto}), 0)` }).from(gasto).where(and(inArray(gasto.viajeId, ids), eq(gasto.categoria, "peaje")));
  return { km: Math.round(filas.reduce((s, f) => s + f.km!, 0) / filas.length), peajes: Number(p?.t ?? 0) / 100 / filas.length };
}

// ── Rentabilidad por trailer ─────────────────────────────────────────────────

export interface RentabilidadUnidad {
  vehiculoId: number;
  unidad: string;
  viajes: number;
  km: number;
  ingresos: number;
  costos: number;
  solesPorKm: number | null;
  margenPct: number | null;
}

export async function rentabilidadPorUnidad(ctx: Contexto, desde: string, hasta: string): Promise<RentabilidadUnidad[]> {
  const r: RentabilidadUnidad[] = [];
  for (const u of await listarUnidades(ctx)) {
    const f = await resumenFinanciero(ctx, desde, hasta, u.id);
    r.push({
      vehiculoId: u.id, unidad: u.codigo, viajes: f.viajes, km: f.km, ingresos: f.ingresos, costos: f.gastos,
      solesPorKm: f.km > 0 ? r2(f.ingresos / 100 / f.km) : null, margenPct: f.margenPct,
    });
  }
  return r;
}

// ── Proyección a 6 meses ─────────────────────────────────────────────────────

export interface MesProyeccion {
  mes: string;
  ingresos: number;
  costos: number;
  proyectado: boolean;
  cambiosRepuestos: number;
}

export async function proyeccion(ctx: Contexto, mesesHistoria = 3, mesesFuturo = 6): Promise<{ meses: MesProyeccion[]; base: { viajesMes: number; fletePromedio: number; costoPorKm: number; kmPorViaje: number } }> {
  const mesActual = hoy(ctx).slice(0, 7);
  const historia: MesProyeccion[] = [];
  for (let k = mesesHistoria; k >= 0; k--) {
    const mes = mesAnterior(mesActual, k);
    const { desde, hasta } = rangoMes(`${mes}-01`);
    const f = await resumenFinanciero(ctx, desde, hasta);
    historia.push({ mes, ingresos: f.ingresos, costos: f.gastos, proyectado: false, cambiosRepuestos: 0 });
  }
  // Base: meses cerrados de la historia (sin el actual, que va a medias); si no hay, el actual.
  const cerrados = historia.slice(0, -1).filter((m) => m.ingresos > 0 || m.costos > 0);
  const muestra = cerrados.length ? cerrados : historia.slice(-1);
  const desde = `${mesAnterior(mesActual, mesesHistoria)}-01`;
  const viajes = await listarViajesFlota(ctx, { desde, hasta: rangoMes(`${mesActual}-01`).hasta, limite: 10000 });
  const nMeses = Math.max(1, muestra.length);
  const viajesMes = viajes.length / (mesesHistoria + 1);
  const conFlete = viajes.filter((v) => v.flete > 0);
  const fletePromedio = conFlete.length ? conFlete.reduce((s, v) => s + v.flete, 0) / conFlete.length : 0;
  const kmTotal = viajes.reduce((s, v) => s + (v.km ?? 0), 0);
  const conKm = viajes.filter((v) => v.km);
  const kmPorViaje = conKm.length ? kmTotal / conKm.length : 0;
  // Costo operativo por km sin reparaciones (esas se proyectan con los contadores de desgaste).
  const [g] = await ctx.db.select({ t: sql<string>`coalesce(sum(${gasto.monto}), 0)` }).from(gasto)
    .where(and(sql`${gasto.fecha} >= ${desde}`, sql`${gasto.categoria} <> 'reparacion'`));
  const costoPorKm = kmTotal > 0 ? Number(g?.t ?? 0) / kmTotal : 0;
  const costoMesSinKm = kmTotal > 0 ? 0 : muestra.reduce((s, m) => s + m.costos, 0) / nMeses;

  // Cambios de repuestos que vienen en camino: mes en que cada parte llega a 100 %.
  const unidades = await listarUnidades(ctx);
  const partes = await partesConDesgaste(ctx, unidades.map((u) => u.id));
  const viajesMesUnidad = unidades.length ? viajesMes / unidades.length : 0;
  const cambiosPorMes = new Array<number>(mesesFuturo).fill(0);
  for (const p of partes) {
    let mesesHasta: number | null = null;
    if (p.viajesRestantes !== null && viajesMesUnidad > 0) mesesHasta = p.viajesRestantes / viajesMesUnidad;
    else if (p.diasRestantes !== null) mesesHasta = p.diasRestantes / 30;
    if (mesesHasta === null) continue;
    const k = Math.floor(mesesHasta);
    if (k < mesesFuturo) cambiosPorMes[k]! += p.costo;
  }

  const futuros: MesProyeccion[] = [];
  for (let k = 1; k <= mesesFuturo; k++) {
    const ingresos = Math.round(viajesMes * fletePromedio);
    const operativo = Math.round(viajesMes * kmPorViaje * costoPorKm + costoMesSinKm);
    futuros.push({ mes: mesAnterior(mesActual, -k), ingresos, costos: operativo + cambiosPorMes[k - 1]!, proyectado: true, cambiosRepuestos: cambiosPorMes[k - 1]! });
  }
  return { meses: [...historia, ...futuros], base: { viajesMes: r2(viajesMes), fletePromedio: Math.round(fletePromedio), costoPorKm: r2(costoPorKm), kmPorViaje: Math.round(kmPorViaje) } };
}

// ── Presupuesto vs real ──────────────────────────────────────────────────────

export async function presupuestoMensual(ctx: Contexto): Promise<Partial<Record<CategoriaGasto, number>>> {
  return leerAjuste<Partial<Record<CategoriaGasto, number>>>(ctx, "presupuesto_mensual", {});
}

export async function guardarPresupuestoMensual(ctx: Contexto, p: Partial<Record<CategoriaGasto, number>>): Promise<void> {
  for (const v of Object.values(p)) if (!Number.isInteger(v) || v! < 0) throw new ErrorNegocio("Montos de presupuesto no válidos");
  await guardarAjuste(ctx, "presupuesto_mensual", p);
}

/**
 * Presupuesto del mes por categoría: el presupuesto mensual guardado o, si no hay, la suma de los
 * presupuestos de los viajes del mes. Real = gastos del mes.
 */
export async function presupuestoVsReal(ctx: Contexto, fecha: string) {
  const { desde, hasta } = rangoMes(fecha);
  const real = await gastosPorCategoria(ctx, desde, hasta);
  let presupuesto = await presupuestoMensual(ctx);
  if (Object.keys(presupuesto).length === 0) {
    const filas = await ctx.db.select({ categoria: viajePresupuesto.categoria, t: sql<string>`sum(${viajePresupuesto.monto})` })
      .from(viajePresupuesto).innerJoin(viaje, eq(viaje.id, viajePresupuesto.viajeId))
      .where(and(sql`${viaje.fechaSalida} >= ${desde}`, sql`${viaje.fechaSalida} <= ${hasta}`)).groupBy(viajePresupuesto.categoria);
    presupuesto = Object.fromEntries(filas.map((f) => [f.categoria, Number(f.t)]));
  }
  const categorias = new Set<CategoriaGasto>([...(Object.keys(presupuesto) as CategoriaGasto[]), ...real.map((r) => r.categoria)]);
  return [...categorias].map((c) => {
    const p = presupuesto[c] ?? 0;
    const r = real.find((x) => x.categoria === c)?.monto ?? 0;
    return { categoria: c, nombre: NOMBRE_CATEGORIA[c], presupuesto: p, real: r, pct: p > 0 ? Math.round((r / p) * 100) : null };
  }).sort((a, b) => b.real - a.real);
}

/** PDF del presupuesto guardado (se descarga en la web o se envía por Telegram). */
export async function pdfDeCotizacion(ctx: Contexto, id: number): Promise<{ pdf: Buffer; nombre: string; texto: string }> {
  const c = await obtenerCotizacion(ctx, id);
  const [emp] = await ctx.db.select().from(empresa).limit(1);
  let unidad: string | null = null;
  if (c.vehiculoId) {
    const [v] = await ctx.db.select({ codigo: vehiculo.codigo, placa: vehiculo.placa }).from(vehiculo).where(eq(vehiculo.id, c.vehiculoId));
    unidad = v ? `${v.codigo ?? ""} · ${v.placa}` : null;
  }
  const numero = `P-${String(c.id).padStart(4, "0")}`;
  const e = c.entrada;
  const res = c.resultado;
  const pdf = await pdfPresupuesto({
    empresa: { ruc: emp?.ruc ?? "", razonSocial: emp?.razonSocial ?? "EMPRESA", direccion: emp?.direccion ?? "" },
    numero, fecha: c.creadoEn.toISOString().slice(0, 10), ruta: c.ruta, unidad, km: e.km, toneladas: e.toneladas,
    lineas: [
      { concepto: `Combustible (${e.km} km ÷ ${e.rendimientoKmGal} km/gal × S/ ${e.precioGal})`, monto: res.combustible },
      { concepto: "Peajes", monto: res.peajes },
      { concepto: "Viáticos", monto: res.viaticos },
      { concepto: `Desgaste de unidad (S/ ${e.desgasteSolesKm} por km)`, monto: res.desgaste },
    ],
    costo: res.costo, margenPct: res.margenPct, flete: res.flete, porTonelada: res.porTonelada, porKm: res.porKm,
  });
  const f = (n: number) => `S/ ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const texto = `📄 PRESUPUESTO ${numero}\n${c.ruta} · ${e.km.toLocaleString("en-US")} km · ${e.toneladas} t\nCosto ${f(res.costo)} · margen ${res.margenPct}%\nFLETE SUGERIDO ${f(res.flete)}`;
  return { pdf, nombre: `presupuesto-${numero}.pdf`, texto };
}
