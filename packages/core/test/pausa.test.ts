import { afterEach, describe, expect, it } from "vitest";
import { tomarAvisos } from "../src/eventos/eventos";
import { esPrimeraReal, leerPausaSunat, marcarPrimeraRealHecha, pausarSunat, reanudarSunat } from "../src/sunat/pausa";
import { crearContextoPrueba } from "./helpers";

const cerrables: Array<() => Promise<void>> = [];
afterEach(async () => { while (cerrables.length) await cerrables.pop()!(); });

async function ctxPrueba() {
  const r = await crearContextoPrueba();
  cerrables.push(r.cerrar);
  return r.ctx;
}

describe("pausa de SUNAT", () => {
  it("pausa una vez, avisa una vez y se reanuda", async () => {
    const ctx = await ctxPrueba();
    expect(await leerPausaSunat(ctx)).toBeNull();
    expect(await pausarSunat(ctx, "clave SOL rechazada")).toBe(true);
    expect(await pausarSunat(ctx, "otra vez")).toBe(false);
    expect(await leerPausaSunat(ctx)).toMatchObject({ motivo: "clave SOL rechazada" });
    const avisos = await tomarAvisos(ctx);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.texto).toContain("SUNAT en pausa");
    await reanudarSunat(ctx);
    expect(await leerPausaSunat(ctx)).toBeNull();
  });

  it("primera emisión real: solo en modo real y hasta marcarla", async () => {
    const ctx = await ctxPrueba();
    expect(await esPrimeraReal(ctx, "guia")).toBe(false); // simulado
    ctx.simulado = false;
    expect(await esPrimeraReal(ctx, "guia")).toBe(true);
    await marcarPrimeraRealHecha(ctx, "guia");
    expect(await esPrimeraReal(ctx, "guia")).toBe(false);
    ctx.facturaSimulada = false;
    expect(await esPrimeraReal(ctx, "factura")).toBe(true);
  });
});
