import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { categoriaDesdeTexto, crearCategoria, desactivarCategoria, listarCategorias, nombreCategoria, registrarGasto, type Contexto } from "../src/index";
import { crearContextoPrueba } from "./helpers";

let ctx: Contexto;
let cerrar: () => Promise<void>;
beforeEach(async () => ({ ctx, cerrar } = await crearContextoPrueba()));
afterEach(async () => cerrar());

describe("categorías de gasto", () => {
  it("lista las de fábrica por orden y filtra por tipo", async () => {
    const todas = await listarCategorias(ctx);
    expect(todas[0]!.clave).toBe("combustible");
    expect(todas).toHaveLength(27);
    expect((await listarCategorias(ctx, { tipo: "fijo" })).every((c) => c.tipo === "fijo")).toBe(true);
  });

  it("crea una propia con clave desde el nombre, sin repetir", async () => {
    const clave = await crearCategoria(ctx, { nombre: "Guardianía de carga", tipo: "variable" });
    expect(clave).toBe("guardiania_de_carga");
    await expect(crearCategoria(ctx, { nombre: "Guardianía de carga", tipo: "fijo" })).rejects.toThrow(/ya existe/);
    const c = (await listarCategorias(ctx)).find((x) => x.clave === clave)!;
    expect(c).toMatchObject({ sistema: false, tipo: "variable", nombre: "Guardianía de carga" });
    expect(nombreCategoria(clave, [c])).toBe("Guardianía de carga");
    expect(nombreCategoria("sueldo_chofer")).toBe("Sueldo del chofer");
  });

  it("una desactivada no se ofrece ni acepta gastos nuevos", async () => {
    const clave = await crearCategoria(ctx, { nombre: "Propinas", tipo: "variable" });
    await desactivarCategoria(ctx, clave);
    expect((await listarCategorias(ctx, { soloActivas: true })).some((c) => c.clave === clave)).toBe(false);
    await expect(registrarGasto(ctx, { categoria: clave, monto: 1000, origen: "web" })).rejects.toThrow(/no está activa/);
  });

  it("entiende sinónimos del rubro", () => {
    expect(categoriaDesdeTexto("grifo")).toBe("combustible");
    expect(categoriaDesdeTexto("vulcanizado")).toBe("llantas_ruta");
    expect(categoriaDesdeTexto("mecanico")).toBe("reparacion_ruta");
    expect(categoriaDesdeTexto("papeleta")).toBe("multas");
    expect(categoriaDesdeTexto("xyz")).toBeNull();
  });
});
