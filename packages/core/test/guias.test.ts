import { contraparte, correlativo, eq, guiaTransportista } from "@sunatapp/db";
import { SunatNoDisponibleError, SunatSimulado, type DocumentoFirmado, type SunatGateway } from "@sunatapp/sunat";
import { afterEach, describe, expect, it } from "vitest";
import { ErrorValidacion } from "../src/errores";
import { emitirGuia, procesarPendientesGuias } from "../src/guias/emitir";
import { registrarGuiaBorrador } from "../src/guias/registrar";
import { validarEntradaGuia } from "../src/guias/validar";
import { crearContextoPrueba, entradaGuia } from "./helpers";

class GatewayControlado implements SunatGateway {
  envios = 0;
  caido = true;
  constructor(private readonly base: SunatGateway) {}
  async enviarGuia(doc: DocumentoFirmado) {
    this.envios++;
    if (this.caido) throw new SunatNoDisponibleError("sin red");
    return this.base.enviarGuia(doc);
  }
  consultarTicket(t: string) { return this.base.consultarTicket(t); }
  enviarFactura(doc: DocumentoFirmado) { return this.base.enviarFactura(doc); }
}

const cerrables: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cerrables.length) await cerrables.pop()!();
});

async function contexto(o: Parameters<typeof crearContextoPrueba>[0] = {}) {
  const r = await crearContextoPrueba(o);
  cerrables.push(r.cerrar);
  return r.ctx;
}

describe("validarEntradaGuia", () => {
  it("acepta una entrada correcta", () => {
    expect(validarEntradaGuia(entradaGuia())).toEqual([]);
  });

  it("explica cada problema en español", () => {
    const e = entradaGuia();
    e.remitente.numeroDoc = "20131312956";
    e.llegada.ubigeo = "999999";
    e.pesoBruto = "0";
    e.items = [];
    e.fechaTraslado = "14/09/2026";
    expect(validarEntradaGuia(e)).toEqual([
      "Fecha de traslado inválida (use AAAA-MM-DD)",
      "RUC/DNI del remitente inválido",
      "Ubigeo de llegada no existe",
      "El peso bruto debe ser mayor a cero",
      "Debe haber al menos un bien",
    ]);
  });
});

describe("registrarGuiaBorrador", () => {
  it("crea contrapartes reutilizables y usa el vehículo y conductor activos", async () => {
    const ctx = await contexto();
    const id1 = await registrarGuiaBorrador(ctx, entradaGuia());
    await registrarGuiaBorrador(ctx, entradaGuia());
    expect(await ctx.db.select().from(contraparte)).toHaveLength(2);
    const [g] = await ctx.db.select().from(guiaTransportista).where(eq(guiaTransportista.id, id1));
    expect(g).toMatchObject({ estado: "borrador", numero: null, serie: "V001" });
  });

  it("rechaza entradas inválidas", async () => {
    const ctx = await contexto();
    const e = entradaGuia();
    e.pesoBruto = "-1";
    await expect(registrarGuiaBorrador(ctx, e)).rejects.toBeInstanceOf(ErrorValidacion);
  });
});

describe("emitirGuia", () => {
  it("flujo feliz: número, XML, CDR, PDF y estado aceptada", async () => {
    const ctx = await contexto();
    const r = await emitirGuia(ctx, await registrarGuiaBorrador(ctx, entradaGuia()));
    expect(r).toMatchObject({ estado: "aceptada", serieNumero: "V001-1", codigo: "0" });
    const [g] = await ctx.db.select().from(guiaTransportista);
    expect(await ctx.almacen.leerTexto(g!.rutaXml!)).toContain("<cbc:ID>V001-1</cbc:ID>");
    expect((await ctx.almacen.leer(g!.rutaPdf!)).subarray(0, 5).toString()).toBe("%PDF-");
    expect(g!.rutaCdr).toBe("guias/R-20606433094-31-V001-1.zip");
  });

  it("es idempotente: emitir dos veces no reenvía ni gasta otro número", async () => {
    const gw = new GatewayControlado(new SunatSimulado({ demoraMs: 0 }));
    gw.caido = false;
    const ctx = await contexto({ gateway: gw });
    const id = await registrarGuiaBorrador(ctx, entradaGuia());
    await emitirGuia(ctx, id);
    const segunda = await emitirGuia(ctx, id);
    expect(segunda.serieNumero).toBe("V001-1");
    expect(gw.envios).toBe(1);
    expect((await ctx.db.select().from(correlativo))[0]?.ultimoNumero).toBe(1);
  });

  it("SUNAT caído deja la guía pendiente y el proceso de fondo la completa con el mismo número", async () => {
    let ahora = new Date("2026-09-13T15:00:00Z");
    const gw = new GatewayControlado(new SunatSimulado({ demoraMs: 0 }));
    const ctx = await contexto({ gateway: gw, reloj: () => ahora });
    const id = await registrarGuiaBorrador(ctx, entradaGuia());
    expect(await emitirGuia(ctx, id)).toMatchObject({ estado: "pendiente_envio", serieNumero: "V001-1" });

    expect(await procesarPendientesGuias(ctx)).toEqual([]); // aún no toca reintentar
    gw.caido = false;
    ahora = new Date(ahora.getTime() + 6 * 60_000);
    const cambios = await procesarPendientesGuias(ctx);
    expect(cambios).toEqual([expect.objectContaining({ id, estado: "aceptada", serieNumero: "V001-1" })]);
  });

  it("rechazo de SUNAT queda registrado y se puede reemitir con el mismo número", async () => {
    const ctx = await contexto({ gateway: new SunatSimulado({ demoraMs: 0, rechazo: { codigo: "2556", mensaje: "Placa inválida" } }) });
    const id = await registrarGuiaBorrador(ctx, entradaGuia());
    expect(await emitirGuia(ctx, id)).toMatchObject({ estado: "rechazada", codigo: "2556", mensaje: "Placa inválida" });
    ctx.gateway = new SunatSimulado({ demoraMs: 0 });
    expect(await emitirGuia(ctx, id)).toMatchObject({ estado: "aceptada", serieNumero: "V001-1" });
  });

  it("si el ticket tarda, queda enviada y el proceso de fondo la termina", async () => {
    let ms = Date.parse("2026-09-13T15:00:00Z");
    const ctx = await contexto({
      gateway: new SunatSimulado({ demoraMs: 10 * 60_000, ahora: () => ms }),
      reloj: () => new Date(ms),
    });
    const id = await registrarGuiaBorrador(ctx, entradaGuia());
    expect((await emitirGuia(ctx, id)).estado).toBe("enviada");
    ms += 11 * 60_000;
    expect(await procesarPendientesGuias(ctx)).toEqual([expect.objectContaining({ id, estado: "aceptada" })]);
  });
});
