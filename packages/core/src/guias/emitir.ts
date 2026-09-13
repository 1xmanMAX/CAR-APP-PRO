import { and, eq, guiaTransportista, isNull, lt, lte, or, siguienteCorrelativo } from "@sunatapp/db";
import { generarPdfGuia } from "@sunatapp/pdf";
import {
  construirXmlGreTransportista, extraerDigest, firmarXml, nombreArchivo, SunatNoDisponibleError, validarXsd, type RespuestaSunat,
} from "@sunatapp/sunat";
import { fechaHoraLima } from "../dominio/fechas";
import { ErrorNegocio } from "../errores";
import { registrarAuditoria } from "../infra/auditoria";
import type { Contexto } from "../infra/contexto";
import { cargarGuiaCompleta, datosGreDesde, datosPdfGuiaDesde } from "./cargar";

export const ESPERAS_TICKET_MS = [2000, 4000, 8000, 16000, 30000, 30000, 30000];
export const REINTENTO_MS = 5 * 60_000;
export const MAX_INTENTOS = 288;

export interface ResultadoEmision {
  id: number;
  estado: string;
  serieNumero: string;
  codigo: string | null;
  mensaje: string | null;
  rutaPdf: string | null;
}

type CambiosGuia = Partial<typeof guiaTransportista.$inferInsert>;

async function actualizar(ctx: Contexto, id: number, cambios: CambiosGuia): Promise<void> {
  await ctx.db.update(guiaTransportista).set({ ...cambios, actualizadoEn: ctx.reloj() }).where(eq(guiaTransportista.id, id));
}

export async function resultadoGuia(ctx: Contexto, guiaId: number): Promise<ResultadoEmision> {
  const [g] = await ctx.db.select().from(guiaTransportista).where(eq(guiaTransportista.id, guiaId));
  if (!g) throw new ErrorNegocio(`La guía ${guiaId} no existe`);
  return {
    id: g.id,
    estado: g.estado,
    serieNumero: g.numero ? `${g.serie}-${g.numero}` : `${g.serie}-(sin número)`,
    codigo: g.codigoRespuesta,
    mensaje: g.mensajeRespuesta,
    rutaPdf: g.rutaPdf,
  };
}

export async function aplicarRespuestaGuia(ctx: Contexto, guiaId: number, r: RespuestaSunat): Promise<void> {
  if (r.estado === "en_proceso") return;
  const d = await cargarGuiaCompleta(ctx.db, guiaId);
  const nombre = nombreArchivo(d.empresa.ruc, "31", d.guia.serie, d.guia.numero!);
  if (r.estado === "rechazada") {
    await actualizar(ctx, guiaId, { estado: "rechazada", codigoRespuesta: r.codigo, mensajeRespuesta: r.mensaje, ticket: null });
    await registrarAuditoria(ctx.db, { accion: "guia_rechazada", entidad: "guia_transportista", entidadId: guiaId, detalle: { codigo: r.codigo } });
    return;
  }
  const rutaCdr = r.cdrZip ? await ctx.almacen.guardar(`guias/R-${nombre}.zip`, r.cdrZip) : null;
  const xml = await ctx.almacen.leerTexto(d.guia.rutaXml!);
  const textoQr = r.urlQr ?? `${d.empresa.ruc}|31|${d.guia.serie}|${d.guia.numero}|${extraerDigest(xml)}|`;
  const pdf = await generarPdfGuia(datosPdfGuiaDesde(d, textoQr, ctx.simulado));
  const rutaPdf = await ctx.almacen.guardar(`guias/${nombre}.pdf`, pdf);
  await actualizar(ctx, guiaId, { estado: "aceptada", codigoRespuesta: r.codigo, mensajeRespuesta: r.mensaje, rutaCdr, rutaPdf });
  await registrarAuditoria(ctx.db, { accion: "guia_aceptada", entidad: "guia_transportista", entidadId: guiaId });
}

export async function emitirGuia(ctx: Contexto, guiaId: number, o: { esperarRespuesta?: boolean } = {}): Promise<ResultadoEmision> {
  const reserva = await ctx.db.transaction(async (tx) => {
    const [g] = await tx.select().from(guiaTransportista).where(eq(guiaTransportista.id, guiaId)).for("update");
    if (!g) throw new ErrorNegocio(`La guía ${guiaId} no existe`);
    if (g.estado === "aceptada" || g.estado === "enviada") return "ya_procesada" as const;
    const { fecha, hora } = fechaHoraLima(ctx.reloj());
    const numero = g.numero ?? (await siguienteCorrelativo(tx, "31", g.serie));
    await tx
      .update(guiaTransportista)
      .set({ numero, fechaEmision: fecha, horaEmision: hora, estado: "pendiente_envio", actualizadoEn: ctx.reloj() })
      .where(eq(guiaTransportista.id, guiaId));
    return "reservada" as const;
  });
  if (reserva === "ya_procesada") return resultadoGuia(ctx, guiaId);

  const d = await cargarGuiaCompleta(ctx.db, guiaId);
  const nombre = nombreArchivo(d.empresa.ruc, "31", d.guia.serie, d.guia.numero!);
  const xml = firmarXml(construirXmlGreTransportista(datosGreDesde(d)), ctx.certificado);
  const xsd = await validarXsd(xml, "DespatchAdvice");
  if (!xsd.valido) {
    await actualizar(ctx, guiaId, { estado: "rechazada", codigoRespuesta: "XSD", mensajeRespuesta: xsd.errores.slice(0, 5).join(" | ") });
    return resultadoGuia(ctx, guiaId);
  }
  const rutaXml = await ctx.almacen.guardar(`guias/${nombre}.xml`, xml);
  const intentos = d.guia.intentos + 1;

  let ticket: string;
  try {
    ({ ticket } = await ctx.gateway.enviarGuia({ nombreArchivo: nombre, xml }));
  } catch (error) {
    if (error instanceof SunatNoDisponibleError) {
      await actualizar(ctx, guiaId, {
        rutaXml, intentos, proximoIntentoEn: new Date(ctx.reloj().getTime() + REINTENTO_MS),
        codigoRespuesta: null, mensajeRespuesta: "SUNAT no disponible; se reintentará automáticamente",
      });
    } else {
      await actualizar(ctx, guiaId, { rutaXml, intentos, estado: "rechazada", codigoRespuesta: "ERROR", mensajeRespuesta: (error as Error).message });
    }
    return resultadoGuia(ctx, guiaId);
  }

  await actualizar(ctx, guiaId, { rutaXml, intentos, ticket, estado: "enviada", proximoIntentoEn: null, codigoRespuesta: null, mensajeRespuesta: null });
  await registrarAuditoria(ctx.db, { accion: "guia_enviada", entidad: "guia_transportista", entidadId: guiaId, detalle: { ticket } });

  if (o.esperarRespuesta !== false) {
    for (const espera of ESPERAS_TICKET_MS) {
      await ctx.dormir(espera);
      try {
        const r = await ctx.gateway.consultarTicket(ticket);
        if (r.estado !== "en_proceso") {
          await aplicarRespuestaGuia(ctx, guiaId, r);
          break;
        }
      } catch (error) {
        if (!(error instanceof SunatNoDisponibleError)) throw error;
      }
    }
  }
  return resultadoGuia(ctx, guiaId);
}

export async function procesarPendientesGuias(ctx: Contexto): Promise<ResultadoEmision[]> {
  const ahora = ctx.reloj();
  const haceUnMinuto = new Date(ahora.getTime() - 60_000);
  const candidatas = await ctx.db
    .select({ id: guiaTransportista.id, estado: guiaTransportista.estado, ticket: guiaTransportista.ticket })
    .from(guiaTransportista)
    .where(
      or(
        and(
          eq(guiaTransportista.estado, "pendiente_envio"),
          lt(guiaTransportista.intentos, MAX_INTENTOS),
          lte(guiaTransportista.actualizadoEn, haceUnMinuto),
          or(isNull(guiaTransportista.proximoIntentoEn), lte(guiaTransportista.proximoIntentoEn, ahora)),
        ),
        eq(guiaTransportista.estado, "enviada"),
      ),
    );

  const cambios: ResultadoEmision[] = [];
  for (const g of candidatas) {
    if (g.estado === "pendiente_envio") {
      // Reenvío sin espera; si queda "enviada" se consulta el ticket una vez en esta misma pasada.
      const r = await emitirGuia(ctx, g.id, { esperarRespuesta: false });
      if (r.estado === "aceptada" || r.estado === "rechazada") cambios.push(r);
      if (r.estado !== "enviada") continue;
    }
    const [actual] = await ctx.db.select({ ticket: guiaTransportista.ticket }).from(guiaTransportista).where(eq(guiaTransportista.id, g.id));
    if (!actual?.ticket) continue;
    try {
      const r = await ctx.gateway.consultarTicket(actual.ticket);
      if (r.estado !== "en_proceso") {
        await aplicarRespuestaGuia(ctx, g.id, r);
        cambios.push(await resultadoGuia(ctx, g.id));
      }
    } catch (error) {
      if (!(error instanceof SunatNoDisponibleError)) throw error;
    }
  }
  return cambios;
}
