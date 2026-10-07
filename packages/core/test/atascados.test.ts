import { auditoria, eq, factura, guiaTransportista, type EstadoSunatFactura } from "@sunatapp/db";
import { SunatSimulado, type DocumentoFirmado, type SunatGateway } from "@sunatapp/sunat";
import { afterEach, describe, expect, it } from "vitest";
import { ErrorNegocio } from "../src/errores";
import { emitirFactura, MENSAJE_VERIFICAR_EN_SOL, procesarPendientesFacturas } from "../src/facturas/emitir";
import { prepararFactura } from "../src/facturas/preparar";
import { emitirGuia, MAX_INTENTOS, procesarPendientesGuias } from "../src/guias/emitir";
import { registrarGuiaBorrador } from "../src/guias/registrar";
import type { Contexto } from "../src/infra/contexto";
import { contarDocumentosEnCurso } from "../src/sunat/aplicar";
import { confirmarFacturaEnSol, listarDocumentosAtascados, reconsultarGuia } from "../src/sunat/atascados";
import { crearContextoPrueba, entradaGuia, prepararDatosTransporte } from "./helpers";

const cerrables: Array<() => Promise<void>> = [];
afterEach(async () => { while (cerrables.length) await cerrables.pop()!(); });

let ahora = new Date("2026-09-13T15:00:00Z");
const simulado = new SunatSimulado({ demoraMs: 0 });
let ticketsConsultados: string[] = [];

const gateway: SunatGateway = {
  enviarGuia: (d: DocumentoFirmado) => simulado.enviarGuia(d),
  consultarTicket: (t: string) => { ticketsConsultados.push(t); return simulado.consultarTicket(t); },
  enviarFactura: (d: DocumentoFirmado) => simulado.enviarFactura(d),
  consultarCdrFactura: async () => null,
};

async function ctxConGuia(): Promise<{ ctx: Contexto; guiaId: number }> {
  ahora = new Date("2026-09-13T15:00:00Z");
  ticketsConsultados = [];
  const r = await crearContextoPrueba({ reloj: () => ahora, gateway });
  cerrables.push(r.cerrar);
  await prepararDatosTransporte(r.ctx);
  const guiaId = await registrarGuiaBorrador(r.ctx, entradaGuia());
  await emitirGuia(r.ctx, guiaId);
  return { ctx: r.ctx, guiaId };
}

/** Factura que SUNAT dice tener (1033) sin CDR: queda pendiente para verificar en SOL. */
async function facturaPorVerificar(ctx: Contexto, guiaId: number): Promise<number> {
  const { facturaId } = await prepararFactura(ctx, { guiaId, montoCentimos: 50000, incluyeIgv: true, formaPago: "contado" });
  await emitirFactura(ctx, facturaId); // aceptada por el simulador: se deja como la deja un 1033
  await ctx.db.update(factura).set({
    estadoSunat: "pendiente_envio" as EstadoSunatFactura, codigoRespuesta: "1033", mensajeRespuesta: MENSAJE_VERIFICAR_EN_SOL,
    proximoIntentoEn: null, rutaCdr: null, rutaPdf: null,
  }).where(eq(factura.id, facturaId));
  return facturaId;
}

/** Guía enviada cuyo ticket dejó de consultarse (MAX_INTENTOS fallos de sondeo). */
async function guiaSinRespuesta(ctx: Contexto, guiaId: number, ticket: string): Promise<void> {
  await ctx.db.update(guiaTransportista).set({
    estado: "enviada", ticket, intentos: MAX_INTENTOS, mensajeRespuesta: "Sin respuesta de SUNAT; consulta el estado manualmente.",
  }).where(eq(guiaTransportista.id, guiaId));
}

async function auditorias(ctx: Contexto, accion: string) {
  return ctx.db.select().from(auditoria).where(eq(auditoria.accion, accion));
}

describe("documentos atascados: no bloquean el cambio de modo", () => {
  it("no cuenta la factura por verificar en SOL ni la guía que ya no se consulta", async () => {
    const { ctx, guiaId } = await ctxConGuia();
    await facturaPorVerificar(ctx, guiaId);
    await guiaSinRespuesta(ctx, guiaId, "T-1");
    expect(await contarDocumentosEnCurso(ctx)).toBe(0);
    const atascados = await listarDocumentosAtascados(ctx);
    expect(atascados.facturas).toEqual([expect.objectContaining({ serieNumero: "F001-1", codigo: "1033" })]);
    expect(atascados.guias).toEqual([expect.objectContaining({ id: guiaId, serieNumero: "V001-1" })]);
  });

  it("sí cuenta la guía enviada que se sigue consultando y la factura pendiente sin código", async () => {
    const { ctx, guiaId } = await ctxConGuia();
    const facturaId = await facturaPorVerificar(ctx, guiaId);
    await ctx.db.update(factura).set({ codigoRespuesta: null }).where(eq(factura.id, facturaId));
    await ctx.db.update(guiaTransportista).set({ estado: "enviada", ticket: "T-1", intentos: MAX_INTENTOS - 1 }).where(eq(guiaTransportista.id, guiaId));
    expect(await contarDocumentosEnCurso(ctx)).toBe(2);
    expect(await listarDocumentosAtascados(ctx)).toEqual({ facturas: [], guias: [], porReemitir: [] });
  });
});

describe("el dueño resuelve una factura por verificar en SOL", () => {
  it("«ya la verifiqué: está aceptada» la deja aceptada, sin CDR, y lo audita", async () => {
    const { ctx, guiaId } = await ctxConGuia();
    const facturaId = await facturaPorVerificar(ctx, guiaId);
    const r = await confirmarFacturaEnSol(ctx, facturaId, true, 1);
    expect(r).toMatchObject({ estado: "aceptada", serieNumero: "F001-1" });
    expect(r.mensaje).toContain("el dueño la verificó en SOL");
    const [f] = await ctx.db.select().from(factura).where(eq(factura.id, facturaId));
    expect(f).toMatchObject({ estadoSunat: "aceptada", rutaCdr: null, proximoIntentoEn: null });
    const a = await auditorias(ctx, "factura_confirmada_en_sol");
    expect(a).toEqual([expect.objectContaining({ usuarioId: 1, entidadId: String(facturaId), detalle: { codigo: "1033" } })]);
    // El fondo le genera el PDF sin volver a enviarla.
    await procesarPendientesFacturas(ctx);
    const [f2] = await ctx.db.select().from(factura).where(eq(factura.id, facturaId));
    expect(f2!.rutaPdf).not.toBeNull();
  });

  it("«no está en SOL» la deja rechazada y al volver a emitir toma otro número", async () => {
    const { ctx, guiaId } = await ctxConGuia();
    const facturaId = await facturaPorVerificar(ctx, guiaId);
    const r = await confirmarFacturaEnSol(ctx, facturaId, false, 1);
    expect(r).toMatchObject({ estado: "rechazada", codigo: "NO_EN_SOL" });
    expect(r.mensaje).toContain("vuelve a emitirla");
    expect(await auditorias(ctx, "factura_no_esta_en_sol")).toEqual([expect.objectContaining({ detalle: expect.objectContaining({ codigo: "1033" }) })]);
    expect((await listarDocumentosAtascados(ctx)).facturas).toEqual([]);
    expect((await listarDocumentosAtascados(ctx)).porReemitir).toEqual([expect.objectContaining({ id: facturaId, serieNumero: "F001-1" })]);
    ahora = new Date(ahora.getTime() + 10 * 60_000);
    expect(await emitirFactura(ctx, facturaId)).toMatchObject({ estado: "aceptada", serieNumero: "F001-2" });
  });

  it("no toca una factura que no está esperando verificación", async () => {
    const { ctx, guiaId } = await ctxConGuia();
    const { facturaId } = await prepararFactura(ctx, { guiaId, montoCentimos: 50000, incluyeIgv: true, formaPago: "contado" });
    await emitirFactura(ctx, facturaId);
    await expect(confirmarFacturaEnSol(ctx, facturaId, false, 1)).rejects.toBeInstanceOf(ErrorNegocio);
    const [f] = await ctx.db.select().from(factura).where(eq(factura.id, facturaId));
    expect(f!.estadoSunat).toBe("aceptada");
  });
});

describe("el dueño pide volver a consultar una guía sin respuesta", () => {
  it("reinicia los intentos y el fondo vuelve a consultar el ticket", async () => {
    const { ctx, guiaId } = await ctxConGuia();
    await guiaSinRespuesta(ctx, guiaId, "T-SIN-RESPUESTA");
    ahora = new Date(ahora.getTime() + 10 * 60_000);
    ticketsConsultados = [];
    await procesarPendientesGuias(ctx);
    expect(ticketsConsultados).toEqual([]); // agotada: el fondo ya no la consulta

    const r = await reconsultarGuia(ctx, guiaId, 1);
    expect(r).toMatchObject({ estado: "enviada" });
    const [g2] = await ctx.db.select().from(guiaTransportista).where(eq(guiaTransportista.id, guiaId));
    expect(g2).toMatchObject({ intentos: 0, ticket: "T-SIN-RESPUESTA" });
    expect(await contarDocumentosEnCurso(ctx)).toBe(1);
    expect(await auditorias(ctx, "guia_reconsultar")).toEqual([expect.objectContaining({ usuarioId: 1, entidadId: String(guiaId) })]);

    ahora = new Date(ahora.getTime() + 10 * 60_000);
    await procesarPendientesGuias(ctx);
    expect(ticketsConsultados).toEqual(["T-SIN-RESPUESTA"]);
  });

  it("no toca una guía que todavía se consulta sola", async () => {
    const { ctx, guiaId } = await ctxConGuia();
    await expect(reconsultarGuia(ctx, guiaId, 1)).rejects.toBeInstanceOf(ErrorNegocio);
    await ctx.db.update(guiaTransportista).set({ estado: "enviada", ticket: "T-1", intentos: 3 }).where(eq(guiaTransportista.id, guiaId));
    await expect(reconsultarGuia(ctx, guiaId, 1)).rejects.toBeInstanceOf(ErrorNegocio);
    const [g] = await ctx.db.select().from(guiaTransportista).where(eq(guiaTransportista.id, guiaId));
    expect(g!.intentos).toBe(3);
  });
});
