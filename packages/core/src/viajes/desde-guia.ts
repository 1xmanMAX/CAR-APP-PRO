import { and, auditoria, desc, eq, guiaTransportista, vehiculo, viaje } from "@sunatapp/db";
import { registrarAuditoria } from "../infra/auditoria";
import { obtenerUbigeo } from "../dominio/ubigeos";
import type { Contexto } from "../infra/contexto";
import { finalizarViajeFlota, registrarViajeFlota } from "../flota/viajes-flota";
import { enlazarGuia } from "./viajes";

const titulo = (t: string) => t.toLowerCase().replace(/(^|\s)\p{L}/gu, (l) => l.toUpperCase());

/** «Lima» para cualquier distrito de Lima Metropolitana; si no, el distrito («Juliaca», «Arequipa»). */
export function ciudadDeUbigeo(codigo: string): string {
  const u = obtenerUbigeo(codigo);
  if (!u) return codigo;
  return titulo(u.provincia === "LIMA" ? "LIMA" : u.distrito);
}

export type AccionGuia = "creado" | "retorno" | "cerrado_y_creado";

/**
 * Enlaza la guía recién registrada al viaje de su unidad (spec §5): sin viaje en curso lo crea (ida);
 * con ida y sin retorno la pone como retorno; con los dos tramos ocupados cierra ese viaje (queda
 * marcado para revisar km y flete) y abre uno nuevo. Una guía ya enlazada no hace nada.
 */
export async function alRegistrarGuia(
  ctx: Contexto, guiaId: number, usuarioId?: number,
): Promise<ResultadoGuia | null> {
  const [g] = await ctx.db.select().from(guiaTransportista).where(eq(guiaTransportista.id, guiaId));
  if (!g || g.viajeId !== null) return null;
  const [enCurso] = await ctx.db.select().from(viaje).where(and(eq(viaje.vehiculoId, g.vehiculoId), eq(viaje.estado, "en_curso")));
  let cerradoCodigo: string | undefined;
  if (enCurso) {
    const tramos = new Set((await ctx.db.select({ t: guiaTransportista.tramo }).from(guiaTransportista)
      .where(eq(guiaTransportista.viajeId, enCurso.id))).map((x) => x.t));
    if (!tramos.has("ida")) {
      await enlazarGuia(ctx, guiaId, enCurso.id, "ida", usuarioId);
      return anotar(ctx, guiaId, { accion: "creado", viajeId: enCurso.id, viajeCodigo: enCurso.codigo, ruta: rutaDe(enCurso) }, usuarioId);
    }
    if (!tramos.has("retorno")) {
      await enlazarGuia(ctx, guiaId, enCurso.id, "retorno", usuarioId);
      return anotar(ctx, guiaId, { accion: "retorno", viajeId: enCurso.id, viajeCodigo: enCurso.codigo, ruta: rutaDe(enCurso) }, usuarioId);
    }
    // Se cierra con el último km conocido (el del último voucher o lectura), si avanzó desde la salida.
    const [u] = await ctx.db.select({ km: vehiculo.odometroKm }).from(vehiculo).where(eq(vehiculo.id, enCurso.vehiculoId));
    const avanzo = u && enCurso.odometroInicio !== null && u.km > enCurso.odometroInicio;
    await finalizarViajeFlota(ctx, { viajeId: enCurso.id, usuarioId, ...(avanzo ? { odometroFin: u.km } : {}) });
    await ctx.db.update(viaje).set({ cierreAutomatico: true }).where(eq(viaje.id, enCurso.id));
    cerradoCodigo = enCurso.codigo;
  }
  const peso = Number(g.pesoBruto);
  const toneladas = Math.round((g.unidadPeso === "TNE" ? peso : peso / 1000) * 100) / 100;
  const v = await registrarViajeFlota(ctx, {
    vehiculoId: g.vehiculoId, vehiculoSecundarioId: g.vehiculoSecundarioId, conductorId: g.conductorId,
    origenLugar: ciudadDeUbigeo(g.partidaUbigeo), destinoLugar: ciudadDeUbigeo(g.llegadaUbigeo),
    toneladas: toneladas > 0 && toneladas <= 100 ? toneladas : null, estado: "en_curso", origen: "sistema", usuarioId,
  });
  await enlazarGuia(ctx, guiaId, v.id, "ida", usuarioId);
  const ruta = `${ciudadDeUbigeo(g.partidaUbigeo)} → ${ciudadDeUbigeo(g.llegadaUbigeo)}`;
  return anotar(ctx, guiaId, { accion: cerradoCodigo ? "cerrado_y_creado" : "creado", viajeId: v.id, viajeCodigo: v.codigo, ruta, cerradoCodigo }, usuarioId);
}

type ResultadoGuia = { accion: AccionGuia; viajeId: number; viajeCodigo: string; ruta: string; cerradoCodigo?: string };
const rutaDe = (v: { origenLugar: string | null; destinoLugar: string | null }) => `${v.origenLugar ?? "?"} → ${v.destinoLugar ?? "?"}`;

/** Deja constancia de lo que se hizo con el viaje (el bot la lee para avisar a quien mandó la guía). */
async function anotar(ctx: Contexto, guiaId: number, r: ResultadoGuia, usuarioId?: number): Promise<ResultadoGuia> {
  await registrarAuditoria(ctx.db, { usuarioId, accion: "viaje_desde_guia", entidad: "guia_transportista", entidadId: guiaId, detalle: r });
  return r;
}

/** Aviso para quien registró la guía: qué viaje se abrió, de cuál es retorno o cuál se cerró solo. */
export async function avisoViajeDeGuia(ctx: Contexto, guiaId: number): Promise<string | null> {
  const [a] = await ctx.db.select({ accion: auditoria.accion, detalle: auditoria.detalle }).from(auditoria)
    .where(and(eq(auditoria.entidad, "guia_transportista"), eq(auditoria.entidadId, String(guiaId))))
    .orderBy(desc(auditoria.id)).limit(10)
    .then((fs) => fs.filter((f) => f.accion === "viaje_desde_guia" || f.accion === "viaje_desde_guia_error"));
  if (!a) return null;
  if (a.accion === "viaje_desde_guia_error") return `⚠️ No pude crear el viaje de esta guía (${String((a.detalle as { mensaje?: string })?.mensaje ?? "error")}). Queda en «Necesita tu atención».`;
  const r = a.detalle as ResultadoGuia;
  if (r.accion === "retorno") return `↩️ Guía de retorno de ${r.viajeCodigo} (${r.ruta}).`;
  const abierto = `🚛 Viaje ${r.viajeCodigo} abierto: ${r.ruta}. Los gastos que mandes van a este viaje.`;
  return r.cerradoCodigo ? `${abierto}\n⚠️ ${r.cerradoCodigo} ya tenía ida y retorno: se cerró solo; revisa su km y flete en «Necesita tu atención».` : abierto;
}
