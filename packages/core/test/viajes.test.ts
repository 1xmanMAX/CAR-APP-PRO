import { entrega, eq, viajePresupuesto } from "@sunatapp/db";
import { afterEach, describe, expect, it } from "vitest";
import { registrarGuiaBorrador } from "../src/guias/registrar";
import { crearRuta } from "../src/viajes/rutas";
import {
  actualizarPresupuestoViaje, buscarViajePorCodigo, cerrarViaje, crearViaje, desenlazarGuia, enlazarGuia,
  enlazarGuiaAlViajeEnCurso, listarViajes, obtenerViaje, reabrirViaje, viajeEnCurso,
} from "../src/viajes/viajes";
import { crearContextoPrueba, entradaGuia } from "./helpers";

const cerrables: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cerrables.length) await cerrables.pop()!();
});

async function contexto(o: Parameters<typeof crearContextoPrueba>[0] = {}) {
  const r = await crearContextoPrueba(o);
  cerrables.push(r.cerrar);
  return r.ctx;
}

const plantillaDemo = [
  { categoria: "combustible" as const, monto: 30000 },
  { categoria: "peaje" as const, monto: 5000 },
];

describe("viajes", () => {
  it("crea con los habituales, copia la plantilla de la ruta y registra el adelanto", async () => {
    const ctx = await contexto();
    const rutaId = await crearRuta(ctx, "Lima - Pucallpa", plantillaDemo);
    const { id, codigo } = await crearViaje(ctx, { rutaId, adelantoCentimos: 50000, medioAdelanto: "efectivo" });
    expect(codigo).toBe("VJ-0001");
    const v = await obtenerViaje(ctx, id);
    expect(v).toMatchObject({ id, codigo: "VJ-0001", rutaId, estado: "en_curso", fechaSalida: "2026-09-13", fechaRegreso: null });
    expect(v.vehiculoId).toBeTypeOf("number");
    expect(v.conductorId).toBeTypeOf("number");

    const presupuesto = await ctx.db.select().from(viajePresupuesto).where(eq(viajePresupuesto.viajeId, id));
    const filas = presupuesto.map((p) => ({ categoria: p.categoria, monto: p.monto })).sort((a, b) => a.categoria.localeCompare(b.categoria));
    expect(filas).toEqual([...plantillaDemo].sort((a, b) => a.categoria.localeCompare(b.categoria)));

    const entregas = await ctx.db.select().from(entrega).where(eq(entrega.viajeId, id));
    expect(entregas).toHaveLength(1);
    expect(entregas[0]).toMatchObject({ viajeId: id, monto: 50000, medio: "efectivo", fecha: "2026-09-13" });
  });

  it("un segundo viaje en curso para el mismo tracto falla con el código del viaje vigente", async () => {
    const ctx = await contexto();
    await crearViaje(ctx, {});
    await expect(crearViaje(ctx, {})).rejects.toThrow("El tracto ABC-123 ya tiene el viaje VJ-0001 en curso");
  });

  it("viajeEnCurso", async () => {
    const ctx = await contexto();
    expect(await viajeEnCurso(ctx)).toBeNull();
    const { id } = await crearViaje(ctx, {});
    const v = await viajeEnCurso(ctx);
    expect(v?.id).toBe(id);
    const vPorVehiculo = await viajeEnCurso(ctx, v!.vehiculoId);
    expect(vPorVehiculo?.id).toBe(id);
  });

  it("enlazarGuiaAlViajeEnCurso asigna ida y luego retorno, y null al tercer intento", async () => {
    const ctx = await contexto();
    await crearViaje(ctx, {});
    const viaje = await viajeEnCurso(ctx);
    const g1 = await registrarGuiaBorrador(ctx, entradaGuia());
    const g2 = await registrarGuiaBorrador(ctx, entradaGuia());
    const g3 = await registrarGuiaBorrador(ctx, entradaGuia());
    expect(await enlazarGuiaAlViajeEnCurso(ctx, g1)).toEqual({ viajeId: viaje!.id, tramo: "ida" });
    expect(await enlazarGuiaAlViajeEnCurso(ctx, g2)).toEqual({ viajeId: viaje!.id, tramo: "retorno" });
    expect(await enlazarGuiaAlViajeEnCurso(ctx, g3)).toBeNull();
  });

  it("enlazarGuia falla si el tramo ya está ocupado o la guía está en otro viaje", async () => {
    const ctx = await contexto();
    const { id: viajeId1 } = await crearViaje(ctx, {});
    await cerrarViaje(ctx, viajeId1);
    const { id: viajeId2 } = await crearViaje(ctx, {});
    const g1 = await registrarGuiaBorrador(ctx, entradaGuia());
    const g2 = await registrarGuiaBorrador(ctx, entradaGuia());
    await enlazarGuia(ctx, g1, viajeId2, "ida");
    await expect(enlazarGuia(ctx, g2, viajeId2, "ida")).rejects.toThrow("El viaje ya tiene una guía en el tramo ida");
    await enlazarGuia(ctx, g2, viajeId1, "ida");
    await expect(enlazarGuia(ctx, g2, viajeId2, "retorno")).rejects.toThrow("La guía ya está en otro viaje");
    await desenlazarGuia(ctx, g2);
    await enlazarGuia(ctx, g2, viajeId2, "retorno");
  });

  it("cerrarViaje rechaza una fecha de regreso anterior a la salida", async () => {
    const ctx = await contexto();
    const { id } = await crearViaje(ctx, { fechaSalida: "2026-09-13" });
    await expect(cerrarViaje(ctx, id, "2026-09-10")).rejects.toThrow("La fecha de regreso no puede ser anterior a la fecha de salida");
  });

  it("cierra y reabre", async () => {
    const ctx = await contexto();
    const { id } = await crearViaje(ctx, {});
    await cerrarViaje(ctx, id, "2026-09-15");
    let v = await obtenerViaje(ctx, id);
    expect(v.estado).toBe("cerrado");
    expect(v.fechaRegreso).toBe("2026-09-15");
    await expect(cerrarViaje(ctx, id)).rejects.toThrow("El viaje no está en curso");

    await reabrirViaje(ctx, id);
    v = await obtenerViaje(ctx, id);
    expect(v.estado).toBe("en_curso");
    expect(v.fechaRegreso).toBeNull();
  });

  it("reabrirViaje falla si el vehículo ya tiene otro viaje en curso", async () => {
    const ctx = await contexto();
    const { id: id1 } = await crearViaje(ctx, {});
    await cerrarViaje(ctx, id1);
    const { id: id2, codigo: codigo2 } = await crearViaje(ctx, {});
    await expect(reabrirViaje(ctx, id1)).rejects.toThrow(`El tracto ABC-123 ya tiene el viaje ${codigo2} en curso`);
    expect(id2).toBeTypeOf("number");
  });

  it("buscarViajePorCodigo entiende 'vj-3' y 'VJ-0003'", async () => {
    const ctx = await contexto();
    const { id: id1 } = await crearViaje(ctx, {});
    await cerrarViaje(ctx, id1);
    const { id: id2 } = await crearViaje(ctx, {});
    await cerrarViaje(ctx, id2);
    const { id: id3 } = await crearViaje(ctx, {});
    expect((await buscarViajePorCodigo(ctx, "vj-3"))?.id).toBe(id3);
    expect((await buscarViajePorCodigo(ctx, "VJ-0003"))?.id).toBe(id3);
    expect(await buscarViajePorCodigo(ctx, "vj-9")).toBeNull();
  });

  it("listarViajes filtra por mes según fechaSalida", async () => {
    const ctx = await contexto();
    const { id: id1 } = await crearViaje(ctx, { fechaSalida: "2026-08-20" });
    await cerrarViaje(ctx, id1);
    const { id: id2 } = await crearViaje(ctx, { fechaSalida: "2026-09-05" });
    await cerrarViaje(ctx, id2);
    const { id: id3 } = await crearViaje(ctx, { fechaSalida: "2026-09-30" });
    const deSeptiembre = await listarViajes(ctx, { mes: "2026-09" });
    expect(deSeptiembre.map((v) => v.id).sort()).toEqual([id2, id3].sort());
  });

  it("actualizarPresupuestoViaje reemplaza la plantilla del viaje", async () => {
    const ctx = await contexto();
    const { id } = await crearViaje(ctx, {});
    await actualizarPresupuestoViaje(ctx, id, [{ categoria: "hospedaje", monto: 8000 }]);
    const filas = await ctx.db.query.viajePresupuesto.findMany({ where: (t, { eq }) => eq(t.viajeId, id) });
    expect(filas.map((f) => ({ categoria: f.categoria, monto: f.monto }))).toEqual([{ categoria: "hospedaje", monto: 8000 }]);
  });
});
