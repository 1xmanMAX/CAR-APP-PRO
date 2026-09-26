import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buscarUnidad, crearRepuesto, crearUnidad, finalizarViajeFlota, instalarParte, listarReparaciones, listarTiposParte,
  listarRepuestos, obtenerRepuesto, partesDeUnidad, registrarCambio, registrarCompra, registrarLecturaOdometro,
  registrarViajeFlota, tomarAlertasDesgaste, estadoPorZona, listarViajesFlota, resumenFinanciero, registrarGasto,
  saludFlota, listarUnidades, editarRepuesto, repuestosDePieza,
} from "../src";
import type { Contexto } from "../src/infra/contexto";
import { crearContextoPrueba } from "./helpers";

let ctx: Contexto;
let cerrar: () => Promise<void>;
let reloj = new Date("2026-09-13T15:00:00Z");

beforeEach(async () => {
  reloj = new Date("2026-09-13T15:00:00Z");
  ({ ctx, cerrar } = await crearContextoPrueba({ reloj: () => reloj }));
});
afterEach(async () => cerrar());

async function frenosEnT01(o: { km?: number; viajes?: number; fecha?: string } = {}) {
  const t01 = (await buscarUnidad(ctx, "T-01"))!;
  const tipos = await listarTiposParte(ctx);
  const frenos = tipos.find((t) => t.codigo === "frenos_sr")!;
  const aceite = tipos.find((t) => t.codigo === "aceite")!;
  await instalarParte(ctx, { vehiculoId: t01.id, tipoParteId: frenos.id, fecha: o.fecha ?? "2026-04-26", km: o.km ?? 0, viajes: o.viajes ?? 0 });
  await instalarParte(ctx, { vehiculoId: t01.id, tipoParteId: aceite.id, fecha: "2026-09-01", km: 0, viajes: 0 });
  return { t01, frenos, aceite };
}

describe("flota y desgaste", () => {
  it("el sembrado deja T-01 y el catálogo de partes", async () => {
    const unidades = await listarUnidades(ctx);
    expect(unidades.map((u) => u.codigo)).toEqual(["T-01"]);
    expect((await listarTiposParte(ctx)).length).toBeGreaterThanOrEqual(9);
  });

  it("un viaje de 1,290 km suma 1,290 km y 1 viaje a todas las partes de la unidad", async () => {
    const { t01 } = await frenosEnT01();
    const antes = await partesDeUnidad(ctx, t01.id);
    await registrarViajeFlota(ctx, { vehiculoId: t01.id, origenLugar: "Juliaca", destinoLugar: "Arequipa", km: 1290, toneladas: 30, origen: "web" });
    const despues = await partesDeUnidad(ctx, t01.id);
    for (const p of despues) {
      const a = antes.find((x) => x.id === p.id)!;
      expect(p.uso.km - a.uso.km).toBe(1290);
      expect(p.uso.viajes - a.uso.viajes).toBe(1);
    }
    expect((await buscarUnidad(ctx, "T-01"))!.odometroKm).toBe(1290);
  });

  it("criterio: 22/24 viajes, 46,800/60,000 km, 140/240 días → 92 %, y el cambio vuelve a 0 con stock, gasto y A TIEMPO", async () => {
    const t01 = (await buscarUnidad(ctx, "T-01"))!;
    const frenos = (await listarTiposParte(ctx)).find((t) => t.codigo === "frenos_sr")!;
    // 140 días antes del 2026-09-13 = 2026-04-26; odómetro 46,800 y 22 viajes desde la instalación.
    await registrarLecturaOdometro(ctx, { vehiculoId: t01.id, km: 10000, origen: "web" });
    await instalarParte(ctx, { vehiculoId: t01.id, tipoParteId: frenos.id, fecha: "2026-04-26", km: 10000, viajes: 0 });
    for (let k = 0; k < 22; k++) {
      await registrarViajeFlota(ctx, { vehiculoId: t01.id, origenLugar: "A", destinoLugar: "B", km: k < 20 ? 1840 : 0 || undefined, origen: "telegram", fecha: "2026-05-01" });
    }
    const odo = (await buscarUnidad(ctx, "T-01"))!.odometroKm;
    await registrarLecturaOdometro(ctx, { vehiculoId: t01.id, km: 10000 + 46800 > odo ? 56800 : odo, origen: "web" });
    const [p] = await partesDeUnidad(ctx, t01.id);
    expect(p!.uso).toEqual({ km: 46800, viajes: 22, dias: 140 });
    expect(p!.pct).toBe(92);
    expect(p!.estado).toBe("cambiar");
    expect(p!.manda).toBe("viajes");
    expect(p!.restanteTexto).toBe("2 VIAJES");
    expect(estadoPorZona([p!]).llantas_sr).toEqual({ pct: 92, estado: "cambiar" });

    const alertas = await tomarAlertasDesgaste(ctx);
    expect(alertas.map((a) => a.umbral)).toEqual([90]);
    expect(await tomarAlertasDesgaste(ctx)).toEqual([]);

    const repId = await crearRepuesto(ctx, { nombre: "Pastillas de freno", categoria: "Frenos", stockMinimo: 4, tipoParteId: frenos.id });
    await registrarCompra(ctx, { repuestoId: repId, cantidad: 10, costoUnitario: 18000, origen: "web" });
    const r = await registrarCambio(ctx, {
      vehiculoId: t01.id, parteInstaladaId: p!.id, tipo: "preventivo", repuestos: [{ repuestoId: repId, cantidad: 6 }],
      manoObra: 15000, taller: "Taller Juliaca", origen: "web",
    });
    expect(r.desgastePct).toBe(92);
    expect(r.etiqueta).toBe("A TIEMPO");
    expect(r.costoTotal).toBe(6 * 18000 + 15000);
    expect(r.stockBajo).toEqual([{ codigo: "REP-001", nombre: "Pastillas de freno", stock: 4 }]);
    expect((await obtenerRepuesto(ctx, repId)).stock).toBe(4);
    const [nueva] = await partesDeUnidad(ctx, t01.id);
    expect(nueva!.uso).toEqual({ km: 0, viajes: 0, dias: 0 });
    expect(nueva!.pct).toBe(0);
    const [hist] = await listarReparaciones(ctx);
    expect(hist!.desgastePct).toBe(92);
    const fin = await resumenFinanciero(ctx, "2026-09-01", "2026-09-30", t01.id);
    expect(fin.gastos).toBe(r.costoTotal);
    const inv = await listarRepuestos(ctx);
    expect(inv[0]!.instalado).toEqual([{ unidad: "T-01", posicion: "", parte: "FRENOS SEMIRREMOLQUE" }]);
    await expect(registrarCambio(ctx, { vehiculoId: t01.id, parteInstaladaId: p!.id, tipo: "preventivo", repuestos: [], manoObra: 100, origen: "web" }))
      .rejects.toThrow(/no está instalada/);
  });

  it("stock insuficiente no registra nada", async () => {
    const { t01 } = await frenosEnT01();
    const [p] = await partesDeUnidad(ctx, t01.id);
    const repId = await crearRepuesto(ctx, { nombre: "Pastillas", categoria: "Frenos" });
    await registrarCompra(ctx, { repuestoId: repId, cantidad: 2, costoUnitario: 100, origen: "web" });
    await expect(registrarCambio(ctx, { vehiculoId: t01.id, parteInstaladaId: p!.id, tipo: "correctivo", repuestos: [{ repuestoId: repId, cantidad: 3 }], origen: "web" }))
      .rejects.toThrow(/Stock insuficiente/);
    expect((await obtenerRepuesto(ctx, repId)).stock).toBe(2);
    expect((await partesDeUnidad(ctx, t01.id)).find((x) => x.id === p!.id)).toBeDefined();
  });

  it("viaje en curso: /viaje inicio y /fin con odómetro final; gasto va al viaje en curso", async () => {
    const t01 = (await buscarUnidad(ctx, "T-01"))!;
    await registrarLecturaOdometro(ctx, { vehiculoId: t01.id, km: 411090, origen: "web" }).catch(() => {});
    const u = await crearUnidad(ctx, { placa: "XYZ-987", marca: "Volvo", modelo: "FH 540", odometroKm: 100000, viajesBase: 10 });
    expect(u.codigo).toBe("T-02");
    expect(u.viajesTotales).toBe(10);
    const v = await registrarViajeFlota(ctx, { vehiculoId: u.id, origenLugar: "Juliaca", destinoLugar: "Arequipa", toneladas: 30, estado: "en_curso", origen: "telegram" });
    expect((await buscarUnidad(ctx, u.id))!.estado).toBe("en_ruta");
    await expect(registrarViajeFlota(ctx, { vehiculoId: u.id, origenLugar: "X", destinoLugar: "Y", estado: "en_curso", origen: "web" })).rejects.toThrow(/en curso/);
    const g = await registrarGasto(ctx, { categoria: "combustible", monto: 48000, vehiculoId: u.id, origen: "telegram" });
    expect(g.viajeCodigo).toBe(v.codigo);
    const fin = await finalizarViajeFlota(ctx, { viajeId: v.id, odometroFin: 101290, flete: 350000 });
    expect(fin.km).toBe(1290);
    const [fila] = await listarViajesFlota(ctx, { vehiculoId: u.id });
    expect(fila).toMatchObject({ km: 1290, flete: 350000, costo: 48000, margenPct: 86, factura: "SIN FACTURA", estado: "cerrado" });
    expect((await buscarUnidad(ctx, "t2"))!.estado).toBe("en_base");
    const salud = await saludFlota(ctx);
    expect(salud.length).toBe(2);
  });

  it("el odómetro no retrocede", async () => {
    const t01 = (await buscarUnidad(ctx, "T-01"))!;
    await registrarLecturaOdometro(ctx, { vehiculoId: t01.id, km: 5000, origen: "web" });
    await expect(registrarLecturaOdometro(ctx, { vehiculoId: t01.id, km: 4000, origen: "web" })).rejects.toThrow(/no puede ser menor/);
  });
});

describe("repuestos y piezas del modelo 3D", () => {
  it("sin elegir, un repuesto va donde va su tipo de parte; eligiendo, donde se diga", async () => {
    const { ctx, cerrar } = await crearContextoPrueba();
    try {
      const frenos = (await listarTiposParte(ctx)).find((t) => t.codigo === "frenos_sr")!;
      const pastillas = await crearRepuesto(ctx, { nombre: "Pastillas", categoria: "Frenos", tipoParteId: frenos.id });
      const espejo = await crearRepuesto(ctx, { nombre: "Luna de retrovisor", categoria: "Otros", piezas: ["retrovisor-izq", "retrovisor-der"] });
      await expect(crearRepuesto(ctx, { nombre: "X", categoria: "Otros", piezas: ["no-existe"] })).rejects.toThrow(/no existe/);
      let reps = await listarRepuestos(ctx);
      expect(reps.find((r) => r.id === pastillas)).toMatchObject({ piezas: ["freno-sr1", "freno-sr2", "freno-sr3"], piezasElegidas: false });
      expect(reps.find((r) => r.id === espejo)).toMatchObject({ piezas: ["retrovisor-izq", "retrovisor-der"], piezasElegidas: true });
      expect(repuestosDePieza(reps, "retrovisor-der").map((r) => r.id)).toEqual([espejo]);
      await editarRepuesto(ctx, pastillas, { piezas: ["freno-sr1"] });
      await editarRepuesto(ctx, espejo, { piezas: null });
      reps = await listarRepuestos(ctx);
      expect(reps.find((r) => r.id === pastillas)!.piezas).toEqual(["freno-sr1"]);
      expect(reps.find((r) => r.id === espejo)).toMatchObject({ piezas: [], piezasElegidas: false });
    } finally {
      await cerrar();
    }
  });
});
