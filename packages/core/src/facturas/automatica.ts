import { ajuste, contraparte, eq, facturaGuia, guiaTransportista, viaje } from "@sunatapp/db";
import type { Contexto } from "../infra/contexto";
import type { ResultadoEmision } from "../guias/emitir";
import { emitirFactura } from "./emitir";
import { prepararFactura } from "./preparar";

const CLAVE = "factura_automatica";

export async function facturaAutomaticaActiva(ctx: Contexto): Promise<boolean> {
  const [f] = await ctx.db.select().from(ajuste).where(eq(ajuste.clave, CLAVE));
  return (f?.valor as { activa?: boolean } | undefined)?.activa === true;
}

export async function activarFacturaAutomatica(ctx: Contexto, activa: boolean): Promise<void> {
  const valor = { activa };
  await ctx.db.insert(ajuste).values({ clave: CLAVE, valor }).onConflictDoUpdate({ target: ajuste.clave, set: { valor, actualizadoEn: ctx.reloj() } });
}

/**
 * Factura sola una guía recién aceptada, solo si: está encendido, la guía tiene viaje con flete
 * pactado, es la única guía del viaje, el remitente tiene RUC y no falta ningún dato (VR). Si algo
 * falla, devuelve null sin error y el bot ofrece facturar como siempre.
 */
export async function intentarFacturaAutomatica(ctx: Contexto, guiaId: number): Promise<ResultadoEmision | null> {
  if (!(await facturaAutomaticaActiva(ctx))) return null;
  const [g] = await ctx.db.select().from(guiaTransportista).where(eq(guiaTransportista.id, guiaId));
  if (!g || g.estado !== "aceptada" || !g.viajeId) return null;
  const [ya] = await ctx.db.select().from(facturaGuia).where(eq(facturaGuia.guiaId, guiaId));
  if (ya) return null;
  const [v] = await ctx.db.select().from(viaje).where(eq(viaje.id, g.viajeId));
  if (!v?.flete || v.flete <= 0) return null;
  const guiasDelViaje = await ctx.db.select({ id: guiaTransportista.id }).from(guiaTransportista).where(eq(guiaTransportista.viajeId, g.viajeId));
  if (guiasDelViaje.length !== 1) return null;
  const [cli] = await ctx.db.select().from(contraparte).where(eq(contraparte.id, g.remitenteId));
  if (cli?.tipoDoc !== "6") return null;
  try {
    const { facturaId } = await prepararFactura(ctx, { guiaId, montoCentimos: v.flete, incluyeIgv: false, formaPago: "contado" });
    return await emitirFactura(ctx, facturaId);
  } catch (error) {
    ctx.log?.("info", `Factura automática no emitida para la guía ${guiaId}: ${(error as Error).message}`);
    return null;
  }
}
