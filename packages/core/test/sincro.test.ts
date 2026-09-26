import { createServer, connect, type AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  buscarUnidad, crearGrupo, crearRepuesto, crearUnidad, identidad, instalarParte, listarTiposParte, listarViajesFlota,
  obtenerRepuesto, partesDeUnidad, planificar, registrarCompra, registrarGasto, registrarLecturaOdometro, registrarViajeFlota,
  responder, sincronizarCon, unirseAGrupo, codigoDispositivo, borrarGasto, editarViajeFlota, inventario, registrarCambio,
  listarReparaciones, resumenFinanciero, rangoMes, guardarPresupuestoMensual, presupuestoMensual,
} from "../src";
import type { Contexto } from "../src/infra/contexto";
import { crearContextoPrueba } from "./helpers";

const cerrables: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cerrables.length) await cerrables.pop()!();
});

async function dispositivo(): Promise<Contexto> {
  const { ctx, cerrar } = await crearContextoPrueba({ reloj: () => new Date() });
  cerrables.push(cerrar);
  return ctx;
}

/** Levanta al que responde en un puerto y conecta al que dirige. */
async function sincronizar(dirige: Contexto, responde: Contexto) {
  const servidor = createServer((s) => void responder(responde, s).catch(() => s.destroy()));
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  const { port } = servidor.address() as AddressInfo;
  try {
    const s = connect(port, "127.0.0.1");
    await new Promise<void>((r) => s.once("connect", r));
    return await sincronizarCon(dirige, s);
  } finally {
    servidor.close();
  }
}

async function grupo(a: Contexto, b: Contexto) {
  const codigo = await crearGrupo(a);
  await unirseAGrupo(b, codigo);
}

describe("planificar (como PixPin Diferencia.plan)", () => {
  const ap = (c: string, h: string, b = false) => ({ c, cr: 0, k: 0, h, b });
  it("trae lo que falta, manda lo mío, junta lo cambiado en los dos", () => {
    const base = new Map([["x/1", "h0"], ["x/2", "h0"], ["x/3", "h0"], ["x/4", "h0"]]);
    const pasos = planificar(
      [ap("x/1", "h0"), ap("x/2", "hA"), ap("x/3", "hA"), ap("x/4", "", true), ap("x/5", "n")],
      [ap("x/1", "hB"), ap("x/2", "h0"), ap("x/3", "hB"), ap("x/4", "h0"), ap("x/6", "m")],
      base,
    );
    expect(pasos).toEqual([
      { tipo: "traer", c: "x/1" }, { tipo: "mandar", c: "x/2" }, { tipo: "fusionar", c: "x/3" },
      { tipo: "mandar", c: "x/4" }, { tipo: "mandar", c: "x/5" }, { tipo: "traer", c: "x/6" },
    ]);
  });
  it("borrado contra cambiado: se queda lo cambiado", () => {
    const pasos = planificar([{ c: "x/1", cr: 0, k: 0, h: "", b: true }], [{ c: "x/1", cr: 0, k: 0, h: "hB" }], new Map([["x/1", "h0"]]));
    expect(pasos).toEqual([{ tipo: "traer", c: "x/1" }]);
  });
});

describe("sincronizar dos dispositivos por la red local", () => {
  it("misma base inicial, cambios distintos en cada uno → los dos quedan con todo, sin duplicar", async () => {
    const a = await dispositivo();
    const b = await dispositivo();
    await grupo(a, b);
    // Los dos sembraron lo mismo: la empresa, T-01 y el catálogo tienen el mismo código en los dos.
    const invA0 = await inventario(a.db);
    const invB0 = await inventario(b.db);
    const comunes = invA0.filter((x) => invB0.some((y) => y.c === x.c));
    expect(comunes.length).toBeGreaterThanOrEqual(10);

    const t01a = (await buscarUnidad(a, "T-01"))!;
    const t01b = (await buscarUnidad(b, "T-01"))!;
    // A: un viaje con gasto. B: otra unidad, una compra de repuesto y una lectura de odómetro.
    const v = await registrarViajeFlota(a, { vehiculoId: t01a.id, origenLugar: "Juliaca", destinoLugar: "Arequipa", km: 1290, flete: 350000, origen: "web" });
    await registrarGasto(a, { categoria: "combustible", monto: 48000, viajeId: v.id, origen: "telegram" });
    await crearUnidad(b, { placa: "XYZ-987", marca: "Volvo" });
    const rep = await crearRepuesto(b, { nombre: "Pastillas", categoria: "Frenos" });
    await registrarCompra(b, { repuestoId: rep, cantidad: 10, costoUnitario: 18000, origen: "web" });
    await registrarLecturaOdometro(b, { vehiculoId: t01b.id, km: 5000, origen: "telegram" });
    await guardarPresupuestoMensual(b, { combustible: 3200000 });

    const r = await sincronizar(a, b);
    expect(r.traidas).toBeGreaterThan(0);
    expect(r.mandadas).toBeGreaterThan(0);

    for (const x of [a, b]) {
      const viajes = await listarViajesFlota(x);
      expect(viajes).toHaveLength(1);
      expect(viajes[0]).toMatchObject({ km: 1290, flete: 350000, costo: 48000, unidad: "T-01" });
      expect((await buscarUnidad(x, "XYZ-987"))?.codigo).toBe("T-02");
      // El odómetro es el mayor: 1290 del viaje en A, 5000 leídos en B.
      expect((await buscarUnidad(x, "T-01"))!.odometroKm).toBe(5000);
      expect(await presupuestoMensual(x)).toEqual({ combustible: 3200000 });
    }
    const repA = (await obtenerRepuesto(a, (await obtenerRepuestoPorNombre(a, "Pastillas"))!)).stock;
    expect(repA).toBe(10);
    // Una segunda vuelta no manda nada: ya son iguales.
    const r2 = await sincronizar(b, a);
    expect(r2.traidas + r2.mandadas + r2.fusionadas + r2.borradas).toBe(0);
    const invA = await inventario(a.db);
    const invB = await inventario(b.db);
    expect(new Map(invA.map((x) => [x.c, x.h]))).toEqual(new Map(invB.map((x) => [x.c, x.h])));
  });

  it("el mismo registro cambiado en los dos se junta campo por campo; lo borrado se borra en los dos", async () => {
    const a = await dispositivo();
    const b = await dispositivo();
    await grupo(a, b);
    const t01 = (await buscarUnidad(a, "T-01"))!;
    const v = await registrarViajeFlota(a, { vehiculoId: t01.id, origenLugar: "Puno", destinoLugar: "Lima", km: 3050, origen: "web" });
    const g = await registrarGasto(a, { categoria: "peaje", monto: 3500, viajeId: v.id, origen: "web" });
    await sincronizar(a, b);
    // A corrige el flete; B corrige las toneladas del mismo viaje. B borra el peaje.
    await editarViajeFlota(a, v.id, { flete: 980000 });
    const vb = (await listarViajesFlota(b))[0]!;
    await editarViajeFlota(b, vb.id, { toneladas: 28 });
    const gb = (await b.db.execute(`select id from gasto` as never) as unknown as { rows: Array<{ id: number }> }).rows[0]!;
    await borrarGasto(b, gb.id);
    const r = await sincronizar(b, a);
    expect(r.fusionadas).toBe(1);
    for (const x of [a, b]) {
      const [vj] = await listarViajesFlota(x);
      expect(vj).toMatchObject({ flete: 980000, toneladas: 28, costo: 0 });
    }
    void g;
  });

  it("un cambio de parte hecho en otro celular reinicia el contador aquí y el stock baja en los dos", async () => {
    const a = await dispositivo();
    const b = await dispositivo();
    await grupo(a, b);
    const t01 = (await buscarUnidad(a, "T-01"))!;
    const frenos = (await listarTiposParte(a)).find((t) => t.codigo === "frenos_sr")!;
    await instalarParte(a, { vehiculoId: t01.id, tipoParteId: frenos.id, fecha: "2026-01-01" });
    const rep = await crearRepuesto(a, { nombre: "Pastillas", categoria: "Frenos", tipoParteId: frenos.id });
    await registrarCompra(a, { repuestoId: rep, cantidad: 10, costoUnitario: 18000, origen: "web" });
    await sincronizar(a, b);
    // En B (el celular del taller) se registra el cambio.
    const pb = (await partesDeUnidad(b, (await buscarUnidad(b, "T-01"))!.id))[0]!;
    const repB = (await obtenerRepuestoPorNombre(b, "Pastillas"))!;
    await registrarCambio(b, { vehiculoId: pb.vehiculoId, parteInstaladaId: pb.id, tipo: "preventivo", repuestos: [{ repuestoId: repB, cantidad: 6 }], manoObra: 15000, origen: "telegram" });
    // Mientras, en A se compraron 5 más.
    await registrarCompra(a, { repuestoId: rep, cantidad: 5, costoUnitario: 18000, origen: "web" });
    await sincronizar(a, b);
    for (const x of [a, b]) {
      const [p] = await partesDeUnidad(x, (await buscarUnidad(x, "T-01"))!.id);
      expect(p!.uso.dias).toBe(0);
      expect((await obtenerRepuesto(x, (await obtenerRepuestoPorNombre(x, "Pastillas"))!)).stock).toBe(10 + 5 - 6);
      expect((await listarReparaciones(x))).toHaveLength(1);
      const { desde, hasta } = rangoMes(new Date().toISOString().slice(0, 10));
      expect((await resumenFinanciero(x, desde, hasta)).gastos).toBe(6 * 18000 + 15000);
    }
  });

  it("códigos repetidos creados a la vez (dos T-02 distintos) se renumeran, no se mezclan", async () => {
    const a = await dispositivo();
    const b = await dispositivo();
    await grupo(a, b);
    await crearUnidad(a, { placa: "AAA-111" });
    await crearUnidad(b, { placa: "BBB-222" });
    const r = await sincronizar(a, b);
    expect(r.avisos.join(" ")).toMatch(/T-02/);
    const r2 = await sincronizar(b, a);
    expect(r2.traidas + r2.mandadas + r2.fusionadas).toBe(0);
    for (const x of [a, b]) {
      expect((await buscarUnidad(x, "AAA-111"))!.codigo).not.toBe((await buscarUnidad(x, "BBB-222"))!.codigo);
    }
    expect((await buscarUnidad(a, "AAA-111"))!.codigo).toBe((await buscarUnidad(b, "AAA-111"))!.codigo);
  });

  it("con otro código de grupo no se sincroniza nada", async () => {
    const a = await dispositivo();
    const b = await dispositivo();
    await crearGrupo(a);
    await crearGrupo(b);
    await expect(sincronizar(a, b)).rejects.toThrow();
  });

  it("cada cosa lleva su código de dispositivo y su número", async () => {
    const a = await dispositivo();
    const i = await identidad(a);
    const t01 = (await buscarUnidad(a, "T-01"))!;
    await registrarViajeFlota(a, { vehiculoId: t01.id, origenLugar: "A", destinoLugar: "B", origen: "web" });
    const r = (await a.db.execute(`select sinc_uid, sinc_disp, sinc_num, sinc_creado from viaje` as never) as unknown as { rows: Array<Record<string, unknown>> }).rows[0]!;
    expect(r.sinc_disp).toBe(codigoDispositivo(i.yo.id));
    expect(Number(r.sinc_num)).toBeGreaterThan(0);
    expect(String(r.sinc_uid)).toHaveLength(32);
  });
});

async function obtenerRepuestoPorNombre(ctx: Contexto, nombre: string): Promise<number | null> {
  const r = (await ctx.db.execute(`select id from repuesto where nombre = '${nombre}'` as never) as unknown as { rows: Array<{ id: number }> }).rows[0];
  return r?.id ?? null;
}

describe("red local", () => {
  it("dos dispositivos se encuentran por difusión y sincronizan por TCP", async () => {
    const { RedSinc } = await import("../src");
    const a = await dispositivo();
    const b = await dispositivo();
    await grupo(a, b);
    const ra = new RedSinc(a);
    const rb = new RedSinc(b);
    await ra.iniciar(0);
    await rb.iniciar(0);
    try {
      // La difusión puede no estar permitida en el entorno de pruebas: se espera un poco y, si no
      // llega, se sigue con la dirección a mano (como en la pantalla).
      for (let i = 0; i < 20 && !ra.cerca().length; i++) await new Promise((r) => setTimeout(r, 250));
      const destino = ra.cerca()[0] ? `${ra.cerca()[0]!.direccion}:${ra.cerca()[0]!.puerto}` : `127.0.0.1:${rb.puerto}`;
      await crearUnidad(b, { placa: "QWE-555" });
      const r = await ra.sincronizar(destino);
      expect(r.par.nombre).toBeTruthy();
      expect(await buscarUnidad(a, "QWE-555")).not.toBeNull();
      expect(ra.estado.ultimo?.ok).toBe(true);
      await expect(ra.sincronizar("127.0.0.1:1")).rejects.toThrow(/no acepta|conexión|ECONN/);
    } finally {
      ra.detener();
      rb.detener();
    }
  });
});
