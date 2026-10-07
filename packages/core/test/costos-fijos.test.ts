import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, gasto } from "@sunatapp/db";
import {
  asegurarFijos, borrarGasto, crearCostoFijo, crearUnidad, crearPrestamo, editarCostoFijo, guardarPresupuestoMensual, presupuestoMensual, flujoCaja, generarFijosDelMes, listarCostosFijos, listarMovimientos, montoDelMes, pagarCuota,
  registrarGasto, resumenFinanciero, type Contexto,
} from "../src/index";
import { crearContextoPrueba } from "./helpers";

let ctx: Contexto;
let cerrar: () => Promise<void>;
// Reloj de prueba: 2026-09-13 (helpers).
beforeEach(async () => ({ ctx, cerrar } = await crearContextoPrueba()));
afterEach(async () => cerrar());

describe("costos fijos recurrentes", () => {
  it("anual = 1/12 por mes con el redondeo en diciembre", () => {
    expect(montoDelMes(120000, "mensual", "2026-03")).toBe(120000);
    expect(montoDelMes(100000, "anual", "2026-03")).toBe(8333);
    expect(montoDelMes(100000, "anual", "2026-12")).toBe(100000 - 8333 * 11);
  });

  it("genera el gasto del mes una sola vez, respetando la vigencia", async () => {
    const a = await crearCostoFijo(ctx, { concepto: "Sueldo chofer T-01", categoria: "sueldo_chofer", monto: 250000, periodicidad: "mensual", vehiculoId: 1, desde: "2026-08-15" });
    await crearCostoFijo(ctx, { concepto: "Contador", categoria: "contador", monto: 60000, periodicidad: "mensual", desde: "2026-01-01", hasta: "2026-08-31" });
    expect(await generarFijosDelMes(ctx, "2026-09")).toBe(1);
    expect(await generarFijosDelMes(ctx, "2026-09")).toBe(0);
    const gs = await ctx.db.select().from(gasto).where(eq(gasto.costoFijoId, a));
    expect(gs).toHaveLength(1);
    expect(gs[0]).toMatchObject({ fecha: "2026-09-01", periodo: "2026-09", vehiculoId: 1, medioPago: "transferencia", origen: "sistema", viajeId: null });
    expect(await generarFijosDelMes(ctx, "2026-07")).toBe(1); // solo el contador: el sueldo empieza en agosto
    expect((await listarCostosFijos(ctx, false)).map((f) => f.concepto).sort()).toEqual(["Contador", "Sueldo chofer T-01"]);
  });

  it("no crea un segundo fijo activo igual (mismo concepto, categoría y camión): se cobraría dos veces", async () => {
    const id = await crearCostoFijo(ctx, { concepto: "Sueldo de Mario", categoria: "sueldo_chofer", monto: 250000, periodicidad: "mensual", vehiculoId: 1 });
    await expect(crearCostoFijo(ctx, { concepto: " sueldo de mario ", categoria: "sueldo_chofer", monto: 260000, periodicidad: "mensual", vehiculoId: 1 }))
      .rejects.toThrow("Ya se carga solo: Sueldo de Mario S/ 2,500.00 cada mes");
    // Otro camión u otro concepto sí; uno desactivado ya no cuenta.
    const t2 = await crearUnidad(ctx, { placa: "XYZ-987" });
    await crearCostoFijo(ctx, { concepto: "Sueldo de Mario", categoria: "sueldo_chofer", monto: 250000, periodicidad: "mensual", vehiculoId: t2.id });
    await crearCostoFijo(ctx, { concepto: "Sueldo de Luis", categoria: "sueldo_chofer", monto: 250000, periodicidad: "mensual", vehiculoId: 1 });
    await editarCostoFijo(ctx, id, { activo: false });
    await crearCostoFijo(ctx, { concepto: "Sueldo de Mario", categoria: "sueldo_chofer", monto: 270000, periodicidad: "mensual", vehiculoId: 1 });
    expect(await listarCostosFijos(ctx)).toHaveLength(3);
  });

  it("el voucher del fijo queda en el gasto del primer mes", async () => {
    const id = await crearCostoFijo(ctx, { concepto: "GPS", categoria: "telefonia", monto: 12000, periodicidad: "mensual", desde: "2026-09-05", medioPago: "yape_plin", rutaFoto: "vouchers/gps.jpg" });
    const gs = await ctx.db.select().from(gasto).where(eq(gasto.costoFijoId, id));
    expect(gs).toEqual([expect.objectContaining({ periodo: "2026-09", rutaFoto: "vouchers/gps.jpg", medioPago: "yape_plin", monto: 12000 })]);
  });

  it("rechaza una categoría variable para un fijo", async () => {
    await expect(crearCostoFijo(ctx, { concepto: "x", categoria: "combustible", monto: 1000, periodicidad: "mensual" })).rejects.toThrow(/fija/);
  });

  it("las cuotas de préstamo entran como fijo del mes en que vencen", async () => {
    await crearPrestamo(ctx, { entidad: "BCP", monto: 1200000, tasaAnual: 12, cuotas: 12, fechaInicio: "2026-08-10", vehiculoId: 1 });
    await generarFijosDelMes(ctx, "2026-09");
    await generarFijosDelMes(ctx, "2026-09");
    const cuotas = await ctx.db.select().from(gasto).where(eq(gasto.categoria, "cuota_prestamo"));
    expect(cuotas).toHaveLength(1);
    expect(cuotas[0]).toMatchObject({ fecha: "2026-09-10", vehiculoId: 1, periodo: "2026-09" });
  });

  it("pagar la cuota con su número: un segundo envío de la misma no paga la siguiente", async () => {
    const p = await crearPrestamo(ctx, { entidad: "BCP", monto: 1200000, tasaAnual: 0, cuotas: 12, fechaInicio: "2026-08-10" });
    expect(await pagarCuota(ctx, p, undefined, undefined, 1)).toMatchObject({ numero: 1 });
    await expect(pagarCuota(ctx, p, undefined, undefined, 1)).rejects.toThrow("Esa cuota ya se pagó");
    await expect(pagarCuota(ctx, p, undefined, undefined, 5)).rejects.toThrow("Primero va la cuota 2");
    expect(await pagarCuota(ctx, p, undefined, undefined, 2)).toMatchObject({ numero: 2 });
  });

  it("flujo sin doble conteo: la cuota pagada sale una sola vez en caja y en movimientos", async () => {
    const p = await crearPrestamo(ctx, { entidad: "BCP", monto: 1200000, tasaAnual: 0, cuotas: 12, fechaInicio: "2026-08-10" });
    await generarFijosDelMes(ctx, "2026-09");
    await pagarCuota(ctx, p, "2026-09-10");
    const semanas = await flujoCaja(ctx, 4);
    expect(semanas.reduce((s, x) => s + x.sale, 0)).toBe(100000);
    const movs = await listarMovimientos(ctx, "2026-09-01", "2026-09-30");
    expect(movs.filter((m) => m.monto === -100000)).toHaveLength(1);
  });

  it("el resumen separa fijo y variable y resta ambos", async () => {
    await crearCostoFijo(ctx, { concepto: "GPS", categoria: "gps", monto: 9000, periodicidad: "mensual", desde: "2026-01-01" });
    await registrarGasto(ctx, { categoria: "peaje", monto: 2000, vehiculoId: 1, fecha: "2026-09-05", origen: "web" });
    const r = await resumenFinanciero(ctx, "2026-09-01", "2026-09-30");
    expect([r.gastosVariables, r.gastosFijos, r.gastos]).toEqual([2000, 9000, 11000]);
  });

  it("un gasto generado por un fijo o una cuota no se borra suelto (volvería a aparecer)", async () => {
    await crearCostoFijo(ctx, { concepto: "GPS", categoria: "gps", monto: 9000, periodicidad: "mensual", desde: "2026-09-01" });
    await crearPrestamo(ctx, { entidad: "BCP", monto: 1200000, tasaAnual: 0, cuotas: 12, fechaInicio: "2026-08-10" });
    await generarFijosDelMes(ctx, "2026-09");
    const [fijo] = await ctx.db.select().from(gasto).where(eq(gasto.categoria, "gps"));
    const [cuota] = await ctx.db.select().from(gasto).where(eq(gasto.categoria, "cuota_prestamo"));
    await expect(borrarGasto(ctx, fijo!.id)).rejects.toThrow(/Ajustes/);
    await expect(borrarGasto(ctx, cuota!.id)).rejects.toThrow(/Préstamos/);
  });

  it("editar un fijo corrige el mes en curso ya generado; desactivarlo lo quita desde este mes", async () => {
    const id = await crearCostoFijo(ctx, { concepto: "Sueldo", categoria: "sueldo_chofer", monto: 2500000, periodicidad: "mensual", desde: "2026-08-01" });
    await asegurarFijos(ctx, "2026-08-01", "2026-09-30");
    await editarCostoFijo(ctx, id, { monto: 250000 });
    const mes = async (p: string) => (await ctx.db.select().from(gasto).where(eq(gasto.periodo, p)))[0];
    expect((await mes("2026-09"))!.monto).toBe(250000);
    expect((await mes("2026-08"))!.monto).toBe(2500000); // los meses cerrados no se tocan
    await editarCostoFijo(ctx, id, { activo: false });
    expect(await mes("2026-09")).toBeUndefined();
    expect(await mes("2026-08")).toBeDefined();
  });

  it("los fijos salen en el flujo de caja (solo las cuotas se cuentan al pagarse)", async () => {
    await crearCostoFijo(ctx, { concepto: "GPS", categoria: "gps", monto: 9000, periodicidad: "mensual", desde: "2026-09-01" });
    await generarFijosDelMes(ctx, "2026-09");
    const semanas = await flujoCaja(ctx, 4);
    expect(semanas.reduce((s, x) => s + x.sale, 0)).toBe(9000);
  });

  it("el presupuesto mensual guardado con claves antiguas se lee con las nuevas", async () => {
    await guardarPresupuestoMensual(ctx, { reparacion: 900000, otros: 1000, combustible: 5000 } as never);
    expect(await presupuestoMensual(ctx)).toEqual({ reparacion_ruta: 900000, otros_viaje: 1000, combustible: 5000 });
  });

  it("no genera meses futuros y la edición cambia el monto de los meses que vienen", async () => {
    const id = await crearCostoFijo(ctx, { concepto: "GPS", categoria: "gps", monto: 9000, periodicidad: "mensual", desde: "2026-01-01" });
    await asegurarFijos(ctx, "2026-09-01", "2026-12-31");
    expect(await ctx.db.select().from(gasto).where(eq(gasto.costoFijoId, id))).toHaveLength(1);
    await editarCostoFijo(ctx, id, { monto: 12000 });
    expect(await generarFijosDelMes(ctx, "2026-10")).toBe(1);
    const [oct] = await ctx.db.select().from(gasto).where(eq(gasto.periodo, "2026-10"));
    expect(oct!.monto).toBe(12000);
  });
});
