import { eq, vehiculo } from "@sunatapp/db";
import type { Contexto } from "../infra/contexto";

/** Configuración vehicular y carga útil del camión (las usa la factura de transporte, código 1004). */
export async function datosSunatVehiculo(ctx: Contexto, vehiculoId: number): Promise<{ configuracionVehicular: string | null; cargaUtilTm: number | null }> {
  const [f] = await ctx.db.select({ configuracion: vehiculo.configuracionVehicular, carga: vehiculo.cargaUtilTm }).from(vehiculo).where(eq(vehiculo.id, vehiculoId));
  return { configuracionVehicular: f?.configuracion ?? null, cargaUtilTm: f?.carga === null || f?.carga === undefined ? null : Number(f.carga) };
}
