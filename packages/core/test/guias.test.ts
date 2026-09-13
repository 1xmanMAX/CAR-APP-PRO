import { contraparte, correlativo, eq, guiaTransportista } from "@sunatapp/db";
import { SunatNoDisponibleError, SunatSimulado, type DocumentoFirmado, type SunatGateway } from "@sunatapp/sunat";
import { afterEach, describe, expect, it } from "vitest";
import { ErrorValidacion } from "../src/errores";
import { aplicarRespuestaGuia, emitirGuia, MAX_INTENTOS, procesarPendientesGuias, type ResultadoEmision } from "../src/guias/emitir";
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

  it("evita doble envío si ya hay un envío en curso (lease por proximoIntentoEn)", async () => {
    const ctx = await contexto();
    const id = await registrarGuiaBorrador(ctx, entradaGuia());
    const base = new SunatSimulado({ demoraMs: 0 });
    let envios = 0;
    let segundaLlamada: ResultadoEmision | undefined;
    ctx.gateway = {
      async enviarGuia(doc: DocumentoFirmado) {
        envios++;
        // Reentrada mientras el primer envío sigue "en curso": debe encontrar la guía
        // reservada con un lease futuro y no volver a llamar a enviarGuia.
        if (envios === 1) segundaLlamada = await emitirGuia(ctx, id);
        return base.enviarGuia(doc);
      },
      consultarTicket: (t: string) => base.consultarTicket(t),
      enviarFactura: (doc: DocumentoFirmado) => base.enviarFactura(doc),
    };
    const primera = await emitirGuia(ctx, id);
    expect(envios).toBe(1);
    expect(segundaLlamada).toMatchObject({ estado: "pendiente_envio", serieNumero: "V001-1" });
    expect(primera.estado).toBe("aceptada");
  });

  it("conserva fechaEmision y horaEmision al reintentar tras una caída de SUNAT", async () => {
    let ahora = new Date("2026-09-13T15:00:00Z");
    const gw = new GatewayControlado(new SunatSimulado({ demoraMs: 0 }));
    const ctx = await contexto({ gateway: gw, reloj: () => ahora });
    const id = await registrarGuiaBorrador(ctx, entradaGuia());
    await emitirGuia(ctx, id);
    const [antes] = await ctx.db.select().from(guiaTransportista).where(eq(guiaTransportista.id, id));

    gw.caido = false;
    ahora = new Date(ahora.getTime() + 6 * 60_000);
    await procesarPendientesGuias(ctx);
    const [despues] = await ctx.db.select().from(guiaTransportista).where(eq(guiaTransportista.id, id));
    expect(despues).toMatchObject({ fechaEmision: antes!.fechaEmision, horaEmision: antes!.horaEmision, estado: "aceptada" });
  });

  it("aplicarRespuestaGuia con un ticket obsoleto no hace nada", async () => {
    const ctx = await contexto();
    const id = await registrarGuiaBorrador(ctx, entradaGuia());
    await ctx.db
      .update(guiaTransportista)
      .set({ estado: "enviada", numero: 1, fechaEmision: "2026-09-14", horaEmision: "10:00:00", ticket: "TICKET-VIGENTE" })
      .where(eq(guiaTransportista.id, id));

    const aplicado = await aplicarRespuestaGuia(ctx, id, { estado: "aceptada", codigo: "0", mensaje: "OK", notas: [] }, "TICKET-OBSOLETO");
    expect(aplicado).toBe(false);

    const [g] = await ctx.db.select().from(guiaTransportista).where(eq(guiaTransportista.id, id));
    expect(g).toMatchObject({ estado: "enviada", ticket: "TICKET-VIGENTE", rutaPdf: null, rutaCdr: null });
  });

  it("un error no relacionado con disponibilidad al enviar mantiene pendiente_envio", async () => {
    const ctx = await contexto({
      gateway: {
        async enviarGuia() {
          throw new Error("Credenciales inválidas");
        },
        consultarTicket: () => { throw new Error("no debería llamarse"); },
        enviarFactura: () => { throw new Error("no debería llamarse"); },
      },
    });
    const id = await registrarGuiaBorrador(ctx, entradaGuia());
    const r = await emitirGuia(ctx, id);
    expect(r.estado).toBe("pendiente_envio");
    const [g] = await ctx.db.select().from(guiaTransportista).where(eq(guiaTransportista.id, id));
    expect(g!.mensajeRespuesta).toBe("Error al comunicarse con SUNAT: Credenciales inválidas");
    expect(g!.intentos).toBe(1);
    expect(g!.proximoIntentoEn).not.toBeNull();
  });

  it("una guía envenenada no bloquea el procesamiento de las demás", async () => {
    let ahora = new Date("2026-09-13T15:00:00Z");
    const gwCaido = new GatewayControlado(new SunatSimulado({ demoraMs: 0 }));
    const ctx = await contexto({ gateway: gwCaido, reloj: () => ahora });
    const idA = await registrarGuiaBorrador(ctx, entradaGuia());
    const idB = await registrarGuiaBorrador(ctx, entradaGuia());
    await emitirGuia(ctx, idA); // queda pendiente_envio (SUNAT caído)
    await emitirGuia(ctx, idB); // queda pendiente_envio (SUNAT caído)

    const base = new SunatSimulado({ demoraMs: 0 });
    ctx.gateway = {
      async enviarGuia(doc: DocumentoFirmado) {
        if (doc.nombreArchivo.endsWith("V001-1")) throw new Error("Servicio caído");
        return base.enviarGuia(doc);
      },
      consultarTicket: (t: string) => base.consultarTicket(t),
      enviarFactura: (doc: DocumentoFirmado) => base.enviarFactura(doc),
    };
    ahora = new Date(ahora.getTime() + 6 * 60_000);
    const cambios = await procesarPendientesGuias(ctx);

    expect(cambios).toEqual([expect.objectContaining({ id: idB, estado: "aceptada" })]);
    const [a] = await ctx.db.select().from(guiaTransportista).where(eq(guiaTransportista.id, idA));
    expect(a).toMatchObject({ estado: "pendiente_envio", intentos: 2, mensajeRespuesta: "Error al comunicarse con SUNAT: Servicio caído" });
    expect(a!.proximoIntentoEn).not.toBeNull();
  });

  it("agota los intentos: pasa a rechazada con SIN_ENVIO tras MAX_INTENTOS fallos", async () => {
    let ahora = new Date("2026-09-13T15:00:00Z");
    const gw = new GatewayControlado(new SunatSimulado({ demoraMs: 0 }));
    const ctx = await contexto({ gateway: gw, reloj: () => ahora });
    const id = await registrarGuiaBorrador(ctx, entradaGuia());
    await emitirGuia(ctx, id); // primer intento fallido -> pendiente_envio, intentos=1

    await ctx.db
      .update(guiaTransportista)
      .set({ intentos: MAX_INTENTOS - 1, proximoIntentoEn: new Date(ahora.getTime() - 1000), actualizadoEn: new Date(ahora.getTime() - 120_000) })
      .where(eq(guiaTransportista.id, id));
    ahora = new Date(ahora.getTime() + 120_000);

    const cambios = await procesarPendientesGuias(ctx);
    expect(cambios).toEqual([expect.objectContaining({ id, estado: "rechazada", codigo: "SIN_ENVIO" })]);
    const [g] = await ctx.db.select().from(guiaTransportista).where(eq(guiaTransportista.id, id));
    expect(g).toMatchObject({ intentos: MAX_INTENTOS, mensajeRespuesta: "No se pudo enviar a SUNAT durante 24 horas. Revisa la conexión y vuelve a emitir." });
  });
});
