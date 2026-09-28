import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, guiaTransportista, viaje } from "@sunatapp/db";
import { alRegistrarGuia, ciudadDeUbigeo, editarViajeFlota, registrarGuiaBorrador, registrarViajeFlota, viajesPorRevisar, type Contexto } from "../src/index";
import { crearContextoPrueba, entradaGuia } from "./helpers";

let ctx: Contexto;
let cerrar: () => Promise<void>;
beforeEach(async () => ({ ctx, cerrar } = await crearContextoPrueba()));
afterEach(async () => cerrar());

const guia = (ref: string) => registrarGuiaBorrador(ctx, { ...entradaGuia(), greRemitenteRef: ref });
const deGuia = async (guiaId: number) => (await ctx.db.select().from(guiaTransportista).where(eq(guiaTransportista.id, guiaId)))[0]!;

describe("el viaje nace de la guía", () => {
  it("nombre de ciudad desde el ubigeo", () => {
    expect(ciudadDeUbigeo("150115")).toBe("Lima");
    expect(ciudadDeUbigeo("211101")).toBe("Juliaca");
    expect(ciudadDeUbigeo("250101")).toBe("Calleria");
  });

  it("sin viaje en curso: registrar la guía crea el viaje con los datos de la guía", async () => {
    const g = await deGuia(await guia("EG01-1"));
    expect(g.tramo).toBe("ida");
    const [v] = await ctx.db.select().from(viaje).where(eq(viaje.id, g.viajeId!));
    expect(v).toMatchObject({ estado: "en_curso", origenLugar: "Lima", destinoLugar: "Calleria", toneladas: "1.50", vehiculoId: g.vehiculoId, conductorId: g.conductorId });
  });

  it("la segunda guía de la unidad es el retorno del mismo viaje", async () => {
    const a = await deGuia(await guia("EG01-1"));
    const b = await deGuia(await guia("EG01-2"));
    expect(b.viajeId).toBe(a.viajeId);
    expect(b.tramo).toBe("retorno");
  });

  it("con ida y retorno ocupados: cierra ese viaje (marcado) y abre otro", async () => {
    const a = await deGuia(await guia("EG01-1"));
    await guia("EG01-2");
    const c = await deGuia(await guia("EG01-3"));
    const [cerrado] = await ctx.db.select().from(viaje).where(eq(viaje.id, a.viajeId!));
    expect(cerrado).toMatchObject({ estado: "cerrado", cierreAutomatico: true });
    expect(c.viajeId).not.toBe(a.viajeId);
    expect(c.tramo).toBe("ida");
    expect((await viajesPorRevisar(ctx)).some((x) => x.motivo === "cierre_automatico" && x.viajeId === a.viajeId)).toBe(true);
    // Al corregir el viaje sale de «Por revisar».
    await editarViajeFlota(ctx, a.viajeId!, { flete: 500000 });
    expect((await viajesPorRevisar(ctx)).some((x) => x.motivo === "cierre_automatico" && x.viajeId === a.viajeId)).toBe(false);
  });

  it("idempotencia: llamarla otra vez para la misma guía no crea otro viaje", async () => {
    const g = await guia("EG01-1");
    expect(await alRegistrarGuia(ctx, g)).toBeNull();
    expect(await ctx.db.select().from(viaje)).toHaveLength(1);
  });

  it("un viaje creado a mano después de la migración aparece como «sin guía»", async () => {
    const v = await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Juliaca", destinoLugar: "Puno", estado: "en_curso", origen: "web" });
    expect((await viajesPorRevisar(ctx)).find((x) => x.viajeId === v.id)?.motivo).toBe("sin_guia");
  });
});
