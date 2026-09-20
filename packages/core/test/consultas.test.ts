import { eq, guiaTransportista, usuario } from "@sunatapp/db";
import { afterEach, describe, expect, it } from "vitest";
import {
  buscarContrapartePorDoc, buscarGuiaPorSerieNumero, listarBorradores, listarGuias, listarGuiasSinFacturar,
} from "../src/consultas/consultas";
import { prepararFactura } from "../src/facturas/preparar";
import { emitirGuia, generarPdfGuiaSiFalta } from "../src/guias/emitir";
import { registrarGuiaBorrador } from "../src/guias/registrar";
import type { DatosIniciales } from "../src/infra/sembrar";
import {
  auditarTelegramDesconocido, contarAuditoria, duenoTelegramId, hayDueno, hayUsuarios,
  registrarUsuarioTelegram, usuarioPorTelegram,
} from "../src/usuarios/usuarios";
import { DATOS_INICIALES, crearContextoPrueba, entradaGuia } from "./helpers";

const cerrables: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cerrables.length) await cerrables.pop()!();
});

async function contexto(o: Parameters<typeof crearContextoPrueba>[0] = {}) {
  const r = await crearContextoPrueba(o);
  cerrables.push(r.cerrar);
  return r.ctx;
}

describe("consultas de guías", () => {
  it("listarGuias ordena por id descendente y marca facturada", async () => {
    const ctx = await contexto();
    const id1 = await registrarGuiaBorrador(ctx, entradaGuia());
    const id2 = await registrarGuiaBorrador(ctx, entradaGuia());
    await emitirGuia(ctx, id2);
    await prepararFactura(ctx, { guiaId: id2, montoCentimos: 100000, incluyeIgv: false, formaPago: "contado" });

    const filas = await listarGuias(ctx);
    expect(filas.map((f) => f.id)).toEqual([id2, id1]);
    expect(filas.find((f) => f.id === id2)).toMatchObject({ facturada: true, remitente: "DISTRIBUIDORA SAC", destinatario: "CHOCANO CARGO SAC" });
    expect(filas.find((f) => f.id === id1)).toMatchObject({ facturada: false });
  });

  it("listarGuias respeta el límite, con 10 por defecto", async () => {
    const ctx = await contexto();
    for (let i = 0; i < 12; i++) await registrarGuiaBorrador(ctx, entradaGuia());
    expect(await listarGuias(ctx)).toHaveLength(10);
    expect(await listarGuias(ctx, 3)).toHaveLength(3);
  });

  it("listarBorradores incluye borrador y rechazada, excluye aceptada", async () => {
    const ctx = await contexto();
    const idBorrador = await registrarGuiaBorrador(ctx, entradaGuia());
    const idRechazada = await registrarGuiaBorrador(ctx, entradaGuia());
    await ctx.db.update(guiaTransportista).set({ estado: "rechazada" }).where(eq(guiaTransportista.id, idRechazada));
    const idAceptada = await registrarGuiaBorrador(ctx, entradaGuia());
    await emitirGuia(ctx, idAceptada);

    const filas = await listarBorradores(ctx);
    expect(filas.map((f) => f.id).sort()).toEqual([idBorrador, idRechazada].sort());
  });

  it("listarGuiasSinFacturar solo devuelve aceptadas sin factura_guia", async () => {
    const ctx = await contexto();
    const idSinFacturar = await registrarGuiaBorrador(ctx, entradaGuia());
    await emitirGuia(ctx, idSinFacturar);
    const idFacturada = await registrarGuiaBorrador(ctx, entradaGuia());
    await emitirGuia(ctx, idFacturada);
    await prepararFactura(ctx, { guiaId: idFacturada, montoCentimos: 100000, incluyeIgv: false, formaPago: "contado" });
    const idBorrador = await registrarGuiaBorrador(ctx, entradaGuia());
    void idBorrador;

    const filas = await listarGuiasSinFacturar(ctx);
    expect(filas.map((f) => f.id)).toEqual([idSinFacturar]);
  });

  it("buscarGuiaPorSerieNumero encuentra la guía emitida y devuelve null si no existe o el texto es inválido", async () => {
    const ctx = await contexto();
    const id = await registrarGuiaBorrador(ctx, entradaGuia());
    await emitirGuia(ctx, id);

    expect(await buscarGuiaPorSerieNumero(ctx, "v001-1")).toEqual({ id });
    expect(await buscarGuiaPorSerieNumero(ctx, "V001-99")).toBeNull();
    expect(await buscarGuiaPorSerieNumero(ctx, "basura")).toBeNull();
  });

  it("buscarContrapartePorDoc encuentra o no una contraparte registrada", async () => {
    const ctx = await contexto();
    await registrarGuiaBorrador(ctx, entradaGuia());
    expect(await buscarContrapartePorDoc(ctx, "20131312955")).toMatchObject({ razonSocial: "DISTRIBUIDORA SAC" });
    expect(await buscarContrapartePorDoc(ctx, "99999999999")).toBeNull();
  });
});

const DATOS_SIN_DUENO: DatosIniciales = { ...DATOS_INICIALES, usuario: { nombre: "Dueño", email: "dueno@demo.pe" } };

describe("usuarios de Telegram", () => {
  it("hayUsuarios y hayDueno reflejan el estado sembrado", async () => {
    const ctxConDueno = await contexto();
    expect(await hayUsuarios(ctxConDueno)).toBe(true);
    expect(await hayDueno(ctxConDueno)).toBe(true);

    const ctxSinDueno = await contexto({ datos: DATOS_SIN_DUENO });
    expect(await hayUsuarios(ctxSinDueno)).toBe(true);
    expect(await hayDueno(ctxSinDueno)).toBe(false);
  });

  it("registrarUsuarioTelegram asigna el ID al primer usuario sin telegramId, y un segundo llamado lanza 'El bot ya tiene dueño'", async () => {
    const ctx = await contexto({ datos: DATOS_SIN_DUENO });
    const u = await registrarUsuarioTelegram(ctx, 555);
    expect(u.telegramId).toBe(555);

    await expect(registrarUsuarioTelegram(ctx, 999)).rejects.toThrow("El bot ya tiene dueño");
  });

  it("registrarUsuarioTelegram sin usuarios sembrados lanza 'Ejecuta pnpm sembrar primero'", async () => {
    const ctx = await contexto({ datos: DATOS_SIN_DUENO });
    await ctx.db.delete(usuario);
    await expect(registrarUsuarioTelegram(ctx, 555)).rejects.toThrow("Ejecuta pnpm sembrar primero");
  });

  it("usuarioPorTelegram devuelve null para desconocidos e inactivos", async () => {
    const ctx = await contexto();
    expect(await usuarioPorTelegram(ctx, 424242)).toBeNull();

    await ctx.db.update(usuario).set({ activo: false }).where(eq(usuario.telegramId, DATOS_INICIALES.usuario.telegramId!));
    expect(await usuarioPorTelegram(ctx, DATOS_INICIALES.usuario.telegramId!)).toBeNull();
  });

  it("usuarioPorTelegram encuentra al dueño activo", async () => {
    const ctx = await contexto();
    expect(await usuarioPorTelegram(ctx, DATOS_INICIALES.usuario.telegramId!)).toMatchObject({ nombre: "Dueño" });
  });

  it("duenoTelegramId devuelve el telegramId del dueño, o null si no hay", async () => {
    const ctx = await contexto();
    expect(await duenoTelegramId(ctx)).toBe(DATOS_INICIALES.usuario.telegramId);

    const ctxSinDueno = await contexto({ datos: DATOS_SIN_DUENO });
    expect(await duenoTelegramId(ctxSinDueno)).toBeNull();
  });

  it("auditarTelegramDesconocido registra una auditoría contable con contarAuditoria", async () => {
    const ctx = await contexto();
    expect(await contarAuditoria(ctx, "telegram_desconocido")).toBe(0);
    await auditarTelegramDesconocido(ctx, 777, "hola bot");
    await auditarTelegramDesconocido(ctx, 778, undefined);
    expect(await contarAuditoria(ctx, "telegram_desconocido")).toBe(2);
  });
});

describe("hook de log", () => {
  it("un PDF que falla registra una entrada de error vía ctx.log", async () => {
    const ctx = await contexto();
    const id = await registrarGuiaBorrador(ctx, entradaGuia());
    await emitirGuia(ctx, id);
    await ctx.db.update(guiaTransportista).set({ rutaXml: "guias/no-existe.xml", rutaPdf: null }).where(eq(guiaTransportista.id, id));

    const entradas: Array<{ nivel: string; mensaje: string; detalle?: unknown }> = [];
    ctx.log = (nivel, mensaje, detalle) => entradas.push({ nivel, mensaje, detalle });

    await generarPdfGuiaSiFalta(ctx, id);

    expect(entradas.some((e) => e.nivel === "error")).toBe(true);
  });
});
