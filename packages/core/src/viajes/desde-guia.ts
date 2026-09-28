import { and, eq, guiaTransportista, viaje } from "@sunatapp/db";
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
): Promise<{ accion: AccionGuia; viajeId: number; viajeCodigo: string; cerradoCodigo?: string } | null> {
  const [g] = await ctx.db.select().from(guiaTransportista).where(eq(guiaTransportista.id, guiaId));
  if (!g || g.viajeId !== null) return null;
  const [enCurso] = await ctx.db.select().from(viaje).where(and(eq(viaje.vehiculoId, g.vehiculoId), eq(viaje.estado, "en_curso")));
  let cerradoCodigo: string | undefined;
  if (enCurso) {
    const tramos = new Set((await ctx.db.select({ t: guiaTransportista.tramo }).from(guiaTransportista)
      .where(eq(guiaTransportista.viajeId, enCurso.id))).map((x) => x.t));
    if (!tramos.has("ida")) {
      await enlazarGuia(ctx, guiaId, enCurso.id, "ida", usuarioId);
      return { accion: "creado", viajeId: enCurso.id, viajeCodigo: enCurso.codigo };
    }
    if (!tramos.has("retorno")) {
      await enlazarGuia(ctx, guiaId, enCurso.id, "retorno", usuarioId);
      return { accion: "retorno", viajeId: enCurso.id, viajeCodigo: enCurso.codigo };
    }
    await finalizarViajeFlota(ctx, { viajeId: enCurso.id, usuarioId });
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
  return { accion: cerradoCodigo ? "cerrado_y_creado" : "creado", viajeId: v.id, viajeCodigo: v.codigo, cerradoCodigo };
}
