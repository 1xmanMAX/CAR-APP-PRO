import { cobro, contraparte, empresa, eq, factura, sql, type EstadoSunatFactura } from "@sunatapp/db";
import { SunatNoDisponibleError, SunatSimulado, type DocumentoFirmado, type RespuestaSunat, type SunatGateway } from "@sunatapp/sunat";
import { extractText, getDocumentProxy } from "unpdf";
import { afterEach, describe, expect, it } from "vitest";
import { buscarFacturaPorSerieNumero, listarCobrosPendientes, registrarCobro } from "../src/cobros/cobros";
import { ErrorNegocio } from "../src/errores";
import { emitirFactura, procesarPendientesFacturas } from "../src/facturas/emitir";
import { prepararFactura } from "../src/facturas/preparar";
import { emitirGuia } from "../src/guias/emitir";
import { registrarGuiaBorrador } from "../src/guias/registrar";
import type { Contexto } from "../src/infra/contexto";
import { crearContextoPrueba, entradaGuia } from "./helpers";

async function textoPdf(pdf: Buffer): Promise<string> {
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  return ((await extractText(doc, { mergePages: true })).text as string).replace(/\s+/g, " ");
}

const cerrables: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cerrables.length) await cerrables.pop()!();
});

let ahora = new Date("2026-09-13T15:00:00Z");

async function contextoConGuia(gateway?: SunatGateway, o: { facturaSimulada?: boolean } = {}): Promise<{ ctx: Contexto; guiaId: number }> {
  ahora = new Date("2026-09-13T15:00:00Z");
  const r = await crearContextoPrueba({ reloj: () => ahora, ...(gateway ? { gateway } : {}), ...(o.facturaSimulada !== undefined ? { facturaSimulada: o.facturaSimulada } : {}) });
  cerrables.push(r.cerrar);
  const guiaId = await registrarGuiaBorrador(r.ctx, entradaGuia());
  await emitirGuia(r.ctx, guiaId);
  return { ctx: r.ctx, guiaId };
}

describe("prepararFactura", () => {
  it("calcula montos con detracción y factura al remitente por defecto", async () => {
    const { ctx, guiaId } = await contextoConGuia();
    const { facturaId, montos } = await prepararFactura(ctx, { guiaId, montoCentimos: 100000, incluyeIgv: false, formaPago: "contado" });
    expect(montos).toMatchObject({ total: 118000, detraccionMonto: 4700, cobrable: 113300 });
    const [f] = await ctx.db.select().from(factura).where(eq(factura.id, facturaId));
    expect(f).toMatchObject({ estadoSunat: "borrador", serie: "F001", descripcion: expect.stringContaining("V001-1") });
  });

  it("no permite facturar dos veces la misma guía", async () => {
    const { ctx, guiaId } = await contextoConGuia();
    await prepararFactura(ctx, { guiaId, montoCentimos: 100000, incluyeIgv: false, formaPago: "contado" });
    await expect(prepararFactura(ctx, { guiaId, montoCentimos: 100000, incluyeIgv: false, formaPago: "contado" })).rejects.toThrow("ya tiene factura");
  });

  it("exige guía aceptada y cuenta de detracciones cuando aplica", async () => {
    const { ctx, guiaId } = await contextoConGuia();
    const borrador = await registrarGuiaBorrador(ctx, entradaGuia());
    await expect(prepararFactura(ctx, { guiaId: borrador, montoCentimos: 1000, incluyeIgv: true, formaPago: "contado" })).rejects.toBeInstanceOf(ErrorNegocio);
    await ctx.db.update(empresa).set({ cuentaDetraccionBn: null });
    await expect(prepararFactura(ctx, { guiaId, montoCentimos: 100000, incluyeIgv: false, formaPago: "contado" })).rejects.toThrow("cuenta de detracciones");
  });

  it("crédito exige días mayores a cero", async () => {
    const { ctx, guiaId } = await contextoConGuia();
    await expect(prepararFactura(ctx, { guiaId, montoCentimos: 1000, incluyeIgv: true, formaPago: "credito" })).rejects.toThrow("días de crédito");
  });
});

describe("emitirFactura", () => {
  it("emite a crédito con vencimiento, archivos y estado aceptada", async () => {
    const { ctx, guiaId } = await contextoConGuia();
    const { facturaId } = await prepararFactura(ctx, { guiaId, montoCentimos: 100000, incluyeIgv: false, formaPago: "credito", diasCredito: 30 });
    const r = await emitirFactura(ctx, facturaId);
    expect(r).toMatchObject({ estado: "aceptada", serieNumero: "F001-1" });
    const [f] = await ctx.db.select().from(factura).where(eq(factura.id, facturaId));
    expect(f).toMatchObject({ fechaEmision: "2026-09-13", fechaVencimiento: "2026-10-13", estadoCobro: "pendiente" });
    expect(await ctx.almacen.leerTexto(f!.rutaXml!)).toContain("<cbc:PaymentDueDate>2026-10-13</cbc:PaymentDueDate>");
    expect((await ctx.almacen.leer(f!.rutaPdf!)).subarray(0, 5).toString()).toBe("%PDF-");
    expect(await emitirFactura(ctx, facturaId)).toMatchObject({ serieNumero: "F001-1" }); // idempotente
  });

  it("el PDF de la factura lleva el sello DOCUMENTO SIMULADO cuando facturaSimulada es true, y no cuando es false", async () => {
    const { ctx: ctxSimulado, guiaId: guiaId1 } = await contextoConGuia(undefined, { facturaSimulada: true });
    const { facturaId: facturaId1 } = await prepararFactura(ctxSimulado, { guiaId: guiaId1, montoCentimos: 100000, incluyeIgv: false, formaPago: "contado" });
    const r1 = await emitirFactura(ctxSimulado, facturaId1);
    const [f1] = await ctxSimulado.db.select().from(factura).where(eq(factura.id, facturaId1));
    expect(await textoPdf(await ctxSimulado.almacen.leer(f1!.rutaPdf!))).toContain("DOCUMENTO SIMULADO");
    expect(r1.estado).toBe("aceptada");

    // facturaSimulada=false representa un contexto real + ambiente producción (finding 1): el
    // PDF no debe llevar el sello de simulado.
    const { ctx: ctxReal, guiaId: guiaId2 } = await contextoConGuia(undefined, { facturaSimulada: false });
    const { facturaId: facturaId2 } = await prepararFactura(ctxReal, { guiaId: guiaId2, montoCentimos: 100000, incluyeIgv: false, formaPago: "contado" });
    await emitirFactura(ctxReal, facturaId2);
    const [f2] = await ctxReal.db.select().from(factura).where(eq(factura.id, facturaId2));
    expect(await textoPdf(await ctxReal.almacen.leer(f2!.rutaPdf!))).not.toContain("DOCUMENTO SIMULADO");
  });

  it("SUNAT caído: pendiente y luego enviada por el proceso de fondo", async () => {
    let caido = true;
    const base = new SunatSimulado({ demoraMs: 0 });
    const gw: SunatGateway = {
      enviarGuia: (d: DocumentoFirmado) => base.enviarGuia(d),
      consultarTicket: (t: string) => base.consultarTicket(t),
      enviarFactura: async (d: DocumentoFirmado) => {
        if (caido) throw new SunatNoDisponibleError("sin red");
        return base.enviarFactura(d);
      },
    };
    const { ctx, guiaId } = await contextoConGuia(gw);
    const { facturaId } = await prepararFactura(ctx, { guiaId, montoCentimos: 50000, incluyeIgv: true, formaPago: "contado" });
    expect((await emitirFactura(ctx, facturaId)).estado).toBe("pendiente_envio");
    caido = false;
    ahora = new Date(ahora.getTime() + 6 * 60_000);
    expect(await procesarPendientesFacturas(ctx)).toEqual([expect.objectContaining({ id: facturaId, estado: "aceptada" })]);
  });

  it("no envía dos veces si hay un envío en curso (doble clic / solape con el fondo)", async () => {
    let llamadas = 0;
    let liberar!: (r: RespuestaSunat) => void;
    const gw: SunatGateway = {
      enviarGuia: (d: DocumentoFirmado) => new SunatSimulado({ demoraMs: 0 }).enviarGuia(d),
      consultarTicket: (t: string) => new SunatSimulado({ demoraMs: 0 }).consultarTicket(t),
      enviarFactura: () => {
        llamadas++;
        return new Promise<RespuestaSunat>((resolve) => {
          liberar = resolve;
        });
      },
    };
    const { ctx, guiaId } = await contextoConGuia(gw);
    const { facturaId } = await prepararFactura(ctx, { guiaId, montoCentimos: 50000, incluyeIgv: true, formaPago: "contado" });

    const primera = emitirFactura(ctx, facturaId);
    // Deja que la primera reserve la factura y llegue a llamar al gateway (firma + validación
    // XSD incluidas) antes de que se resuelva su promesa — simula un envío real en curso.
    const limite = Date.now() + 5000;
    while (llamadas < 1 && Date.now() < limite) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(llamadas).toBe(1);
    const segunda = await emitirFactura(ctx, facturaId);

    expect(segunda.estado).toBe("pendiente_envio");
    expect(llamadas).toBe(1); // el segundo emitirFactura no volvió a llamar al gateway

    liberar({ estado: "aceptada", codigo: "0", mensaje: "OK", notas: [] });
    expect((await primera).estado).toBe("aceptada");
  });

  it("un error de comunicación que no es caída de SUNAT mantiene pendiente_envio con el mensaje", async () => {
    const gw: SunatGateway = {
      enviarGuia: (d: DocumentoFirmado) => new SunatSimulado({ demoraMs: 0 }).enviarGuia(d),
      consultarTicket: (t: string) => new SunatSimulado({ demoraMs: 0 }).consultarTicket(t),
      enviarFactura: async () => {
        throw new Error("Credenciales SOL inválidas");
      },
    };
    const { ctx, guiaId } = await contextoConGuia(gw);
    const { facturaId } = await prepararFactura(ctx, { guiaId, montoCentimos: 50000, incluyeIgv: true, formaPago: "contado" });
    const r = await emitirFactura(ctx, facturaId);
    expect(r.estado).toBe("pendiente_envio");
    expect(r.mensaje).toBe("Error al comunicarse con SUNAT: Credenciales SOL inválidas");
  });

  it("agota los reintentos y pasa a rechazada SIN_ENVIO, reportada en los cambios del proceso de fondo", async () => {
    const gw: SunatGateway = {
      enviarGuia: (d: DocumentoFirmado) => new SunatSimulado({ demoraMs: 0 }).enviarGuia(d),
      consultarTicket: (t: string) => new SunatSimulado({ demoraMs: 0 }).consultarTicket(t),
      enviarFactura: async () => {
        throw new SunatNoDisponibleError("sin red");
      },
    };
    const { ctx, guiaId } = await contextoConGuia(gw);
    const { facturaId } = await prepararFactura(ctx, { guiaId, montoCentimos: 50000, incluyeIgv: true, formaPago: "contado" });
    // Simula una factura que ya reservó número/fecha y acumuló 287 intentos fallidos previos.
    await ctx.db.update(factura).set({
      numero: 1,
      fechaEmision: "2026-09-13",
      horaEmision: "10:00:00",
      fechaVencimiento: "2026-09-13",
      estadoSunat: "pendiente_envio" as EstadoSunatFactura,
      intentos: 287,
      proximoIntentoEn: null,
      actualizadoEn: new Date(ahora.getTime() - 120_000),
    }).where(eq(factura.id, facturaId));

    const cambios = await procesarPendientesFacturas(ctx);
    expect(cambios).toEqual([
      expect.objectContaining({ id: facturaId, estado: "rechazada", codigo: "SIN_ENVIO", mensaje: "No se pudo enviar a SUNAT durante 24 horas. Revisa la conexión y vuelve a emitir." }),
    ]);
  });

  it("si falla el guardado del PDF, la factura queda aceptada con rutaPdf null y no se reenvía a SUNAT", async () => {
    let llamadasEnvio = 0;
    const base = new SunatSimulado({ demoraMs: 0 });
    const gw: SunatGateway = {
      enviarGuia: (d: DocumentoFirmado) => base.enviarGuia(d),
      consultarTicket: (t: string) => base.consultarTicket(t),
      enviarFactura: (d: DocumentoFirmado) => {
        llamadasEnvio++;
        return base.enviarFactura(d);
      },
    };
    const { ctx, guiaId } = await contextoConGuia(gw);
    const { facturaId } = await prepararFactura(ctx, { guiaId, montoCentimos: 50000, incluyeIgv: true, formaPago: "contado" });

    let fallarPdf = true;
    const almacenOriginal = ctx.almacen;
    ctx.almacen = {
      ...almacenOriginal,
      guardar: async (ruta: string, contenido: Buffer | string) => {
        if (fallarPdf && ruta.endsWith(".pdf")) throw new Error("disco lleno (simulado)");
        return almacenOriginal.guardar(ruta, contenido);
      },
    };

    // SUNAT acepta la factura, pero el guardado del PDF falla: el resultado de SUNAT no debe
    // perderse ni reintentarse como envío — queda "aceptada" con rutaPdf null.
    const r = await emitirFactura(ctx, facturaId);
    expect(r).toMatchObject({ estado: "aceptada", rutaPdf: null });
    expect(llamadasEnvio).toBe(1);
    const [f] = await ctx.db.select().from(factura).where(eq(factura.id, facturaId));
    expect(f).toMatchObject({ estadoSunat: "aceptada", rutaPdf: null });

    // Un reintento directo tampoco debe volver a llamar a SUNAT: la factura ya está "aceptada".
    await emitirFactura(ctx, facturaId);
    expect(llamadasEnvio).toBe(1);

    // Una vez que el almacenamiento vuelve a funcionar, el proceso de fondo completa el PDF sin
    // tocar SUNAT.
    fallarPdf = false;
    const cambios = await procesarPendientesFacturas(ctx);
    expect(llamadasEnvio).toBe(1); // sigue sin volver a llamar a enviarFactura
    expect(cambios).toEqual([expect.objectContaining({ id: facturaId, estado: "aceptada", rutaPdf: expect.stringContaining(".pdf") })]);
    const [f2] = await ctx.db.select().from(factura).where(eq(factura.id, facturaId));
    expect(f2!.rutaPdf).not.toBeNull();
    expect((await ctx.almacen.leer(f2!.rutaPdf!)).subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("el resultado de SUNAT (rutaXml/intentos/estadoSunat/código/mensaje) queda persistido en un único update ANTES de intentar el CDR; si el CDR falla, la factura queda aceptada con rutaCdr null y no se reenvía a SUNAT", async () => {
    let llamadasEnvio = 0;
    const base = new SunatSimulado({ demoraMs: 0 });
    const gw: SunatGateway = {
      enviarGuia: (d: DocumentoFirmado) => base.enviarGuia(d),
      consultarTicket: (t: string) => base.consultarTicket(t),
      enviarFactura: (d: DocumentoFirmado) => {
        llamadasEnvio++;
        return base.enviarFactura(d);
      },
    };
    const { ctx, guiaId } = await contextoConGuia(gw);
    const { facturaId } = await prepararFactura(ctx, { guiaId, montoCentimos: 50000, incluyeIgv: true, formaPago: "contado" });

    const almacenOriginal = ctx.almacen;
    let estadoAlIntentarCdr: { estadoSunat: string; rutaXml: string | null; intentos: number } | undefined;
    ctx.almacen = {
      ...almacenOriginal,
      guardar: async (ruta: string, contenido: Buffer | string) => {
        if (ruta.startsWith("facturas/R-")) {
          // Comprueba el estado de la factura en la BD justo cuando se intenta guardar el CDR:
          // el resultado (rutaXml, intentos, estadoSunat, código, mensaje) ya debe estar
          // persistido en un único update previo, no partido en dos escrituras con el CDR en
          // medio (finding 4).
          const [f] = await ctx.db.select().from(factura).where(eq(factura.id, facturaId));
          estadoAlIntentarCdr = { estadoSunat: f!.estadoSunat, rutaXml: f!.rutaXml, intentos: f!.intentos };
          throw new Error("disco lleno (simulado)");
        }
        return almacenOriginal.guardar(ruta, contenido);
      },
    };

    // SUNAT acepta la factura, pero el guardado del CDR falla: el resultado de SUNAT no debe
    // perderse ni reintentarse como envío — queda "aceptada" con rutaCdr null.
    const r = await emitirFactura(ctx, facturaId);

    expect(estadoAlIntentarCdr).toMatchObject({ estadoSunat: "aceptada", intentos: 0 });
    expect(estadoAlIntentarCdr!.rutaXml).not.toBeNull();

    expect(r).toMatchObject({ estado: "aceptada" });
    expect(llamadasEnvio).toBe(1);
    const [f] = await ctx.db.select().from(factura).where(eq(factura.id, facturaId));
    expect(f).toMatchObject({ estadoSunat: "aceptada", rutaCdr: null });
    expect(f!.rutaPdf).not.toBeNull();
    expect((await ctx.almacen.leer(f!.rutaPdf!)).subarray(0, 5).toString()).toBe("%PDF-");

    // Un reintento directo, y una pasada de fondo, tampoco vuelven a llamar a SUNAT.
    await emitirFactura(ctx, facturaId);
    await procesarPendientesFacturas(ctx);
    expect(llamadasEnvio).toBe(1);
  });

  it("un reintento de factura reenvía el mismo XML firmado (byte a byte) aunque cambie la razón social del cliente", async () => {
    let caido = true;
    const base = new SunatSimulado({ demoraMs: 0 });
    const xmlsEnviados: string[] = [];
    const gw: SunatGateway = {
      enviarGuia: (d: DocumentoFirmado) => base.enviarGuia(d),
      consultarTicket: (t: string) => base.consultarTicket(t),
      enviarFactura: async (d: DocumentoFirmado) => {
        xmlsEnviados.push(d.xml);
        if (caido) throw new SunatNoDisponibleError("sin red");
        return base.enviarFactura(d);
      },
    };
    const { ctx, guiaId } = await contextoConGuia(gw);
    const { facturaId } = await prepararFactura(ctx, { guiaId, montoCentimos: 50000, incluyeIgv: true, formaPago: "contado" });
    expect((await emitirFactura(ctx, facturaId)).estado).toBe("pendiente_envio");
    expect(xmlsEnviados).toHaveLength(1);

    const [f] = await ctx.db.select().from(factura).where(eq(factura.id, facturaId));
    await ctx.db.update(contraparte).set({ razonSocial: "OTRO NOMBRE SAC" }).where(eq(contraparte.id, f!.clienteId));

    caido = false;
    ahora = new Date(ahora.getTime() + 6 * 60_000);
    const cambios = await procesarPendientesFacturas(ctx);

    expect(cambios).toEqual([expect.objectContaining({ id: facturaId, estado: "aceptada" })]);
    expect(xmlsEnviados).toHaveLength(2);
    expect(xmlsEnviados[1]).toBe(xmlsEnviados[0]); // byte-idéntico: se reenvía el XML ya firmado
    expect(xmlsEnviados[1]).toContain("DISTRIBUIDORA SAC"); // no se reconstruyó con la razón social nueva
  });

  it("aísla el fallo de una factura del resto durante la pasada de fondo", async () => {
    const { ctx, guiaId: guiaId1 } = await contextoConGuia();
    const { facturaId: facturaId1 } = await prepararFactura(ctx, { guiaId: guiaId1, montoCentimos: 50000, incluyeIgv: true, formaPago: "contado" });
    const guiaId2 = await registrarGuiaBorrador(ctx, entradaGuia());
    await emitirGuia(ctx, guiaId2);
    const { facturaId: facturaId2 } = await prepararFactura(ctx, { guiaId: guiaId2, montoCentimos: 50000, incluyeIgv: true, formaPago: "contado" });

    // Sustituye el gateway después de preparar ambas facturas: solo afecta el envío de facturas.
    // Simula que, justo cuando el envío de la factura 1 llega a SUNAT, esa factura desaparece por
    // una condición de carrera (p. ej. borrada por otro proceso) — un fallo genuinamente
    // inesperado, no una simple caída de red ni un fallo de almacenamiento.
    const base = new SunatSimulado({ demoraMs: 0 });
    ctx.gateway = {
      enviarGuia: (d: DocumentoFirmado) => base.enviarGuia(d),
      consultarTicket: (t: string) => base.consultarTicket(t),
      enviarFactura: async (d: DocumentoFirmado) => {
        const r = await base.enviarFactura(d);
        if (d.nombreArchivo.includes("-01-F001-10")) {
          await ctx.db.delete(factura).where(eq(factura.id, facturaId1));
        }
        return r;
      },
    };

    // Deja ambas facturas en "pendiente_envio", como si un intento previo hubiera reservado
    // número/fecha y luego se hubiera interrumpido antes de enviar.
    const viejo = new Date(ahora.getTime() - 120_000);
    await ctx.db.update(factura).set({
      numero: 10, fechaEmision: "2026-09-13", horaEmision: "10:00:00", fechaVencimiento: "2026-09-13",
      estadoSunat: "pendiente_envio" as EstadoSunatFactura, intentos: 0, proximoIntentoEn: null, actualizadoEn: viejo,
    }).where(eq(factura.id, facturaId1));
    await ctx.db.update(factura).set({
      numero: 11, fechaEmision: "2026-09-13", horaEmision: "10:00:00", fechaVencimiento: "2026-09-13",
      estadoSunat: "pendiente_envio" as EstadoSunatFactura, intentos: 0, proximoIntentoEn: null, actualizadoEn: viejo,
    }).where(eq(factura.id, facturaId2));

    const cambios = await procesarPendientesFacturas(ctx);
    expect(cambios).toEqual([expect.objectContaining({ id: facturaId2, estado: "aceptada" })]);
    const restante = await ctx.db.select().from(factura).where(eq(factura.id, facturaId1));
    expect(restante).toHaveLength(0); // la factura 1 desapareció, pero no bloqueó a la 2
  });

  it("al reemitir una factura desde rechazada, si la preparación falla no reenvía el XML rechazado", async () => {
    let acepta = false;
    const rechazar = new SunatSimulado({ rechazo: { codigo: "2800", mensaje: "dato inválido" }, demoraMs: 0 });
    const aceptar = new SunatSimulado({ demoraMs: 0 });
    const gw: SunatGateway = {
      enviarGuia: (d: DocumentoFirmado) => aceptar.enviarGuia(d),
      consultarTicket: (t: string) => aceptar.consultarTicket(t),
      enviarFactura: (d: DocumentoFirmado) => (acepta ? aceptar : rechazar).enviarFactura(d),
    };
    const { ctx, guiaId } = await contextoConGuia(gw);
    const { facturaId } = await prepararFactura(ctx, { guiaId, montoCentimos: 50000, incluyeIgv: true, formaPago: "contado" });

    expect((await emitirFactura(ctx, facturaId)).estado).toBe("rechazada");
    const [f1] = await ctx.db.select().from(factura).where(eq(factura.id, facturaId));
    const xmlA = await ctx.almacen.leerTexto(f1!.rutaXml!);

    ahora = new Date(ahora.getTime() + 10 * 60_000);
    const almacenOriginal = ctx.almacen;
    ctx.almacen = {
      ...almacenOriginal,
      guardar: async (ruta: string, contenido: Buffer | string) => {
        if (ruta.endsWith(".xml")) throw new Error("disco lleno");
        return almacenOriginal.guardar(ruta, contenido);
      },
    };
    expect((await emitirFactura(ctx, facturaId)).estado).toBe("pendiente_envio");
    const [f2] = await ctx.db.select().from(factura).where(eq(factura.id, facturaId));
    expect(f2!.rutaXml).toBeNull();

    ctx.almacen = almacenOriginal;
    acepta = true;
    ahora = new Date(ahora.getTime() + 10 * 60_000);
    const cambios = await procesarPendientesFacturas(ctx);
    expect(cambios).toEqual(expect.arrayContaining([expect.objectContaining({ id: facturaId, estado: "aceptada" })]));

    const [f3] = await ctx.db.select().from(factura).where(eq(factura.id, facturaId));
    const xmlB = await ctx.almacen.leerTexto(f3!.rutaXml!);
    expect(xmlB).not.toBe(xmlA);
  });
});

describe("cobros", () => {
  async function facturaEmitida(diasCredito?: number) {
    const { ctx, guiaId } = await contextoConGuia();
    const { facturaId } = await prepararFactura(ctx, {
      guiaId, montoCentimos: 100000, incluyeIgv: false,
      formaPago: diasCredito ? "credito" : "contado", ...(diasCredito ? { diasCredito } : {}),
    });
    await emitirFactura(ctx, facturaId);
    return { ctx, facturaId };
  }

  it("pago parcial y luego total sobre el monto cobrable (sin detracción)", async () => {
    const { ctx, facturaId } = await facturaEmitida();
    expect(await registrarCobro(ctx, { facturaId, montoCentimos: 50000, fecha: "2026-09-14", medio: "transferencia" })).toEqual({ estadoCobro: "parcial", saldo: 63300 });
    expect(await registrarCobro(ctx, { facturaId, montoCentimos: 63300, fecha: "2026-09-15", medio: "efectivo" })).toEqual({ estadoCobro: "pagada", saldo: 0 });
    await expect(registrarCobro(ctx, { facturaId, montoCentimos: 1, fecha: "2026-09-15", medio: "otro" })).rejects.toThrow("supera el saldo");
  });

  it("dos cobros concurrentes que exceden el saldo: solo uno tiene éxito y nunca se sobrepasa el cobrable", async () => {
    const { ctx, facturaId } = await facturaEmitida(); // total 118000, detracción 4700, cobrable 113300
    const resultados = await Promise.allSettled([
      registrarCobro(ctx, { facturaId, montoCentimos: 70000, fecha: "2026-09-14", medio: "transferencia" }),
      registrarCobro(ctx, { facturaId, montoCentimos: 70000, fecha: "2026-09-14", medio: "efectivo" }),
    ]);
    const exitosos = resultados.filter((r) => r.status === "fulfilled");
    const fallidos = resultados.filter((r) => r.status === "rejected");
    expect(exitosos).toHaveLength(1); // el segundo (70000+70000 > 113300) debe fallar, no sobre-cobrar
    expect(fallidos).toHaveLength(1);

    const [fila] = await ctx.db.select({ suma: sql<string>`coalesce(sum(${cobro.monto}), 0)` }).from(cobro).where(eq(cobro.facturaId, facturaId));
    const totalCobrado = Number(fila?.suma ?? 0);
    expect(totalCobrado).toBe(70000);
    expect(totalCobrado).toBeLessThanOrEqual(113300);

    const [f] = await ctx.db.select().from(factura).where(eq(factura.id, facturaId));
    expect(f!.estadoCobro).toBe("parcial"); // consistente con el único cobro que sí se aplicó
    const exitoso = exitosos[0] as PromiseFulfilledResult<{ estadoCobro: string; saldo: number }>;
    expect(exitoso.value).toEqual({ estadoCobro: "parcial", saldo: 43300 });
  });

  it("busca por serie-número con o sin ceros", async () => {
    const { ctx, facturaId } = await facturaEmitida();
    expect(await buscarFacturaPorSerieNumero(ctx, "f001-00000001")).toEqual({ id: facturaId });
    expect(await buscarFacturaPorSerieNumero(ctx, "F001-99")).toBeNull();
    expect(await buscarFacturaPorSerieNumero(ctx, "basura")).toBeNull();
  });

  it("lista pendientes, vence hoy y vencidas con totales", async () => {
    const { ctx } = await facturaEmitida(30);
    let lista = await listarCobrosPendientes(ctx);
    expect(lista.filas).toEqual([expect.objectContaining({ serieNumero: "F001-1", estado: "pendiente", saldo: 113300, fechaVencimiento: "2026-10-13" })]);
    expect(lista).toMatchObject({ totalPendiente: 113300, totalVencido: 0 });

    ahora = new Date("2026-10-13T15:00:00Z");
    expect((await listarCobrosPendientes(ctx)).filas[0]?.estado).toBe("vence_hoy");

    ahora = new Date("2026-10-20T15:00:00Z");
    lista = await listarCobrosPendientes(ctx);
    expect(lista.filas[0]?.estado).toBe("vencida");
    expect(lista.totalVencido).toBe(113300);
  });
});
