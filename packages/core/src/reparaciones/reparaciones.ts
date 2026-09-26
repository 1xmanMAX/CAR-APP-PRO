import {
  and, desc, eq, gasto, inArray, isNotNull, parteInstalada, reparacion, reparacionRepuesto, repuesto, sql, tipoParte, vehiculo, viaje,
  type OrigenRegistro, type TipoReparacion,
} from "@sunatapp/db";
import { formatearSoles } from "../dominio/montos";
import { ErrorNegocio } from "../errores";
import { registrarAuditoria } from "../infra/auditoria";
import type { Contexto } from "../infra/contexto";
import { nombrePieza, pieza } from "../flota/componentes";
import { calcularDesgaste, etiquetaCambio } from "../flota/desgaste";
import { hoy, instalarParte, partesDeUnidad, promediosUnidad, registrarLecturaOdometro } from "../flota/unidades";

export interface EntradaCambio {
  vehiculoId: number;
  /** La parte instalada que se cambia. Sin ella es una reparación general (no reinicia contadores). */
  parteInstaladaId?: number | null;
  tipo: TipoReparacion;
  odometro?: number;
  fecha?: string;
  repuestos: Array<{ repuestoId: number; cantidad: number }>;
  /** Mano de obra en céntimos. */
  manoObra?: number;
  taller?: string | null;
  trabajo?: string | null;
  /** Pieza exacta del modelo 3D (ver `PIEZAS`): llanta, retrovisor, faro… */
  componente?: string | null;
  origen: OrigenRegistro;
  usuarioId?: number;
}

export interface ResultadoCambio {
  reparacionId: number;
  gastoId: number;
  parteNuevaId: number | null;
  desgastePct: number | null;
  etiqueta: ReturnType<typeof etiquetaCambio> | null;
  costoTotal: number;
  unidad: string;
  trabajo: string;
  stockBajo: Array<{ codigo: string; nombre: string; stock: number }>;
  resumen: string;
}

export const TIPOS_REPARACION: Record<TipoReparacion, string> = {
  preventivo: "PREVENTIVO",
  correctivo: "CORRECTIVO",
  falla_en_ruta: "FALLA EN RUTA",
};

/**
 * Registra un cambio de parte (o una reparación). En una sola transacción:
 * 1. guarda el % de desgaste que tenía la parte, 2. la desactiva y crea la nueva con contadores
 * en 0, 3. descuenta el stock de los repuestos usados, 4. crea el gasto del trailer.
 * El aviso a Telegram lo hace quien llama (web o bot) con `resumen`.
 */
export async function registrarCambio(ctx: Contexto, e: EntradaCambio): Promise<ResultadoCambio> {
  const fecha = e.fecha ?? hoy(ctx);
  const manoObra = e.manoObra ?? 0;
  if (!Number.isInteger(manoObra) || manoObra < 0) throw new ErrorNegocio("La mano de obra no es válida");
  for (const r of e.repuestos) {
    if (!Number.isInteger(r.cantidad) || r.cantidad <= 0) throw new ErrorNegocio("Las cantidades de repuestos deben ser enteros positivos");
  }
  const componente = e.componente?.trim() || null;
  if (componente && !pieza(componente)) throw new ErrorNegocio("Esa pieza no existe en el modelo del trailer");
  const ids = e.repuestos.map((r) => r.repuestoId);
  if (new Set(ids).size !== ids.length) throw new ErrorNegocio("Un repuesto aparece dos veces; junta las cantidades");

  const [unidad] = await ctx.db.select().from(vehiculo).where(eq(vehiculo.id, e.vehiculoId));
  if (!unidad) throw new ErrorNegocio("La unidad no existe");
  const odometro = e.odometro ?? unidad.odometroKm;
  if (!Number.isInteger(odometro) || odometro < 0) throw new ErrorNegocio("El odómetro no es válido");

  // El desgaste se calcula fuera de la transacción (PGlite no admite lecturas concurrentes a una
  // transacción abierta) y con el odómetro del cambio.
  let parte: Awaited<ReturnType<typeof partesDeUnidad>>[number] | undefined;
  let desgastePct: number | null = null;
  if (e.parteInstaladaId != null) {
    parte = (await partesDeUnidad(ctx, e.vehiculoId)).find((p) => p.id === e.parteInstaladaId);
    if (!parte) throw new ErrorNegocio("La parte no está instalada en esa unidad (o ya se cambió)");
    const uso = { ...parte.uso, km: Math.max(0, Math.max(odometro, unidad.odometroKm) - parte.kmInstalacion) };
    desgastePct = calcularDesgaste(parte.vida, uso, await promediosUnidad(ctx, e.vehiculoId)).pct;
  }
  const trabajo = e.trabajo?.trim() || (parte ? `Cambio · ${parte.nombre}` : componente ? `Revisión · ${nombrePieza(componente)}` : "Reparación");

  const r = await ctx.db.transaction(async (tx) => {
    if (odometro > unidad.odometroKm) {
      await registrarLecturaOdometro(ctx, { vehiculoId: unidad.id, km: odometro, fecha, origen: e.origen, usuarioId: e.usuarioId }, tx);
    }
    let costoRepuestos = 0;
    const usados: Array<{ id: number; codigo: string; nombre: string; cantidad: number; costoUnitario: number; stock: number; stockMinimo: number; tipoParteId: number | null }> = [];
    if (ids.length) {
      const filas = await tx.select().from(repuesto).where(inArray(repuesto.id, ids)).for("update");
      for (const u of e.repuestos) {
        const f = filas.find((x) => x.id === u.repuestoId);
        if (!f) throw new ErrorNegocio("Uno de los repuestos no existe");
        if (f.stock < u.cantidad) throw new ErrorNegocio(`Stock insuficiente de ${f.codigo} ${f.nombre}: quedan ${f.stock}`);
        costoRepuestos += u.cantidad * f.costoUnitario;
        usados.push({ id: f.id, codigo: f.codigo, nombre: f.nombre, cantidad: u.cantidad, costoUnitario: f.costoUnitario, stock: f.stock - u.cantidad, stockMinimo: f.stockMinimo, tipoParteId: f.tipoParteId });
        await tx.update(repuesto).set({ stock: sql`${repuesto.stock} - ${u.cantidad}` }).where(eq(repuesto.id, f.id));
      }
    }
    const costoTotal = costoRepuestos + manoObra;
    // Con la pieza indicada se puede anotar un incidente sin costo (se abrió el retrovisor, etc.).
    if (costoTotal <= 0 && !parte && !componente) throw new ErrorNegocio("Indica los repuestos usados o el costo de la mano de obra");

    let parteNuevaId: number | null = null;
    if (parte) {
      const [vigente] = await tx.select({ activa: parteInstalada.activa }).from(parteInstalada).where(eq(parteInstalada.id, parte.id)).for("update");
      if (!vigente?.activa) throw new ErrorNegocio("Esa parte ya se cambió");
      await tx.update(parteInstalada).set({ activa: false, retiradaEn: fecha }).where(eq(parteInstalada.id, parte.id));
      const principal = usados.find((u) => u.tipoParteId === parte!.tipoParteId) ?? usados[0];
      parteNuevaId = await instalarParte(ctx, {
        vehiculoId: unidad.id, tipoParteId: parte.tipoParteId, posicion: parte.posicion, repuestoId: principal?.id ?? null,
        fecha, km: Math.max(odometro, unidad.odometroKm),
        vidaKm: null, vidaViajes: null, vidaDias: null, costo: costoRepuestos,
      }, tx, e.usuarioId);
      // Conserva la vida útil propia que tuviera la parte anterior.
      const [anterior] = await tx.select().from(parteInstalada).where(eq(parteInstalada.id, parte.id));
      await tx.update(parteInstalada).set({ vidaKm: anterior!.vidaKm, vidaViajes: anterior!.vidaViajes, vidaDias: anterior!.vidaDias })
        .where(eq(parteInstalada.id, parteNuevaId));
    }

    const [g] = await tx.insert(gasto).values({
      categoria: "reparacion", monto: costoTotal, fecha, vehiculoId: unidad.id, origen: e.origen, usuarioId: e.usuarioId ?? null,
      proveedorNombre: e.taller ?? null, nota: `${unidad.codigo ?? unidad.placa} · ${trabajo}`,
    }).returning({ id: gasto.id });
    const [rep] = await tx.insert(reparacion).values({
      vehiculoId: unidad.id, parteRetiradaId: parte?.id ?? null, parteNuevaId, tipoParteId: parte?.tipoParteId ?? null, componente,
      tipo: e.tipo, trabajo, odometro, fecha, manoObra, costoRepuestos, costoTotal, taller: e.taller ?? null,
      desgastePct, gastoId: g!.id, origen: e.origen, usuarioId: e.usuarioId ?? null,
    }).returning({ id: reparacion.id });
    if (usados.length) {
      await tx.insert(reparacionRepuesto).values(usados.map((u) => ({ reparacionId: rep!.id, repuestoId: u.id, cantidad: u.cantidad, costoUnitario: u.costoUnitario })));
    }
    await registrarAuditoria(tx, { usuarioId: e.usuarioId, accion: "cambio_registrado", entidad: "reparacion", entidadId: rep!.id, detalle: { ...e, desgastePct, costoTotal } });
    return {
      reparacionId: rep!.id, gastoId: g!.id, parteNuevaId, costoTotal,
      stockBajo: usados.filter((u) => u.stockMinimo > 0 && u.stock <= u.stockMinimo).map((u) => ({ codigo: u.codigo, nombre: u.nombre, stock: u.stock })),
    };
  });

  const codigo = unidad.codigo ?? unidad.placa;
  const etiqueta = desgastePct === null ? null : etiquetaCambio(desgastePct);
  const resumen = [
    `🔧 CAMBIO REGISTRADO · ${codigo}`,
    trabajo + (desgastePct !== null ? ` (al ${desgastePct}% · ${etiqueta})` : ""),
    componente && !trabajo.includes(nombrePieza(componente)!) ? `Pieza: ${nombrePieza(componente)}` : "",
    `Costo ${formatearSoles(r.costoTotal)} · ${TIPOS_REPARACION[e.tipo]}${e.taller ? ` · ${e.taller}` : ""}`,
    parte ? "El contador de la parte vuelve a 0." : "",
  ].filter(Boolean).join("\n");
  return { ...r, desgastePct, etiqueta, unidad: codigo, trabajo, resumen };
}

export interface FilaReparacion {
  id: number;
  fecha: string;
  unidad: string;
  vehiculoId: number;
  trabajo: string;
  tipo: TipoReparacion;
  odometro: number;
  costoTotal: number;
  manoObra: number;
  taller: string | null;
  desgastePct: number | null;
  parte: string | null;
  /** Pieza del modelo 3D (id de `PIEZAS`) y su nombre. */
  componente: string | null;
  pieza: string | null;
  origen: OrigenRegistro;
}

export async function listarReparaciones(
  ctx: Contexto, o: { vehiculoId?: number; limite?: number; desde?: string; conPieza?: boolean } = {},
): Promise<FilaReparacion[]> {
  const filtros = [];
  if (o.vehiculoId !== undefined) filtros.push(eq(reparacion.vehiculoId, o.vehiculoId));
  if (o.conPieza) filtros.push(isNotNull(reparacion.componente));
  if (o.desde) filtros.push(sql`${reparacion.fecha} >= ${o.desde}`);
  const filas = await ctx.db
    .select({ r: reparacion, codigo: vehiculo.codigo, placa: vehiculo.placa, parte: tipoParte.nombreCorto })
    .from(reparacion)
    .innerJoin(vehiculo, eq(vehiculo.id, reparacion.vehiculoId))
    .leftJoin(tipoParte, eq(tipoParte.id, reparacion.tipoParteId))
    .where(filtros.length ? and(...filtros) : undefined)
    .orderBy(desc(reparacion.fecha), desc(reparacion.id))
    .limit(o.limite ?? 100);
  return filas.map(({ r, codigo, placa, parte }) => ({
    id: r.id, fecha: r.fecha, unidad: codigo ?? placa, vehiculoId: r.vehiculoId, trabajo: r.trabajo, tipo: r.tipo,
    odometro: r.odometro, costoTotal: r.costoTotal, manoObra: r.manoObra, taller: r.taller, desgastePct: r.desgastePct,
    parte, componente: r.componente, pieza: nombrePieza(r.componente), origen: r.origen,
  }));
}

export async function repuestosDeReparacion(ctx: Contexto, reparacionId: number) {
  return ctx.db.select({ codigo: repuesto.codigo, nombre: repuesto.nombre, cantidad: reparacionRepuesto.cantidad, costoUnitario: reparacionRepuesto.costoUnitario })
    .from(reparacionRepuesto).innerJoin(repuesto, eq(repuesto.id, reparacionRepuesto.repuestoId))
    .where(eq(reparacionRepuesto.reparacionId, reparacionId));
}

/** Costo de repuestos cambiados / km recorridos: el "desgaste S/ por km" automático del cotizador. */
export async function desgastePorKm(ctx: Contexto, vehiculoId?: number): Promise<{ solesPorKm: number | null; costo: number; km: number }> {
  const filtroR = vehiculoId !== undefined ? eq(reparacion.vehiculoId, vehiculoId) : undefined;
  const [c] = await ctx.db.select({ t: sql<string>`coalesce(sum(${reparacion.costoTotal}), 0)` }).from(reparacion).where(filtroR);
  const costo = Number(c?.t ?? 0);
  const [k] = await ctx.db.select({ km: sql<string>`coalesce(sum(${vehiculo.odometroKm}), 0)` }).from(vehiculo)
    .where(vehiculoId !== undefined ? eq(vehiculo.id, vehiculoId) : eq(vehiculo.tipo, "tracto"));
  // km recorridos desde la primera reparación: se aproxima con el km registrado en los viajes.
  const [kv] = await ctx.db.select({ km: sql<string>`coalesce(sum(${viaje.km}), 0)` }).from(viaje)
    .where(vehiculoId !== undefined ? eq(viaje.vehiculoId, vehiculoId) : undefined);
  const km = Number(kv?.km ?? 0) || Number(k?.km ?? 0);
  return { solesPorKm: km > 0 && costo > 0 ? costo / 100 / km : null, costo, km };
}
