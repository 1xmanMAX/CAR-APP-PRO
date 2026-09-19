import { and, empresa, eq, guiaTransportista, isNull, lt, lte, or, siguienteCorrelativo } from "@sunatapp/db";
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
// El sondeo en segundo plano de guías "enviada" solo debe actuar cuando el ciclo de
// espera en primer plano (ESPERAS_TICKET_MS, ~120s) ya tuvo tiempo de completarse.
const REPOSO_ENVIADA_MS = 150_000;
const MENSAJE_AGOTADO = "No se pudo enviar a SUNAT durante 24 horas. Revisa la conexión y vuelve a emitir.";
const MENSAJE_SIN_RESPUESTA_TICKET = "Sin respuesta de SUNAT; consulta el estado manualmente.";

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

/** Lee un XML ya almacenado para reenviarlo tal cual; null si no existe o no es legible (se reconstruye). */
async function leerSiExiste(ctx: Contexto, ruta: string): Promise<string | null> {
  try {
    return await ctx.almacen.leerTexto(ruta);
  } catch {
    return null;
  }
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

/**
 * Registra un intento fallido de envío/preparación (después de reservada la guía).
 * Al llegar a MAX_INTENTOS, la guía pasa a "rechazada" con código SIN_ENVIO en vez de
 * seguir reintentando indefinidamente.
 */
async function manejarFalloEnvio(
  ctx: Contexto,
  guiaId: number,
  intentosPrevios: number,
  mensaje: string,
  extra: CambiosGuia = {},
): Promise<void> {
  const intentos = intentosPrevios + 1;
  if (intentos >= MAX_INTENTOS) {
    await actualizar(ctx, guiaId, {
      ...extra,
      estado: "rechazada",
      intentos,
      proximoIntentoEn: null,
      codigoRespuesta: "SIN_ENVIO",
      mensajeRespuesta: MENSAJE_AGOTADO,
    });
    await registrarAuditoria(ctx.db, { accion: "guia_envio_agotado", entidad: "guia_transportista", entidadId: guiaId, detalle: { intentos } });
    return;
  }
  await actualizar(ctx, guiaId, {
    ...extra,
    intentos,
    proximoIntentoEn: new Date(ctx.reloj().getTime() + REINTENTO_MS),
    codigoRespuesta: null,
    mensajeRespuesta: mensaje,
  });
}

/**
 * Genera y guarda el PDF de una guía ya aceptada por SUNAT que todavía no tiene rutaPdf. Es un
 * paso retryable e idempotente que nunca reenvía a SUNAT: si falla (almacenamiento caído, XML no
 * legible...) la guía queda aceptada con rutaPdf null y el fallo se audita para que quede
 * visible, sin lanzar la excepción hacia el llamador ni contar como intento de envío.
 */
export async function generarPdfGuiaSiFalta(ctx: Contexto, guiaId: number): Promise<void> {
  const [g] = await ctx.db.select({ estado: guiaTransportista.estado, rutaPdf: guiaTransportista.rutaPdf })
    .from(guiaTransportista).where(eq(guiaTransportista.id, guiaId));
  if (!g || g.estado !== "aceptada" || g.rutaPdf) return;
  try {
    const d = await cargarGuiaCompleta(ctx.db, guiaId);
    const nombre = nombreArchivo(d.empresa.ruc, "31", d.guia.serie, d.guia.numero!);
    const xml = await ctx.almacen.leerTexto(d.guia.rutaXml!);
    const textoQr = d.guia.urlQr ?? `${d.empresa.ruc}|31|${d.guia.serie}|${d.guia.numero}|${extraerDigest(xml)}|`;
    const pdf = await generarPdfGuia(datosPdfGuiaDesde(d, textoQr, ctx.simulado));
    const rutaPdf = await ctx.almacen.guardar(`guias/${nombre}.pdf`, pdf);
    await actualizar(ctx, guiaId, { rutaPdf });
  } catch (error) {
    await registrarAuditoria(ctx.db, { accion: "guia_pdf_pendiente", entidad: "guia_transportista", entidadId: guiaId, detalle: { error: (error as Error).message } });
  }
}

/**
 * Aplica una respuesta de SUNAT (aceptada/rechazada) solo si la guía sigue "enviada" con ese
 * ticket. El resultado se reclama con un único update compare-and-set (WHERE estado="enviada"
 * AND ticket=$ticket) ANTES de generar el CDR/PDF: si la guía ya no está en ese estado con ese
 * ticket (superada por otro reenvío, ya resuelta, o dos llamadas concurrentes para el mismo
 * ticket) el update afecta 0 filas y se sale sin generar el PDF ni auditar — así nunca hay dos
 * "holders" del mismo ticket aplicando la respuesta ni generando el PDF dos veces.
 */
export async function aplicarRespuestaGuia(ctx: Contexto, guiaId: number, r: RespuestaSunat, ticket: string): Promise<boolean> {
  if (r.estado === "en_proceso") return false;

  const estadoFinal = r.estado === "rechazada" ? "rechazada" : "aceptada";
  const reclamada = await ctx.db
    .update(guiaTransportista)
    .set({ estado: estadoFinal, codigoRespuesta: r.codigo, mensajeRespuesta: r.mensaje, ticket: null, actualizadoEn: ctx.reloj() })
    .where(and(eq(guiaTransportista.id, guiaId), eq(guiaTransportista.estado, "enviada"), eq(guiaTransportista.ticket, ticket)))
    .returning({ id: guiaTransportista.id });
  if (reclamada.length === 0) return false;

  if (estadoFinal === "rechazada") {
    await registrarAuditoria(ctx.db, { accion: "guia_rechazada", entidad: "guia_transportista", entidadId: guiaId, detalle: { codigo: r.codigo } });
    return true;
  }
  await registrarAuditoria(ctx.db, { accion: "guia_aceptada", entidad: "guia_transportista", entidadId: guiaId });

  // El resultado de SUNAT ya quedó confirmado arriba; el CDR/urlQr y el PDF son pasos
  // posteriores, independientes y reintentables, que nunca deben revertir esa aceptación ya
  // aplicada. Se persisten en dos escrituras separadas: si guardar el CDR falla, urlQr igual
  // queda registrado (se intenta aparte) para que el barrido pueda regenerar el PDF sin depender
  // de la respuesta de SUNAT ya descartada; y si además falla el PDF, queda auditado con rutaPdf
  // en null sin relanzar la excepción.
  try {
    const [emp] = await ctx.db.select({ ruc: empresa.ruc }).from(empresa).limit(1);
    const [g] = await ctx.db.select({ serie: guiaTransportista.serie, numero: guiaTransportista.numero }).from(guiaTransportista).where(eq(guiaTransportista.id, guiaId));
    const rutaCdr = r.cdrZip ? await ctx.almacen.guardar(`guias/R-${nombreArchivo(emp!.ruc, "31", g!.serie, g!.numero!)}.zip`, r.cdrZip) : null;
    await actualizar(ctx, guiaId, { rutaCdr, urlQr: r.urlQr ?? null });
  } catch (error) {
    await actualizar(ctx, guiaId, { urlQr: r.urlQr ?? null }).catch(() => {});
    await registrarAuditoria(ctx.db, { accion: "guia_cdr_pendiente", entidad: "guia_transportista", entidadId: guiaId, detalle: { error: (error as Error).message } });
  }
  await generarPdfGuiaSiFalta(ctx, guiaId);
  return true;
}

export async function emitirGuia(ctx: Contexto, guiaId: number, o: { esperarRespuesta?: boolean } = {}): Promise<ResultadoEmision> {
  const reserva = await ctx.db.transaction(async (tx) => {
    const [g] = await tx.select().from(guiaTransportista).where(eq(guiaTransportista.id, guiaId)).for("update");
    if (!g) throw new ErrorNegocio(`La guía ${guiaId} no existe`);
    if (g.estado === "aceptada" || g.estado === "enviada") return { tipo: "ocupada" } as const;
    const ahora = ctx.reloj();
    // Lease: mientras haya un envío en curso (o recién reservado) con proximoIntentoEn en
    // el futuro, no reservar de nuevo — evita doble envío por doble clic o solape con el
    // proceso de fondo cuando SunatReal tarda más que la ventana de reintento.
    if (g.estado === "pendiente_envio" && g.proximoIntentoEn && g.proximoIntentoEn.getTime() > ahora.getTime()) {
      return { tipo: "ocupada" } as const;
    }
    const numeroNuevo = g.numero === null;
    // Una emisión "nueva" (primera vez, o reintento explícito de una guía rechazada) reinicia
    // el contador de intentos: de lo contrario, una guía que agotó MAX_INTENTOS (SIN_ENVIO) o
    // que fue rechazada por SUNAT tras muchos reintentos quedaría "atascada" — el primer fallo
    // al reemitirla volvería a superar MAX_INTENTOS de inmediato.
    const fechaNueva = numeroNuevo || g.estado === "rechazada";
    const numero = g.numero ?? (await siguienteCorrelativo(tx, "31", g.serie));
    const cambios: CambiosGuia = {
      numero,
      estado: "pendiente_envio",
      proximoIntentoEn: new Date(ahora.getTime() + REINTENTO_MS),
      actualizadoEn: ahora,
    };
    if (fechaNueva) {
      const { fecha, hora } = fechaHoraLima(ahora);
      cambios.fechaEmision = fecha;
      cambios.horaEmision = hora;
      cambios.intentos = 0;
      // Al reemitir desde "rechazada" (o SIN_ENVIO) se limpia el XML anterior: si la
      // preparación de este intento falla antes de firmar/guardar uno nuevo, el siguiente
      // reintento no debe reenviar el XML rechazado que SUNAT ya conoce.
      cambios.rutaXml = null;
    }
    await tx.update(guiaTransportista).set(cambios).where(eq(guiaTransportista.id, guiaId));
    return {
      tipo: "reservada", intentosPrevios: fechaNueva ? 0 : g.intentos,
      fechaNueva, serie: g.serie, numero, rutaXmlPrevia: g.rutaXml,
    } as const;
  });
  if (reserva.tipo === "ocupada") return resultadoGuia(ctx, guiaId);

  let nombre!: string;
  let xml!: string;
  let rutaXml!: string;
  try {
    // Reintento sobre una guía que ya se firmó antes (pendiente_envio con XML almacenado): se
    // reenvía exactamente ese XML en vez de reconstruirlo y volver a firmar — los datos de
    // contraparte/empresa pueden haber cambiado desde el primer intento (p. ej. otra guía
    // registrada después corrigió la razón social del mismo RUC), y no deben alterar un
    // documento que SUNAT podría terminar recibiendo dos veces con contenidos distintos. Solo se
    // reconstruye si no hay XML almacenado (primer intento) o al reemitir desde "rechazada"
    // (fechaNueva: hay que firmar con fecha/hora nuevas).
    const xmlPrevio = !reserva.fechaNueva && reserva.rutaXmlPrevia ? await leerSiExiste(ctx, reserva.rutaXmlPrevia) : null;
    if (xmlPrevio !== null) {
      const [emp] = await ctx.db.select({ ruc: empresa.ruc }).from(empresa).limit(1);
      if (!emp) throw new Error("Falta configurar la empresa");
      nombre = nombreArchivo(emp.ruc, "31", reserva.serie, reserva.numero);
      xml = xmlPrevio;
      rutaXml = reserva.rutaXmlPrevia!;
    } else {
      const d = await cargarGuiaCompleta(ctx.db, guiaId);
      nombre = nombreArchivo(d.empresa.ruc, "31", d.guia.serie, d.guia.numero!);
      xml = firmarXml(construirXmlGreTransportista(datosGreDesde(d)), ctx.certificado);
      const xsd = await validarXsd(xml, "DespatchAdvice");
      if (!xsd.valido) {
        await actualizar(ctx, guiaId, { estado: "rechazada", codigoRespuesta: "XSD", mensajeRespuesta: xsd.errores.slice(0, 5).join(" | ") });
        return resultadoGuia(ctx, guiaId);
      }
      rutaXml = await ctx.almacen.guardar(`guias/${nombre}.xml`, xml);
    }
  } catch (error) {
    // Fallo al preparar el envío (datos incompletos, firma, almacenamiento...): no es una
    // respuesta de SUNAT, así que se trata como reintento, no como rechazo.
    await manejarFalloEnvio(ctx, guiaId, reserva.intentosPrevios, `Error al preparar el envío: ${(error as Error).message}`);
    return resultadoGuia(ctx, guiaId);
  }

  let ticket: string;
  try {
    ({ ticket } = await ctx.gateway.enviarGuia({ nombreArchivo: nombre, xml }));
  } catch (error) {
    // Solo una respuesta real de SUNAT (ticket/CDR) o una falla de validación XSD rechazan
    // la guía; cualquier otro error de comunicación (caída, credenciales, HTTP 4xx) se
    // reintenta igual que "SUNAT no disponible".
    const mensaje = error instanceof SunatNoDisponibleError
      ? "SUNAT no disponible; se reintentará automáticamente"
      : `Error al comunicarse con SUNAT: ${(error as Error).message}`;
    await manejarFalloEnvio(ctx, guiaId, reserva.intentosPrevios, mensaje, { rutaXml });
    return resultadoGuia(ctx, guiaId);
  }

  // Al pasar a "enviada" se reinicia el contador de intentos: de aquí en más solo cuenta los
  // fallos de sondeo/aplicación del ticket (evita que una guía que tardó muchos intentos en
  // enviarse quede excluida del sondeo en segundo plano por superar MAX_INTENTOS de arranque).
  await actualizar(ctx, guiaId, { rutaXml, intentos: 0, ticket, estado: "enviada", proximoIntentoEn: null, codigoRespuesta: null, mensajeRespuesta: null });
  await registrarAuditoria(ctx.db, { accion: "guia_enviada", entidad: "guia_transportista", entidadId: guiaId, detalle: { ticket } });

  if (o.esperarRespuesta !== false) {
    for (const espera of ESPERAS_TICKET_MS) {
      await ctx.dormir(espera);
      try {
        const r = await ctx.gateway.consultarTicket(ticket);
        if (r.estado !== "en_proceso") {
          await aplicarRespuestaGuia(ctx, guiaId, r, ticket);
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
  const haceReposoEnviada = new Date(ahora.getTime() - REPOSO_ENVIADA_MS);
  const candidatas = await ctx.db
    .select({ id: guiaTransportista.id, estado: guiaTransportista.estado, ticket: guiaTransportista.ticket, intentos: guiaTransportista.intentos })
    .from(guiaTransportista)
    .where(
      or(
        and(
          eq(guiaTransportista.estado, "pendiente_envio"),
          lt(guiaTransportista.intentos, MAX_INTENTOS),
          lte(guiaTransportista.actualizadoEn, haceUnMinuto),
          or(isNull(guiaTransportista.proximoIntentoEn), lte(guiaTransportista.proximoIntentoEn, ahora)),
        ),
        and(
          eq(guiaTransportista.estado, "enviada"),
          lt(guiaTransportista.intentos, MAX_INTENTOS),
          lte(guiaTransportista.actualizadoEn, haceReposoEnviada),
        ),
      ),
    );

  const cambios: ResultadoEmision[] = [];
  for (const g of candidatas) {
    try {
      let ticketAConsultar = g.ticket;
      if (g.estado === "pendiente_envio") {
        // Reenvío sin espera; si queda "enviada" se consulta el ticket una vez en esta misma pasada.
        const r = await emitirGuia(ctx, g.id, { esperarRespuesta: false });
        if (r.estado === "aceptada" || r.estado === "rechazada") {
          cambios.push(r);
          continue;
        }
        if (r.estado !== "enviada") continue; // sigue pendiente: emitirGuia ya registró el fallo
        const [actual] = await ctx.db.select({ ticket: guiaTransportista.ticket }).from(guiaTransportista).where(eq(guiaTransportista.id, g.id));
        ticketAConsultar = actual?.ticket ?? null;
      }
      if (!ticketAConsultar) continue;
      const r = await ctx.gateway.consultarTicket(ticketAConsultar);
      if (r.estado === "en_proceso") continue;
      const aplicado = await aplicarRespuestaGuia(ctx, g.id, r, ticketAConsultar);
      if (aplicado) cambios.push(await resultadoGuia(ctx, g.id));
    } catch (error) {
      // Ninguna guía debe bloquear el procesamiento de las demás: cualquier falla al
      // reservar/preparar, sondear el ticket o aplicar la respuesta (consulta de red, PDF,
      // almacenamiento, error inesperado...) se aísla aquí.
      if (error instanceof SunatNoDisponibleError) continue; // SUNAT sigue caída: se reintenta en la próxima pasada
      try {
        // Si la guía sigue activa, la falla cuenta como un intento fallido de sondeo/aplicación;
        // al agotar MAX_INTENTOS deja de sondearse (sin cambiar de estado) con un mensaje manual.
        const [fila] = await ctx.db
          .select({ estado: guiaTransportista.estado, intentos: guiaTransportista.intentos })
          .from(guiaTransportista)
          .where(eq(guiaTransportista.id, g.id));
        if (fila && (fila.estado === "enviada" || fila.estado === "pendiente_envio")) {
          const intentos = fila.intentos + 1;
          const mensaje = intentos >= MAX_INTENTOS ? MENSAJE_SIN_RESPUESTA_TICKET : `Error al procesar la guía: ${(error as Error).message}`;
          await actualizar(ctx, g.id, { intentos, mensajeRespuesta: mensaje });
        }
      } catch {
        // Si ni siquiera se pudo registrar el fallo, se continúa con las demás guías.
      }
    }
  }

  // Barrido independiente del envío: guías ya aceptadas por SUNAT a las que les falta el PDF
  // (por un fallo previo de almacenamiento). Nunca llama a gateway.enviarGuia.
  const sinPdf = await ctx.db.select({ id: guiaTransportista.id }).from(guiaTransportista)
    .where(and(eq(guiaTransportista.estado, "aceptada"), isNull(guiaTransportista.rutaPdf)));
  for (const { id } of sinPdf) {
    await generarPdfGuiaSiFalta(ctx, id);
    const r = await resultadoGuia(ctx, id);
    if (r.rutaPdf && !cambios.some((c) => c.id === id)) cambios.push(r);
  }
  return cambios;
}
