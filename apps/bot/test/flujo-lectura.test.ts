import { afterEach, describe, expect, it } from "vitest";
import { crearUnidad, leerDocumento, obtenerUnidad, registrarEntrega, registrarViajeFlota } from "@sunatapp/core";
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
/** El resumen sin la línea 📍 del contexto (unidad, viaje, pago, km), que se prueba aparte. */
const sinContexto = (t: string) => t.replace(/\n📍 [^\n]*/, "");

describe("boletas por Telegram", () => {
  it("texto «grifo 350» → resumen → ✅ → gasto en la unidad (una sola vez)", async () => {
    const a = await arnes();
    await a.texto("grifo 350 Primax");
    await a.esperarTareas();
    expect(a.textosEnviados()).toContain("👀 Leyendo…");
    expect(sinContexto(a.ultimoTexto())).toBe("⛽ Combustible · S/ 350.00\ngrifo Primax\n¿Lo guardo?");
    const ok = a.botones().find((b) => b.text === "✅ Correcto")!.callback_data;
    await a.boton(ok);
    // Combustible sin km en el voucher: pregunta el del tablero una vez.
    await a.boton(a.botones().find((b) => b.text === "No sé")!.callback_data);
    expect(a.ultimoTexto()).toMatch(/^✅ GASTO GUARDADO\nT-01 · ⛽ Combustible · S\/ 350.00/);
    await a.boton(ok);
    expect(a.ultimoTexto()).toBe("Ya lo guardé.");
    const gastos = await a.ctx.db.select().from(gasto).where(eq(gasto.documentoId, idDe(ok)));
    expect(gastos.map((g) => g.monto)).toEqual([35000]);
  });

  it("combustible sin km: al confirmar pide el km del tablero y lo guarda como km real", async () => {
    const a = await arnes();
    const km0 = (await obtenerUnidad(a.ctx, 1)).odometroKm;
    await a.texto("grifo 350");
    await a.esperarTareas();
    await a.boton(a.botones().find((b) => b.text === "✅ Correcto")!.callback_data);
    expect(a.ultimoTexto()).toContain("¿Km del tablero?");
    expect(a.botones().some((b) => b.text === "No sé")).toBe(true);
    await a.texto(String(km0 + 200));
    expect(a.ultimoTexto()).toMatch(/^✅ GASTO GUARDADO/);
    const [g] = await a.ctx.db.select().from(gasto);
    expect(g).toMatchObject({ kmVehiculo: km0 + 200, kmReal: true });
  });

  it("combustible: «No sé» guarda con el último km", async () => {
    const a = await arnes();
    await a.texto("grifo 350");
    await a.esperarTareas();
    await a.boton(a.botones().find((b) => b.text === "✅ Correcto")!.callback_data);
    await a.boton(a.botones().find((b) => b.text === "No sé")!.callback_data);
    expect(a.ultimoTexto()).toMatch(/^✅ GASTO GUARDADO/);
    const [g] = await a.ctx.db.select().from(gasto);
    expect(g!.kmReal).toBe(false);
  });

  it("el resumen muestra unidad, viaje, forma de pago y km", async () => {
    const a = await arnes();
    const v = await registrarViajeFlota(a.ctx, { vehiculoId: 1, origenLugar: "Juliaca", destinoLugar: "Arequipa", estado: "en_curso", origen: "web" });
    await a.texto("peaje 28");
    await a.esperarTareas();
    expect(a.ultimoTexto()).toContain(`📍 T-01 · ${v.codigo} (sin guía) · efectivo del chofer`);
  });

  it("corregir y descartar", async () => {
    const a = await arnes();
    await a.texto("peaje 30");
    await a.esperarTareas();
    const botones = a.botones();
    await a.boton(botones.find((b) => b.text === "✏️ Corregir")!.callback_data);
    await a.texto("eran 28.50");
    expect(sinContexto(a.ultimoTexto())).toBe("🛣️ Peajes · S/ 28.50\n¿Lo guardo?");
    await a.boton(a.botones().find((b) => b.text === "❌ Descartar")!.callback_data);
    expect(a.ultimoTexto()).toBe("❌ Descartado. No guardé nada.");
    expect(await a.ctx.db.select().from(gasto)).toEqual([]);
  });

  it("❌ Descartar después de guardar no toca el gasto (ni lo vuelve a abrir)", async () => {
    const a = await arnes();
    await a.texto("peaje 30");
    await a.esperarTareas();
    const botones = a.botones();
    await a.boton(botones.find((b) => b.text === "✅ Correcto")!.callback_data);
    expect(a.ultimoTexto()).toMatch(/^✅ GASTO GUARDADO/);
    await a.boton(botones.find((b) => b.text === "❌ Descartar")!.callback_data);
    expect(a.ultimoTexto()).toBe("⚠️ Ese mensaje ya se guardó o se descartó");
    expect((await a.ctx.db.select().from(gasto)).map((g) => g.monto)).toEqual([3000]);
    const [d] = await a.ctx.db.select().from(documentoRecibido);
    expect(d!.estadoLectura).toBe("confirmado");
  });

  it("foto sin IA: pregunta la categoría y el monto, y guarda la foto con el gasto", async () => {
    const a = await arnes({ archivos: { boleta1: Buffer.from("jpeg-boleta") } });
    await a.foto("boleta1");
    await a.esperarTareas();
    expect(a.ultimoTexto()).toContain("¿Qué gasto es?");
    await a.boton(a.botones().find((b) => b.text.includes("Hospedaje"))!.callback_data);
    await a.texto("60");
    expect(sinContexto(a.ultimoTexto())).toBe("🛏️ Hospedaje · S/ 60.00\n¿Lo guardo?");
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
    expect(a.ultimoTexto()).toBe(`✅ ENTREGA ANOTADA en ${v.codigo}\n💵 Dinero recibido para el viaje · S/ 500.00 · Yape/Plin. Se descuenta en la liquidación del viaje.\n💰 Quedan S/ 500.00 de lo entregado (${v.codigo}).`);
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
    expect(sinContexto(a.ultimoTexto())).toBe("🅿️ Cochera en ruta · S/ 20.00\n¿Lo guardo?");
  });

  it("un texto sin números sigue yendo a la ayuda de guías", async () => {
    const a = await arnes();
    await a.texto("hola");
    expect(a.ultimoTexto()).toContain("Envíame el PDF de la guía del remitente");
  });

  it("resumen con proveedor, comprobante, fecha y dudas", () => {
    expect(resumenLectura({ tipo: "gasto", categoria: "combustible", monto: 350, fecha: "2026-09-18", proveedorRuc: "20100070970", proveedorNombre: "PRIMAX", comprobante: "B012-4471", nota: null, dudas: ["no se lee la hora"], medioPago: null, kmOdometro: null }))
      .toBe("⛽ Combustible · S/ 350.00\nPRIMAX (RUC 20100070970) · B012-4471 · 18/09\n⚠️ no se lee la hora");
  });

  it("después de un gasto dice cuánto queda de lo entregado, y /saldo da la liquidación", async () => {
    const a = await arnes();
    const v = await registrarViajeFlota(a.ctx, { vehiculoId: 1, origenLugar: "Juliaca", destinoLugar: "Arequipa", estado: "en_curso", origen: "web" });
    await registrarEntrega(a.ctx, { viajeId: v.id, monto: 100000, medio: "efectivo" });
    await a.texto("grifo 350");
    await a.esperarTareas();
    await a.boton(a.botones().find((b) => b.text === "✅ Correcto")!.callback_data);
    await a.boton(a.botones().find((b) => b.text === "No sé")!.callback_data);
    expect(a.ultimoTexto()).toContain(`💰 Quedan S/ 650.00 de lo entregado (${v.codigo}).`);
    await a.texto("/saldo");
    expect(a.ultimoTexto()).toBe(`💰 ${v.codigo} · T-01 · Juliaca → Arequipa (en curso)\nEntregado S/ 1,000.00 · Gastado S/ 350.00\n👉 Le quedan S/ 650.00 al chofer\n🔴 Combustible S/ 350.00`);
  });

  it("«salgo de Juliaca a Puno, me dieron 1300» abre el viaje y «ya llegué» lo cierra con la liquidación", async () => {
    const a = await arnes();
    await a.texto("salgo de Juliaca a Puno, me dieron 1300");
    await a.esperarTareas();
    expect(a.ultimoTexto()).toBe("🚛 Sale de viaje · Juliaca → Puno · adelanto S/ 1,300.00\n¿Abro el viaje?");
    await a.boton(a.botones().find((b) => b.text === "✅ Correcto")!.callback_data);
    expect(a.ultimoTexto()).toMatch(/^✅ VIAJE ABIERTO · VJ-\d+\nT-01 · Juliaca → Puno · adelanto S\/ 1,300.00 anotado/);
    await a.texto("peaje 20");
    await a.esperarTareas();
    await a.boton(a.botones().find((b) => b.text === "✅ Correcto")!.callback_data);
    await a.texto("ya llegué");
    await a.esperarTareas();
    expect(a.ultimoTexto()).toBe("🏁 Llegó: cerrar el viaje en curso\n¿Lo cierro?");
    await a.boton(a.botones().find((b) => b.text === "✅ Correcto")!.callback_data);
    expect(a.ultimoTexto()).toContain("✅ VIAJE CERRADO");
    expect(a.ultimoTexto()).toContain("👉 Le quedan S/ 1,280.00 al chofer");
  });

  it("/invitar da un código y quien lo manda entra como chofer", async () => {
    const a = await arnes();
    await a.texto("/invitar");
    const codigo = /(\d{6})/.exec(a.ultimoTexto())![1]!;
    await a.texto(codigo, 999);
    expect(a.ultimoTexto()).toMatch(/^✅ Bienvenido, Usuario/);
    await a.texto("peaje 15", 999);
    await a.esperarTareas();
    expect(sinContexto(a.ultimoTexto())).toBe("🛣️ Peajes · S/ 15.00\n¿Lo guardo?");
    await a.texto("/invitar", 999);
    expect(a.ultimoTexto()).toBe("Solo el dueño puede invitar a alguien.");
  });

  it("/cerrar muestra la liquidación y pide el odómetro", async () => {
    const a = await arnes();
    const v = await registrarViajeFlota(a.ctx, { vehiculoId: 1, origenLugar: "Juliaca", destinoLugar: "Arequipa", estado: "en_curso", origen: "web" });
    await registrarEntrega(a.ctx, { viajeId: v.id, monto: 50000, medio: "efectivo" });
    await a.texto("/cerrar");
    const t = a.textosEnviados();
    expect(t.at(-2)).toContain("👉 Le quedan S/ 500.00 al chofer");
    expect(t.at(-1)).toMatch(/^🏁 T-01: escribe el odómetro final/);
  });
});
