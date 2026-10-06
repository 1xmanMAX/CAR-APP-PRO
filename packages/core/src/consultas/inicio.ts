import { and, categoriaGasto, conductor, eq, facturaGuia, gasto, guiaTransportista, isNotNull, sql, viaje } from "@sunatapp/db";
import { listarCobrosPendientes } from "../cobros/cobros";
import { mesAnterior, rangoMes, sumarDias } from "../dominio/fechas";
import { resumenFinanciero } from "../finanzas/finanzas";
import { hoy } from "../flota/unidades";
import type { Contexto } from "../infra/contexto";
import { liquidacionViaje } from "../viajes/liquidacion";

/** Solo lectura: lo que muestra la pantalla de Inicio del rediseño. */

export interface ResumenInicio {
  /** AAAA-MM del mes actual (hora de Lima). */
  mes: string;
  mesAnterior: string;
  ganancia: number;
  gananciaAnterior: number;
  entro: number;
  salio: number;
  viajes: number;
  /** Saldo de las facturas por cobrar. */
  teDeben: number;
  facturasPorCobrar: number;
  vencido: number;
}

export async function resumenInicio(ctx: Contexto): Promise<ResumenInicio> {
  const { desde, hasta, mes } = rangoMes(hoy(ctx));
  const anterior = mesAnterior(mes);
  const previo = rangoMes(`${anterior}-01`);
  const [fin, antes, cobros] = await Promise.all([
    resumenFinanciero(ctx, desde, hasta), resumenFinanciero(ctx, previo.desde, previo.hasta), listarCobrosPendientes(ctx),
  ]);
  return {
    mes, mesAnterior: anterior, ganancia: fin.ganancia, gananciaAnterior: antes.ganancia, entro: fin.ingresos, salio: fin.gastos, viajes: fin.viajes,
    teDeben: cobros.totalPendiente, facturasPorCobrar: cobros.filas.length, vencido: cobros.totalVencido,
  };
}

/** «JHON LARRY» → «Jhon» (como se le dice en la calle). */
export function primerNombre(nombres: string): string {
  const p = nombres.trim().split(/\s+/)[0] ?? "";
  return p ? p[0]!.toUpperCase() + p.slice(1).toLowerCase() : "el chofer";
}

export async function choferDeViaje(ctx: Contexto, viajeId: number): Promise<string> {
  const [f] = await ctx.db.select({ nombres: conductor.nombres }).from(viaje)
    .innerJoin(conductor, eq(conductor.id, viaje.conductorId)).where(eq(viaje.id, viajeId));
  return primerNombre(f?.nombres ?? "");
}

export interface ViajeEnRuta {
  viajeId: number;
  codigo: string;
  vehiculoId: number;
  unidad: string;
  ruta: string;
  chofer: string;
  /** Día del viaje: 1 el día que salió. */
  dia: number;
  entregado: number;
  gastado: number;
  /** entregado − gastado (lo que le queda al chofer; negativo = se le debe). */
  saldo: number;
  flete: number;
  /** flete − gastado; null si todavía no tiene flete. */
  deja: number | null;
}

const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export async function viajesEnRuta(ctx: Contexto): Promise<ViajeEnRuta[]> {
  const filas = await ctx.db.select({ id: viaje.id, salida: viaje.fechaSalida, nombres: conductor.nombres }).from(viaje)
    .innerJoin(conductor, eq(conductor.id, viaje.conductorId))
    .where(eq(viaje.estado, "en_curso")).orderBy(viaje.fechaSalida, viaje.id);
  const h = hoy(ctx);
  const r: ViajeEnRuta[] = [];
  for (const f of filas) {
    const l = await liquidacionViaje(ctx, f.id);
    r.push({
      viajeId: f.id, codigo: l.viaje.codigo, vehiculoId: l.viaje.vehiculoId, unidad: l.viaje.unidad, ruta: l.viaje.ruta,
      chofer: primerNombre(f.nombres), dia: Math.max(1, diasEntre(f.salida, h) + 1), entregado: l.entregado, gastado: l.gastado, saldo: l.saldo,
      flete: l.flete, deja: l.flete > 0 ? l.flete - l.gastado : null,
    });
  }
  return r;
}

/** Las categorías variables con más gastos en los últimos `dias` días (para los botones de «¿En qué?»). */
export async function categoriasMasUsadas(ctx: Contexto, n = 3, dias = 90): Promise<string[]> {
  const desde = sumarDias(hoy(ctx), -dias);
  const filas = await ctx.db.select({ categoria: gasto.categoria, total: sql<string>`count(*)` }).from(gasto)
    .innerJoin(categoriaGasto, eq(categoriaGasto.clave, gasto.categoria))
    .where(and(sql`${gasto.fecha} >= ${desde}`, eq(categoriaGasto.tipo, "variable"), eq(categoriaGasto.activa, true)))
    .groupBy(gasto.categoria).orderBy(sql`count(*) desc`, gasto.categoria).limit(n);
  return filas.map((f) => f.categoria);
}

/** El viaje de una factura (por la guía que factura); null si ninguna guía está enlazada a un viaje. */
export async function viajeDeFactura(ctx: Contexto, facturaId: number): Promise<number | null> {
  const [f] = await ctx.db.select({ viajeId: guiaTransportista.viajeId }).from(facturaGuia)
    .innerJoin(guiaTransportista, eq(guiaTransportista.id, facturaGuia.guiaId))
    .where(and(eq(facturaGuia.facturaId, facturaId), isNotNull(guiaTransportista.viajeId))).limit(1);
  return f?.viajeId ?? null;
}
