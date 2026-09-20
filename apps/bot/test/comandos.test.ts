import { afterEach, describe, expect, it } from "vitest";
import {
  emitirFactura,
  emitirGuia,
  ErrorNegocio,
  prepararFactura,
  registrarGuiaBorrador,
  resultadoGuia,
} from "@sunatapp/core";
import { entradaGuia } from "../../../packages/core/test/helpers";
import { crearArnes } from "./arnes";
import { lineaCobro } from "../src/textos";

const cerrables: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cerrables.length) await cerrables.pop()!();
});

async function arnes(o: Parameters<typeof crearArnes>[0] = {}) {
  const a = await crearArnes(o);
  cerrables.push(a.cerrar);
  return a;
}

describe("/guias", () => {
  it("dice que no hay guías cuando no hay ninguna", async () => {
    const a = await arnes();
    await a.texto("/guias");
    expect(a.ultimoTexto()).toBe("Todavía no hay guías.");
  });

  it("lista las guías con estado y si ya está facturada", async () => {
    const a = await arnes();
    const guiaId = await registrarGuiaBorrador(a.ctx, entradaGuia());
    await emitirGuia(a.ctx, guiaId);

    await a.texto("/guias");
    expect(a.ultimoTexto()).toBe("V001-1 · 14/09 · CHOCANO CARGO SAC · ✅ aceptada · sin facturar");

    const { facturaId } = await prepararFactura(a.ctx, { guiaId, montoCentimos: 250000, incluyeIgv: true, formaPago: "contado" });
    await emitirFactura(a.ctx, facturaId);

    await a.texto("/guias");
    expect(a.ultimoTexto()).toBe("V001-1 · 14/09 · CHOCANO CARGO SAC · ✅ aceptada · facturada");
  });
});

describe("/pendientes", () => {
  it("dice que no hay pendientes cuando no hay ninguna", async () => {
    const a = await arnes();
    await a.texto("/pendientes");
    expect(a.ultimoTexto()).toBe("No hay guías pendientes.");
  });

  it("retoma un borrador tras un reinicio del bot y reusa la misma guía al emitir", async () => {
    const a = await arnes();
    const guiaId = await registrarGuiaBorrador(a.ctx, entradaGuia());

    // Simula un reinicio: un segundo bot sobre la misma base de datos, sesión nueva.
    const b = await arnes({ ctx: a.ctx });

    await b.texto("/pendientes");
    expect(b.ultimoTexto()).toBe("V001-(sin número) · 📝 borrador · CHOCANO CARGO SAC");
    expect(b.botones()).toEqual([{ text: "Retomar V001-(sin número)", callback_data: `g:retomar:${guiaId}` }]);

    await b.boton(`g:retomar:${guiaId}`);
    expect(b.ultimoTexto().startsWith("🧾 Guía de transportista (borrador)")).toBe(true);
    expect(b.botones().map((x) => x.callback_data)).toEqual(["g:emitir", "g:corregir", "g:cancelar"]);

    await b.boton("g:emitir");
    await b.esperarTareas();

    const r = await resultadoGuia(a.ctx, guiaId);
    expect(r.estado).toBe("aceptada");
    expect(r.serieNumero).toBe("V001-1");
  });
});

describe("/cobros", () => {
  it("dice que no hay nada por cobrar cuando no hay facturas pendientes", async () => {
    const a = await arnes();
    await a.texto("/cobros");
    expect(a.ultimoTexto()).toBe("No hay facturas por cobrar. 🎉");
  });

  it("lista las facturas por cobrar con su estado y los totales", async () => {
    const a = await arnes();
    const guia1 = await registrarGuiaBorrador(a.ctx, entradaGuia());
    await emitirGuia(a.ctx, guia1);
    const { facturaId: f1 } = await prepararFactura(a.ctx, { guiaId: guia1, montoCentimos: 250000, incluyeIgv: true, formaPago: "contado" });
    await emitirFactura(a.ctx, f1);

    await a.texto("/cobros");
    expect(a.ultimoTexto()).toBe(
      ["🟡 F001-1 · DISTRIBUIDORA SAC · vence hoy · S/ 2,400.00", "Por cobrar: S/ 2,400.00 · Vencido: S/ 0.00"].join("\n"),
    );
  });

  it("formatea una factura vencida (línea suelta, sin depender de la fecha del reloj)", () => {
    expect(
      lineaCobro({
        facturaId: 1,
        serieNumero: "F001-2",
        cliente: "DISTRIBUIDORA SAC",
        fechaVencimiento: "2026-09-30",
        saldo: 240000,
        estado: "vencida",
      }),
    ).toBe("🔴 F001-2 · DISTRIBUIDORA SAC · vencida 30/09 · S/ 2,400.00");
  });

  it("formatea una factura todavía no vencida", () => {
    expect(
      lineaCobro({
        facturaId: 1,
        serieNumero: "F001-2",
        cliente: "DISTRIBUIDORA SAC",
        fechaVencimiento: "2026-09-30",
        saldo: 240000,
        estado: "pendiente",
      }),
    ).toBe("⚪ F001-2 · DISTRIBUIDORA SAC · vence 30/09 · S/ 2,400.00");
  });
});

describe("/pagado", () => {
  it("formato inválido sin argumentos", async () => {
    const a = await arnes();
    await a.texto("/pagado");
    expect(a.ultimoTexto()).toBe("Úsalo así: /pagado F001-2 1500");
  });

  it("formato inválido con un monto ilegible", async () => {
    const a = await arnes();
    await a.texto("/pagado F001-1 diez");
    expect(a.ultimoTexto()).toBe("Úsalo así: /pagado F001-2 1500");
  });

  it("factura inexistente", async () => {
    const a = await arnes();
    await a.texto("/pagado F009-9");
    expect(a.ultimoTexto()).toBe("No encontré la factura F009-9.");
  });

  it("ErrorNegocio cuando el monto supera el saldo", async () => {
    const a = await arnes();
    const guiaId = await registrarGuiaBorrador(a.ctx, entradaGuia());
    await emitirGuia(a.ctx, guiaId);
    const { facturaId } = await prepararFactura(a.ctx, {
      guiaId,
      montoCentimos: 250000,
      incluyeIgv: true,
      formaPago: "credito",
      diasCredito: 30,
    });
    await emitirFactura(a.ctx, facturaId);

    await a.texto("/pagado F001-1 3000");
    expect(a.ultimoTexto()).toBe("El monto supera el saldo pendiente (2400)");
  });

  it("registra un cobro parcial y luego cobra el saldo completo", async () => {
    const a = await arnes();
    const guiaId = await registrarGuiaBorrador(a.ctx, entradaGuia());
    await emitirGuia(a.ctx, guiaId);
    const { facturaId } = await prepararFactura(a.ctx, {
      guiaId,
      montoCentimos: 250000,
      incluyeIgv: true,
      formaPago: "credito",
      diasCredito: 30,
    });
    await emitirFactura(a.ctx, facturaId);

    await a.texto("/pagado F001-1 1000");
    expect(a.ultimoTexto()).toBe("💰 Cobro registrado. Saldo: S/ 1,400.00 (parcial)");

    await a.texto("/pagado F001-1");
    expect(a.ultimoTexto()).toBe("💰 Cobro registrado. Saldo: S/ 0.00 (pagada)");
  });
});

describe("/cancelar", () => {
  it("no hay nada que cancelar sin un flujo activo", async () => {
    const a = await arnes();
    await a.texto("/cancelar");
    expect(a.ultimoTexto()).toBe("No hay nada que cancelar.");
  });
});
