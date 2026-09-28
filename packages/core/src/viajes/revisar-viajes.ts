import { ajuste, and, eq, gte, guiaTransportista, isNull, notExists, sql, viaje } from "@sunatapp/db";
import type { Contexto } from "../infra/contexto";

export type MotivoViaje = "sin_guia" | "guia_rechazada" | "cierre_automatico" | "guia_sin_viaje";
export interface ViajePorRevisar { motivo: MotivoViaje; viajeId: number | null; guiaId: number | null; codigo: string; detalle: string }

/**
 * Viajes y guías a medias: viajes sin guía (solo los creados desde este cambio), con la guía
 * rechazada por SUNAT, cerrados solos al salir con otra guía, y guías que quedaron sin viaje.
 */
export async function viajesPorRevisar(ctx: Contexto): Promise<ViajePorRevisar[]> {
  const r: ViajePorRevisar[] = [];
  const [corte] = await ctx.db.select({ v: ajuste.valor }).from(ajuste).where(eq(ajuste.clave, "viajes_sin_guia_desde"));
  const desde = corte ? new Date(String(corte.v)) : new Date(0);
  const sinGuia = await ctx.db.select({ id: viaje.id, codigo: viaje.codigo, o: viaje.origenLugar, d: viaje.destinoLugar }).from(viaje)
    .where(and(gte(viaje.creadoEn, desde), notExists(ctx.db.select({ x: sql`1` }).from(guiaTransportista).where(eq(guiaTransportista.viajeId, viaje.id)))));
  for (const v of sinGuia) r.push({ motivo: "sin_guia", viajeId: v.id, guiaId: null, codigo: v.codigo, detalle: `${v.o ?? "?"} → ${v.d ?? "?"} no tiene guía enlazada` });
  const rechazadas = await ctx.db.select({ g: guiaTransportista, codigo: viaje.codigo }).from(guiaTransportista)
    .innerJoin(viaje, eq(viaje.id, guiaTransportista.viajeId)).where(eq(guiaTransportista.estado, "rechazada"));
  for (const x of rechazadas) {
    r.push({ motivo: "guia_rechazada", viajeId: x.g.viajeId, guiaId: x.g.id, codigo: x.codigo, detalle: `Guía ${x.g.serie}-${x.g.numero ?? "?"} rechazada por SUNAT: corrígela` });
  }
  for (const v of await ctx.db.select().from(viaje).where(eq(viaje.cierreAutomatico, true))) {
    r.push({ motivo: "cierre_automatico", viajeId: v.id, guiaId: null, codigo: v.codigo, detalle: "Se cerró solo al salir con una guía nueva: revisa km y flete" });
  }
  for (const g of await ctx.db.select().from(guiaTransportista).where(and(isNull(guiaTransportista.viajeId), gte(guiaTransportista.creadoEn, desde)))) {
    r.push({ motivo: "guia_sin_viaje", viajeId: null, guiaId: g.id, codigo: `${g.serie}-${g.numero ?? "?"}`, detalle: "Guía sin viaje: enlázala o crea el viaje" });
  }
  return r;
}
