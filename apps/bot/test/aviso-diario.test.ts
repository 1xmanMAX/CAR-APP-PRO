import { afterEach, describe, expect, it, vi } from "vitest";
import { emitirFactura, emitirGuia, prepararFactura, registrarGuiaBorrador, type Contexto } from "@sunatapp/core";
import { crearContextoPrueba, entradaGuia } from "../../../packages/core/test/helpers";
import { msHastaProximoAviso, programarAvisoDiario, textoAvisoDiario } from "../src/aviso-diario";

const cerrables: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cerrables.length) await cerrables.pop()!();
});

const HORA = 60 * 60_000;

describe("msHastaProximoAviso", () => {
  it("cuenta las horas que faltan para la hora de Lima de hoy", () => {
    // 12:00 UTC = 07:00 en Lima (UTC-5 todo el año): falta una hora para las 08:00.
    expect(msHastaProximoAviso(new Date("2026-09-19T12:00:00Z"), "08:00")).toBe(HORA);
  });

  it("salta al día siguiente si la hora ya pasó", () => {
    // 13:30 UTC = 08:30 en Lima: las 08:00 ya pasaron, faltan 23,5 horas.
    expect(msHastaProximoAviso(new Date("2026-09-19T13:30:00Z"), "08:00")).toBe(23.5 * HORA);
  });

  it("justo a la hora espera al día siguiente en vez de disparar en bucle", () => {
    expect(msHastaProximoAviso(new Date("2026-09-19T13:00:00Z"), "08:00")).toBe(24 * HORA);
  });
});

describe("programarAvisoDiario", () => {
  it("envía a la hora y vuelve a programarse para el día siguiente", async () => {
    vi.useFakeTimers();
    try {
      let ahora = new Date("2026-09-19T12:00:00Z");
      let envios = 0;
      const cancelar = programarAvisoDiario(
        async () => {
          envios += 1;
          ahora = new Date(ahora.getTime() + HORA);
        },
        "08:00",
        () => ahora,
      );
      await vi.advanceTimersByTimeAsync(HORA);
      expect(envios).toBe(1);
      await vi.advanceTimersByTimeAsync(24 * HORA);
      expect(envios).toBe(2);
      cancelar();
      await vi.advanceTimersByTimeAsync(48 * HORA);
      expect(envios).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

/** Una guía aceptada nueva; `ref` la distingue de las demás del mismo contexto. */
async function guiaAceptada(ctx: Contexto, ref: string): Promise<number> {
  const guiaId = await registrarGuiaBorrador(ctx, { ...entradaGuia(), greRemitenteRef: ref });
  const r = await emitirGuia(ctx, guiaId);
  expect(r.estado).toBe("aceptada");
  return guiaId;
}

describe("textoAvisoDiario", () => {
  it("no dice nada si no hay facturas por cobrar", async () => {
    const { ctx, cerrar } = await crearContextoPrueba();
    cerrables.push(cerrar);
    expect(await textoAvisoDiario(ctx)).toBeNull();
  });

  it("lista lo vencido y lo que vence hoy", async () => {
    let ahora = new Date("2026-09-13T15:00:00Z");
    const { ctx, cerrar } = await crearContextoPrueba({ reloj: () => ahora });
    cerrables.push(cerrar);

    // Crédito a 2 días emitida el 13/09: vence el 15/09.
    const g1 = await guiaAceptada(ctx, "EG01-101");
    const { facturaId: f1 } = await prepararFactura(ctx, {
      guiaId: g1, montoCentimos: 250_000, incluyeIgv: true, formaPago: "credito", diasCredito: 2,
    });
    expect((await emitirFactura(ctx, f1)).estado).toBe("aceptada");

    ahora = new Date("2026-09-17T15:00:00Z");
    // Al contado emitida el 17/09: vence hoy.
    const g2 = await guiaAceptada(ctx, "EG01-102");
    const { facturaId: f2 } = await prepararFactura(ctx, {
      guiaId: g2, montoCentimos: 118_000, incluyeIgv: true, formaPago: "contado",
    });
    expect((await emitirFactura(ctx, f2)).estado).toBe("aceptada");

    expect(await textoAvisoDiario(ctx)).toBe(
      [
        "📅 Cobros de hoy",
        "🔴 Vencidas:",
        "• F001-1 · DISTRIBUIDORA SAC · S/ 2,400.00 (venció 15/09)",
        "🟡 Vencen hoy:",
        "• F001-2 · DISTRIBUIDORA SAC · S/ 1,133.00",
      ].join("\n"),
    );
  });

  it("calla cuando todo vence más adelante", async () => {
    const ahora = new Date("2026-09-13T15:00:00Z");
    const { ctx, cerrar } = await crearContextoPrueba({ reloj: () => ahora });
    cerrables.push(cerrar);

    const g = await guiaAceptada(ctx, "EG01-103");
    const { facturaId } = await prepararFactura(ctx, {
      guiaId: g, montoCentimos: 250_000, incluyeIgv: true, formaPago: "credito", diasCredito: 30,
    });
    expect((await emitirFactura(ctx, facturaId)).estado).toBe("aceptada");

    expect(await textoAvisoDiario(ctx)).toBeNull();
  });
});
