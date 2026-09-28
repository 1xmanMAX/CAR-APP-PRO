import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  crearCostoFijo, crearUnidad, finalizarViajeFlota, registrarGasto, registrarViajeFlota, rentabilidadDeViaje, rentabilidadPorMes, rentabilidadPorViaje,
  type Contexto,
} from "../src/index";
import { crearContextoPrueba } from "./helpers";

let ctx: Contexto;
let cerrar: () => Promise<void>;
beforeEach(async () => ({ ctx, cerrar } = await crearContextoPrueba({ reloj: () => new Date("2026-10-05T15:00:00Z") })));
afterEach(async () => cerrar());

async function viajeCerrado(vehiculoId: number, fecha: string, flete: number, combustible: number) {
  const v = await registrarViajeFlota(ctx, { vehiculoId, origenLugar: "Juliaca", destinoLugar: "Arequipa", estado: "en_curso", fecha, origen: "web" });
  await registrarGasto(ctx, { viajeId: v.id, categoria: "combustible", monto: combustible, fecha, origen: "web" });
  await finalizarViajeFlota(ctx, { viajeId: v.id, km: 300, fecha, flete });
  return v.id;
}

describe("rentabilidad por viaje y por mes", () => {
  it("reparte el fijo de la unidad entre sus viajes y el general entre todos", async () => {
    const t2 = await crearUnidad(ctx, { placa: "XYZ-987" });
    await crearCostoFijo(ctx, { concepto: "Sueldo T-01", categoria: "sueldo_chofer", monto: 300000, periodicidad: "mensual", vehiculoId: 1, desde: "2026-09-01" });
    await crearCostoFijo(ctx, { concepto: "Contador", categoria: "contador", monto: 90000, periodicidad: "mensual", desde: "2026-09-01" });
    const a = await viajeCerrado(1, "2026-09-10", 500000, 150000);
    await viajeCerrado(1, "2026-09-20", 500000, 150000);
    await viajeCerrado(t2.id, "2026-09-22", 400000, 100000);
    const filas = await rentabilidadPorViaje(ctx, { desde: "2026-09-01", hasta: "2026-09-30" });
    expect(filas).toHaveLength(3);
    const fa = filas.find((f) => f.viajeId === a)!;
    // Fijo de T-01: 300,000 / 2 viajes = 150,000; general: 90,000 / 3 viajes = 30,000.
    expect(fa).toMatchObject({ flete: 500000, variables: 150000, contribucion: 350000, fijoAsignado: 180000, ganancia: 170000, margenPct: 34, provisional: false });
    expect((await rentabilidadDeViaje(ctx, a))!.ganancia).toBe(170000);
  });

  it("por mes: ingresos, variables, fijos y ganancia neta; el mes actual es provisional", async () => {
    await crearCostoFijo(ctx, { concepto: "GPS", categoria: "gps", monto: 10000, periodicidad: "mensual", vehiculoId: 1, desde: "2026-09-01" });
    await viajeCerrado(1, "2026-09-10", 500000, 150000);
    const meses = await rentabilidadPorMes(ctx, { desde: "2026-09-01", hasta: "2026-10-31" });
    expect(meses.map((m) => m.mes)).toEqual(["2026-09", "2026-10"]);
    expect(meses[0]).toMatchObject({ viajes: 1, ingresos: 500000, variables: 150000, contribucion: 350000, fijos: 10000, ganancia: 340000, provisional: false });
    expect(meses[0]!.fijosDetalle).toEqual([{ categoria: "gps", nombre: "GPS y monitoreo", monto: 10000 }]);
    expect(meses[1]!.provisional).toBe(true);
  });

  it("mes sin viajes: pérdida por los fijos y ninguna división entre cero", async () => {
    await crearCostoFijo(ctx, { concepto: "Leasing", categoria: "cuota_prestamo", monto: 800000, periodicidad: "mensual", vehiculoId: 1, desde: "2026-09-01" });
    const [sep] = await rentabilidadPorMes(ctx, { desde: "2026-09-01", hasta: "2026-09-30" });
    expect(sep).toMatchObject({ viajes: 0, ingresos: 0, fijos: 800000, ganancia: -800000, margenPct: null });
    expect(await rentabilidadPorViaje(ctx, { desde: "2026-09-01", hasta: "2026-09-30" })).toEqual([]);
  });

  it("por unidad: una fila por unidad y mes, y el general se reparte según sus viajes", async () => {
    const t2 = await crearUnidad(ctx, { placa: "XYZ-987" });
    await crearCostoFijo(ctx, { concepto: "Contador", categoria: "contador", monto: 90000, periodicidad: "mensual", desde: "2026-09-01" });
    await viajeCerrado(1, "2026-09-10", 500000, 150000);
    await viajeCerrado(1, "2026-09-11", 500000, 150000);
    await viajeCerrado(t2.id, "2026-09-12", 400000, 100000);
    const filas = await rentabilidadPorMes(ctx, { desde: "2026-09-01", hasta: "2026-09-30", porUnidad: true });
    expect(filas.every((f) => f.vehiculoId !== null)).toBe(true);
    expect(filas.find((f) => f.vehiculoId === 1)!.fijos).toBe(60000);
    expect(filas.find((f) => f.vehiculoId === t2.id)!.fijos).toBe(30000);
  });
});
