import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, usuario } from "@sunatapp/db";
import {
  capturarContexto, describirContexto, enlazarGuia, obtenerGasto, obtenerUnidad, registrarGasto, registrarGuiaBorrador, registrarViajeFlota,
  type Contexto,
} from "../src/index";
import { crearContextoPrueba, entradaGuia } from "./helpers";

let ctx: Contexto;
let cerrar: () => Promise<void>;
beforeEach(async () => ({ ctx, cerrar } = await crearContextoPrueba()));
afterEach(async () => cerrar());

describe("captura automática del gasto", () => {
  it("sin viaje: unidad indicada, km actual y transferencia", async () => {
    const c = await capturarContexto(ctx, { vehiculoId: 1 });
    expect(c).toMatchObject({ vehiculoId: 1, viajeId: null, guiaId: null, medioPago: "transferencia" });
    expect(c.km).toBe((await obtenerUnidad(ctx, 1)).odometroKm);
  });

  it("con viaje en curso: toma el viaje, la guía del tramo actual y efectivo del chofer", async () => {
    const v = await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Juliaca", destinoLugar: "Arequipa", estado: "en_curso", origen: "web" });
    const ida = await registrarGuiaBorrador(ctx, entradaGuia());
    await enlazarGuia(ctx, ida, v.id, "ida").catch(() => {});
    let c = await capturarContexto(ctx, { vehiculoId: 1 });
    expect(c).toMatchObject({ viajeId: v.id, guiaId: ida, tramo: "ida", medioPago: "efectivo_chofer" });
    const ret = await registrarGuiaBorrador(ctx, { ...entradaGuia(), greRemitenteRef: "EG01-999" });
    await enlazarGuia(ctx, ret, v.id, "retorno").catch(() => {});
    c = await capturarContexto(ctx, { vehiculoId: 1 });
    expect(c).toMatchObject({ guiaId: ret, tramo: "retorno" });
    expect(describirContexto(c)).toMatch(/VJ-\d{4} \(guía .+, retorno\) · efectivo del chofer · [\d,]+ km/);
  });

  it("sin unidad: la deduce del viaje en curso del chofer que escribe", async () => {
    await ctx.db.update(usuario).set({ conductorId: 1 }).where(eq(usuario.id, 1));
    const v = await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Juliaca", destinoLugar: "Puno", estado: "en_curso", origen: "web", conductorId: 1 });
    expect((await capturarContexto(ctx, { usuarioId: 1 })).viajeId).toBe(v.id);
  });

  it("el gasto guarda solo guía, medio, km y el km real del voucher actualiza el odómetro", async () => {
    const u = await obtenerUnidad(ctx, 1);
    await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Juliaca", destinoLugar: "Arequipa", estado: "en_curso", origen: "web" });
    const r = await registrarGasto(ctx, { categoria: "combustible", monto: 48000, vehiculoId: 1, kmVehiculo: u.odometroKm + 350, origen: "telegram" });
    expect(r).toMatchObject({ kmReal: true, avisoKm: null });
    const g = (await obtenerGasto(ctx, r.id))!;
    expect(g).toMatchObject({ medioPago: "efectivo_chofer", kmVehiculo: u.odometroKm + 350, kmReal: true });
    expect((await obtenerUnidad(ctx, 1)).odometroKm).toBe(u.odometroKm + 350);
  });

  it("km inválido: guarda igual con el último km y avisa", async () => {
    const u = await obtenerUnidad(ctx, 1);
    // Un salto de más de 20,000 km se rechaza como lectura (si el odómetro es 0, se sube primero a 1,000).
    if (u.odometroKm === 0) await registrarGasto(ctx, { categoria: "peaje", monto: 100, vehiculoId: 1, kmVehiculo: 1000, origen: "web" });
    const base = (await obtenerUnidad(ctx, 1)).odometroKm;
    const r = await registrarGasto(ctx, { categoria: "combustible", monto: 30000, vehiculoId: 1, kmVehiculo: base + 50000, origen: "telegram" });
    expect(r.kmReal).toBe(false);
    expect(r.avisoKm).toMatch(/de golpe/);
    expect((await obtenerGasto(ctx, r.id))!.kmVehiculo).toBe(base);
    const menor = await registrarGasto(ctx, { categoria: "combustible", monto: 30000, vehiculoId: 1, kmVehiculo: base - 10, origen: "telegram" });
    expect(menor.kmReal).toBe(false);
    expect(menor.avisoKm).toMatch(/ya marca/);
  });

  it("respeta la forma de pago indicada", async () => {
    const r = await registrarGasto(ctx, { categoria: "peaje", monto: 2800, vehiculoId: 1, medioPago: "tarjeta", origen: "web" });
    expect((await obtenerGasto(ctx, r.id))!.medioPago).toBe("tarjeta");
  });

  it("un gasto de categoría fija no se carga al viaje en curso", async () => {
    await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Juliaca", destinoLugar: "Arequipa", estado: "en_curso", origen: "web" });
    const r = await registrarGasto(ctx, { categoria: "soat", monto: 140000, vehiculoId: 1, origen: "web" });
    expect((await obtenerGasto(ctx, r.id))).toMatchObject({ viajeId: null, guiaId: null, vehiculoId: 1, medioPago: "transferencia" });
  });
});
