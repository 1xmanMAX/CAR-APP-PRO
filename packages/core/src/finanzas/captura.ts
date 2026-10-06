import { and, desc, eq, guiaTransportista, usuario, vehiculo, viaje, type MedioPago } from "@sunatapp/db";
import type { Contexto } from "../infra/contexto";

export const NOMBRE_MEDIO_PAGO: Record<MedioPago, string> = {
  efectivo_chofer: "efectivo del chofer", efectivo: "efectivo de oficina", yape_plin: "Yape/Plin",
  transferencia: "transferencia", tarjeta: "tarjeta", credito: "crédito",
};

export interface ContextoGasto {
  vehiculoId: number | null;
  unidad: string | null;
  viajeId: number | null;
  viajeCodigo: string | null;
  guiaId: number | null;
  guia: string | null;
  tramo: "ida" | "retorno" | null;
  km: number | null;
  medioPago: MedioPago;
}

type ViajeCorto = { id: number; codigo: string; vehiculoId: number };
const COLS = { id: viaje.id, codigo: viaje.codigo, vehiculoId: viaje.vehiculoId };

/**
 * Lo que un gasto sabe solo, en el momento en que se registra: la unidad (la indicada, la del viaje
 * o la del viaje en curso del chofer que escribe), su viaje en curso, la guía del tramo actual
 * (retorno si ya existe, si no ida), el último km conocido y la forma de pago por defecto.
 */
export async function capturarContexto(
  ctx: Contexto, o: { usuarioId?: number; vehiculoId?: number | null; viajeId?: number | null; sinViaje?: boolean },
): Promise<ContextoGasto> {
  let vj: ViajeCorto | undefined;
  if (o.viajeId) {
    [vj] = await ctx.db.select(COLS).from(viaje).where(eq(viaje.id, o.viajeId));
  } else if (o.sinViaje) {
    vj = undefined;
  } else if (o.vehiculoId) {
    [vj] = await ctx.db.select(COLS).from(viaje)
      .where(and(eq(viaje.vehiculoId, o.vehiculoId), eq(viaje.estado, "en_curso"))).orderBy(desc(viaje.id)).limit(1);
  } else if (o.usuarioId) {
    const [u] = await ctx.db.select({ conductorId: usuario.conductorId }).from(usuario).where(eq(usuario.id, o.usuarioId));
    if (u?.conductorId) {
      [vj] = await ctx.db.select(COLS).from(viaje)
        .where(and(eq(viaje.conductorId, u.conductorId), eq(viaje.estado, "en_curso"))).orderBy(desc(viaje.id)).limit(1);
    }
  }
  const vehiculoId = vj?.vehiculoId ?? o.vehiculoId ?? null;
  const [v] = vehiculoId
    ? await ctx.db.select({ codigo: vehiculo.codigo, placa: vehiculo.placa, km: vehiculo.odometroKm }).from(vehiculo).where(eq(vehiculo.id, vehiculoId))
    : [];
  let guiaId: number | null = null, guia: string | null = null, tramo: "ida" | "retorno" | null = null;
  if (vj) {
    const gs = await ctx.db.select({ id: guiaTransportista.id, serie: guiaTransportista.serie, numero: guiaTransportista.numero, tramo: guiaTransportista.tramo })
      .from(guiaTransportista).where(eq(guiaTransportista.viajeId, vj.id));
    const g = gs.find((x) => x.tramo === "retorno") ?? gs.find((x) => x.tramo === "ida") ?? null;
    if (g) {
      guiaId = g.id;
      guia = g.numero != null ? `${g.serie}-${g.numero}` : `${g.serie} sin número`;
      tramo = g.tramo;
    }
  }
  return {
    vehiculoId, unidad: v ? (v.codigo ?? v.placa) : null, viajeId: vj?.id ?? null, viajeCodigo: vj?.codigo ?? null,
    guiaId, guia, tramo, km: v?.km ?? null, medioPago: vj ? "efectivo_chofer" : "transferencia",
  };
}

/** «T-02 · VJ-0129 (guía V001-12, ida) · efectivo del chofer · 402,380 km». */
export function describirContexto(c: ContextoGasto): string {
  return [
    c.unidad,
    c.viajeCodigo ? `${c.viajeCodigo}${c.guia ? ` (guía ${c.guia}, ${c.tramo})` : " (sin guía)"}` : "sin viaje",
    NOMBRE_MEDIO_PAGO[c.medioPago],
    c.km !== null ? `${c.km.toLocaleString("en-US")} km` : null,
  ].filter(Boolean).join(" · ");
}
