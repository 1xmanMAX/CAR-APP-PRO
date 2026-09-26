import {
  and, documentoRecibido, eq, lecturaIa, lte, type EstadoLectura, type TipoMensaje,
} from "@sunatapp/db";
import {
  esquemaLectura, IaCredencialesError, IaNoDisponibleError, TranscripcionNoDisponibleError, type Imagen, type Lectura,
} from "@sunatapp/ia";
import { validarRuc } from "../dominio/validaciones";
import { registrarDocumentoRecibido } from "../documentos/recibidos";
import { ErrorNegocio } from "../errores";
import { registrarGasto } from "../finanzas/finanzas";
import { hoy } from "../flota/unidades";
import { viajeEnCursoDeUnidad } from "../flota/viajes-flota";
import { registrarAuditoria } from "../infra/auditoria";
import type { Contexto } from "../infra/contexto";
import { registrarEntrega } from "../viajes/entregas";

/**
 * **Lectura de boletas por Telegram**: el chofer manda una foto, un texto («grifo 350») o una nota
 * de voz; la IA (o el lector por reglas, sin clave) propone qué es y cuánto, y **nada se guarda
 * hasta que la persona confirma**. Si la IA no responde, el mensaje queda en cola y se reintenta.
 */
export type { Lectura } from "@sunatapp/ia";

export interface MensajeEntrante {
  tipo: Exclude<TipoMensaje, "pdf">;
  contenido?: Buffer;
  mime?: string;
  /** El texto o el pie de foto. */
  texto?: string | null;
  telegramChatId?: number;
  telegramMessageId?: number;
  telegramFileId?: string;
  usuarioId?: number;
}

export interface EstadoDocumento {
  documentoId: number;
  tipo: TipoMensaje;
  estado: EstadoLectura;
  lectura: Lectura | null;
  texto: string | null;
  rutaArchivo: string | null;
  telegramChatId: number | null;
  error: string | null;
}

export type ResultadoLeer =
  | { ok: true; documentoId: number; lectura: Lectura }
  | { ok: false; documentoId: number; error: "pendiente" | "credenciales" | "voz" | "sin_ia" | "ya_confirmado"; mensaje: string };

export type ResultadoConfirmacion =
  | { tipo: "gasto"; gastoId: number; viajeCodigo: string | null; monto: number }
  | { tipo: "entrega"; entregaId: number; viajeCodigo: string; monto: number }
  | { tipo: "ya_confirmado" };

/** Minutos de espera antes de reintentar una lectura según los intentos hechos. */
const ESPERAS_MIN = [1, 5, 15, 60];
const MAX_INTENTOS = 8;

export const aCentimos = (soles: number) => Math.round(soles * 100);

/** Registra el mensaje (una sola vez aunque Telegram lo reenvíe) y devuelve su id. */
export async function recibirMensaje(ctx: Contexto, m: MensajeEntrante): Promise<{ id: number; nuevo: boolean }> {
  if (m.contenido) {
    const r = await registrarDocumentoRecibido(ctx, { contenido: m.contenido, mime: m.mime ?? "application/octet-stream", telegramFileId: m.telegramFileId, usuarioId: m.usuarioId });
    if (r.nuevo) {
      await ctx.db.update(documentoRecibido).set({
        tipo: m.tipo, texto: m.texto?.trim() || null, telegramChatId: m.telegramChatId ?? null, telegramMessageId: m.telegramMessageId ?? null,
      }).where(eq(documentoRecibido.id, r.id));
    }
    return { id: r.id, nuevo: r.nuevo };
  }
  const texto = m.texto?.trim();
  if (!texto) throw new ErrorNegocio("El mensaje está vacío");
  const [f] = await ctx.db.insert(documentoRecibido).values({
    mime: "text/plain", tipo: m.tipo, texto, telegramChatId: m.telegramChatId ?? null, telegramMessageId: m.telegramMessageId ?? null, usuarioId: m.usuarioId ?? null,
  }).onConflictDoNothing().returning({ id: documentoRecibido.id });
  if (f) return { id: f.id, nuevo: true };
  const [ya] = await ctx.db.select({ id: documentoRecibido.id }).from(documentoRecibido)
    .where(and(eq(documentoRecibido.telegramChatId, m.telegramChatId ?? -1), eq(documentoRecibido.telegramMessageId, m.telegramMessageId ?? -1)));
  if (!ya) throw new ErrorNegocio("No se pudo registrar el mensaje");
  return { id: ya.id, nuevo: false };
}

export async function obtenerDocumento(ctx: Contexto, documentoId: number): Promise<EstadoDocumento> {
  const [d] = await ctx.db.select().from(documentoRecibido).where(eq(documentoRecibido.id, documentoId));
  if (!d) throw new ErrorNegocio("El mensaje no existe");
  const [ultima] = await ctx.db.select({ error: lecturaIa.error }).from(lecturaIa).where(eq(lecturaIa.documentoId, documentoId)).orderBy(lecturaIa.id);
  const lectura = esquemaLectura.safeParse(d.datosExtraidos);
  return {
    documentoId: d.id, tipo: d.tipo, estado: d.estadoLectura, lectura: lectura.success ? lectura.data : null, texto: d.texto,
    rutaArchivo: d.rutaArchivo, telegramChatId: d.telegramChatId, error: d.estadoLectura === "error" ? (ultima?.error ?? null) : null,
  };
}

async function marcarError(ctx: Contexto, documentoId: number, proveedor: string, mensaje: string): Promise<void> {
  await ctx.db.update(documentoRecibido).set({ estadoLectura: "error", proximoIntentoEn: null }).where(eq(documentoRecibido.id, documentoId));
  await ctx.db.insert(lecturaIa).values({ documentoId, proveedor, modelo: "-", error: mensaje });
}

/**
 * Lee el mensaje con la IA (o las reglas). Voz → texto con el transcriptor. Deja el documento
 * «por confirmar» con la lectura, o «pendiente» para reintentar si la IA no responde.
 */
export async function leerDocumento(ctx: Contexto, documentoId: number): Promise<ResultadoLeer> {
  const [d] = await ctx.db.select().from(documentoRecibido).where(eq(documentoRecibido.id, documentoId));
  if (!d) throw new ErrorNegocio("El mensaje no existe");
  if (d.estadoLectura === "confirmado" || d.estadoLectura === "descartado") {
    return { ok: false, documentoId, error: "ya_confirmado", mensaje: d.estadoLectura === "confirmado" ? "Este mensaje ya se guardó." : "Este mensaje se descartó." };
  }
  if (!ctx.ia) return { ok: false, documentoId, error: "sin_ia", mensaje: "La lectura de mensajes no está activada en este dispositivo." };
  const ia = ctx.ia;

  let texto = d.texto ?? undefined;
  if (d.tipo === "voz" && !texto) {
    try {
      if (!ctx.transcriptor?.disponible) throw new TranscripcionNoDisponibleError("Las notas de voz no están activadas en este dispositivo");
      texto = await ctx.transcriptor.transcribir(await ctx.almacen.leer(d.rutaArchivo!), d.mime);
      await ctx.db.update(documentoRecibido).set({ texto }).where(eq(documentoRecibido.id, documentoId));
    } catch (e) {
      const mensaje = e instanceof TranscripcionNoDisponibleError ? e.message : "No se pudo transcribir la nota de voz";
      await marcarError(ctx, documentoId, "voz", mensaje);
      return { ok: false, documentoId, error: "voz", mensaje: `${mensaje}. Escríbelo, por ejemplo: grifo 350` };
    }
  }
  const imagenes: Imagen[] = d.tipo === "foto" && d.rutaArchivo && ia.leeImagenes ? [{ contenido: await ctx.almacen.leer(d.rutaArchivo), mime: d.mime }] : [];
  const correcciones = Array.isArray(d.correcciones) ? (d.correcciones as string[]) : [];
  const anterior = esquemaLectura.safeParse(d.datosExtraidos);
  try {
    // Un lector que no ve fotos igual sabe que llegó una (y responde «otro» para preguntar los datos).
    const r = await ia.leer({
      texto, imagenes: imagenes.length ? imagenes : d.tipo === "foto" ? [{ contenido: Buffer.alloc(0), mime: d.mime }] : undefined,
      contexto: { hoy: hoy(ctx), correcciones, ...(anterior.success ? { lecturaAnterior: anterior.data } : {}) },
    });
    await ctx.db.insert(lecturaIa).values({ documentoId, ...r.uso, respuesta: r.lectura });
    await ctx.db.update(documentoRecibido).set({
      estadoLectura: "por_confirmar", datosExtraidos: r.lectura, clasificacion: r.lectura.tipo, intentosLectura: d.intentosLectura + 1, proximoIntentoEn: null,
    }).where(eq(documentoRecibido.id, documentoId));
    return { ok: true, documentoId, lectura: r.lectura };
  } catch (e) {
    if (e instanceof IaCredencialesError) {
      await marcarError(ctx, documentoId, ia.nombre, e.message);
      return { ok: false, documentoId, error: "credenciales", mensaje: e.message };
    }
    if (!(e instanceof IaNoDisponibleError)) throw e;
    const intentos = d.intentosLectura + 1;
    if (intentos >= MAX_INTENTOS) {
      await marcarError(ctx, documentoId, ia.nombre, e.message);
      return { ok: false, documentoId, error: "credenciales", mensaje: `${e.message}. Ya lo intenté ${intentos} veces: regístralo con /gasto.` };
    }
    const espera = ESPERAS_MIN[Math.min(intentos - 1, ESPERAS_MIN.length - 1)]!;
    await ctx.db.update(documentoRecibido).set({
      estadoLectura: "pendiente", intentosLectura: intentos, proximoIntentoEn: new Date(ctx.reloj().getTime() + espera * 60_000),
    }).where(eq(documentoRecibido.id, documentoId));
    await ctx.db.insert(lecturaIa).values({ documentoId, proveedor: ia.nombre, modelo: "-", error: e.message });
    return { ok: false, documentoId, error: "pendiente", mensaje: `${e.message}. Lo vuelvo a intentar en ${espera} min y te aviso.` };
  }
}

/** «Eran 305», «era peaje»: se suma a las correcciones y se vuelve a leer sobre la lectura anterior. */
export async function corregirLectura(ctx: Contexto, documentoId: number, texto: string): Promise<ResultadoLeer> {
  const [d] = await ctx.db.select({ c: documentoRecibido.correcciones, estado: documentoRecibido.estadoLectura }).from(documentoRecibido).where(eq(documentoRecibido.id, documentoId));
  if (!d) throw new ErrorNegocio("El mensaje no existe");
  if (d.estado === "confirmado") return { ok: false, documentoId, error: "ya_confirmado", mensaje: "Este mensaje ya se guardó." };
  const correcciones = [...(Array.isArray(d.c) ? (d.c as string[]) : []), texto.trim()];
  await ctx.db.update(documentoRecibido).set({ correcciones }).where(eq(documentoRecibido.id, documentoId));
  return leerDocumento(ctx, documentoId);
}

/** Cuando la persona elige la categoría y escribe el monto (la foto no se pudo leer). */
export async function fijarLectura(ctx: Contexto, documentoId: number, lectura: Lectura): Promise<Lectura> {
  const v = esquemaLectura.safeParse(lectura);
  if (!v.success) throw new ErrorNegocio("Datos del gasto no válidos");
  const [f] = await ctx.db.update(documentoRecibido).set({ estadoLectura: "por_confirmar", datosExtraidos: v.data, clasificacion: v.data.tipo, proximoIntentoEn: null })
    .where(and(eq(documentoRecibido.id, documentoId))).returning({ estado: documentoRecibido.estadoLectura });
  if (!f) throw new ErrorNegocio("El mensaje no existe");
  return v.data;
}

/**
 * Guarda lo leído como gasto (en la unidad y su viaje en curso) o como entrega de dinero del viaje.
 * El paso «por confirmar → confirmado» es atómico: un segundo clic no duplica nada.
 */
export async function confirmarLectura(ctx: Contexto, documentoId: number, o: { vehiculoId?: number | null; usuarioId?: number }): Promise<ResultadoConfirmacion> {
  const [d] = await ctx.db.update(documentoRecibido).set({ estadoLectura: "confirmado" })
    .where(and(eq(documentoRecibido.id, documentoId), eq(documentoRecibido.estadoLectura, "por_confirmar")))
    .returning();
  if (!d) {
    const [existe] = await ctx.db.select({ estado: documentoRecibido.estadoLectura }).from(documentoRecibido).where(eq(documentoRecibido.id, documentoId));
    if (!existe) throw new ErrorNegocio("El mensaje no existe");
    if (existe.estado === "confirmado") return { tipo: "ya_confirmado" };
    throw new ErrorNegocio("Este mensaje todavía no tiene una lectura para confirmar");
  }
  const devolver = () => ctx.db.update(documentoRecibido).set({ estadoLectura: "por_confirmar" }).where(eq(documentoRecibido.id, documentoId));
  try {
    const l = esquemaLectura.parse(d.datosExtraidos);
    const hoyStr = hoy(ctx);
    if (l.tipo === "gasto") {
      const fecha = l.fecha && l.fecha <= hoyStr ? l.fecha : hoyStr;
      const r = await registrarGasto(ctx, {
        categoria: l.categoria, monto: aCentimos(l.monto), fecha, vehiculoId: o.vehiculoId ?? null, nota: l.nota, proveedorNombre: l.proveedorNombre,
        proveedorRuc: l.proveedorRuc && validarRuc(l.proveedorRuc) ? l.proveedorRuc : null, comprobante: l.comprobante,
        rutaFoto: d.tipo === "foto" ? d.rutaArchivo : null, documentoId, origen: "telegram", usuarioId: o.usuarioId,
      });
      return { tipo: "gasto", gastoId: r.id, viajeCodigo: r.viajeCodigo, monto: aCentimos(l.monto) };
    }
    if (l.tipo === "entrega") {
      if (!o.vehiculoId) throw new ErrorNegocio("¿De qué unidad es el viaje?");
      const v = await viajeEnCursoDeUnidad(ctx, o.vehiculoId);
      if (!v) throw new ErrorNegocio("Esa unidad no tiene un viaje en curso: inicia uno con /viaje para anotar el dinero entregado.");
      const r = await registrarEntrega(ctx, { viajeId: v.id, monto: aCentimos(l.monto), medio: l.medio, fecha: l.fecha && l.fecha <= hoyStr ? l.fecha : hoyStr, documentoId, usuarioId: o.usuarioId });
      return { tipo: "entrega", entregaId: r.id, viajeCodigo: r.viajeCodigo, monto: aCentimos(l.monto) };
    }
    throw new ErrorNegocio("No hay un gasto ni una entrega que guardar en este mensaje");
  } catch (e) {
    await devolver();
    throw e;
  }
}

export async function descartarLectura(ctx: Contexto, documentoId: number, usuarioId?: number): Promise<void> {
  const [f] = await ctx.db.update(documentoRecibido).set({ estadoLectura: "descartado", proximoIntentoEn: null })
    .where(and(eq(documentoRecibido.id, documentoId))).returning({ id: documentoRecibido.id });
  if (!f) throw new ErrorNegocio("El mensaje no existe");
  await registrarAuditoria(ctx.db, { usuarioId, accion: "lectura_descartada", entidad: "documento_recibido", entidadId: documentoId });
}

/** Reintenta las lecturas en cola cuyo turno llegó; devuelve las que ya se pueden avisar. */
export async function procesarLecturasPendientes(ctx: Contexto): Promise<Array<ResultadoLeer & { telegramChatId: number | null }>> {
  const pendientes = await ctx.db.select({ id: documentoRecibido.id, chat: documentoRecibido.telegramChatId }).from(documentoRecibido)
    .where(and(eq(documentoRecibido.estadoLectura, "pendiente"), lte(documentoRecibido.proximoIntentoEn, ctx.reloj())));
  const listos: Array<ResultadoLeer & { telegramChatId: number | null }> = [];
  for (const p of pendientes) {
    const r = await leerDocumento(ctx, p.id);
    if (r.ok || r.error !== "pendiente") listos.push({ ...r, telegramChatId: p.chat });
  }
  return listos;
}
