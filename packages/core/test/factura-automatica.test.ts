import { eq, guiaTransportista, viaje } from "@sunatapp/db";
import { afterEach, describe, expect, it } from "vitest";
import { activarFacturaAutomatica, intentarFacturaAutomatica } from "../src/facturas/automatica";
import { emitirGuia } from "../src/guias/emitir";
import { registrarGuiaBorrador } from "../src/guias/registrar";
import { crearContextoPrueba, entradaGuia, prepararDatosTransporte } from "./helpers";

const cerrables: Array<() => Promise<void>> = [];
afterEach(async () => { while (cerrables.length) await cerrables.pop()!(); });

async function guiaAceptadaConViaje(flete: number | null) {
  const r = await crearContextoPrueba();
  cerrables.push(r.cerrar);
  await prepararDatosTransporte(r.ctx);
  const guiaId = await registrarGuiaBorrador(r.ctx, entradaGuia());
  await emitirGuia(r.ctx, guiaId);
  const [g] = await r.ctx.db.select().from(guiaTransportista).where(eq(guiaTransportista.id, guiaId));
  if (g!.viajeId) await r.ctx.db.update(viaje).set({ flete }).where(eq(viaje.id, g!.viajeId));
  return { ctx: r.ctx, guiaId, viajeId: g!.viajeId };
}

describe("intentarFacturaAutomatica", () => {
  it("apagada por defecto: no factura", async () => {
    const { ctx, guiaId } = await guiaAceptadaConViaje(250000);
    expect(await intentarFacturaAutomatica(ctx, guiaId)).toBeNull();
  });

  it("encendida, con flete y guía única: emite al contado por el flete", async () => {
    const { ctx, guiaId, viajeId } = await guiaAceptadaConViaje(250000);
    expect(viajeId).not.toBeNull();
    await activarFacturaAutomatica(ctx, true);
    const r = await intentarFacturaAutomatica(ctx, guiaId);
    expect(r).toMatchObject({ estado: "aceptada", serieNumero: "F001-1" });
  });

  it("encendida pero sin flete: no factura", async () => {
    const { ctx, guiaId } = await guiaAceptadaConViaje(null);
    await activarFacturaAutomatica(ctx, true);
    expect(await intentarFacturaAutomatica(ctx, guiaId)).toBeNull();
  });
});
