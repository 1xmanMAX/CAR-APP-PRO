import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { crearLectorReglas, IaCredencialesError, IaNoDisponibleError, type ProveedorIA } from "@sunatapp/ia";
import { documentoRecibido, entrega, eq, gasto } from "@sunatapp/db";
import {
  confirmarLectura, corregirLectura, descartarLectura, fijarLectura, leerDocumento, obtenerDocumento, procesarLecturasPendientes,
  recibirMensaje, registrarViajeFlota, listarPorRevisar, gastosSinViaje, asignarViajeGasto, contarPorRevisar, costoIaDelMes, crearRuta, liquidacionDeUnidad,
  crearInvitacion, obtenerUnidad, usarInvitacion, type Contexto,
} from "../src/index";
import { crearContextoPrueba } from "./helpers";

let ctx: Contexto;
let cerrar: () => Promise<void>;
let ahora: Date;
let msg = 0;

beforeEach(async () => {
  ahora = new Date("2026-09-18T15:00:00Z");
  ({ ctx, cerrar } = await crearContextoPrueba({ reloj: () => ahora }));
  ctx.ia = crearLectorReglas();
});
afterEach(async () => cerrar());

const texto = (t: string) => recibirMensaje(ctx, { tipo: "texto", texto: t, telegramChatId: 111, telegramMessageId: ++msg });

describe("lecturas de mensajes", () => {
  it("un mismo mensaje se registra una sola vez", async () => {
    const a = await recibirMensaje(ctx, { tipo: "texto", texto: "grifo 350", telegramChatId: 111, telegramMessageId: 7 });
    const b = await recibirMensaje(ctx, { tipo: "texto", texto: "grifo 350", telegramChatId: 111, telegramMessageId: 7 });
    expect(b).toEqual({ id: a.id, nuevo: false });
    const foto = { tipo: "foto" as const, contenido: Buffer.from("jpeg"), mime: "image/jpeg", telegramChatId: 111, telegramMessageId: 8 };
    expect((await recibirMensaje(ctx, foto)).nuevo).toBe(true);
    expect((await recibirMensaje(ctx, { ...foto, telegramMessageId: 9 })).nuevo).toBe(false);
  });

  it("leer → por confirmar → gasto en el viaje en curso, sin duplicar con el doble clic", async () => {
    const v = await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Juliaca", destinoLugar: "Arequipa", estado: "en_curso", origen: "web" });
    const { id } = await texto("grifo 350.50 Primax");
    const r = await leerDocumento(ctx, id);
    expect(r).toMatchObject({ ok: true, lectura: { tipo: "gasto", categoria: "combustible", monto: 350.5 } });
    expect((await obtenerDocumento(ctx, id)).estado).toBe("por_confirmar");
    const c = await confirmarLectura(ctx, id, { vehiculoId: 1 });
    expect(c).toMatchObject({ tipo: "gasto", viajeCodigo: v.codigo, monto: 35050 });
    expect(await confirmarLectura(ctx, id, { vehiculoId: 1 })).toEqual({ tipo: "ya_confirmado" });
    const gastos = await ctx.db.select().from(gasto).where(eq(gasto.documentoId, id));
    expect(gastos.map((g) => [g.monto, g.categoria, g.nota])).toEqual([[35050, "combustible", "grifo Primax"]]);
  });

  it("combustible con km del voucher: se guarda como km real, con la forma de pago leída y la fecha de hoy", async () => {
    const u = await obtenerUnidad(ctx, 1);
    const { id } = await texto("grifo 350");
    await leerDocumento(ctx, id);
    await fijarLectura(ctx, id, {
      tipo: "gasto", categoria: "combustible", monto: 350, fecha: "2026-01-01", proveedorRuc: null, proveedorNombre: null, comprobante: null, nota: null, dudas: [],
      medioPago: "tarjeta", kmOdometro: u.odometroKm + 100,
    });
    const r = await confirmarLectura(ctx, id, { vehiculoId: 1 });
    expect(r).toMatchObject({ tipo: "gasto", avisoKm: null });
    const [g] = await ctx.db.select().from(gasto).where(eq(gasto.documentoId, id));
    expect(g).toMatchObject({ fecha: "2026-09-18", medioPago: "tarjeta", kmVehiculo: u.odometroKm + 100, kmReal: true });
  });

  it("la lectura trae el contexto (unidad, viaje, pago y km) y una categoría desconocida va a «otros del viaje»", async () => {
    await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Juliaca", destinoLugar: "Arequipa", estado: "en_curso", origen: "web" });
    const { id } = await texto("peaje 28");
    const leida = await leerDocumento(ctx, id);
    // Sin usuario (texto suelto) no se sabe la unidad: no hay contexto (el bot lo arma con la suya).
    expect(leida).toMatchObject({ ok: true, contexto: null });
    await fijarLectura(ctx, id, {
      tipo: "gasto", categoria: "inventada", monto: 28, fecha: null, proveedorRuc: null, proveedorNombre: null, comprobante: null, nota: null, dudas: [],
      medioPago: null, kmOdometro: null,
    });
    await confirmarLectura(ctx, id, { vehiculoId: 1 });
    const [g] = await ctx.db.select().from(gasto).where(eq(gasto.documentoId, id));
    expect(g).toMatchObject({ categoria: "otros_viaje", medioPago: "efectivo_chofer" });
    expect(g!.nota).toContain("inventada");
  });

  it("a la IA se le ofrecen solo las categorías variables (lo que manda el chofer es del viaje)", async () => {
    let ofrecidas: string[] = [];
    const lector = crearLectorReglas();
    ctx.ia = { ...lector, async leer(e) { ofrecidas = (e.contexto.categorias ?? []).map((c) => c.clave); return lector.leer(e); } };
    const { id } = await texto("grifo 100");
    await leerDocumento(ctx, id);
    expect(ofrecidas).toContain("combustible");
    expect(ofrecidas).not.toContain("mantenimiento");
    expect(ofrecidas).not.toContain("soat");
  });

  it("corregir cambia el monto y deja rastro; descartar no guarda nada", async () => {
    const { id } = await texto("peaje 30");
    await leerDocumento(ctx, id);
    expect(await corregirLectura(ctx, id, "eran 28.50")).toMatchObject({ ok: true, lectura: { tipo: "gasto", categoria: "peaje", monto: 28.5 } });
    const [d] = await ctx.db.select().from(documentoRecibido).where(eq(documentoRecibido.id, id));
    expect(d!.correcciones).toEqual(["eran 28.50"]);
    await descartarLectura(ctx, id);
    await expect(confirmarLectura(ctx, id, { vehiculoId: 1 })).rejects.toThrow();
    expect(await ctx.db.select().from(gasto).where(eq(gasto.documentoId, id))).toEqual([]);
  });

  it("una foto que el lector no ve se completa a mano (categoría y monto)", async () => {
    const { id } = await recibirMensaje(ctx, { tipo: "foto", contenido: Buffer.from("boleta"), mime: "image/jpeg", telegramChatId: 111, telegramMessageId: 50 });
    expect(await leerDocumento(ctx, id)).toMatchObject({ ok: true, lectura: { tipo: "otro" } });
    await expect(confirmarLectura(ctx, id, { vehiculoId: 1 })).rejects.toThrow(/No hay un gasto/);
    await fijarLectura(ctx, id, { tipo: "gasto", categoria: "hospedaje", monto: 60, fecha: null, proveedorRuc: null, proveedorNombre: null, comprobante: null, nota: null, dudas: [], medioPago: null, kmOdometro: null });
    const c = await confirmarLectura(ctx, id, { vehiculoId: 1 });
    expect(c).toMatchObject({ tipo: "gasto", monto: 6000 });
    const [g] = await ctx.db.select().from(gasto).where(eq(gasto.documentoId, id));
    expect(g!.rutaFoto).toMatch(/^recibidos\//);
  });

  it("entregas de dinero van al viaje en curso de la unidad", async () => {
    const { id } = await texto("me yapearon 500");
    await leerDocumento(ctx, id);
    await expect(confirmarLectura(ctx, id, { vehiculoId: 1 })).rejects.toThrow(/viaje en curso/);
    expect((await obtenerDocumento(ctx, id)).estado).toBe("por_confirmar");
    const v = await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Puno", destinoLugar: "Lima", estado: "en_curso", origen: "web" });
    expect(await confirmarLectura(ctx, id, { vehiculoId: 1 })).toMatchObject({ tipo: "entrega", viajeCodigo: v.codigo, monto: 50000 });
    expect((await ctx.db.select().from(entrega)).map((e) => [e.monto, e.medio])).toEqual([[50000, "yape"]]);
  });

  it("IA caída: queda en cola y se reintenta después; clave mala no se reintenta", async () => {
    let caida = true;
    const reglas = crearLectorReglas();
    const ia: ProveedorIA = { nombre: "prueba", leeImagenes: true, leer: async (e) => { if (caida) throw new IaNoDisponibleError("sin red"); return reglas.leer(e); } };
    ctx.ia = ia;
    const { id } = await texto("balanza 25");
    expect(await leerDocumento(ctx, id)).toMatchObject({ ok: false, error: "pendiente" });
    expect(await procesarLecturasPendientes(ctx)).toEqual([]); // todavía no toca
    caida = false;
    ahora = new Date(ahora.getTime() + 61_000);
    const listos = await procesarLecturasPendientes(ctx);
    expect(listos).toMatchObject([{ ok: true, documentoId: id, telegramChatId: 111, lectura: { categoria: "balanza", monto: 25 } }]);

    ctx.ia = { nombre: "prueba", leeImagenes: true, leer: async () => { throw new IaCredencialesError("clave rechazada"); } };
    const otro = await texto("cochera 20");
    expect(await leerDocumento(ctx, otro.id)).toMatchObject({ ok: false, error: "credenciales" });
    expect(await obtenerDocumento(ctx, otro.id)).toMatchObject({ estado: "error", error: "clave rechazada" });
  });

  it("voz sin transcriptor pide escribirlo; con transcriptor se lee", async () => {
    const nota = { tipo: "voz" as const, contenido: Buffer.from("ogg"), mime: "audio/ogg", telegramChatId: 111, telegramMessageId: 70 };
    const { id } = await recibirMensaje(ctx, nota);
    expect(await leerDocumento(ctx, id)).toMatchObject({ ok: false, error: "voz" });
    ctx.transcriptor = { disponible: true, transcribir: async () => "almuerzo 15" };
    const otra = await recibirMensaje(ctx, { ...nota, contenido: Buffer.from("ogg2"), telegramMessageId: 71 });
    expect(await leerDocumento(ctx, otra.id)).toMatchObject({ ok: true, lectura: { categoria: "viaticos", monto: 15 } });
    expect((await obtenerDocumento(ctx, otra.id)).texto).toBe("almuerzo 15");
  });

  it("por revisar: errores, sin confirmar +24 h y gastos sin viaje; se asignan y se cuenta el costo de la IA", async () => {
    const viejo = await texto("grifo 100");
    await leerDocumento(ctx, viejo.id);
    const malo = await recibirMensaje(ctx, { tipo: "voz", contenido: Buffer.from("x"), mime: "audio/ogg", telegramChatId: 111, telegramMessageId: 900 });
    await leerDocumento(ctx, malo.id);
    expect((await listarPorRevisar(ctx)).map((i) => i.documentoId)).toEqual([malo.id]);
    // La fecha de creación la pone la base con su reloj: se adelanta el de la app desde ese momento.
    ahora = new Date(Date.now() + 25 * 3_600_000);
    expect((await listarPorRevisar(ctx)).map((i) => [i.documentoId, i.estado])).toEqual([[malo.id, "error"], [viejo.id, "por_confirmar"]]);
    // Un gasto por Telegram sin viaje en curso queda sin viaje; se pasa a uno.
    await confirmarLectura(ctx, viejo.id, { vehiculoId: 1 });
    const [g] = await gastosSinViaje(ctx);
    expect(g).toMatchObject({ monto: 10000, categoria: "combustible" });
    const v = await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "A", destinoLugar: "B", estado: "cerrado", km: 10, origen: "web" });
    expect(await asignarViajeGasto(ctx, g!.id, v.id)).toBe(v.codigo);
    expect(await gastosSinViaje(ctx)).toEqual([]);
    // 1 mensaje sin confirmar + el viaje A → B, creado a mano sin guía.
    expect(await contarPorRevisar(ctx)).toBe(2);
    const mes = new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 7); // mes de Lima
    expect(await costoIaDelMes(ctx, mes)).toEqual({ usd: 0, lecturas: 2 });
  });

  it("«salgo…» abre el viaje con su adelanto y la plantilla de la ruta; «ya llegué» lo cierra", async () => {
    await crearRuta(ctx, "Juliaca → Puno", [{ categoria: "combustible", monto: 40000 }]);
    const a = await texto("salgo de Juliaca a Puno, me dieron 1300");
    await leerDocumento(ctx, a.id);
    const r = await confirmarLectura(ctx, a.id, { vehiculoId: 1 });
    expect(r).toMatchObject({ tipo: "inicio_viaje", ruta: "Juliaca → Puno", adelanto: 130000 });
    const l = await liquidacionDeUnidad(ctx, 1);
    expect([l!.entregado, l!.presupuestoTotal, l!.viaje.estado]).toEqual([130000, 40000, "en_curso"]);
    const b = await texto("ya llegué");
    await leerDocumento(ctx, b.id);
    expect(await confirmarLectura(ctx, b.id, { vehiculoId: 1 })).toMatchObject({ tipo: "fin_viaje" });
    expect((await liquidacionDeUnidad(ctx, 1))!.viaje.estado).toBe("cerrado");
    // Sin origen: sale de donde llegó la última vez.
    const c = await texto("voy a Arequipa");
    await leerDocumento(ctx, c.id);
    expect(await confirmarLectura(ctx, c.id, { vehiculoId: 1 })).toMatchObject({ ruta: "Puno → Arequipa", adelanto: 0 });
  });

  it("invitaciones: un código sirve una vez y 24 horas", async () => {
    const inv = await crearInvitacion(ctx, 1);
    expect(inv.codigo).toMatch(/^\d{6}$/);
    expect(await usarInvitacion(ctx, "000000" === inv.codigo ? "111111" : "000000", 555, "X")).toBeNull();
    const u = await usarInvitacion(ctx, inv.codigo, 555, "Juan Pérez");
    expect(u).toMatchObject({ nombre: "Juan Pérez", rol: "chofer", telegramId: 555 });
    expect(await usarInvitacion(ctx, inv.codigo, 556, "Otro")).toBeNull();
    const vencida = await crearInvitacion(ctx, 1);
    ahora = new Date(ahora.getTime() + 25 * 3_600_000);
    expect(await usarInvitacion(ctx, vencida.codigo, 557, "Tarde")).toBeNull();
  });
});
