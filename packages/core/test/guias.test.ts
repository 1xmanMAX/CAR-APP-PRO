import { and, auditoria, contraparte, correlativo, eq, guiaTransportista, vehiculo } from "@sunatapp/db";
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

  it("no sobrescribe la razón social de una contraparte existente al registrar otra guía con el mismo RUC", async () => {
    const ctx = await contexto();
    const primera = entradaGuia();
    await registrarGuiaBorrador(ctx, primera);

    const segunda = entradaGuia();
    segunda.remitente = { ...segunda.remitente, razonSocial: "OTRO NOMBRE SAC" };
    await registrarGuiaBorrador(ctx, segunda);

    const filas = await ctx.db.select().from(contraparte).where(eq(contraparte.numeroDoc, primera.remitente.numeroDoc));
    expect(filas).toHaveLength(1);
    expect(filas[0]!.razonSocial).toBe(primera.remitente.razonSocial);
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

  it("una guía agotada (SIN_ENVIO) reemitida reinicia el contador de intentos", async () => {
    const gw = new GatewayControlado(new SunatSimulado({ demoraMs: 0 })); // caido=true por defecto
    const ctx = await contexto({ gateway: gw });
    const id = await registrarGuiaBorrador(ctx, entradaGuia());
    await ctx.db
      .update(guiaTransportista)
      .set({
        estado: "rechazada",
        numero: 1,
        fechaEmision: "2026-09-01",
        horaEmision: "08:00:00",
        intentos: MAX_INTENTOS,
        codigoRespuesta: "SIN_ENVIO",
        mensajeRespuesta: "No se pudo enviar a SUNAT durante 24 horas. Revisa la conexión y vuelve a emitir.",
      })
      .where(eq(guiaTransportista.id, id));

    const r = await emitirGuia(ctx, id); // reintenta desde "rechazada": debe reiniciar intentos a 0
    expect(r.estado).toBe("pendiente_envio"); // sin la corrección, volvería directo a rechazada/SIN_ENVIO
    const [g] = await ctx.db.select().from(guiaTransportista).where(eq(guiaTransportista.id, id));
    expect(g).toMatchObject({ estado: "pendiente_envio", intentos: 1, codigoRespuesta: null });
    expect(g!.mensajeRespuesta).toBe("SUNAT no disponible; se reintentará automáticamente");
  });

  it("una guía enviada con intentos cercanos al máximo sigue siendo sondeada hasta aceptada", async () => {
    let ahora = new Date("2026-09-13T15:00:00Z");
    const gw = new GatewayControlado(new SunatSimulado({ demoraMs: 0 })); // caido=true por defecto
    const ctx = await contexto({ gateway: gw, reloj: () => ahora });
    const id = await registrarGuiaBorrador(ctx, entradaGuia());
    await emitirGuia(ctx, id); // falla (SUNAT caído): pendiente_envio, numero=1, intentos=1

    await ctx.db
      .update(guiaTransportista)
      .set({ intentos: MAX_INTENTOS - 1, proximoIntentoEn: new Date(ahora.getTime() - 1000) })
      .where(eq(guiaTransportista.id, id));
    gw.caido = false;
    ahora = new Date(ahora.getTime() + 1000);
    const r = await emitirGuia(ctx, id, { esperarRespuesta: false }); // esta vez el envío tiene éxito
    expect(r.estado).toBe("enviada");
    const [trasEmision] = await ctx.db.select().from(guiaTransportista).where(eq(guiaTransportista.id, id));
    expect(trasEmision!.intentos).toBe(0); // sin la corrección, quedaría en MAX_INTENTOS y nunca se sondearía

    ahora = new Date(ahora.getTime() + 200_000); // deja pasar el reposo de la rama "enviada"
    const cambios = await procesarPendientesGuias(ctx);
    expect(cambios).toEqual([expect.objectContaining({ id, estado: "aceptada" })]);
  });

  it("un fallo al generar el PDF no revierte la aceptación ya confirmada, y no bloquea a las demás guías", async () => {
    // Nota: este caso cambió con la corrección de la Tarea de compare-and-set en
    // aplicarRespuestaGuia (findings de revisión): el resultado de SUNAT (estado, código,
    // mensaje) se reclama y persiste ANTES de generar el CDR/PDF, así dos llamadas concurrentes
    // para el mismo ticket nunca generan el PDF ni auditan dos veces. En consecuencia, un fallo
    // posterior al generar el PDF (aquí, un rutaXml no legible) ya no puede dejar la guía varada
    // en "enviada": el resultado ya fue aplicado y queda "aceptada" con rutaPdf null, auditado
    // aparte, sin relanzar el error hacia procesarPendientesGuias.
    let ahora = new Date("2026-09-13T15:00:00Z");
    const ctx = await contexto({ gateway: new SunatSimulado({ demoraMs: 0 }), reloj: () => ahora });
    const idA = await registrarGuiaBorrador(ctx, entradaGuia());
    const idB = await registrarGuiaBorrador(ctx, entradaGuia());
    await emitirGuia(ctx, idA, { esperarRespuesta: false }); // queda "enviada"
    await emitirGuia(ctx, idB, { esperarRespuesta: false }); // queda "enviada"

    // Fuerza un fallo real (no relacionado con SUNAT) al generar el PDF de A, sin usar un
    // gateway de prueba: apunta rutaXml a un archivo inexistente, así ctx.almacen.leerTexto
    // lanza al intentar generar el texto del QR. Nota: con la separación del guardado de
    // CDR/urlQr (independiente de rutaXml) y la generación del PDF, el CDR sí se guarda
    // correctamente — solo el PDF queda pendiente.
    await ctx.db.update(guiaTransportista).set({ rutaXml: "guias/no-existe.xml" }).where(eq(guiaTransportista.id, idA));

    ahora = new Date(ahora.getTime() + 200_000); // deja pasar el reposo de la rama "enviada"
    const cambios = await procesarPendientesGuias(ctx);

    expect(cambios).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: idA, estado: "aceptada", rutaPdf: null }),
      expect.objectContaining({ id: idB, estado: "aceptada" }),
    ]));
    const [a] = await ctx.db.select().from(guiaTransportista).where(eq(guiaTransportista.id, idA));
    expect(a).toMatchObject({ estado: "aceptada", rutaPdf: null, ticket: null });
    expect(a!.rutaCdr).not.toBeNull();
  });

  it("un reintento reenvía el mismo XML firmado (byte a byte) aunque cambie la razón social de la contraparte", async () => {
    let ahora = new Date("2026-09-13T15:00:00Z");
    let caido = true;
    const base = new SunatSimulado({ demoraMs: 0 });
    const xmlsEnviados: string[] = [];
    const ctx = await contexto({
      reloj: () => ahora,
      gateway: {
        async enviarGuia(doc: DocumentoFirmado) {
          xmlsEnviados.push(doc.xml);
          if (caido) throw new SunatNoDisponibleError("sin red");
          return base.enviarGuia(doc);
        },
        consultarTicket: (t: string) => base.consultarTicket(t),
        enviarFactura: (doc: DocumentoFirmado) => base.enviarFactura(doc),
      },
    });
    const id = await registrarGuiaBorrador(ctx, entradaGuia());
    await emitirGuia(ctx, id); // SUNAT caído: queda pendiente_envio con el XML ya firmado y guardado
    expect(xmlsEnviados).toHaveLength(1);

    // Cambia la razón social de la contraparte (remitente) ya usada en el XML firmado.
    await ctx.db.update(contraparte).set({ razonSocial: "OTRO NOMBRE SAC" }).where(eq(contraparte.numeroDoc, "20131312955"));

    caido = false;
    ahora = new Date(ahora.getTime() + 6 * 60_000);
    const cambios = await procesarPendientesGuias(ctx);

    expect(cambios).toEqual([expect.objectContaining({ id, estado: "aceptada" })]);
    expect(xmlsEnviados).toHaveLength(2);
    expect(xmlsEnviados[1]).toBe(xmlsEnviados[0]); // byte-idéntico: se reenvía el XML ya firmado
    expect(xmlsEnviados[1]).toContain("DISTRIBUIDORA SAC"); // no se reconstruyó con la razón social nueva
  });

  it("incluye la carreta (vehículo secundario) en el XML emitido", async () => {
    const ctx = await contexto();
    const [carreta] = await ctx.db.insert(vehiculo).values({ placa: "XYZ-987" }).returning();
    const id = await registrarGuiaBorrador(ctx, entradaGuia());
    await ctx.db.update(guiaTransportista).set({ vehiculoSecundarioId: carreta!.id }).where(eq(guiaTransportista.id, id));

    await emitirGuia(ctx, id);
    const [g] = await ctx.db.select().from(guiaTransportista).where(eq(guiaTransportista.id, id));
    expect(await ctx.almacen.leerTexto(g!.rutaXml!)).toContain("XYZ987");
  });

  it("dos llamadas concurrentes a aplicarRespuestaGuia para el mismo ticket aplican el resultado una sola vez", async () => {
    const ctx = await contexto();
    const id = await registrarGuiaBorrador(ctx, entradaGuia());
    await emitirGuia(ctx, id, { esperarRespuesta: false }); // queda "enviada" con ticket
    const [antes] = await ctx.db.select().from(guiaTransportista).where(eq(guiaTransportista.id, id));
    const ticket = antes!.ticket!;
    const respuesta = await ctx.gateway.consultarTicket(ticket);

    let escrituraPdf = 0;
    const almacenOriginal = ctx.almacen;
    ctx.almacen = {
      ...almacenOriginal,
      guardar: async (ruta: string, contenido: Buffer | string) => {
        if (ruta.endsWith(".pdf")) escrituraPdf++;
        return almacenOriginal.guardar(ruta, contenido);
      },
    };

    const [r1, r2] = await Promise.all([
      aplicarRespuestaGuia(ctx, id, respuesta, ticket),
      aplicarRespuestaGuia(ctx, id, respuesta, ticket),
    ]);
    expect([r1, r2].filter(Boolean)).toHaveLength(1); // solo una de las dos llamadas aplicó algo

    expect(escrituraPdf).toBe(1); // el PDF se generó exactamente una vez

    const auditorias = await ctx.db
      .select()
      .from(auditoria)
      .where(and(eq(auditoria.entidad, "guia_transportista"), eq(auditoria.entidadId, String(id)), eq(auditoria.accion, "guia_aceptada")));
    expect(auditorias).toHaveLength(1); // una sola fila de auditoría "guia_aceptada"

    const [gFinal] = await ctx.db.select().from(guiaTransportista).where(eq(guiaTransportista.id, id));
    expect(gFinal).toMatchObject({ estado: "aceptada", ticket: null });
    expect(gFinal!.rutaPdf).not.toBeNull();
  });

  it("si el PDF falla tras la aceptación, conserva CDR y urlQr y el barrido regenera el PDF", async () => {
    const ctx = await contexto();
    const id = await registrarGuiaBorrador(ctx, entradaGuia());
    const guardarOriginal = ctx.almacen.guardar;
    ctx.almacen.guardar = async (ruta, c) => {
      if (ruta.endsWith(".pdf")) throw new Error("disco lleno");
      return guardarOriginal(ruta, c);
    };
    const r = await emitirGuia(ctx, id);
    expect(r.estado).toBe("aceptada");
    const [g1] = await ctx.db.select().from(guiaTransportista).where(eq(guiaTransportista.id, id));
    expect(g1!.rutaPdf).toBeNull();
    expect(g1!.rutaCdr).not.toBeNull();
    expect(g1!.urlQr).not.toBeNull();
    ctx.almacen.guardar = guardarOriginal;
    const cambios = await procesarPendientesGuias(ctx);
    expect(cambios.map((c) => c.id)).toContain(id);
    const [g2] = await ctx.db.select().from(guiaTransportista).where(eq(guiaTransportista.id, id));
    expect(g2!.rutaPdf).toMatch(/\.pdf$/);
  });

  it("al reemitir desde rechazada, si la preparación falla no reenvía el XML rechazado", async () => {
    let ahora = new Date("2026-09-13T15:00:00Z");
    let acepta = false;
    const rechazar = new SunatSimulado({ rechazo: { codigo: "2800", mensaje: "dato inválido" }, demoraMs: 0 });
    const aceptar = new SunatSimulado({ demoraMs: 0 });
    const gw: SunatGateway = {
      enviarGuia: (d: DocumentoFirmado) => (acepta ? aceptar : rechazar).enviarGuia(d),
      consultarTicket: (t: string) => (acepta ? aceptar : rechazar).consultarTicket(t),
      enviarFactura: (d: DocumentoFirmado) => (acepta ? aceptar : rechazar).enviarFactura(d),
    };
    const ctx = await contexto({ gateway: gw, reloj: () => ahora });
    const id = await registrarGuiaBorrador(ctx, entradaGuia());

    expect((await emitirGuia(ctx, id)).estado).toBe("rechazada");
    const [g1] = await ctx.db.select().from(guiaTransportista).where(eq(guiaTransportista.id, id));
    const xmlA = await ctx.almacen.leerTexto(g1!.rutaXml!);

    ahora = new Date(ahora.getTime() + 10 * 60_000);
    const almacenOriginal = ctx.almacen;
    ctx.almacen = {
      ...almacenOriginal,
      guardar: async (ruta: string, contenido: Buffer | string) => {
        if (ruta.endsWith(".xml")) throw new Error("disco lleno");
        return almacenOriginal.guardar(ruta, contenido);
      },
    };
    expect((await emitirGuia(ctx, id)).estado).toBe("pendiente_envio");
    const [g2] = await ctx.db.select().from(guiaTransportista).where(eq(guiaTransportista.id, id));
    expect(g2!.rutaXml).toBeNull();

    ctx.almacen = almacenOriginal;
    acepta = true;
    ahora = new Date(ahora.getTime() + 10 * 60_000);
    const cambios = await procesarPendientesGuias(ctx);
    expect(cambios).toEqual(expect.arrayContaining([expect.objectContaining({ id, estado: "aceptada" })]));

    const [g3] = await ctx.db.select().from(guiaTransportista).where(eq(guiaTransportista.id, id));
    const xmlB = await ctx.almacen.leerTexto(g3!.rutaXml!);
    expect(xmlB).not.toBe(xmlA);
  });
});
