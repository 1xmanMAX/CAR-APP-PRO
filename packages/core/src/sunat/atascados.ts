import { and, eq, factura, gte, guiaTransportista, inArray } from "@sunatapp/db";
import { ErrorNegocio } from "../errores";
import { CODIGOS_VERIFICAR, resultadoFactura } from "../facturas/emitir";
import { MAX_INTENTOS, resultadoGuia, type ResultadoEmision } from "../guias/emitir";
import { registrarAuditoria } from "../infra/auditoria";
import type { Contexto } from "../infra/contexto";

/**
 * **Documentos atascados**: los que el fondo ya no mueve solo y necesitan al dueño.
 * - Factura que SUNAT dice tener (1032/1033) sin CDR: el dueño la mira en SOL y dice qué vio.
 * - Guía enviada cuyo ticket dejó de consultarse (MAX_INTENTOS): el dueño pide volver a consultar.
 * No cuentan como "en camino" (no bloquean el cambio de modo SUNAT).
 */
export const MENSAJE_ACEPTADA_EN_SOL = "Aceptada: el dueño la verificó en SOL (no hay CDR guardado)";
export const MENSAJE_NO_ESTA_EN_SOL = "No está en SOL: vuelve a emitirla (saldrá con otro número)";
/** Código con el que queda la factura que el dueño marcó "no está en SOL" (no es de SUNAT; la reemisión toma otro número). */
export const CODIGO_NO_EN_SOL = "NO_EN_SOL";
const MENSAJE_RECONSULTAR = "Se volverá a consultar a SUNAT en unos minutos";

export interface DocumentoAtascado { id: number; serieNumero: string; codigo: string | null; mensaje: string | null }

const serieNumero = (d: { serie: string; numero: number | null }) => (d.numero ? `${d.serie}-${d.numero}` : `${d.serie}-(sin número)`);

export async function listarDocumentosAtascados(ctx: Contexto): Promise<{ facturas: DocumentoAtascado[]; guias: DocumentoAtascado[]; porReemitir: DocumentoAtascado[] }> {
  const fila = (d: { id: number; serie: string; numero: number | null; codigoRespuesta: string | null; mensajeRespuesta: string | null }) =>
    ({ id: d.id, serieNumero: serieNumero(d), codigo: d.codigoRespuesta, mensaje: d.mensajeRespuesta });
  const facturas = await ctx.db.select().from(factura)
    .where(and(eq(factura.estadoSunat, "pendiente_envio"), inArray(factura.codigoRespuesta, CODIGOS_VERIFICAR)));
  // Las que el dueño marcó "no está en SOL": esperan que las vuelva a emitir.
  const porReemitir = await ctx.db.select().from(factura)
    .where(and(eq(factura.estadoSunat, "rechazada"), eq(factura.codigoRespuesta, CODIGO_NO_EN_SOL)));
  const guias = await ctx.db.select().from(guiaTransportista)
    .where(and(eq(guiaTransportista.estado, "enviada"), gte(guiaTransportista.intentos, MAX_INTENTOS)));
  return { facturas: facturas.map(fila), guias: guias.map(fila), porReemitir: porReemitir.map(fila) };
}

/**
 * El dueño revisó en SOL una factura que SUNAT dijo tener (1032/1033). `enSol`: true = SOL la
 * muestra aceptada (queda aceptada, sin CDR); false = no está (queda rechazada con su código, así
 * al volver a emitirla toma un número nuevo).
 */
export async function confirmarFacturaEnSol(ctx: Contexto, facturaId: number, enSol: boolean, usuarioId?: number): Promise<ResultadoEmision> {
  const [previa] = await ctx.db.select({ codigo: factura.codigoRespuesta }).from(factura).where(eq(factura.id, facturaId));
  const cambios = enSol
    ? { estadoSunat: "aceptada" as const, mensajeRespuesta: MENSAJE_ACEPTADA_EN_SOL }
    : { estadoSunat: "rechazada" as const, codigoRespuesta: CODIGO_NO_EN_SOL, mensajeRespuesta: MENSAJE_NO_ESTA_EN_SOL };
  const hechas = await ctx.db.update(factura)
    .set({ ...cambios, intentos: 0, proximoIntentoEn: null, actualizadoEn: ctx.reloj() })
    .where(and(eq(factura.id, facturaId), eq(factura.estadoSunat, "pendiente_envio"), inArray(factura.codigoRespuesta, CODIGOS_VERIFICAR)))
    .returning({ id: factura.id });
  if (hechas.length === 0) throw new ErrorNegocio("Esa factura no está esperando que la verifiques en SOL");
  await registrarAuditoria(ctx.db, {
    usuarioId, accion: enSol ? "factura_confirmada_en_sol" : "factura_no_esta_en_sol", entidad: "factura", entidadId: facturaId, detalle: { codigo: previa?.codigo ?? null },
  });
  return resultadoFactura(ctx, facturaId);
}

/** Guía enviada que ya no se consultaba: reinicia los intentos para que el fondo vuelva a consultar su ticket. */
export async function reconsultarGuia(ctx: Contexto, guiaId: number, usuarioId?: number): Promise<ResultadoEmision> {
  const hechas = await ctx.db.update(guiaTransportista)
    .set({ intentos: 0, mensajeRespuesta: MENSAJE_RECONSULTAR, actualizadoEn: ctx.reloj() })
    .where(and(eq(guiaTransportista.id, guiaId), eq(guiaTransportista.estado, "enviada"), gte(guiaTransportista.intentos, MAX_INTENTOS)))
    .returning({ ticket: guiaTransportista.ticket });
  if (hechas.length === 0) throw new ErrorNegocio("Esa guía no necesita que la vuelvas a consultar");
  await registrarAuditoria(ctx.db, { usuarioId, accion: "guia_reconsultar", entidad: "guia_transportista", entidadId: guiaId, detalle: { ticket: hechas[0]!.ticket } });
  return resultadoGuia(ctx, guiaId);
}
