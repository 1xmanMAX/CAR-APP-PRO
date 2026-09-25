import {
  and, conductor, entrega, eq, guiaTransportista, ruta, rutaPresupuesto, siguienteCorrelativo, sql, vehiculo, viaje,
  viajePresupuesto, type Ejecutor, type EstadoViaje, type MedioEntrega,
} from "@sunatapp/db";
import { fechaHoraLima } from "../dominio/fechas";
import { ErrorNegocio } from "../errores";
import { registrarAuditoria } from "../infra/auditoria";
import type { Contexto } from "../infra/contexto";
import { transporteHabitual } from "../transporte/transporte";
import type { LineaPlantilla } from "./rutas";

export interface Viaje {
  id: number;
  codigo: string;
  rutaId: number | null;
  vehiculoId: number;
  vehiculoSecundarioId: number | null;
  conductorId: number;
  fechaSalida: string;
  fechaRegreso: string | null;
  estado: EstadoViaje;
  nota: string | null;
}

export interface EntradaViaje {
  rutaId?: number;
  vehiculoId?: number;
  vehiculoSecundarioId?: number | null;
  conductorId?: number;
  fechaSalida?: string;
  adelantoCentimos?: number;
  medioAdelanto?: MedioEntrega;
  nota?: string;
}

export const CODIGO_VIAJE = (numero: number) => `VJ-${String(numero).padStart(4, "0")}`;

function codigoError(error: unknown): string | undefined {
  return (error as { cause?: { code?: string }; code?: string }).cause?.code ?? (error as { code?: string }).code;
}

function filaAModelo(f: typeof viaje.$inferSelect): Viaje {
  return {
    id: f.id, codigo: f.codigo, rutaId: f.rutaId, vehiculoId: f.vehiculoId, vehiculoSecundarioId: f.vehiculoSecundarioId,
    conductorId: f.conductorId, fechaSalida: f.fechaSalida, fechaRegreso: f.fechaRegreso, estado: f.estado, nota: f.nota,
  };
}

async function vehiculoPorPlaca(db: Ejecutor, placa: string): Promise<{ id: number } | undefined> {
  const [v] = await db.select({ id: vehiculo.id }).from(vehiculo).where(eq(vehiculo.placa, placa));
  return v;
}

/**
 * El índice parcial `viaje_en_curso_vehiculo` es la verdad sobre "un solo viaje en curso por
 * tracto"; esta función solo produce el mensaje amistoso, tanto en el chequeo previo (caso común)
 * como al recuperarse de la violación de unicidad (carrera entre dos creaciones/reaperturas
 * concurrentes para el mismo vehículo).
 */
async function comprobarSinViajeEnCurso(db: Ejecutor, vehiculoId: number): Promise<void> {
  const [fila] = await db
    .select({ codigo: viaje.codigo, placa: vehiculo.placa })
    .from(viaje)
    .innerJoin(vehiculo, eq(viaje.vehiculoId, vehiculo.id))
    .where(and(eq(viaje.vehiculoId, vehiculoId), eq(viaje.estado, "en_curso")));
  if (fila) throw new ErrorNegocio(`El tracto ${fila.placa} ya tiene el viaje ${fila.codigo} en curso`);
}

async function copiarPlantillaRuta(db: Ejecutor, rutaId: number, viajeId: number): Promise<void> {
  const [r] = await db.select({ id: ruta.id }).from(ruta).where(eq(ruta.id, rutaId));
  if (!r) throw new ErrorNegocio("La ruta no existe");
  const filas = await db
    .select({ categoria: rutaPresupuesto.categoria, monto: rutaPresupuesto.monto })
    .from(rutaPresupuesto)
    .where(eq(rutaPresupuesto.rutaId, rutaId));
  if (filas.length > 0) {
    await db.insert(viajePresupuesto).values(filas.map((f) => ({ viajeId, categoria: f.categoria, monto: f.monto })));
  }
}

function validarPlantilla(plantilla: LineaPlantilla[]): void {
  if (plantilla.some((l) => !Number.isInteger(l.monto) || l.monto < 0)) {
    throw new ErrorNegocio("El monto del presupuesto no puede ser negativo");
  }
}

async function resolverTransporteViaje(
  ctx: Contexto,
  e: EntradaViaje,
): Promise<{ vehiculoId: number; vehiculoSecundarioId: number | null; conductorId: number }> {
  if (e.vehiculoId !== undefined && e.conductorId !== undefined) {
    return { vehiculoId: e.vehiculoId, vehiculoSecundarioId: e.vehiculoSecundarioId ?? null, conductorId: e.conductorId };
  }
  const habitual = await transporteHabitual(ctx);
  let vehiculoId = e.vehiculoId;
  let vehiculoSecundarioId = e.vehiculoSecundarioId ?? null;
  if (vehiculoId === undefined) {
    const veh = await vehiculoPorPlaca(ctx.db, habitual.placaPrincipal);
    if (!veh) throw new ErrorNegocio("Falta configurar empresa, vehículo o conductor");
    vehiculoId = veh.id;
    if (e.vehiculoSecundarioId === undefined && habitual.placasSecundarias[0]) {
      const sec = await vehiculoPorPlaca(ctx.db, habitual.placasSecundarias[0]);
      vehiculoSecundarioId = sec?.id ?? null;
    }
  }
  let conductorId = e.conductorId;
  if (conductorId === undefined) {
    const [cond] = await ctx.db.select({ id: conductor.id }).from(conductor).where(eq(conductor.numeroDoc, habitual.conductor.numeroDoc));
    if (!cond) throw new ErrorNegocio("Falta configurar empresa, vehículo o conductor");
    conductorId = cond.id;
  }
  return { vehiculoId, vehiculoSecundarioId, conductorId };
}

/**
 * Crea el viaje en "en_curso", copia la plantilla de presupuesto de la ruta y, con adelanto > 0,
 * registra la entrega inicial. Todo en una sola transacción.
 * La entrega inicial se inserta directamente aquí (no vía `registrarEntrega`, que pertenece a la
 * Tarea 5 y aún no existe en esta rama).
 */
export async function crearViaje(ctx: Contexto, e: EntradaViaje, usuarioId?: number): Promise<{ id: number; codigo: string }> {
  const { vehiculoId, vehiculoSecundarioId, conductorId } = await resolverTransporteViaje(ctx, e);
  const fechaSalida = e.fechaSalida ?? fechaHoraLima(ctx.reloj()).fecha;
  const adelantoCentimos = e.adelantoCentimos ?? 0;
  if (adelantoCentimos < 0) throw new ErrorNegocio("El adelanto no puede ser negativo");
  if (adelantoCentimos > 0 && !e.medioAdelanto) throw new ErrorNegocio("Falta el medio del adelanto");

  // Chequeo amistoso primero (evita abrir una transacción para el caso común); el índice parcial
  // `viaje_en_curso_vehiculo` es el respaldo real contra la carrera entre dos creaciones concurrentes.
  await comprobarSinViajeEnCurso(ctx.db, vehiculoId);

  try {
    return await ctx.db.transaction(async (tx) => {
      const numero = await siguienteCorrelativo(tx, "VJ", "VJ");
      const codigo = CODIGO_VIAJE(numero);
      const [fila] = await tx
        .insert(viaje)
        .values({
          codigo, rutaId: e.rutaId ?? null, vehiculoId, vehiculoSecundarioId, conductorId, fechaSalida,
          estado: "en_curso", nota: e.nota ?? null,
        })
        .returning({ id: viaje.id });
      const viajeId = fila!.id;
      if (e.rutaId !== undefined) await copiarPlantillaRuta(tx, e.rutaId, viajeId);
      if (adelantoCentimos > 0) {
        await tx.insert(entrega).values({ viajeId, fecha: fechaSalida, monto: adelantoCentimos, medio: e.medioAdelanto!, usuarioId: usuarioId ?? null });
      }
      await registrarAuditoria(tx, {
        usuarioId, accion: "viaje_creado", entidad: "viaje", entidadId: viajeId,
        detalle: { codigo, rutaId: e.rutaId ?? null, vehiculoId, conductorId, fechaSalida },
      });
      return { id: viajeId, codigo };
    });
  } catch (error) {
    if (codigoError(error) === "23505") await comprobarSinViajeEnCurso(ctx.db, vehiculoId);
    throw error;
  }
}

export async function viajeEnCurso(ctx: Contexto, vehiculoId?: number): Promise<Viaje | null> {
  if (vehiculoId !== undefined) {
    const [fila] = await ctx.db.select().from(viaje).where(and(eq(viaje.estado, "en_curso"), eq(viaje.vehiculoId, vehiculoId)));
    return fila ? filaAModelo(fila) : null;
  }
  const filas = await ctx.db.select().from(viaje).where(eq(viaje.estado, "en_curso"));
  return filas.length === 1 ? filaAModelo(filas[0]!) : null;
}

export async function obtenerViaje(ctx: Contexto, viajeId: number): Promise<Viaje> {
  const [fila] = await ctx.db.select().from(viaje).where(eq(viaje.id, viajeId));
  if (!fila) throw new ErrorNegocio(`El viaje ${viajeId} no existe`);
  return filaAModelo(fila);
}

export async function listarViajes(
  ctx: Contexto,
  o: { mes?: string; rutaId?: number; estado?: EstadoViaje; limite?: number } = {},
): Promise<Viaje[]> {
  const filtros = [];
  if (o.mes !== undefined) filtros.push(sql`to_char(${viaje.fechaSalida}, 'YYYY-MM') = ${o.mes}`);
  if (o.rutaId !== undefined) filtros.push(eq(viaje.rutaId, o.rutaId));
  if (o.estado !== undefined) filtros.push(eq(viaje.estado, o.estado));
  const base = ctx.db
    .select()
    .from(viaje)
    .where(filtros.length > 0 ? and(...filtros) : undefined)
    .orderBy(viaje.fechaSalida, viaje.id)
    .$dynamic();
  const filas = await (o.limite !== undefined ? base.limit(o.limite) : base);
  return filas.map(filaAModelo);
}

export async function buscarViajePorCodigo(ctx: Contexto, texto: string): Promise<Viaje | null> {
  const m = /^vj-?(\d+)$/i.exec(texto.trim());
  if (!m) return null;
  const codigo = CODIGO_VIAJE(Number(m[1]));
  const [fila] = await ctx.db.select().from(viaje).where(eq(viaje.codigo, codigo));
  return fila ? filaAModelo(fila) : null;
}

export async function cerrarViaje(ctx: Contexto, viajeId: number, fechaRegreso?: string, usuarioId?: number): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    const [v] = await tx.select().from(viaje).where(eq(viaje.id, viajeId)).for("update");
    if (!v) throw new ErrorNegocio(`El viaje ${viajeId} no existe`);
    if (v.estado !== "en_curso") throw new ErrorNegocio("El viaje no está en curso");
    const fecha = fechaRegreso ?? fechaHoraLima(ctx.reloj()).fecha;
    if (fecha < v.fechaSalida) throw new ErrorNegocio("La fecha de regreso no puede ser anterior a la fecha de salida");
    await tx.update(viaje).set({ estado: "cerrado", fechaRegreso: fecha }).where(eq(viaje.id, viajeId));
    await registrarAuditoria(tx, { usuarioId, accion: "viaje_cerrado", entidad: "viaje", entidadId: viajeId, detalle: { fechaRegreso: fecha } });
  });
}

export async function reabrirViaje(ctx: Contexto, viajeId: number, usuarioId?: number): Promise<void> {
  const [v] = await ctx.db.select().from(viaje).where(eq(viaje.id, viajeId));
  if (!v) throw new ErrorNegocio(`El viaje ${viajeId} no existe`);
  if (v.estado !== "cerrado") throw new ErrorNegocio("El viaje no está cerrado");
  // Chequeo amistoso primero; el índice parcial es el respaldo real contra la carrera.
  await comprobarSinViajeEnCurso(ctx.db, v.vehiculoId);
  try {
    await ctx.db.transaction(async (tx) => {
      await tx.update(viaje).set({ estado: "en_curso", fechaRegreso: null }).where(eq(viaje.id, viajeId));
      await registrarAuditoria(tx, { usuarioId, accion: "viaje_reabierto", entidad: "viaje", entidadId: viajeId });
    });
  } catch (error) {
    if (codigoError(error) === "23505") await comprobarSinViajeEnCurso(ctx.db, v.vehiculoId);
    throw error;
  }
}

export async function enlazarGuia(ctx: Contexto, guiaId: number, viajeId: number, tramo: "ida" | "retorno", usuarioId?: number): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    const [g] = await tx.select().from(guiaTransportista).where(eq(guiaTransportista.id, guiaId)).for("update");
    if (!g) throw new ErrorNegocio(`La guía ${guiaId} no existe`);
    if (g.viajeId !== null) throw new ErrorNegocio("La guía ya está en otro viaje");
    const [v] = await tx.select({ id: viaje.id }).from(viaje).where(eq(viaje.id, viajeId));
    if (!v) throw new ErrorNegocio(`El viaje ${viajeId} no existe`);
    const [ocupado] = await tx
      .select({ id: guiaTransportista.id })
      .from(guiaTransportista)
      .where(and(eq(guiaTransportista.viajeId, viajeId), eq(guiaTransportista.tramo, tramo)));
    if (ocupado) throw new ErrorNegocio(`El viaje ya tiene una guía en el tramo ${tramo}`);
    await tx.update(guiaTransportista).set({ viajeId, tramo }).where(eq(guiaTransportista.id, guiaId));
    await registrarAuditoria(tx, { usuarioId, accion: "guia_enlazada", entidad: "guia_transportista", entidadId: guiaId, detalle: { viajeId, tramo } });
  });
}

export async function desenlazarGuia(ctx: Contexto, guiaId: number, usuarioId?: number): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    const [g] = await tx.select({ id: guiaTransportista.id }).from(guiaTransportista).where(eq(guiaTransportista.id, guiaId)).for("update");
    if (!g) throw new ErrorNegocio(`La guía ${guiaId} no existe`);
    await tx.update(guiaTransportista).set({ viajeId: null, tramo: null }).where(eq(guiaTransportista.id, guiaId));
    await registrarAuditoria(tx, { usuarioId, accion: "guia_desenlazada", entidad: "guia_transportista", entidadId: guiaId });
  });
}

/** Busca el viaje en curso del vehículo de la guía; tramo "ida" si está libre, si no "retorno". */
export async function enlazarGuiaAlViajeEnCurso(ctx: Contexto, guiaId: number): Promise<{ viajeId: number; tramo: "ida" | "retorno" } | null> {
  const [g] = await ctx.db.select({ vehiculoId: guiaTransportista.vehiculoId }).from(guiaTransportista).where(eq(guiaTransportista.id, guiaId));
  if (!g) throw new ErrorNegocio(`La guía ${guiaId} no existe`);
  const v = await viajeEnCurso(ctx, g.vehiculoId);
  if (!v) return null;
  const ocupados = await ctx.db.select({ tramo: guiaTransportista.tramo }).from(guiaTransportista).where(eq(guiaTransportista.viajeId, v.id));
  const tramosOcupados = new Set(ocupados.map((o) => o.tramo));
  const tramo: "ida" | "retorno" | undefined = !tramosOcupados.has("ida") ? "ida" : !tramosOcupados.has("retorno") ? "retorno" : undefined;
  if (!tramo) return null;
  await enlazarGuia(ctx, guiaId, v.id, tramo);
  return { viajeId: v.id, tramo };
}

export async function actualizarPresupuestoViaje(ctx: Contexto, viajeId: number, plantilla: LineaPlantilla[], usuarioId?: number): Promise<void> {
  validarPlantilla(plantilla);
  await ctx.db.transaction(async (tx) => {
    const [v] = await tx.select({ id: viaje.id }).from(viaje).where(eq(viaje.id, viajeId));
    if (!v) throw new ErrorNegocio(`El viaje ${viajeId} no existe`);
    await tx.delete(viajePresupuesto).where(eq(viajePresupuesto.viajeId, viajeId));
    if (plantilla.length > 0) {
      await tx.insert(viajePresupuesto).values(plantilla.map((l) => ({ viajeId, categoria: l.categoria, monto: l.monto })));
    }
    await registrarAuditoria(tx, { usuarioId, accion: "viaje_presupuesto_actualizado", entidad: "viaje", entidadId: viajeId, detalle: { plantilla } });
  });
}
