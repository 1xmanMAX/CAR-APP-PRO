import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, guiaTransportista } from "@sunatapp/db";
import {
  categoriasMasUsadas, choferDeViaje, emitirGuia, prepararFactura, primerNombre, registrarEntrega, registrarGasto, registrarGuiaBorrador, registrarIngreso,
  registrarViajeFlota, resumenInicio, viajeDeFactura, viajesEnRuta,
  type Contexto,
} from "../src";
import { crearContextoPrueba, entradaGuia } from "./helpers";

let ctx: Contexto;
let cerrar: () => Promise<void>;
beforeEach(async () => ({ ctx, cerrar } = await crearContextoPrueba()));
afterEach(async () => cerrar());

describe("consultas de Inicio", () => {
  it("viajes en ruta: chofer, día, lo entregado y lo gastado", async () => {
    const v = await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Yura", destinoLugar: "Puno", estado: "en_curso", fecha: "2026-09-12", origen: "web" });
    await registrarEntrega(ctx, { viajeId: v.id, monto: 120000, medio: "yape" });
    await registrarGasto(ctx, { viajeId: v.id, categoria: "combustible", monto: 64000, origen: "web" });
    const [r] = await viajesEnRuta(ctx);
    expect(r).toMatchObject({ viajeId: v.id, codigo: v.codigo, ruta: "Yura → Puno", chofer: "Jhon", dia: 2, entregado: 120000, gastado: 64000, saldo: 56000, deja: null });
    expect(await choferDeViaje(ctx, v.id)).toBe("Jhon");
  });

  it("resumen del mes: entró, salió, ganancia y te deben", async () => {
    await registrarIngreso(ctx, { concepto: "Alquiler de carreta", monto: 50000, origen: "web" });
    await registrarGasto(ctx, { categoria: "peaje", monto: 2000, origen: "web" });
    const r = await resumenInicio(ctx);
    expect(r).toMatchObject({ mes: "2026-09", mesAnterior: "2026-08", entro: 50000, teDeben: 0, facturasPorCobrar: 0 });
    expect(r.salio).toBeGreaterThanOrEqual(2000);
    expect(r.ganancia).toBe(r.entro - r.salio);
  });

  it("viaje de una factura: por su guía; null si no hay", async () => {
    const v = await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Yura", destinoLugar: "Puno", estado: "cerrado", fecha: "2026-09-12", origen: "web" });
    const guiaId = await registrarGuiaBorrador(ctx, entradaGuia());
    await emitirGuia(ctx, guiaId);
    await ctx.db.update(guiaTransportista).set({ viajeId: v.id }).where(eq(guiaTransportista.id, guiaId));
    const { facturaId } = await prepararFactura(ctx, { guiaId, montoCentimos: 100000, incluyeIgv: false, formaPago: "contado" });
    expect(await viajeDeFactura(ctx, facturaId)).toBe(v.id);
    await ctx.db.update(guiaTransportista).set({ viajeId: null }).where(eq(guiaTransportista.id, guiaId));
    expect(await viajeDeFactura(ctx, facturaId)).toBeNull();
    expect(await viajeDeFactura(ctx, 9999)).toBeNull();
  });

  it("categorías más usadas (solo variables) y primer nombre", async () => {
    for (const m of [1000, 2000]) await registrarGasto(ctx, { categoria: "peaje", monto: m, origen: "web" });
    await registrarGasto(ctx, { categoria: "combustible", monto: 9000, origen: "web" });
    await registrarGasto(ctx, { categoria: "soat", monto: 9000, origen: "web" });
    expect(await categoriasMasUsadas(ctx, 3)).toEqual(["peaje", "combustible"]);
    expect(primerNombre("JHON LARRY")).toBe("Jhon");
    expect(primerNombre("  ")).toBe("el chofer");
  });
});
