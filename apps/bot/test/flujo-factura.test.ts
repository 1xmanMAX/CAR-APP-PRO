import { afterEach, describe, expect, it } from "vitest";
import { emitirGuia, registrarGuiaBorrador, registrarVehiculo } from "@sunatapp/core";
import { entradaGuia, SunatSimulado } from "../../../packages/core/test/helpers";
import { crearArnes } from "./arnes";
import { lineasFixture, pdfConLineas } from "./pdf-prueba";

const cerrables: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cerrables.length) await cerrables.pop()!();
});

async function arnes(archivos?: Record<string, Buffer>) {
  const a = await crearArnes(archivos ? { archivos } : {});
  cerrables.push(a.cerrar);
  return a;
}

/** Una guía ya aceptada por SUNAT, creada por el núcleo: es el punto de partida de la factura. */
async function guiaAceptada(ctx: Parameters<typeof registrarGuiaBorrador>[0]): Promise<number> {
  const guiaId = await registrarGuiaBorrador(ctx, entradaGuia());
  const r = await emitirGuia(ctx, guiaId);
  expect(r.estado).toBe("aceptada");
  return guiaId;
}

const RESUMEN = [
  "🧾 Factura (borrador)",
  "Guía: V001-1",
  "Cliente: DISTRIBUIDORA SAC (20131312955)",
  "Subtotal: S/ 2,118.64 · IGV: S/ 381.36 · Total: S/ 2,500.00",
  "Detracción 4%: S/ 100.00 · Neto a cobrar: S/ 2,400.00",
  "Pago: crédito 30 días",
].join("\n");

describe("flujo de factura: camino feliz", () => {
  it("cobra el flete de una guía aceptada y emite la factura", async () => {
    const a = await arnes();
    await guiaAceptada(a.ctx);

    await a.texto("/facturar V001-1");
    expect(a.ultimoTexto()).toBe("¿Cuál es el monto del flete? (ej. 2500)");

    await a.texto("2500");
    expect(a.ultimoTexto()).toBe("¿El monto incluye IGV?");
    expect(a.botones().map((b) => b.callback_data)).toEqual(["f:igv:si", "f:igv:no"]);

    await a.boton("f:igv:si");
    expect(a.ultimoTexto()).toBe("¿A quién se factura?");
    expect(a.botones()).toEqual([
      { text: "Remitente: DISTRIBUIDORA SAC", callback_data: "f:cli:rem" },
      { text: "Otro RUC", callback_data: "f:cli:otro" },
    ]);

    await a.boton("f:cli:rem");
    expect(a.ultimoTexto()).toBe("¿Forma de pago?");
    expect(a.botones().map((b) => b.callback_data)).toEqual(["f:pago:contado", "f:pago:15", "f:pago:30", "f:pago:otro"]);

    await a.boton("f:pago:30");
    expect(a.ultimoTexto()).toBe(RESUMEN);
    expect(a.botones().map((b) => b.callback_data)).toEqual(["f:emitir", "f:cancelar"]);

    await a.boton("f:emitir");
    expect(a.ultimoTexto()).toBe("📤 Enviando la factura a SUNAT…");

    await a.esperarTareas();
    const documentos = a.documentosEnviados();
    expect(documentos).toHaveLength(1);
    expect(documentos[0]!.payload.caption).toBe("✅ Factura F001-1 aceptada.");
  });

  it("un doble clic en Emitir no manda dos facturas", async () => {
    const a = await arnes();
    await guiaAceptada(a.ctx);
    await a.texto("/facturar V001-1");
    await a.texto("2500");
    await a.boton("f:igv:si");
    await a.boton("f:cli:rem");
    await a.boton("f:pago:contado");

    await a.boton("f:emitir");
    await a.boton("f:emitir");
    expect(a.ultimoTexto()).toBe("Ya la estoy enviando.");

    await a.esperarTareas();
    expect(a.documentosEnviados()).toHaveLength(1);
  });
});

describe("flujo de factura: el dueño se equivoca", () => {
  it("no entiende un monto escrito con letras", async () => {
    const a = await arnes();
    await guiaAceptada(a.ctx);
    await a.texto("/facturar V001-1");

    await a.texto("dos mil");
    expect(a.ultimoTexto()).toBe("No entendí el monto. Escríbelo así: 2500 o 2,500.50");
  });

  it("/cancelar corta la factura a medias", async () => {
    const a = await arnes();
    await guiaAceptada(a.ctx);
    await a.texto("/facturar V001-1");

    await a.texto("/cancelar");
    expect(a.ultimoTexto()).toBe("Cancelado.");

    await a.texto("2500");
    expect(a.ultimoTexto()).toBe("Envíame el PDF de la guía del remitente o escribe /ayuda.");
  });

  it("rechaza un RUC que no está registrado", async () => {
    const a = await arnes();
    await guiaAceptada(a.ctx);
    await a.texto("/facturar V001-1");
    await a.texto("2500");
    await a.boton("f:igv:si");

    await a.boton("f:cli:otro");
    expect(a.ultimoTexto()).toBe("Escribe el RUC del cliente.");

    await a.texto("20509876543");
    expect(a.ultimoTexto()).toBe(
      "Ese RUC no está registrado. Por ahora factura al remitente o a un cliente con el que ya trabajaste.",
    );
  });

  it("avisa cuando la guía no existe o ya tiene factura", async () => {
    const a = await arnes();
    await a.texto("/facturar V001-9");
    expect(a.ultimoTexto()).toBe("No encontré la guía V001-9.");

    await guiaAceptada(a.ctx);
    await a.texto("/facturar V001-1");
    await a.texto("2500");
    await a.boton("f:igv:si");
    await a.boton("f:cli:rem");
    await a.boton("f:pago:contado");
    await a.boton("f:emitir");
    await a.esperarTareas();

    await a.texto("/facturar V001-1");
    expect(a.ultimoTexto()).toBe("La guía V001-1 ya tiene factura.");
  });

  it("no factura una guía que SUNAT rechazó", async () => {
    const a = await crearArnes({ gateway: new SunatSimulado({ demoraMs: 0, rechazo: { codigo: "2800", mensaje: "dato inválido" } }) });
    cerrables.push(a.cerrar);
    const guiaId = await registrarGuiaBorrador(a.ctx, entradaGuia());
    expect((await emitirGuia(a.ctx, guiaId)).estado).toBe("rechazada");

    await a.texto("/facturar V001-1");
    expect(a.ultimoTexto()).toBe("Solo se pueden facturar guías aceptadas por SUNAT.");
  });
});

describe("oferta de factura tras la guía", () => {
  it("ofrece facturar el flete al aceptarse la guía y acepta dejarlo para después", async () => {
    const a = await arnes({ pdf1: await pdfConLineas(lineasFixture(puntosEnOrden)) });
    await registrarVehiculo(a.ctx, "XYZ-987");

    await a.documento("pdf1");
    await a.boton("g:emitir");
    await a.esperarTareas();

    expect(a.ultimoTexto()).toBe("¿Facturar este flete (V001-1)?");
    expect(a.botones()).toEqual([
      { text: "Sí", callback_data: "f:si:1" },
      { text: "Después", callback_data: "f:despues:1" },
    ]);

    await a.boton("f:despues:1");
    expect(a.ultimoTexto()).toBe("Listo, queda sin facturar. Usa /facturar V001-1 cuando quieras.");

    await a.texto("/facturar V001-1");
    expect(a.ultimoTexto()).toBe("¿Cuál es el monto del flete? (ej. 2500)");
  });
});

/** El fixture trae las etiquetas de los puntos al revés; se enderezan para no preguntar nada. */
function puntosEnOrden(l: string[]): string[] {
  return l.map((x) => (x === "PUNTO DE LLEGADA" ? "PUNTO DE PARTIDA :" : x === "PUNTO DE PARTIDA :" ? "PUNTO DE LLEGADA" : x));
}
