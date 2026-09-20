import { afterEach, describe, expect, it } from "vitest";
import { actualizarPlantilla, buscarRuta, crearRuta, desactivarRuta, listarRutas, obtenerRuta } from "../src/viajes/rutas";
import { crearContextoPrueba } from "./helpers";

const cerrables: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cerrables.length) await cerrables.pop()!();
});

async function contexto(o: Parameters<typeof crearContextoPrueba>[0] = {}) {
  const r = await crearContextoPrueba(o);
  cerrables.push(r.cerrar);
  return r.ctx;
}

describe("rutas", () => {
  it("crea una ruta con su plantilla y la lee de vuelta", async () => {
    const ctx = await contexto();
    const plantilla = [
      { categoria: "combustible" as const, monto: 50000 },
      { categoria: "peaje" as const, monto: 3000 },
    ];
    const id = await crearRuta(ctx, "Arequipa ⇄ Puno", plantilla);
    const ruta = await obtenerRuta(ctx, id);
    expect(ruta).toEqual({ id, nombre: "Arequipa ⇄ Puno", activa: true, plantilla });
  });

  it("rechaza un nombre duplicado sin importar tildes, mayúsculas o espacios", async () => {
    const ctx = await contexto();
    await crearRuta(ctx, "Arequipa ⇄ Puno", []);
    await expect(crearRuta(ctx, "  arequipa   ⇄  PUNO ", [])).rejects.toThrow("Ya existe una ruta con ese nombre");
  });

  it("rechaza montos negativos al crear", async () => {
    const ctx = await contexto();
    await expect(crearRuta(ctx, "Tacna ⇄ Moquegua", [{ categoria: "combustible", monto: -1 }]))
      .rejects.toThrow("El monto del presupuesto no puede ser negativo");
  });

  it("obtenerRuta lanza ErrorNegocio si no existe", async () => {
    const ctx = await contexto();
    await expect(obtenerRuta(ctx, 9999)).rejects.toThrow();
  });

  it("actualizarPlantilla reemplaza la plantilla completa, no acumula", async () => {
    const ctx = await contexto();
    const id = await crearRuta(ctx, "Cusco ⇄ Puno", [{ categoria: "combustible", monto: 40000 }]);
    await actualizarPlantilla(ctx, id, [
      { categoria: "peaje", monto: 2000 },
      { categoria: "viaticos", monto: 15000 },
    ]);
    const ruta = await obtenerRuta(ctx, id);
    expect(ruta.plantilla).toEqual([
      { categoria: "peaje", monto: 2000 },
      { categoria: "viaticos", monto: 15000 },
    ]);
  });

  it("actualizarPlantilla rechaza montos negativos y no deja nada a medias", async () => {
    const ctx = await contexto();
    const id = await crearRuta(ctx, "Lima ⇄ Ica", [{ categoria: "combustible", monto: 40000 }]);
    await expect(actualizarPlantilla(ctx, id, [{ categoria: "peaje", monto: -5 }])).rejects.toThrow(
      "El monto del presupuesto no puede ser negativo",
    );
    const ruta = await obtenerRuta(ctx, id);
    expect(ruta.plantilla).toEqual([{ categoria: "combustible", monto: 40000 }]);
  });

  it("desactivarRuta la excluye de listarRutas por defecto", async () => {
    const ctx = await contexto();
    const id = await crearRuta(ctx, "Ica ⇄ Nazca", []);
    await desactivarRuta(ctx, id);
    expect(await listarRutas(ctx)).toEqual([]);
    const conInactivas = await listarRutas(ctx, true);
    expect(conInactivas).toHaveLength(1);
    expect(conInactivas[0]!.activa).toBe(false);
  });

  it("buscarRuta encuentra por texto normalizado y no devuelve inactivas", async () => {
    const ctx = await contexto();
    const id1 = await crearRuta(ctx, "Arequipa ⇄ Puno", []);
    await crearRuta(ctx, "Lima ⇄ Ica", []);
    const idInactiva = await crearRuta(ctx, "Puno ⇄ Juliaca", []);
    await desactivarRuta(ctx, idInactiva);

    const resultado = await buscarRuta(ctx, "puno");
    expect(resultado.map((r) => r.id)).toEqual([id1]);
  });

  it("buscarRuta encuentra una ruta con tildes escribiendo el texto sin tildes", async () => {
    const ctx = await contexto();
    const id = await crearRuta(ctx, "Puno ⇄ Ácora", []);
    const resultado = await buscarRuta(ctx, "acora");
    expect(resultado.map((r) => r.id)).toEqual([id]);
  });

  it("dos creaciones concurrentes con el mismo nombre normalizado dejan solo una ruta", async () => {
    const ctx = await contexto();
    const resultados = await Promise.allSettled([
      crearRuta(ctx, "Arequipa ⇄ Puno", []),
      crearRuta(ctx, "AREQUIPA ⇄ PUNO", []),
    ]);
    const cumplidas = resultados.filter((r) => r.status === "fulfilled");
    const rechazadas = resultados.filter((r) => r.status === "rejected");
    expect(cumplidas).toHaveLength(1);
    expect(rechazadas).toHaveLength(1);
    expect((rechazadas[0] as PromiseRejectedResult).reason.message).toBe("Ya existe una ruta con ese nombre");
    expect(await listarRutas(ctx, true)).toHaveLength(1);
  });
});
