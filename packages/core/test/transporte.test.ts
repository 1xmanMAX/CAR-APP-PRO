import { conductor, eq } from "@sunatapp/db";
import { afterEach, describe, expect, it } from "vitest";
import { cargarGuiaCompleta } from "../src/guias/cargar";
import { registrarGuiaBorrador } from "../src/guias/registrar";
import { compararTransporte, registrarConductor, registrarVehiculo, transporteHabitual } from "../src/transporte/transporte";
import { crearContextoPrueba, entradaGuia } from "./helpers";

const conductorDemo = { numeroDoc: "45288569", nombres: "JHON LARRY", apellidos: "VELEZMORO SOZA", licencia: "Q45288569" };

const cerrables: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cerrables.length) await cerrables.pop()!();
});

async function contexto(o: Parameters<typeof crearContextoPrueba>[0] = {}) {
  const r = await crearContextoPrueba(o);
  cerrables.push(r.cerrar);
  return r.ctx;
}

describe("transporte", () => {
  it("compara contra lo registrado sin importar guiones ni mayúsculas", async () => {
    const ctx = await contexto();
    const t = { rucTransportista: "20606433094", placaPrincipal: "abc123", placasSecundarias: ["XYZ-987"], conductor: conductorDemo };
    expect(await compararTransporte(ctx, t)).toEqual({
      rucEmpresaCoincide: true, placaPrincipal: "registrada",
      placasSecundarias: [{ placa: "XYZ-987", estado: "nueva" }], conductor: "registrado",
    });
  });

  it("registrarVehiculo y registrarConductor no duplican", async () => {
    const ctx = await contexto();
    const a = await registrarVehiculo(ctx, "XYZ-987");
    expect(await registrarVehiculo(ctx, "xyz987")).toBe(a);
    const d = { numeroDoc: "01320429", nombres: "MARIO", apellidos: "MAMANI MAMANI", licencia: "U01320429" };
    const c = await registrarConductor(ctx, d);
    expect(await registrarConductor(ctx, d)).toBe(c);
  });

  it("dos registrarConductor concurrentes para el mismo DNI devuelven el mismo id y dejan una sola fila", async () => {
    const ctx = await contexto();
    const d = { numeroDoc: "01320429", nombres: "MARIO", apellidos: "MAMANI MAMANI", licencia: "U01320429" };
    const [a, b] = await Promise.all([registrarConductor(ctx, d), registrarConductor(ctx, d)]);
    expect(a).toBe(b);
    const filas = await ctx.db.select().from(conductor).where(eq(conductor.numeroDoc, d.numeroDoc));
    expect(filas).toHaveLength(1);
  });

  it("registrarGuiaBorrador usa las placas y el conductor de la entrada", async () => {
    const ctx = await contexto();
    await registrarVehiculo(ctx, "XYZ-987");
    const id = await registrarGuiaBorrador(ctx, { ...entradaGuia(), transporte: {
      rucTransportista: "20606433094", placaPrincipal: "ABC-123", placasSecundarias: ["XYZ-987"], conductor: conductorDemo } });
    const d = await cargarGuiaCompleta(ctx.db, id);
    expect(d.vehiculoSecundario?.placa).toBe("XYZ-987");
  });

  it("rechaza placas no registradas y un RUC de transportista ajeno", async () => {
    const ctx = await contexto();
    const base = { rucTransportista: "20606433094", placaPrincipal: "ABC-123", placasSecundarias: [], conductor: conductorDemo };
    await expect(registrarGuiaBorrador(ctx, { ...entradaGuia(), transporte: { ...base, placaPrincipal: "QQQ-111" } }))
      .rejects.toThrow("La placa QQQ-111 no está registrada");
    await expect(registrarGuiaBorrador(ctx, { ...entradaGuia(), transporte: { ...base, rucTransportista: "20131312955" } }))
      .rejects.toThrow("El transportista de la guía no es la empresa");
  });

  it("transporteHabitual devuelve lo registrado", async () => {
    const ctx = await contexto();
    expect(await transporteHabitual(ctx)).toEqual({ rucTransportista: "20606433094", placaPrincipal: "ABC-123", placasSecundarias: [], conductor: conductorDemo });
  });
});
