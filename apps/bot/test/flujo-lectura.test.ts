import { afterEach, describe, expect, it } from "vitest";
import { crearUnidad, leerDocumento, registrarViajeFlota } from "@sunatapp/core";
import { IaNoDisponibleError, crearLectorReglas } from "@sunatapp/ia";
import { documentoRecibido, entrega, eq, gasto } from "../../../packages/db/src/index";
import { crearArnes } from "./arnes";
import { notificarLectura, resumenLectura } from "../src/flujo-lectura";

const cerrables: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cerrables.length) await cerrables.pop()!();
});

async function arnes(o: Parameters<typeof crearArnes>[0] = {}) {
  const a = await crearArnes(o);
  cerrables.push(a.cerrar);
  return a;
}

const idDe = (data: string) => Number(data.split(":")[2]);

describe("boletas por Telegram", () => {
  it("texto «grifo 350» → resumen → ✅ → gasto en la unidad (una sola vez)", async () => {
    const a = await arnes();
    await a.texto("grifo 350 Primax");
    await a.esperarTareas();
    expect(a.textosEnviados()).toContain("👀 Leyendo…");
    expect(a.ultimoTexto()).toBe("⛽ Combustible · S/ 350.00\ngrifo Primax\n¿Lo guardo?");
    const ok = a.botones().find((b) => b.text === "✅ Correcto")!.callback_data;
    await a.boton(ok);
    expect(a.ultimoTexto()).toMatch(/^✅ GASTO GUARDADO\nT-01 · ⛽ Combustible · S\/ 350.00/);
    await a.boton(ok);
    expect(a.ultimoTexto()).toBe("Ya lo guardé.");
    const gastos = await a.ctx.db.select().from(gasto).where(eq(gasto.documentoId, idDe(ok)));
    expect(gastos.map((g) => g.monto)).toEqual([35000]);
  });

  it("corregir y descartar", async () => {
    const a = await arnes();
    await a.texto("peaje 30");
    await a.esperarTareas();
    const botones = a.botones();
    await a.boton(botones.find((b) => b.text === "✏️ Corregir")!.callback_data);
    await a.texto("eran 28.50");
    expect(a.ultimoTexto()).toBe("🛣️ Peajes · S/ 28.50\n¿Lo guardo?");
    await a.boton(a.botones().find((b) => b.text === "❌ Descartar")!.callback_data);
    expect(a.ultimoTexto()).toBe("❌ Descartado. No guardé nada.");
    expect(await a.ctx.db.select().from(gasto)).toEqual([]);
  });

  it("foto sin IA: pregunta la categoría y el monto, y guarda la foto con el gasto", async () => {
    const a = await arnes({ archivos: { boleta1: Buffer.from("jpeg-boleta") } });
    await a.foto("boleta1");
    await a.esperarTareas();
    expect(a.ultimoTexto()).toContain("¿Qué gasto es?");
    await a.boton(a.botones().find((b) => b.text.includes("Hospedaje"))!.callback_data);
    await a.texto("60");
    expect(a.ultimoTexto()).toBe("🛏️ Hospedaje · S/ 60.00\n¿Lo guardo?");
    await a.boton(a.botones().find((b) => b.text === "✅ Correcto")!.callback_data);
    expect(a.ultimoTexto()).toContain("📷 foto guardada");
    const [g] = await a.ctx.db.select().from(gasto);
    expect(g!.rutaFoto).toMatch(/^recibidos\//);
    // La misma foto otra vez no se duplica.
    await a.foto("boleta1");
    expect(a.ultimoTexto()).toBe("Esta foto ya la había guardado antes.");
  });

  it("con dos unidades pregunta de cuál es; el dinero recibido va al viaje en curso", async () => {
    const a = await arnes();
    const t02 = await crearUnidad(a.ctx, { placa: "XYZ-987" });
    await a.texto("me yapearon 500");
    await a.esperarTareas();
    expect(a.ultimoTexto()).toBe("💵 Dinero recibido para el viaje · S/ 500.00 · Yape/Plin\n¿Lo guardo?");
    await a.boton(a.botones().find((b) => b.text === "✅ Correcto")!.callback_data);
    expect(a.ultimoTexto()).toBe("¿De qué unidad es?");
    const botonT02 = a.botones().find((b) => b.text === t02.codigo)!.callback_data;
    await a.boton(botonT02);
    expect(a.ultimoTexto()).toMatch(/no tiene un viaje en curso/);
    const v = await registrarViajeFlota(a.ctx, { vehiculoId: t02.id, origenLugar: "Puno", destinoLugar: "Lima", estado: "en_curso", origen: "web" });
    await a.boton(botonT02);
    expect(a.ultimoTexto()).toBe(`✅ ENTREGA ANOTADA en ${v.codigo}\n💵 Dinero recibido para el viaje · S/ 500.00 · Yape/Plin. Se descuenta en la liquidación del viaje.`);
    expect((await a.ctx.db.select().from(entrega)).map((e) => e.monto)).toEqual([50000]);
  });

  it("nota de voz sin transcriptor pide escribirlo", async () => {
    const a = await arnes({ archivos: { voz1: Buffer.from("ogg") } });
    await a.voz("voz1");
    await a.esperarTareas();
    expect(a.ultimoTexto()).toMatch(/notas de voz no están activadas.*grifo 350/);
  });

  it("IA caída: avisa que reintenta y el aviso de fondo manda el resumen", async () => {
    const a = await arnes();
    let caida = true;
    const reglas = crearLectorReglas();
    a.ctx.ia = { nombre: "x", leeImagenes: true, leer: async (e) => { if (caida) throw new IaNoDisponibleError("sin red"); return reglas.leer(e); } };
    await a.texto("cochera 20");
    await a.esperarTareas();
    expect(a.ultimoTexto()).toMatch(/^⏳ sin red\. Lo vuelvo a intentar/);
    caida = false;
    const [d] = await a.ctx.db.select().from(documentoRecibido);
    await notificarLectura(a.api, 111, await leerDocumento(a.ctx, d!.id));
    expect(a.ultimoTexto()).toBe("🅿️ Cochera · S/ 20.00\n¿Lo guardo?");
  });

  it("un texto sin números sigue yendo a la ayuda de guías", async () => {
    const a = await arnes();
    await a.texto("hola");
    expect(a.ultimoTexto()).toContain("Envíame el PDF de la guía del remitente");
  });

  it("resumen con proveedor, comprobante, fecha y dudas", () => {
    expect(resumenLectura({ tipo: "gasto", categoria: "combustible", monto: 350, fecha: "2026-09-18", proveedorRuc: "20100070970", proveedorNombre: "PRIMAX", comprobante: "B012-4471", nota: null, dudas: ["no se lee la hora"] }))
      .toBe("⛽ Combustible · S/ 350.00\nPRIMAX (RUC 20100070970) · B012-4471 · 18/09\n⚠️ no se lee la hora");
  });
});
