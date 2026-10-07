import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { factura, guiaTransportista, eq, vehiculo, type EstadoSunatFactura } from "@sunatapp/db";
import {
  generarCertificadoPrueba, SunatSimulado, SunatYaRegistradoError, type DocumentoFirmado, type SunatGateway,
} from "@sunatapp/sunat";
import { afterEach, describe, expect, it } from "vitest";
import { emitirFactura, procesarPendientesFacturas } from "../src/facturas/emitir";
import { prepararFactura } from "../src/facturas/preparar";
import { AVISO_RETORNO_VACIO, avisoRetornoVacio, guiasConAvisoRetornoVacio } from "../src/facturas/transporte";
import { emitirGuia, procesarPendientesGuias } from "../src/guias/emitir";
import { registrarGuiaBorrador } from "../src/guias/registrar";
import { cargarConfig } from "../src/infra/config";
import { crearContexto, reconfigurarSunat, type Contexto } from "../src/infra/contexto";
import { sembrarDatosIniciales } from "../src/infra/sembrar";
import { aplicarConfigSunat, contarDocumentosEnCurso } from "../src/sunat/aplicar";
import { leerPausaSunat, MOTIVO_RESPUESTAS_RARAS, pausarSunat, reanudarSunat } from "../src/sunat/pausa";
import { crearContextoPrueba, DATOS_INICIALES, entradaGuia, prepararDatosTransporte } from "./helpers";

const cerrables: Array<() => Promise<void>> = [];
afterEach(async () => { while (cerrables.length) await cerrables.pop()!(); });

let ahora = new Date("2026-09-13T15:00:00Z");

async function ctxPrueba(gateway?: SunatGateway): Promise<Contexto> {
  ahora = new Date("2026-09-13T15:00:00Z");
  const r = await crearContextoPrueba({ reloj: () => ahora, ...(gateway ? { gateway } : {}) });
  cerrables.push(r.cerrar);
  await prepararDatosTransporte(r.ctx);
  return r.ctx;
}

async function ctxConGuia(gateway?: SunatGateway): Promise<{ ctx: Contexto; guiaId: number }> {
  const ctx = await ctxPrueba();
  const guiaId = await registrarGuiaBorrador(ctx, entradaGuia());
  await emitirGuia(ctx, guiaId);
  if (gateway) ctx.gateway = gateway;
  return { ctx, guiaId };
}

const simulado = new SunatSimulado({ demoraMs: 0 });
function gatewayCon(p: Partial<SunatGateway>): SunatGateway {
  return {
    enviarGuia: (d: DocumentoFirmado) => simulado.enviarGuia(d),
    consultarTicket: (t: string) => simulado.consultarTicket(t),
    enviarFactura: (d: DocumentoFirmado) => simulado.enviarFactura(d),
    consultarCdrFactura: async () => null,
    ...p,
  };
}

describe("C1 · red de seguridad: 3 errores raros seguidos de SUNAT pausan todo", () => {
  it("tres guías seguidas con error no clasificado pausan SUNAT", async () => {
    let llamadas = 0;
    const ctx = await ctxPrueba(gatewayCon({ enviarGuia: async () => { llamadas++; throw new Error("SUNAT GRE HTTP 400: ???"); } }));
    for (let i = 0; i < 2; i++) await emitirGuia(ctx, await registrarGuiaBorrador(ctx, entradaGuia()));
    expect(await leerPausaSunat(ctx)).toBeNull();
    await emitirGuia(ctx, await registrarGuiaBorrador(ctx, entradaGuia()));
    expect(await leerPausaSunat(ctx)).toMatchObject({ motivo: MOTIVO_RESPUESTAS_RARAS });
    expect(MOTIVO_RESPUESTAS_RARAS).toBe("SUNAT responde de forma inesperada; revisa tus claves antes de seguir");
    // En pausa el fondo ya no llama a SUNAT.
    ahora = new Date(ahora.getTime() + 60 * 60_000);
    await procesarPendientesGuias(ctx);
    expect(llamadas).toBe(3);
  });

  it("una respuesta válida de SUNAT reinicia la cuenta", async () => {
    let falla = true;
    const ctx = await ctxPrueba(gatewayCon({
      enviarGuia: async (d) => { if (falla) throw new Error("Respuesta inesperada"); return simulado.enviarGuia(d); },
    }));
    for (let i = 0; i < 2; i++) await emitirGuia(ctx, await registrarGuiaBorrador(ctx, entradaGuia()));
    falla = false;
    await emitirGuia(ctx, await registrarGuiaBorrador(ctx, entradaGuia()));
    falla = true;
    for (let i = 0; i < 2; i++) await emitirGuia(ctx, await registrarGuiaBorrador(ctx, entradaGuia()));
    expect(await leerPausaSunat(ctx)).toBeNull();
  });

  it("cuenta también los errores raros de facturas y de consulta de ticket", async () => {
    const { ctx, guiaId } = await ctxConGuia(gatewayCon({
      enviarFactura: async () => { throw new Error("Respuesta SOAP inesperada de SUNAT"); },
      consultarTicket: async () => { throw new Error("Respuesta de ticket inesperada de SUNAT"); },
    }));
    // El envío de la guía sale bien (eso reinicia la cuenta); fallan la factura y la consulta del ticket.
    await emitirGuia(ctx, await registrarGuiaBorrador(ctx, entradaGuia()), { esperarRespuesta: false });
    const { facturaId } = await prepararFactura(ctx, { guiaId, montoCentimos: 50000, incluyeIgv: true, formaPago: "contado" });
    await emitirFactura(ctx, facturaId); // 1.er error raro
    ahora = new Date(ahora.getTime() + 10 * 60_000);
    await procesarPendientesGuias(ctx); // consulta el ticket de la guía enviada: 2.º error raro
    expect(await leerPausaSunat(ctx)).toBeNull();
    ahora = new Date(ahora.getTime() + 10 * 60_000);
    await procesarPendientesFacturas(ctx); // reintenta la factura: 3.er error raro
    expect(await leerPausaSunat(ctx)).toMatchObject({ motivo: MOTIVO_RESPUESTAS_RARAS });
  });
});

describe("I2 · reconfigurarSunat solo reanuda si cambió una credencial", () => {
  async function ctxReal() {
    const base = mkdtempSync(join(tmpdir(), "reconf-"));
    const env = { STORAGE_DIR: join(base, "storage"), DATA_DIR: join(base, "data") };
    const a = await crearContexto(cargarConfig(env));
    cerrables.push(a.cerrar);
    await sembrarDatosIniciales(a.ctx.db, DATOS_INICIALES);
    const pfx = join(base, "c.pfx");
    writeFileSync(pfx, generarCertificadoPrueba({ ruc: DATOS_INICIALES.empresa.ruc, razonSocial: "X", password: "p" }));
    const real = {
      ...env, SUNAT_MODO: "real", SUNAT_CERT_PATH: pfx, SUNAT_CERT_PASSWORD: "p", SUNAT_SOL_USUARIO: "USU1", SUNAT_SOL_CLAVE: "c1",
      SUNAT_GRE_CLIENT_ID: "id", SUNAT_GRE_CLIENT_SECRET: "s",
    };
    return { ctx: a.ctx, real, env };
  }

  it("rearmar con la misma configuración (arranque, otro ajuste) no quita la pausa", async () => {
    const { ctx, real } = await ctxReal();
    await reconfigurarSunat(ctx, cargarConfig(real));
    await pausarSunat(ctx, "clave SOL rechazada");
    await reconfigurarSunat(ctx, cargarConfig(real));
    expect(await leerPausaSunat(ctx)).not.toBeNull();
  });

  it("cambiar la clave SOL (u otra credencial, el modo o el ambiente) sí la quita", async () => {
    const { ctx, real } = await ctxReal();
    await reconfigurarSunat(ctx, cargarConfig(real));
    await pausarSunat(ctx, "clave SOL rechazada");
    await reconfigurarSunat(ctx, cargarConfig({ ...real, SUNAT_SOL_CLAVE: "c2" }));
    expect(await leerPausaSunat(ctx)).toBeNull();
    await pausarSunat(ctx, "otra");
    await reconfigurarSunat(ctx, cargarConfig({ ...real, SUNAT_SOL_CLAVE: "c2", SUNAT_AMBIENTE_FACTURA: "beta" }));
    expect(await leerPausaSunat(ctx)).toBeNull();
  });

  it("conservarPausa no toca la pausa aunque cambie el modo", async () => {
    const { ctx, real, env } = await ctxReal();
    await reconfigurarSunat(ctx, cargarConfig(real));
    await pausarSunat(ctx, "clave SOL rechazada");
    await reconfigurarSunat(ctx, cargarConfig(env), { conservarPausa: true });
    await reconfigurarSunat(ctx, cargarConfig(real));
    expect(await leerPausaSunat(ctx)).not.toBeNull();
  });
});

describe("I3 · si la configuración Real no carga, se pausa en vez de enviar al simulador", () => {
  it("cert inexistente: queda simulado, en pausa y con el error; al corregir se reanuda", async () => {
    const base = mkdtempSync(join(tmpdir(), "aplicar-"));
    const env = { STORAGE_DIR: join(base, "storage"), DATA_DIR: join(base, "data") };
    const a = await crearContexto(cargarConfig(env), { conservarPausa: true });
    cerrables.push(a.cerrar);
    await sembrarDatosIniciales(a.ctx.db, DATOS_INICIALES);
    const pfx = join(base, "c.pfx");
    const real = {
      ...env, SUNAT_MODO: "real", SUNAT_CERT_PATH: pfx, SUNAT_CERT_PASSWORD: "p", SUNAT_SOL_USUARIO: "USU1", SUNAT_SOL_CLAVE: "c1",
      SUNAT_GRE_CLIENT_ID: "id", SUNAT_GRE_CLIENT_SECRET: "s",
    };
    const r = await aplicarConfigSunat(a.ctx, real);
    expect(r).toMatchObject({ modo: "simulado", error: expect.stringContaining("No se pudo usar SUNAT real") });
    expect(a.ctx.simulado).toBe(true);
    expect(await leerPausaSunat(a.ctx)).toMatchObject({ motivo: expect.stringContaining("No se pudo usar SUNAT real") });

    writeFileSync(pfx, generarCertificadoPrueba({ ruc: DATOS_INICIALES.empresa.ruc, razonSocial: "X", password: "p" }));
    expect(await aplicarConfigSunat(a.ctx, real)).toEqual({ modo: "real" });
    expect(await leerPausaSunat(a.ctx)).toBeNull();
  });

  it("configuración inválida con SUNAT_MODO=real también pausa", async () => {
    const base = mkdtempSync(join(tmpdir(), "aplicar2-"));
    const env = { STORAGE_DIR: join(base, "storage"), DATA_DIR: join(base, "data") };
    const a = await crearContexto(cargarConfig(env), { conservarPausa: true });
    cerrables.push(a.cerrar);
    const r = await aplicarConfigSunat(a.ctx, { ...env, SUNAT_MODO: "real" });
    expect(r.modo).toBe("simulado");
    expect(r.error).toContain("obligatorio");
    expect(await leerPausaSunat(a.ctx)).not.toBeNull();
  });

  it("cuenta las guías y facturas pendientes de envío o enviadas", async () => {
    const { ctx, guiaId } = await ctxConGuia();
    expect(await contarDocumentosEnCurso(ctx)).toBe(0);
    const { facturaId } = await prepararFactura(ctx, { guiaId, montoCentimos: 50000, incluyeIgv: true, formaPago: "contado" });
    await ctx.db.update(guiaTransportista).set({ estado: "enviada" }).where(eq(guiaTransportista.id, guiaId));
    await ctx.db.update(factura).set({ estadoSunat: "pendiente_envio" as EstadoSunatFactura }).where(eq(factura.id, facturaId));
    expect(await contarDocumentosEnCurso(ctx)).toBe(2);
  });
});

describe("I4 · facturas 1032/1033 y reemisión tras rechazo", () => {
  it("1033 sin CDR: queda pendiente para verificar y el fondo no la reenvía", async () => {
    let llamadas = 0;
    const { ctx, guiaId } = await ctxConGuia(gatewayCon({
      enviarFactura: async () => { llamadas++; throw new SunatYaRegistradoError("1033", "SUNAT ya tiene este número"); },
    }));
    const { facturaId } = await prepararFactura(ctx, { guiaId, montoCentimos: 50000, incluyeIgv: true, formaPago: "contado" });
    const r = await emitirFactura(ctx, facturaId);
    expect(r).toMatchObject({
      estado: "pendiente_envio", codigo: "1033",
      mensaje: "SUNAT dice que ya tiene esta factura: verifícala en SOL antes de volver a emitir",
    });
    const [f] = await ctx.db.select().from(factura).where(eq(factura.id, facturaId));
    expect(f!.proximoIntentoEn).toBeNull();
    ahora = new Date(ahora.getTime() + 60 * 60_000);
    await procesarPendientesFacturas(ctx);
    expect(llamadas).toBe(1);
  });

  it("reemitir una factura que SUNAT rechazó toma un número nuevo", async () => {
    let acepta = false;
    const rechazar = new SunatSimulado({ rechazo: { codigo: "2800", mensaje: "dato inválido" }, demoraMs: 0 });
    const enviados: string[] = [];
    const { ctx, guiaId } = await ctxConGuia(gatewayCon({
      enviarFactura: (d) => { enviados.push(d.nombreArchivo); return (acepta ? simulado : rechazar).enviarFactura(d); },
    }));
    const { facturaId } = await prepararFactura(ctx, { guiaId, montoCentimos: 50000, incluyeIgv: true, formaPago: "contado" });
    expect(await emitirFactura(ctx, facturaId)).toMatchObject({ estado: "rechazada", serieNumero: "F001-1" });
    acepta = true;
    ahora = new Date(ahora.getTime() + 10 * 60_000);
    expect(await emitirFactura(ctx, facturaId)).toMatchObject({ estado: "aceptada", serieNumero: "F001-2" });
    expect(enviados).toEqual(["20606433094-01-F001-1", "20606433094-01-F001-2"]);
  });

  it("reemitir tras SIN_ENVIO (nunca llegó a SUNAT) conserva el número", async () => {
    const { ctx, guiaId } = await ctxConGuia();
    const { facturaId } = await prepararFactura(ctx, { guiaId, montoCentimos: 50000, incluyeIgv: true, formaPago: "contado" });
    await ctx.db.update(factura).set({
      numero: 1, fechaEmision: "2026-09-13", horaEmision: "10:00:00", fechaVencimiento: "2026-09-13",
      estadoSunat: "rechazada" as EstadoSunatFactura, codigoRespuesta: "SIN_ENVIO",
    }).where(eq(factura.id, facturaId));
    expect(await emitirFactura(ctx, facturaId)).toMatchObject({ estado: "aceptada", serieNumero: "F001-1" });
  });
});

describe("I5 · aviso de retorno al vacío para cisternas", () => {
  it("solo avisa si la unidad de la guía jala una cisterna", async () => {
    const { ctx, guiaId } = await ctxConGuia();
    expect(await avisoRetornoVacio(ctx, guiaId)).toBeNull();
    expect(await guiasConAvisoRetornoVacio(ctx, [guiaId])).toEqual(new Set());
    await ctx.db.update(vehiculo).set({ semirremolque: "cisterna" });
    expect(await avisoRetornoVacio(ctx, guiaId)).toBe(AVISO_RETORNO_VACIO);
    expect(await guiasConAvisoRetornoVacio(ctx, [guiaId])).toEqual(new Set([guiaId]));
    expect(AVISO_RETORNO_VACIO).toBe("Para cisternas en rutas largas la norma multiplica el valor referencial por 1.4: revisa el monto antes de emitir");
  });
});

describe("M4 · certificado vencido al firmar", () => {
  it("guía en modo real: no reserva número y pausa SUNAT", async () => {
    let llamadas = 0;
    const ctx = await ctxPrueba(gatewayCon({ enviarGuia: async (d) => { llamadas++; return simulado.enviarGuia(d); } }));
    const guiaId = await registrarGuiaBorrador(ctx, entradaGuia());
    ctx.simulado = false;
    ctx.certificado = { ...ctx.certificado, validoHasta: new Date("2026-09-01T00:00:00Z") };
    const r = await emitirGuia(ctx, guiaId);
    expect(r).toMatchObject({ estado: "borrador", serieNumero: expect.stringContaining("sin número") });
    expect(llamadas).toBe(0);
    expect(await leerPausaSunat(ctx)).toMatchObject({ motivo: "Tu certificado digital venció el 2026-09-01" });
  });

  it("factura en modo real: no reserva número y pausa SUNAT", async () => {
    const { ctx, guiaId } = await ctxConGuia();
    const { facturaId } = await prepararFactura(ctx, { guiaId, montoCentimos: 50000, incluyeIgv: true, formaPago: "contado" });
    ctx.simulado = false;
    ctx.facturaSimulada = false;
    ctx.certificado = { ...ctx.certificado, validoHasta: new Date("2026-09-01T00:00:00Z") };
    const r = await emitirFactura(ctx, facturaId);
    expect(r).toMatchObject({ estado: "borrador", serieNumero: expect.stringContaining("sin número") });
    expect(await leerPausaSunat(ctx)).toMatchObject({ motivo: expect.stringContaining("venció el 2026-09-01") });
    await reanudarSunat(ctx);
  });
});

describe("T6 · montos del bloque 1004 en el XML con los datos de prueba", () => {
  it("crédito: cuota neta 1108.00 y DeliveryTerms 02/03", async () => {
    const { ctx, guiaId } = await ctxConGuia();
    const { facturaId } = await prepararFactura(ctx, { guiaId, montoCentimos: 100000, incluyeIgv: false, formaPago: "credito", diasCredito: 30 });
    await emitirFactura(ctx, facturaId);
    const [f] = await ctx.db.select().from(factura).where(eq(factura.id, facturaId));
    expect(f).toMatchObject({ vrCargaEfectiva: 12834, vrCargaUtil: 256500 });
    const xml = await ctx.almacen.leerTexto(f!.rutaXml!);
    expect(xml).toContain('<cac:DeliveryTerms><cbc:ID>02</cbc:ID><cbc:Amount currencyID="PEN">128.34</cbc:Amount></cac:DeliveryTerms>');
    expect(xml).toContain('<cac:DeliveryTerms><cbc:ID>03</cbc:ID><cbc:Amount currencyID="PEN">2565.00</cbc:Amount></cac:DeliveryTerms>');
    expect(xml).toMatch(/<cbc:PaymentMeansID>Credito<\/cbc:PaymentMeansID>\s*<cbc:Amount currencyID="PEN">1108\.00<\/cbc:Amount>/);
    expect(xml).toMatch(/<cbc:PaymentMeansID>Cuota001<\/cbc:PaymentMeansID>\s*<cbc:Amount currencyID="PEN">1108\.00<\/cbc:Amount>/);
  });
});
