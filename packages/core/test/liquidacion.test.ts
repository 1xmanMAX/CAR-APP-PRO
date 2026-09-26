import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  finalizarViajeFlota, liquidacionDeUnidad, liquidacionViaje, registrarEntrega, registrarGasto, registrarViajeFlota, semaforo, type Contexto,
} from "../src/index";
import { crearContextoPrueba } from "./helpers";

let ctx: Contexto;
let cerrar: () => Promise<void>;
beforeEach(async () => ({ ctx, cerrar } = await crearContextoPrueba()));
afterEach(async () => cerrar());

const viajeJuliaca = (estado: "en_curso" | "cerrado" = "en_curso", flete?: number) =>
  registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Juliaca", destinoLugar: "Arequipa", estado, km: estado === "cerrado" ? 300 : undefined, flete, origen: "web" });
const gastar = (viajeId: number, categoria: "combustible" | "peaje" | "viaticos", monto: number) =>
  registrarGasto(ctx, { viajeId, categoria, monto, origen: "web" });

describe("liquidación del viaje", () => {
  it("semáforo en los bordes", () => {
    expect([semaforo(89_9, 1000), semaforo(900, 1000), semaforo(1000, 1000), semaforo(1001, 1000)]).toEqual(["ok", "alerta", "alerta", "excedido"]);
    expect([semaforo(0, 0), semaforo(1, 0)]).toEqual(["ok", "excedido"]);
  });

  it("entregado contra gastado: lo que le queda al chofer", async () => {
    const v = await viajeJuliaca();
    await registrarEntrega(ctx, { viajeId: v.id, monto: 100000, medio: "efectivo" });
    await registrarEntrega(ctx, { viajeId: v.id, monto: 20000, medio: "yape" });
    await gastar(v.id, "combustible", 50000);
    await gastar(v.id, "peaje", 8000);
    const l = await liquidacionViaje(ctx, v.id);
    expect([l.entregado, l.gastado, l.saldo]).toEqual([120000, 58000, 62000]);
    expect(l.presupuestoOrigen).toEqual({ tipo: "ninguno" });
    expect(l.semaforoTotal).toBe("sin_presupuesto");
    expect(l.lineas.map((x) => [x.categoria, x.real])).toEqual([["combustible", 50000], ["peaje", 8000]]);
  });

  it("sin presupuesto propio, compara con el promedio de los últimos viajes de la ruta y calcula la ganancia", async () => {
    for (const comb of [40000, 60000]) {
      const p = await viajeJuliaca("cerrado");
      await gastar(p.id, "combustible", comb);
      await gastar(p.id, "peaje", 8000);
    }
    const v = await viajeJuliaca("en_curso");
    await gastar(v.id, "combustible", 55000);
    await gastar(v.id, "viaticos", 3000);
    await finalizarViajeFlota(ctx, { viajeId: v.id, km: 300, flete: 150000 });
    const l = await liquidacionViaje(ctx, v.id);
    expect(l.presupuestoOrigen).toEqual({ tipo: "promedio", viajes: 2 });
    const comb = l.lineas.find((x) => x.categoria === "combustible")!;
    expect(comb).toMatchObject({ presupuesto: 50000, real: 55000, pct: 110, semaforo: "excedido" });
    expect(l.lineas.find((x) => x.categoria === "peaje")).toMatchObject({ presupuesto: 8000, real: 0, semaforo: "ok" });
    expect(l.lineas.find((x) => x.categoria === "viaticos")).toMatchObject({ presupuesto: 0, semaforo: "excedido" });
    expect([l.flete, l.ganancia, l.margenPct]).toEqual([150000, 92000, 61]);
    expect(l.saldo).toBe(-58000); // no se le entregó nada: la empresa le debe lo que gastó
  });

  it("la de la unidad es la del viaje en curso o la del último", async () => {
    expect(await liquidacionDeUnidad(ctx, 1)).toBeNull();
    const a = await viajeJuliaca("cerrado");
    expect((await liquidacionDeUnidad(ctx, 1))!.viaje.codigo).toBe(a.codigo);
    const b = await viajeJuliaca("en_curso");
    expect((await liquidacionDeUnidad(ctx, 1))!.viaje.codigo).toBe(b.codigo);
  });
});
