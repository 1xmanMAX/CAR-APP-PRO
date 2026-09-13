import { and, contraparte, empresa, eq, factura, facturaGuia, guiaTransportista, inArray, isNull, lt, lte, or, siguienteCorrelativo } from "@sunatapp/db";
import { generarPdfFactura } from "@sunatapp/pdf";
import {
  construirXmlFactura, extraerDigest, firmarXml, montoEnLetras, nombreArchivo, SunatNoDisponibleError, validarXsd,
  type RespuestaSunat, type TipoDocIdentidadSunat,
} from "@sunatapp/sunat";
import { fechaHoraLima, sumarDias } from "../dominio/fechas";
import { formatearSoles } from "../dominio/montos";
import { ErrorNegocio } from "../errores";
import type { ResultadoEmision } from "../guias/emitir";
import { MAX_INTENTOS, REINTENTO_MS } from "../guias/emitir";
import { registrarAuditoria } from "../infra/auditoria";
import type { Contexto } from "../infra/contexto";

// Mensajes y umbrales de reintento espejados de packages/core/src/guias/emitir.ts (Tarea 11):
// a diferencia de la guía, la factura recibe la respuesta de SUNAT de inmediato (sin ticket),
// así que no hay estado "enviada" intermedio ni sondeo — solo "pendiente_envio" mientras se
// reintenta el envío en sí.
const MENSAJE_AGOTADO = "No se pudo enviar a SUNAT durante 24 horas. Revisa la conexión y vuelve a emitir.";

type CambiosFactura = Partial<typeof factura.$inferInsert>;

async function actualizar(ctx: Contexto, id: number, cambios: CambiosFactura): Promise<void> {
  await ctx.db.update(factura).set({ ...cambios, actualizadoEn: ctx.reloj() }).where(eq(factura.id, id));
}

async function resultadoFactura(ctx: Contexto, id: number): Promise<ResultadoEmision> {
  const [f] = await ctx.db.select().from(factura).where(eq(factura.id, id));
  if (!f) throw new ErrorNegocio(`La factura ${id} no existe`);
  return {
    id: f.id,
    estado: f.estadoSunat,
    serieNumero: f.numero ? `${f.serie}-${f.numero}` : `${f.serie}-(sin número)`,
    codigo: f.codigoRespuesta,
    mensaje: f.mensajeRespuesta,
    rutaPdf: f.rutaPdf,
  };
}

async function cargarFactura(ctx: Contexto, id: number) {
  const [f] = await ctx.db.select().from(factura).where(eq(factura.id, id));
  if (!f) throw new ErrorNegocio(`La factura ${id} no existe`);
  const [emp] = await ctx.db.select().from(empresa).limit(1);
  const [cliente] = await ctx.db.select().from(contraparte).where(eq(contraparte.id, f.clienteId));
  const guias = await ctx.db
    .select({ serie: guiaTransportista.serie, numero: guiaTransportista.numero })
    .from(facturaGuia)
    .innerJoin(guiaTransportista, eq(facturaGuia.guiaId, guiaTransportista.id))
    .where(eq(facturaGuia.facturaId, id));
  if (!emp || !cliente) throw new ErrorNegocio(`Datos incompletos para la factura ${id}`);
  return { factura: f, empresa: emp, cliente, guias: guias.map((g) => `${g.serie}-${g.numero}`) };
}

/**
 * Registra un intento fallido de envío/preparación (después de reservada la factura).
 * Espejo de manejarFalloEnvio en guias/emitir.ts: al llegar a MAX_INTENTOS, la factura pasa
 * a "rechazada" con código SIN_ENVIO en vez de seguir reintentando indefinidamente.
 */
async function manejarFalloEnvio(
  ctx: Contexto,
  facturaId: number,
  intentosPrevios: number,
  mensaje: string,
  extra: CambiosFactura = {},
): Promise<void> {
  const intentos = intentosPrevios + 1;
  if (intentos >= MAX_INTENTOS) {
    await actualizar(ctx, facturaId, {
      ...extra,
      estadoSunat: "rechazada",
      intentos,
      proximoIntentoEn: null,
      codigoRespuesta: "SIN_ENVIO",
      mensajeRespuesta: MENSAJE_AGOTADO,
    });
    await registrarAuditoria(ctx.db, { accion: "factura_envio_agotado", entidad: "factura", entidadId: facturaId, detalle: { intentos } });
    return;
  }
  await actualizar(ctx, facturaId, {
    ...extra,
    intentos,
    proximoIntentoEn: new Date(ctx.reloj().getTime() + REINTENTO_MS),
    codigoRespuesta: null,
    mensajeRespuesta: mensaje,
  });
}

/**
 * Persiste el resultado de SUNAT (aceptada/observada/rechazada) en un único update, de
 * inmediato al recibir la respuesta — antes de tocar CDR o PDF. A partir de aquí la factura
 * queda en un estado terminal (rechazada) o "emitida ante SUNAT" (aceptada/observada) y
 * emitirFactura/procesarPendientesFacturas nunca vuelven a llamar a gateway.enviarFactura para
 * ella: el CDR y el PDF son pasos posteriores, independientes y reintentables sin reenviar.
 * Un fallo al guardar el CDR no debe impedir persistir el resultado (queda rutaCdr null).
 */
async function aplicarRespuestaSunat(ctx: Contexto, id: number, r: RespuestaSunat, nombre: string): Promise<void> {
  if (r.estado === "rechazada" || r.estado === "en_proceso") {
    await actualizar(ctx, id, { estadoSunat: "rechazada", codigoRespuesta: r.codigo, mensajeRespuesta: r.mensaje, proximoIntentoEn: null });
    await registrarAuditoria(ctx.db, { accion: "factura_rechazada", entidad: "factura", entidadId: id, detalle: { codigo: r.codigo } });
    return;
  }
  let rutaCdr: string | null = null;
  if (r.cdrZip) {
    try {
      rutaCdr = await ctx.almacen.guardar(`facturas/R-${nombre}.zip`, r.cdrZip);
    } catch (error) {
      await registrarAuditoria(ctx.db, { accion: "factura_cdr_no_guardado", entidad: "factura", entidadId: id, detalle: { error: (error as Error).message } });
    }
  }
  await actualizar(ctx, id, {
    estadoSunat: r.estado, codigoRespuesta: r.codigo,
    mensajeRespuesta: [r.mensaje, ...r.notas].join(" | "), rutaCdr, proximoIntentoEn: null, intentos: 0,
  });
  await registrarAuditoria(ctx.db, { accion: "factura_aceptada", entidad: "factura", entidadId: id });
}

/**
 * Genera y guarda el PDF de una factura ya aceptada/observada por SUNAT que todavía no tiene
 * rutaPdf. Es un paso retryable e idempotente que nunca reenvía a SUNAT: si falla (almacenamiento
 * caído, etc.) la factura queda aceptada/observada con rutaPdf null y el fallo se audita para
 * que quede visible, sin lanzar la excepción hacia el llamador ni contar como intento de envío.
 */
async function generarPdfFacturaSiFalta(ctx: Contexto, id: number): Promise<void> {
  const [f0] = await ctx.db.select({ rutaPdf: factura.rutaPdf, estadoSunat: factura.estadoSunat }).from(factura).where(eq(factura.id, id));
  if (!f0 || f0.rutaPdf || (f0.estadoSunat !== "aceptada" && f0.estadoSunat !== "observada")) return;
  try {
    const d = await cargarFactura(ctx, id);
    const f = d.factura;
    const nombre = nombreArchivo(d.empresa.ruc, "01", f.serie, f.numero!);
    const xml = await ctx.almacen.leerTexto(f.rutaXml!);
    const m = (c: number) => (c / 100).toFixed(2);
    const textoQr = `${d.empresa.ruc}|01|${f.serie}|${f.numero}|${m(f.igv)}|${m(f.total)}|${f.fechaEmision}|${d.cliente.tipoDoc}|${d.cliente.numeroDoc}|${extraerDigest(xml)}|`;
    const pdf = await generarPdfFactura({
      emisor: { ruc: d.empresa.ruc, razonSocial: d.empresa.razonSocial, direccion: d.empresa.direccion },
      serieNumero: `${f.serie}-${f.numero}`,
      fechaEmision: f.fechaEmision!,
      fechaVencimiento: f.formaPago === "credito" ? f.fechaVencimiento : null,
      formaPago: f.formaPago === "credito" ? "Crédito" : "Contado",
      cliente: { numeroDoc: d.cliente.numeroDoc, razonSocial: d.cliente.razonSocial, ...(d.cliente.direccion ? { direccion: d.cliente.direccion } : {}) },
      descripcion: f.descripcion,
      subtotal: formatearSoles(f.subtotal),
      igv: formatearSoles(f.igv),
      total: formatearSoles(f.total),
      montoEnLetras: montoEnLetras(f.total),
      detraccion: f.detraccionMonto > 0 ? { porcentaje: `${f.detraccionPorcentaje}%`, monto: formatearSoles(f.detraccionMonto), cuenta: d.empresa.cuentaDetraccionBn ?? "" } : null,
      guiasRelacionadas: d.guias,
      textoQr,
      simulado: ctx.simulado,
    });
    const rutaPdf = await ctx.almacen.guardar(`facturas/${nombre}.pdf`, pdf);
    await actualizar(ctx, id, { rutaPdf });
  } catch (error) {
    await registrarAuditoria(ctx.db, { accion: "factura_pdf_pendiente", entidad: "factura", entidadId: id, detalle: { error: (error as Error).message } });
  }
}

export async function emitirFactura(ctx: Contexto, facturaId: number): Promise<ResultadoEmision> {
  const reserva = await ctx.db.transaction(async (tx) => {
    const [f] = await tx.select().from(factura).where(eq(factura.id, facturaId)).for("update");
    if (!f) throw new ErrorNegocio(`La factura ${facturaId} no existe`);
    if (f.estadoSunat === "aceptada" || f.estadoSunat === "observada") return { tipo: "ocupada" } as const;
    const ahora = ctx.reloj();
    // Lease: mientras haya un envío en curso (o recién reservado) con proximoIntentoEn en el
    // futuro, no reservar de nuevo — evita doble envío por doble clic o solape con el proceso
    // de fondo, igual que en guías (Tarea 11).
    if (f.estadoSunat === "pendiente_envio" && f.proximoIntentoEn && f.proximoIntentoEn.getTime() > ahora.getTime()) {
      return { tipo: "ocupada" } as const;
    }
    const numeroNuevo = f.numero === null;
    // Una emisión "nueva" (primera vez, o reintento explícito de una factura rechazada) reinicia
    // fecha/hora/vencimiento e intentos: de lo contrario, una factura que agotó MAX_INTENTOS
    // (SIN_ENVIO) o que fue rechazada por SUNAT quedaría con fechas viejas al reemitirla.
    const fechaNueva = numeroNuevo || f.estadoSunat === "rechazada";
    const numero = f.numero ?? (await siguienteCorrelativo(tx, "01", f.serie));
    const cambios: CambiosFactura = {
      numero,
      estadoSunat: "pendiente_envio",
      proximoIntentoEn: new Date(ahora.getTime() + REINTENTO_MS),
      actualizadoEn: ahora,
    };
    if (fechaNueva) {
      const { fecha, hora } = fechaHoraLima(ahora);
      cambios.fechaEmision = fecha;
      cambios.horaEmision = hora;
      cambios.fechaVencimiento = f.formaPago === "credito" ? sumarDias(fecha, f.diasCredito!) : fecha;
      cambios.intentos = 0;
    }
    await tx.update(factura).set(cambios).where(eq(factura.id, facturaId));
    return { tipo: "reservada", intentosPrevios: fechaNueva ? 0 : f.intentos } as const;
  });
  if (reserva.tipo === "ocupada") return resultadoFactura(ctx, facturaId);

  let nombre!: string;
  let xml!: string;
  let rutaXml!: string;
  try {
    const d = await cargarFactura(ctx, facturaId);
    const f = d.factura;
    nombre = nombreArchivo(d.empresa.ruc, "01", f.serie, f.numero!);
    xml = firmarXml(
      construirXmlFactura({
        emisor: {
          ruc: d.empresa.ruc, razonSocial: d.empresa.razonSocial, ubigeo: d.empresa.ubigeo, direccion: d.empresa.direccion,
          ...(d.empresa.nombreComercial ? { nombreComercial: d.empresa.nombreComercial } : {}),
          ...(d.empresa.cuentaDetraccionBn ? { cuentaDetraccion: d.empresa.cuentaDetraccionBn } : {}),
        },
        serie: f.serie,
        numero: f.numero!,
        fechaEmision: f.fechaEmision!,
        horaEmision: f.horaEmision!,
        cliente: {
          tipoDoc: d.cliente.tipoDoc as TipoDocIdentidadSunat, numeroDoc: d.cliente.numeroDoc, razonSocial: d.cliente.razonSocial,
          ...(d.cliente.direccion ? { direccion: d.cliente.direccion } : {}),
        },
        descripcion: f.descripcion,
        montos: { subtotal: f.subtotal, igv: f.igv, total: f.total, detraccionPorcentaje: f.detraccionPorcentaje, detraccionMonto: f.detraccionMonto },
        formaPago: f.formaPago === "credito" ? { tipo: "credito", fechaVencimiento: f.fechaVencimiento! } : { tipo: "contado" },
        guiasRelacionadas: d.guias,
      }),
      ctx.certificado,
    );
    const xsd = await validarXsd(xml, "Invoice");
    if (!xsd.valido) {
      await actualizar(ctx, facturaId, { estadoSunat: "rechazada", codigoRespuesta: "XSD", mensajeRespuesta: xsd.errores.slice(0, 5).join(" | ") });
      return resultadoFactura(ctx, facturaId);
    }
    rutaXml = await ctx.almacen.guardar(`facturas/${nombre}.xml`, xml);
  } catch (error) {
    // Fallo al preparar el envío (datos incompletos, firma, almacenamiento...): no es una
    // respuesta de SUNAT, así que se trata como reintento, no como rechazo.
    await manejarFalloEnvio(ctx, facturaId, reserva.intentosPrevios, `Error al preparar el envío: ${(error as Error).message}`);
    return resultadoFactura(ctx, facturaId);
  }

  let r: RespuestaSunat;
  try {
    r = await ctx.gateway.enviarFactura({ nombreArchivo: nombre, xml });
  } catch (error) {
    // Cualquier error al enviar (caída de SUNAT o no) se reintenta igual que en guías: solo
    // una respuesta real de SUNAT (CDR) o una falla de validación XSD rechazan la factura.
    const mensaje = error instanceof SunatNoDisponibleError
      ? "SUNAT no disponible; se reintentará automáticamente"
      : `Error al comunicarse con SUNAT: ${(error as Error).message}`;
    await manejarFalloEnvio(ctx, facturaId, reserva.intentosPrevios, mensaje, { rutaXml });
    return resultadoFactura(ctx, facturaId);
  }

  // El envío llegó a SUNAT: se persiste su resultado de inmediato (aplicarRespuestaSunat), antes
  // de cualquier paso adicional — desde aquí la factura ya no se reenvía nunca. El PDF es un
  // paso separado y reintentable que no debe poder revertir ni bloquear ese resultado.
  await actualizar(ctx, facturaId, { rutaXml, intentos: 0 });
  await aplicarRespuestaSunat(ctx, facturaId, r, nombre);
  await generarPdfFacturaSiFalta(ctx, facturaId);
  return resultadoFactura(ctx, facturaId);
}

export async function procesarPendientesFacturas(ctx: Contexto): Promise<ResultadoEmision[]> {
  const ahora = ctx.reloj();
  const pendientesEnvio = await ctx.db
    .select({ id: factura.id })
    .from(factura)
    .where(
      and(
        eq(factura.estadoSunat, "pendiente_envio"),
        lt(factura.intentos, MAX_INTENTOS),
        lte(factura.actualizadoEn, new Date(ahora.getTime() - 60_000)),
        or(isNull(factura.proximoIntentoEn), lte(factura.proximoIntentoEn, ahora)),
      ),
    );
  const cambios: ResultadoEmision[] = [];
  for (const { id } of pendientesEnvio) {
    try {
      const r = await emitirFactura(ctx, id);
      if (r.estado !== "pendiente_envio") cambios.push(r);
    } catch {
      // Ninguna factura debe bloquear el procesamiento de las demás: un fallo inesperado (p. ej.
      // la factura desapareció por una condición de carrera) se aísla aquí y se reintenta en la
      // siguiente pasada; nunca implica volver a llamar a gateway.enviarFactura para una factura
      // que SUNAT ya haya aceptado.
    }
  }

  // Segundo barrido, independiente del envío: facturas ya aceptadas/observadas por SUNAT a las
  // que les falta el PDF (por un fallo previo de almacenamiento). Nunca llama a enviarFactura.
  const pdfPendientes = await ctx.db
    .select({ id: factura.id })
    .from(factura)
    .where(and(inArray(factura.estadoSunat, ["aceptada", "observada"]), isNull(factura.rutaPdf)));
  for (const { id } of pdfPendientes) {
    try {
      await generarPdfFacturaSiFalta(ctx, id);
      const r = await resultadoFactura(ctx, id);
      if (r.rutaPdf) cambios.push(r);
    } catch {
      // generarPdfFacturaSiFalta ya captura y audita sus propios fallos; este catch es una red
      // de seguridad adicional para que una factura no bloquee el resto del barrido.
    }
  }
  return cambios;
}
