import {
  and, conductor, desc, eq, factura, facturaGuia, gasto, guiaTransportista, inArray, siguienteCorrelativo, sql, usuario,
  vehiculo, viaje, type Ejecutor, type OrigenRegistro,
} from "@sunatapp/db";
import { ErrorNegocio } from "../errores";
import { registrarAuditoria } from "../infra/auditoria";
import type { Contexto } from "../infra/contexto";
import { CODIGO_VIAJE } from "../viajes/viajes";
import { hoy, registrarLecturaOdometro } from "./unidades";

export interface EntradaViajeFlota {
  vehiculoId: number;
  origenLugar: string;
  destinoLugar: string;
  km?: number | null;
  toneladas?: number | null;
  /** Flete sin IGV, en céntimos. */
  flete?: number | null;
  guiaRef?: string | null;
  fecha?: string;
  conductorId?: number;
  /** "cerrado" = el viaje ya se hizo (suma sus km al odómetro); "en_curso" = sale ahora. */
  estado?: "cerrado" | "en_curso";
  origen: OrigenRegistro;
  usuarioId?: number;
  nota?: string | null;
}

function codigoError(error: unknown): string | undefined {
  return (error as { cause?: { code?: string }; code?: string }).cause?.code ?? (error as { code?: string }).code;
}

async function resolverConductor(db: Ejecutor, e: { conductorId?: number; usuarioId?: number }): Promise<number> {
  if (e.conductorId !== undefined) return e.conductorId;
  if (e.usuarioId !== undefined) {
    const [u] = await db.select({ c: usuario.conductorId }).from(usuario).where(eq(usuario.id, e.usuarioId));
    if (u?.c) return u.c;
  }
  const [c] = await db.select({ id: conductor.id }).from(conductor).where(eq(conductor.activo, true)).orderBy(conductor.id).limit(1);
  if (!c) throw new ErrorNegocio("Registra primero un chofer (conductor)");
  return c.id;
}

/**
 * Registra un viaje de la flota. Al existir, suma 1 viaje a todas las partes de la unidad; si
 * trae km y ya está cerrado, además los suma al odómetro (y a las partes).
 */
export async function registrarViajeFlota(ctx: Contexto, e: EntradaViajeFlota): Promise<{ id: number; codigo: string }> {
  if (!e.origenLugar.trim() || !e.destinoLugar.trim()) throw new ErrorNegocio("Indica el origen y el destino del viaje");
  if (e.km != null && (!Number.isInteger(e.km) || e.km <= 0 || e.km > 10000)) throw new ErrorNegocio("Los km del viaje deben ser un entero entre 1 y 10,000");
  if (e.toneladas != null && (e.toneladas < 0 || e.toneladas > 100)) throw new ErrorNegocio("Las toneladas no son válidas");
  if (e.flete != null && (!Number.isInteger(e.flete) || e.flete < 0)) throw new ErrorNegocio("El flete no es válido");
  const estado = e.estado ?? "cerrado";
  const fecha = e.fecha ?? hoy(ctx);
  try {
    return await ctx.db.transaction(async (tx) => {
      const [v] = await tx.select().from(vehiculo).where(eq(vehiculo.id, e.vehiculoId)).for("update");
      if (!v || v.tipo !== "tracto") throw new ErrorNegocio("La unidad no existe");
      if (estado === "en_curso") {
        const [otro] = await tx.select({ codigo: viaje.codigo }).from(viaje).where(and(eq(viaje.vehiculoId, v.id), eq(viaje.estado, "en_curso")));
        if (otro) throw new ErrorNegocio(`${v.codigo} ya tiene el viaje ${otro.codigo} en curso; ciérralo con /fin`);
      }
      const conductorId = await resolverConductor(tx, e);
      const numero = await siguienteCorrelativo(tx, "VJ", "VJ");
      const codigo = CODIGO_VIAJE(numero);
      const aplicarKm = estado === "cerrado" && e.km != null;
      const [f] = await tx.insert(viaje).values({
        codigo, vehiculoId: v.id, vehiculoSecundarioId: v.carretaId, conductorId, fechaSalida: fecha,
        fechaRegreso: estado === "cerrado" ? fecha : null, estado,
        origenLugar: e.origenLugar.trim(), destinoLugar: e.destinoLugar.trim(), km: e.km ?? null,
        toneladas: e.toneladas == null ? null : String(e.toneladas), flete: e.flete ?? null, guiaRef: e.guiaRef?.trim() || null,
        odometroInicio: v.odometroKm, odometroFin: aplicarKm ? v.odometroKm + e.km! : null, kmAplicados: aplicarKm,
        origen: e.origen, nota: e.nota ?? null,
      }).returning({ id: viaje.id });
      if (aplicarKm) {
        await registrarLecturaOdometro(ctx, { vehiculoId: v.id, km: v.odometroKm + e.km!, fecha, origen: "sistema", usuarioId: e.usuarioId, viajeId: f!.id }, tx);
      }
      await tx.update(vehiculo).set({ estadoUnidad: estado === "en_curso" ? "en_ruta" : v.estadoUnidad === "en_ruta" ? "en_base" : v.estadoUnidad })
        .where(eq(vehiculo.id, v.id));
      await registrarAuditoria(tx, { usuarioId: e.usuarioId, accion: "viaje_registrado", entidad: "viaje", entidadId: f!.id, detalle: { ...e, codigo } });
      return { id: f!.id, codigo };
    });
  } catch (error) {
    if (codigoError(error) === "23505") throw new ErrorNegocio("La unidad ya tiene un viaje en curso");
    throw error;
  }
}

/**
 * Cierra el viaje en curso con el odómetro final (o los km recorridos). Los km se suman al
 * odómetro de la unidad una sola vez.
 */
export async function finalizarViajeFlota(
  ctx: Contexto,
  e: { viajeId: number; odometroFin?: number; km?: number; fecha?: string; flete?: number | null; usuarioId?: number },
): Promise<{ codigo: string; km: number | null }> {
  return ctx.db.transaction(async (tx) => {
    const [vj] = await tx.select().from(viaje).where(eq(viaje.id, e.viajeId)).for("update");
    if (!vj) throw new ErrorNegocio("El viaje no existe");
    if (vj.estado !== "en_curso") throw new ErrorNegocio(`El viaje ${vj.codigo} no está en curso`);
    const [v] = await tx.select().from(vehiculo).where(eq(vehiculo.id, vj.vehiculoId)).for("update");
    const fecha = e.fecha ?? hoy(ctx);
    if (fecha < vj.fechaSalida) throw new ErrorNegocio("La fecha de regreso no puede ser anterior a la salida");
    let km: number | null = null;
    let odometroFin: number | null = null;
    if (e.odometroFin !== undefined) {
      const inicio = vj.odometroInicio ?? v!.odometroKm;
      if (e.odometroFin < v!.odometroKm) throw new ErrorNegocio(`El odómetro final no puede ser menor que ${v!.odometroKm.toLocaleString("en-US")} km`);
      km = e.odometroFin - inicio;
      odometroFin = e.odometroFin;
    } else if (e.km !== undefined) {
      if (!Number.isInteger(e.km) || e.km <= 0) throw new ErrorNegocio("Los km deben ser un entero positivo");
      km = e.km;
      odometroFin = v!.odometroKm + e.km;
    }
    if (odometroFin !== null && odometroFin > v!.odometroKm) {
      await registrarLecturaOdometro(ctx, { vehiculoId: v!.id, km: odometroFin, fecha, origen: "sistema", usuarioId: e.usuarioId, viajeId: vj.id }, tx);
    }
    await tx.update(viaje).set({
      estado: "cerrado", fechaRegreso: fecha, km, odometroFin, kmAplicados: odometroFin !== null,
      ...(e.flete !== undefined ? { flete: e.flete } : {}),
    }).where(eq(viaje.id, vj.id));
    await tx.update(vehiculo).set({ estadoUnidad: v!.estadoUnidad === "en_ruta" ? "en_base" : v!.estadoUnidad }).where(eq(vehiculo.id, v!.id));
    await registrarAuditoria(tx, { usuarioId: e.usuarioId, accion: "viaje_finalizado", entidad: "viaje", entidadId: vj.id, detalle: { km, odometroFin, fecha } });
    return { codigo: vj.codigo, km };
  });
}

export async function editarViajeFlota(
  ctx: Contexto, viajeId: number,
  e: { flete?: number | null; toneladas?: number | null; guiaRef?: string | null; origenLugar?: string; destinoLugar?: string; nota?: string | null },
  usuarioId?: number,
): Promise<void> {
  const cambios: Partial<typeof viaje.$inferInsert> = {};
  if (e.flete !== undefined) cambios.flete = e.flete;
  if (e.toneladas !== undefined) cambios.toneladas = e.toneladas === null ? null : String(e.toneladas);
  if (e.guiaRef !== undefined) cambios.guiaRef = e.guiaRef;
  if (e.origenLugar !== undefined) cambios.origenLugar = e.origenLugar;
  if (e.destinoLugar !== undefined) cambios.destinoLugar = e.destinoLugar;
  if (e.nota !== undefined) cambios.nota = e.nota;
  const [f] = await ctx.db.update(viaje).set(cambios).where(eq(viaje.id, viajeId)).returning({ id: viaje.id });
  if (!f) throw new ErrorNegocio("El viaje no existe");
  await registrarAuditoria(ctx.db, { usuarioId, accion: "viaje_editado", entidad: "viaje", entidadId: viajeId, detalle: e });
}

export type EstadoFacturaViaje = "PAGADA" | "PENDIENTE" | "VENCIDA" | "SIN FACTURA";

export interface FilaViajeFlota {
  id: number;
  codigo: string;
  guia: string;
  vehiculoId: number;
  unidad: string;
  ruta: string;
  fecha: string;
  km: number | null;
  toneladas: number | null;
  flete: number;
  costo: number;
  margenPct: number | null;
  estado: "planificado" | "en_curso" | "cerrado";
  factura: EstadoFacturaViaje;
  facturas: string[];
  origen: OrigenRegistro;
}

/** Datos de facturación de las guías de cada viaje. */
async function facturasPorViaje(ctx: Contexto, viajeIds: number[]) {
  const r = new Map<number, Array<{ serieNumero: string; subtotal: number; estadoSunat: string; estadoCobro: string; vence: string | null; guia: string }>>();
  if (viajeIds.length === 0) return r;
  const filas = await ctx.db
    .select({ viajeId: guiaTransportista.viajeId, gSerie: guiaTransportista.serie, gNum: guiaTransportista.numero, f: factura })
    .from(guiaTransportista)
    .leftJoin(facturaGuia, eq(facturaGuia.guiaId, guiaTransportista.id))
    .leftJoin(factura, eq(factura.id, facturaGuia.facturaId))
    .where(inArray(guiaTransportista.viajeId, viajeIds));
  for (const f of filas) {
    const lista = r.get(f.viajeId!) ?? [];
    lista.push({
      guia: `${f.gSerie}-${f.gNum ?? "?"}`,
      serieNumero: f.f ? `${f.f.serie}-${f.f.numero ?? "?"}` : "",
      subtotal: f.f?.estadoSunat === "aceptada" || f.f?.estadoSunat === "observada" ? f.f.subtotal : 0,
      estadoSunat: f.f?.estadoSunat ?? "",
      estadoCobro: f.f?.estadoCobro ?? "",
      vence: f.f?.fechaVencimiento ?? f.f?.fechaEmision ?? null,
    });
    r.set(f.viajeId!, lista);
  }
  return r;
}

export async function listarViajesFlota(
  ctx: Contexto, o: { desde?: string; hasta?: string; vehiculoId?: number; limite?: number } = {},
): Promise<FilaViajeFlota[]> {
  const filtros = [];
  if (o.desde) filtros.push(sql`${viaje.fechaSalida} >= ${o.desde}`);
  if (o.hasta) filtros.push(sql`${viaje.fechaSalida} <= ${o.hasta}`);
  if (o.vehiculoId !== undefined) filtros.push(eq(viaje.vehiculoId, o.vehiculoId));
  const filas = await ctx.db
    .select({ v: viaje, codigoUnidad: vehiculo.codigo, placa: vehiculo.placa })
    .from(viaje)
    .innerJoin(vehiculo, eq(vehiculo.id, viaje.vehiculoId))
    .where(filtros.length ? and(...filtros) : undefined)
    .orderBy(desc(viaje.fechaSalida), desc(viaje.id))
    .limit(o.limite ?? 200);
  const ids = filas.map((f) => f.v.id);
  const costos = new Map<number, number>();
  if (ids.length) {
    const cs = await ctx.db.select({ viajeId: gasto.viajeId, total: sql<string>`sum(${gasto.monto})` }).from(gasto)
      .where(inArray(gasto.viajeId, ids)).groupBy(gasto.viajeId);
    for (const c of cs) costos.set(c.viajeId!, Number(c.total));
  }
  const facturas = await facturasPorViaje(ctx, ids);
  const hoyStr = hoy(ctx);
  return filas.map(({ v, codigoUnidad, placa }) => {
    const fs = facturas.get(v.id) ?? [];
    const conFactura = fs.filter((x) => x.serieNumero);
    const flete = v.flete ?? conFactura.reduce((s, x) => s + x.subtotal, 0);
    const costo = costos.get(v.id) ?? 0;
    let estadoFactura: EstadoFacturaViaje = "SIN FACTURA";
    if (conFactura.length > 0) {
      if (conFactura.every((x) => x.estadoCobro === "pagada")) estadoFactura = "PAGADA";
      else if (conFactura.some((x) => x.estadoCobro !== "pagada" && x.vence !== null && x.vence < hoyStr)) estadoFactura = "VENCIDA";
      else estadoFactura = "PENDIENTE";
    }
    return {
      id: v.id, codigo: v.codigo, guia: v.guiaRef ?? fs[0]?.guia ?? "—", vehiculoId: v.vehiculoId, unidad: codigoUnidad ?? placa,
      ruta: v.origenLugar && v.destinoLugar ? `${v.origenLugar} → ${v.destinoLugar}` : (v.nota ?? "—"),
      fecha: v.fechaSalida, km: v.km, toneladas: v.toneladas === null ? null : Number(v.toneladas), flete, costo,
      margenPct: flete > 0 ? Math.round(((flete - costo) / flete) * 100) : null,
      estado: v.estado, factura: estadoFactura, facturas: conFactura.map((x) => x.serieNumero), origen: v.origen,
    };
  });
}

export async function viajeEnCursoDeUnidad(ctx: Contexto, vehiculoId: number) {
  const [f] = await ctx.db.select().from(viaje).where(and(eq(viaje.vehiculoId, vehiculoId), eq(viaje.estado, "en_curso")));
  return f ?? null;
}
