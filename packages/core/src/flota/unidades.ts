import {
  and, desc, eq, gte, inArray, lecturaOdometro, parteInstalada, repuesto, sql, tipoParte, vehiculo, viaje,
  type EstadoUnidad, type Ejecutor, type OrigenRegistro, type ZonaModelo,
} from "@sunatapp/db";
import { normalizarPlaca } from "@sunatapp/sunat";
import { fechaHoraLima } from "../dominio/fechas";
import { ErrorNegocio } from "../errores";
import { registrarAuditoria } from "../infra/auditoria";
import type { Contexto } from "../infra/contexto";
import { calcularDesgaste, diasEntre, estadoDe, type EstadoDesgaste, type ResultadoDesgaste } from "./desgaste";

export function hoy(ctx: Contexto): string {
  return fechaHoraLima(ctx.reloj()).fecha;
}

export interface Unidad {
  id: number;
  codigo: string;
  placa: string;
  marca: string | null;
  modelo: string | null;
  anio: number | null;
  estado: EstadoUnidad;
  odometroKm: number;
  viajesTotales: number;
  rendimientoKmGal: number | null;
  carreta: { id: number; placa: string } | null;
}

export interface ParteConDesgaste extends ResultadoDesgaste {
  id: number;
  vehiculoId: number;
  tipoParteId: number;
  codigoTipo: string;
  nombre: string;
  nombreCorto: string;
  zona: ZonaModelo;
  posicion: string;
  fechaInstalacion: string;
  kmInstalacion: number;
  viajesInstalacion: number;
  vida: { km: number | null; viajes: number | null; dias: number | null };
  uso: { km: number; viajes: number; dias: number };
  repuesto: { id: number; codigo: string; nombre: string } | null;
  costo: number;
  alertaNivel: number;
}

/** Cuenta los viajes del tracto (los previos a la app más los registrados). */
export async function viajesTotales(db: Ejecutor, vehiculoId: number): Promise<number> {
  const [v] = await db.select({ base: vehiculo.viajesBase }).from(vehiculo).where(eq(vehiculo.id, vehiculoId));
  const [c] = await db.select({ n: sql<number>`count(*)` }).from(viaje).where(eq(viaje.vehiculoId, vehiculoId));
  return (v?.base ?? 0) + Number(c?.n ?? 0);
}

async function aUnidad(db: Ejecutor, f: typeof vehiculo.$inferSelect): Promise<Unidad> {
  let carreta: Unidad["carreta"] = null;
  if (f.carretaId) {
    const [c] = await db.select({ id: vehiculo.id, placa: vehiculo.placa }).from(vehiculo).where(eq(vehiculo.id, f.carretaId));
    carreta = c ?? null;
  }
  return {
    id: f.id, codigo: f.codigo ?? `#${f.id}`, placa: f.placa, marca: f.marca, modelo: f.modelo, anio: f.anio,
    estado: f.estadoUnidad, odometroKm: f.odometroKm, viajesTotales: await viajesTotales(db, f.id),
    rendimientoKmGal: f.rendimientoKmGal === null ? null : Number(f.rendimientoKmGal), carreta,
  };
}

/** Las unidades de la flota son los tractos (la carreta viaja con ellos). */
export async function listarUnidades(ctx: Contexto, incluirInactivas = false): Promise<Unidad[]> {
  const filas = await ctx.db.select().from(vehiculo).where(eq(vehiculo.tipo, "tracto")).orderBy(vehiculo.codigo, vehiculo.id);
  const r: Unidad[] = [];
  for (const f of filas) {
    if (!incluirInactivas && (!f.activo || f.estadoUnidad === "inactivo")) continue;
    r.push(await aUnidad(ctx.db, f));
  }
  return r;
}

export async function obtenerUnidad(ctx: Contexto, idOCodigo: number | string): Promise<Unidad> {
  const u = await buscarUnidad(ctx, idOCodigo);
  if (!u) throw new ErrorNegocio(`La unidad ${idOCodigo} no existe`);
  return u;
}

/** Acepta id, código ("T-01", "t1", "01") o placa. */
export async function buscarUnidad(ctx: Contexto, idOCodigo: number | string): Promise<Unidad | null> {
  if (typeof idOCodigo === "number") {
    const [f] = await ctx.db.select().from(vehiculo).where(eq(vehiculo.id, idOCodigo));
    return f ? aUnidad(ctx.db, f) : null;
  }
  const texto = idOCodigo.trim().toUpperCase();
  const m = /^T?-?0*(\d{1,3})$/.exec(texto);
  if (m) {
    const codigo = `T-${m[1]!.padStart(2, "0")}`;
    const [f] = await ctx.db.select().from(vehiculo).where(eq(vehiculo.codigo, codigo));
    if (f) return aUnidad(ctx.db, f);
  }
  const [porCodigo] = await ctx.db.select().from(vehiculo).where(eq(vehiculo.codigo, texto));
  if (porCodigo) return aUnidad(ctx.db, porCodigo);
  const placa = normalizarPlaca(texto);
  const [porPlaca] = await ctx.db
    .select()
    .from(vehiculo)
    .where(sql`upper(regexp_replace(${vehiculo.placa}, '[^A-Za-z0-9]', '', 'g')) = ${placa}`);
  return porPlaca ? aUnidad(ctx.db, porPlaca) : null;
}

export interface EntradaUnidad {
  codigo?: string;
  placa: string;
  marca?: string | null;
  modelo?: string | null;
  anio?: number | null;
  odometroKm?: number;
  viajesBase?: number;
  rendimientoKmGal?: number | null;
  placaCarreta?: string | null;
}

async function siguienteCodigoUnidad(db: Ejecutor): Promise<string> {
  const filas = await db.select({ codigo: vehiculo.codigo }).from(vehiculo).where(eq(vehiculo.tipo, "tracto"));
  const max = filas.reduce((m, f) => Math.max(m, Number(/^T-(\d+)$/.exec(f.codigo ?? "")?.[1] ?? 0)), 0);
  return `T-${String(max + 1).padStart(2, "0")}`;
}

async function asegurarCarreta(db: Ejecutor, placa: string): Promise<number> {
  const norm = normalizarPlaca(placa);
  const [f] = await db.select({ id: vehiculo.id, tipo: vehiculo.tipo }).from(vehiculo)
    .where(sql`upper(regexp_replace(${vehiculo.placa}, '[^A-Za-z0-9]', '', 'g')) = ${norm}`);
  if (f) {
    if (f.tipo !== "carreta") throw new ErrorNegocio(`La placa ${placa} ya es un tracto`);
    return f.id;
  }
  const [n] = await db.insert(vehiculo).values({ placa: placa.toUpperCase(), tipo: "carreta" }).returning({ id: vehiculo.id });
  return n!.id;
}

export async function crearUnidad(ctx: Contexto, e: EntradaUnidad, usuarioId?: number): Promise<Unidad> {
  const placa = e.placa.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,3}-?[A-Z0-9]{3}$/.test(placa)) throw new ErrorNegocio("La placa no tiene un formato válido (ej. ABC-123)");
  if ((e.odometroKm ?? 0) < 0 || (e.viajesBase ?? 0) < 0) throw new ErrorNegocio("El odómetro y los viajes no pueden ser negativos");
  if (await buscarUnidad(ctx, placa)) throw new ErrorNegocio(`La placa ${placa} ya está registrada`);
  const id = await ctx.db.transaction(async (tx) => {
    const codigo = e.codigo?.trim().toUpperCase() || (await siguienteCodigoUnidad(tx));
    const [dup] = await tx.select({ id: vehiculo.id }).from(vehiculo).where(eq(vehiculo.codigo, codigo));
    if (dup) throw new ErrorNegocio(`El código ${codigo} ya existe`);
    const carretaId = e.placaCarreta ? await asegurarCarreta(tx, e.placaCarreta) : null;
    const [f] = await tx.insert(vehiculo).values({
      placa, codigo, tipo: "tracto", marca: e.marca ?? null, modelo: e.modelo ?? null, anio: e.anio ?? null,
      odometroKm: e.odometroKm ?? 0, viajesBase: e.viajesBase ?? 0,
      rendimientoKmGal: e.rendimientoKmGal == null ? null : String(e.rendimientoKmGal), carretaId,
    }).returning({ id: vehiculo.id });
    await registrarAuditoria(tx, { usuarioId, accion: "unidad_creada", entidad: "vehiculo", entidadId: f!.id, detalle: { codigo, placa } });
    return f!.id;
  });
  return obtenerUnidad(ctx, id);
}

export async function actualizarUnidad(
  ctx: Contexto,
  id: number,
  e: Partial<Omit<EntradaUnidad, "placa" | "odometroKm">> & { estado?: EstadoUnidad },
  usuarioId?: number,
): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    const cambios: Partial<typeof vehiculo.$inferInsert> = {};
    if (e.marca !== undefined) cambios.marca = e.marca;
    if (e.modelo !== undefined) cambios.modelo = e.modelo;
    if (e.anio !== undefined) cambios.anio = e.anio;
    if (e.viajesBase !== undefined) cambios.viajesBase = e.viajesBase;
    if (e.estado !== undefined) cambios.estadoUnidad = e.estado;
    if (e.rendimientoKmGal !== undefined) cambios.rendimientoKmGal = e.rendimientoKmGal === null ? null : String(e.rendimientoKmGal);
    if (e.placaCarreta !== undefined) cambios.carretaId = e.placaCarreta ? await asegurarCarreta(tx, e.placaCarreta) : null;
    const [f] = await tx.update(vehiculo).set(cambios).where(eq(vehiculo.id, id)).returning({ id: vehiculo.id });
    if (!f) throw new ErrorNegocio("La unidad no existe");
    await registrarAuditoria(tx, { usuarioId, accion: "unidad_editada", entidad: "vehiculo", entidadId: id, detalle: e });
  });
}

/**
 * Registra una lectura de odómetro. El odómetro solo avanza: una lectura menor que la actual
 * es un error de tipeo casi seguro.
 */
export async function registrarLecturaOdometro(
  ctx: Contexto,
  e: { vehiculoId: number; km: number; fecha?: string; origen: OrigenRegistro; usuarioId?: number; viajeId?: number },
  db: Ejecutor = ctx.db,
): Promise<{ anterior: number; actual: number; sumados: number }> {
  if (!Number.isInteger(e.km) || e.km < 0) throw new ErrorNegocio("El odómetro debe ser un número entero de km");
  const [v] = await db.select({ odometroKm: vehiculo.odometroKm, codigo: vehiculo.codigo }).from(vehiculo).where(eq(vehiculo.id, e.vehiculoId));
  if (!v) throw new ErrorNegocio("La unidad no existe");
  if (e.km < v.odometroKm) {
    throw new ErrorNegocio(`El odómetro de ${v.codigo ?? "la unidad"} ya marca ${v.odometroKm.toLocaleString("en-US")} km; la lectura no puede ser menor`);
  }
  if (e.km - v.odometroKm > 20000) {
    throw new ErrorNegocio(`La lectura suma ${(e.km - v.odometroKm).toLocaleString("en-US")} km de golpe; revisa el número`);
  }
  await db.update(vehiculo).set({ odometroKm: e.km }).where(eq(vehiculo.id, e.vehiculoId));
  await db.insert(lecturaOdometro).values({
    vehiculoId: e.vehiculoId, km: e.km, fecha: e.fecha ?? hoy(ctx), origen: e.origen, usuarioId: e.usuarioId ?? null, viajeId: e.viajeId ?? null,
  });
  return { anterior: v.odometroKm, actual: e.km, sumados: e.km - v.odometroKm };
}

export async function lecturasOdometro(ctx: Contexto, vehiculoId: number, limite = 20) {
  return ctx.db.select().from(lecturaOdometro).where(eq(lecturaOdometro.vehiculoId, vehiculoId)).orderBy(desc(lecturaOdometro.id)).limit(limite);
}

/** km promedio por viaje del trailer (viajes con km registrados) y días entre viajes. */
export async function promediosUnidad(ctx: Contexto, vehiculoId: number): Promise<{ kmPorViaje: number | null; diasPorViaje: number | null }> {
  const filas = await ctx.db.select({ km: viaje.km, fecha: viaje.fechaSalida }).from(viaje)
    .where(eq(viaje.vehiculoId, vehiculoId)).orderBy(viaje.fechaSalida);
  const conKm = filas.filter((f) => f.km !== null && f.km > 0);
  const kmPorViaje = conKm.length > 0 ? conKm.reduce((s, f) => s + f.km!, 0) / conKm.length : null;
  let diasPorViaje: number | null = null;
  if (filas.length >= 2) {
    const d = diasEntre(filas[0]!.fecha, filas[filas.length - 1]!.fecha);
    diasPorViaje = d > 0 ? d / (filas.length - 1) : null;
  }
  return { kmPorViaje, diasPorViaje };
}

async function partesCrudas(ctx: Contexto, vehiculoIds: number[]) {
  if (vehiculoIds.length === 0) return [];
  return ctx.db
    .select({ p: parteInstalada, t: tipoParte, r: { id: repuesto.id, codigo: repuesto.codigo, nombre: repuesto.nombre } })
    .from(parteInstalada)
    .innerJoin(tipoParte, eq(parteInstalada.tipoParteId, tipoParte.id))
    .leftJoin(repuesto, eq(parteInstalada.repuestoId, repuesto.id))
    .where(and(inArray(parteInstalada.vehiculoId, vehiculoIds), eq(parteInstalada.activa, true)));
}

/** Estado de cada parte activa de las unidades, ordenado de más a menos desgastada. */
export async function partesConDesgaste(ctx: Contexto, vehiculoIds: number[]): Promise<ParteConDesgaste[]> {
  const filas = await partesCrudas(ctx, vehiculoIds);
  const hoyStr = hoy(ctx);
  const cache = new Map<number, { odometro: number; viajes: number; prom: { kmPorViaje: number | null; diasPorViaje: number | null } }>();
  const datos = async (id: number) => {
    let d = cache.get(id);
    if (!d) {
      const [v] = await ctx.db.select({ odometroKm: vehiculo.odometroKm }).from(vehiculo).where(eq(vehiculo.id, id));
      d = { odometro: v?.odometroKm ?? 0, viajes: await viajesTotales(ctx.db, id), prom: await promediosUnidad(ctx, id) };
      cache.set(id, d);
    }
    return d;
  };
  const r: ParteConDesgaste[] = [];
  for (const { p, t, r: rep } of filas) {
    const d = await datos(p.vehiculoId);
    const vida = { km: p.vidaKm ?? t.vidaKm, viajes: p.vidaViajes ?? t.vidaViajes, dias: p.vidaDias ?? t.vidaDias };
    const uso = {
      km: Math.max(0, d.odometro - p.kmInstalacion),
      viajes: Math.max(0, d.viajes - p.viajesInstalacion),
      dias: Math.max(0, diasEntre(p.fechaInstalacion, hoyStr)),
    };
    r.push({
      ...calcularDesgaste(vida, uso, d.prom),
      id: p.id, vehiculoId: p.vehiculoId, tipoParteId: t.id, codigoTipo: t.codigo, nombre: t.nombre + (p.posicion ? ` · ${p.posicion}` : ""),
      nombreCorto: t.nombreCorto, zona: t.zona, posicion: p.posicion, fechaInstalacion: p.fechaInstalacion,
      kmInstalacion: p.kmInstalacion, viajesInstalacion: p.viajesInstalacion, vida, uso,
      repuesto: rep?.id ? rep : null, costo: p.costo, alertaNivel: p.alertaNivel,
    });
  }
  return r.sort((a, b) => b.pct - a.pct || a.nombre.localeCompare(b.nombre));
}

export async function partesDeUnidad(ctx: Contexto, vehiculoId: number): Promise<ParteConDesgaste[]> {
  return partesConDesgaste(ctx, [vehiculoId]);
}

export interface EntradaInstalacion {
  vehiculoId: number;
  tipoParteId: number;
  posicion?: string;
  repuestoId?: number | null;
  fecha?: string;
  /** Odómetro al instalar; por defecto el actual. */
  km?: number;
  /** Viajes del trailer al instalar; por defecto los actuales. */
  viajes?: number;
  vidaKm?: number | null;
  vidaViajes?: number | null;
  vidaDias?: number | null;
  costo?: number;
}

/**
 * Da de alta una parte controlada en un trailer. Si ya había una activa del mismo tipo y
 * posición, se desactiva (la reemplaza). Para cambios con repuestos y costo, usar
 * `registrarCambio` (reparaciones), que llama a esta función dentro de su transacción.
 */
export async function instalarParte(ctx: Contexto, e: EntradaInstalacion, db: Ejecutor = ctx.db, usuarioId?: number): Promise<number> {
  const [v] = await db.select({ odometroKm: vehiculo.odometroKm }).from(vehiculo).where(eq(vehiculo.id, e.vehiculoId));
  if (!v) throw new ErrorNegocio("La unidad no existe");
  const [t] = await db.select({ id: tipoParte.id }).from(tipoParte).where(eq(tipoParte.id, e.tipoParteId));
  if (!t) throw new ErrorNegocio("El tipo de parte no existe");
  const fecha = e.fecha ?? hoy(ctx);
  const km = e.km ?? v.odometroKm;
  const viajes = e.viajes ?? (await viajesTotales(db, e.vehiculoId));
  if (km < 0 || viajes < 0) throw new ErrorNegocio("Los contadores no pueden ser negativos");
  const posicion = e.posicion?.trim() ?? "";
  await db.update(parteInstalada).set({ activa: false, retiradaEn: fecha })
    .where(and(eq(parteInstalada.vehiculoId, e.vehiculoId), eq(parteInstalada.tipoParteId, e.tipoParteId), eq(parteInstalada.posicion, posicion), eq(parteInstalada.activa, true)));
  const [p] = await db.insert(parteInstalada).values({
    vehiculoId: e.vehiculoId, tipoParteId: e.tipoParteId, posicion, repuestoId: e.repuestoId ?? null,
    fechaInstalacion: fecha, kmInstalacion: km, viajesInstalacion: viajes,
    vidaKm: e.vidaKm ?? null, vidaViajes: e.vidaViajes ?? null, vidaDias: e.vidaDias ?? null, costo: e.costo ?? 0,
  }).returning({ id: parteInstalada.id });
  await registrarAuditoria(db, { usuarioId, accion: "parte_instalada", entidad: "parte_instalada", entidadId: p!.id, detalle: { ...e, fecha, km, viajes } });
  return p!.id;
}

/** Ajusta la vida útil propia de una parte instalada (null = usar la del catálogo). */
export async function ajustarVidaParte(
  ctx: Contexto, parteId: number, vida: { vidaKm: number | null; vidaViajes: number | null; vidaDias: number | null }, usuarioId?: number,
): Promise<void> {
  for (const n of [vida.vidaKm, vida.vidaViajes, vida.vidaDias]) {
    if (n !== null && (!Number.isInteger(n) || n <= 0)) throw new ErrorNegocio("La vida útil debe ser un entero positivo");
  }
  const [f] = await ctx.db.update(parteInstalada).set(vida).where(eq(parteInstalada.id, parteId)).returning({ id: parteInstalada.id });
  if (!f) throw new ErrorNegocio("La parte no existe");
  await registrarAuditoria(ctx.db, { usuarioId, accion: "parte_vida_ajustada", entidad: "parte_instalada", entidadId: parteId, detalle: vida });
}

export interface SaludUnidad {
  unidad: Unidad;
  partes: ParteConDesgaste[];
  peor: ParteConDesgaste | null;
  conteo: Record<EstadoDesgaste, number>;
}

export async function saludFlota(ctx: Contexto): Promise<SaludUnidad[]> {
  const unidades = await listarUnidades(ctx);
  const partes = await partesConDesgaste(ctx, unidades.map((u) => u.id));
  return unidades.map((unidad) => {
    const propias = partes.filter((p) => p.vehiculoId === unidad.id);
    const conteo = { ok: 0, proximo: 0, cambiar: 0 };
    for (const p of propias) conteo[p.estado]++;
    return { unidad, partes: propias, peor: propias[0] ?? null, conteo };
  });
}

/** Peor estado de cada zona del modelo 3D. */
export function estadoPorZona(partes: ParteConDesgaste[]): Partial<Record<ZonaModelo, { pct: number; estado: EstadoDesgaste }>> {
  const r: Partial<Record<ZonaModelo, { pct: number; estado: EstadoDesgaste }>> = {};
  for (const p of partes) {
    const actual = r[p.zona];
    if (!actual || p.pct > actual.pct) r[p.zona] = { pct: p.pct, estado: estadoDe(p.pct) };
  }
  return r;
}

export interface AlertaDesgaste {
  parte: ParteConDesgaste;
  unidad: string;
  umbral: 70 | 90;
}

/**
 * Busca partes que cruzaron 70 % o 90 % desde el último aviso y marca el umbral como avisado.
 * Cada umbral se avisa una sola vez por parte (el cambio de la parte reinicia el conteo).
 */
export async function tomarAlertasDesgaste(ctx: Contexto, vehiculoIds?: number[]): Promise<AlertaDesgaste[]> {
  const unidades = await listarUnidades(ctx);
  const ids = vehiculoIds ?? unidades.map((u) => u.id);
  const partes = await partesConDesgaste(ctx, ids);
  const alertas: AlertaDesgaste[] = [];
  for (const p of partes) {
    const umbral = p.pct >= 90 ? 90 : p.pct >= 70 ? 70 : 0;
    if (umbral > p.alertaNivel) {
      const [f] = await ctx.db.update(parteInstalada).set({ alertaNivel: umbral })
        .where(and(eq(parteInstalada.id, p.id), sql`${parteInstalada.alertaNivel} < ${umbral}`)).returning({ id: parteInstalada.id });
      if (f) alertas.push({ parte: p, unidad: unidades.find((u) => u.id === p.vehiculoId)?.codigo ?? "", umbral: umbral as 70 | 90 });
    }
  }
  return alertas;
}

/** Viajes del trailer desde una fecha (para "viajes desde el último cambio"). */
export async function viajesDesde(ctx: Contexto, vehiculoId: number, fecha: string, limite = 50) {
  return ctx.db.select().from(viaje)
    .where(and(eq(viaje.vehiculoId, vehiculoId), gte(viaje.fechaSalida, fecha)))
    .orderBy(desc(viaje.fechaSalida), desc(viaje.id)).limit(limite);
}
