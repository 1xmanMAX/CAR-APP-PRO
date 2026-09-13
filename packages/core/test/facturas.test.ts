import { empresa, eq, factura, type EstadoSunatFactura } from "@sunatapp/db";
import { SunatNoDisponibleError, SunatSimulado, type DocumentoFirmado, type RespuestaSunat, type SunatGateway } from "@sunatapp/sunat";
import { afterEach, describe, expect, it } from "vitest";
import { buscarFacturaPorSerieNumero, listarCobrosPendientes, registrarCobro } from "../src/cobros/cobros";
import { ErrorNegocio } from "../src/errores";
import { emitirFactura, procesarPendientesFacturas } from "../src/facturas/emitir";
import { prepararFactura } from "../src/facturas/preparar";
import { emitirGuia } from "../src/guias/emitir";
import { registrarGuiaBorrador } from "../src/guias/registrar";
import type { Contexto } from "../src/infra/contexto";
import { crearContextoPrueba, entradaGuia } from "./helpers";

const cerrables: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cerrables.length) await cerrables.pop()!();
});

let ahora = new Date("2026-09-13T15:00:00Z");

async function contextoConGuia(gateway?: SunatGateway): Promise<{ ctx: Contexto; guiaId: number }> {
  ahora = new Date("2026-09-13T15:00:00Z");
  const r = await crearContextoPrueba({ reloj: () => ahora, ...(gateway ? { gateway } : {}) });
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

  it("aísla el fallo de una factura del resto durante la pasada de fondo", async () => {
    const base = new SunatSimulado({ demoraMs: 0 });
    const gw: SunatGateway = {
      enviarGuia: (d: DocumentoFirmado) => base.enviarGuia(d),
      consultarTicket: (t: string) => base.consultarTicket(t),
      enviarFactura: (d: DocumentoFirmado) => base.enviarFactura(d),
    };
    const { ctx, guiaId: guiaId1 } = await contextoConGuia(gw);
    const { facturaId: facturaId1 } = await prepararFactura(ctx, { guiaId: guiaId1, montoCentimos: 50000, incluyeIgv: true, formaPago: "contado" });
    const guiaId2 = await registrarGuiaBorrador(ctx, entradaGuia());
    await emitirGuia(ctx, guiaId2);
    const { facturaId: facturaId2 } = await prepararFactura(ctx, { guiaId: guiaId2, montoCentimos: 50000, incluyeIgv: true, formaPago: "contado" });

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

    // El almacén falla solo al guardar el PDF de la factura 1 (fallo inesperado después de que
    // SUNAT ya respondió): debe aislarse en procesarPendientesFacturas sin afectar a la factura 2.
    const almacenOriginal = ctx.almacen;
    ctx.almacen = {
      ...almacenOriginal,
      guardar: async (ruta: string, contenido: Buffer | string) => {
        if (ruta.includes("-01-F001-10") && ruta.endsWith(".pdf")) throw new Error("disco lleno (simulado)");
        return almacenOriginal.guardar(ruta, contenido);
      },
    };

    const cambios = await procesarPendientesFacturas(ctx);
    expect(cambios).toEqual([expect.objectContaining({ id: facturaId2, estado: "aceptada" })]);
    const [f1] = await ctx.db.select().from(factura).where(eq(factura.id, facturaId1));
    expect(f1!.estadoSunat).toBe("pendiente_envio"); // no completó, pero tampoco tumbó la pasada
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
