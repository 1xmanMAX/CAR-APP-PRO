import {
  and, desc, documentoRecibido, eq, gasto, gte, inArray, isNull, lecturaIa, lt, lte, ne, notInArray, or, sql, viaje, type EstadoLectura, type TipoMensaje,
} from "@sunatapp/db";
import { fechaHoraLima } from "../dominio/fechas";
import {
  esquemaLectura, IaCredencialesError, IaNoDisponibleError, TranscripcionNoDisponibleError, type Imagen, type Lectura,
} from "@sunatapp/ia";
import { validarRuc } from "../dominio/validaciones";
import { registrarDocumentoRecibido } from "../documentos/recibidos";
import { ErrorNegocio } from "../errores";
import { registrarGasto, ultimaUnidadDeUsuario } from "../finanzas/finanzas";
import { hoy, listarUnidades } from "../flota/unidades";
import { finalizarViajeFlota, registrarViajeFlota, viajeEnCursoDeUnidad } from "../flota/viajes-flota";
import { registrarAuditoria } from "../infra/auditoria";
import type { Contexto } from "../infra/contexto";
import { viajesPorRevisar } from "../viajes/revisar-viajes";
import { categoriaValida, listarCategorias } from "../finanzas/categorias";
import { capturarContexto, describirContexto } from "../finanzas/captura";
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
  | { ok: true; documentoId: number; lectura: Lectura; /** Lo que el gasto tomará solo: «T-02 · VJ-0129 (guía …, ida) · efectivo del chofer · 402,380 km». */ contexto?: string | null }
  | { ok: false; documentoId: number; error: "pendiente" | "credenciales" | "voz" | "sin_ia" | "ya_confirmado"; mensaje: string };

export type ResultadoConfirmacion =
  | { tipo: "gasto"; gastoId: number; viajeCodigo: string | null; monto: number; avisoKm: string | null }
  | { tipo: "entrega"; entregaId: number; viajeCodigo: string; monto: number }
  | { tipo: "inicio_viaje"; viajeId: number; viajeCodigo: string; ruta: string; adelanto: number }
  | { tipo: "fin_viaje"; viajeId: number; viajeCodigo: string }
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
      contexto: {
        hoy: hoy(ctx), correcciones, ...(anterior.success ? { lecturaAnterior: anterior.data } : {}),
        // Lo que manda el chofer es un gasto del viaje: solo categorías variables.
        categorias: (await listarCategorias(ctx, { tipo: "variable", soloActivas: true })).map(({ clave, nombre }) => ({ clave, nombre })),
      },
    });
    await ctx.db.insert(lecturaIa).values({ documentoId, ...r.uso, respuesta: r.lectura });
    await ctx.db.update(documentoRecibido).set({
      estadoLectura: "por_confirmar", datosExtraidos: r.lectura, clasificacion: r.lectura.tipo, intentosLectura: d.intentosLectura + 1, proximoIntentoEn: null,
    }).where(eq(documentoRecibido.id, documentoId));
    // Solo si se sabe la unidad (el chofer que escribe tiene un viaje en curso); si no, el bot la deduce.
    const cap = await capturarContexto(ctx, { usuarioId: d.usuarioId ?? undefined });
    const contexto = cap.vehiculoId !== null ? describirContexto(cap) : null;
    return { ok: true, documentoId, lectura: r.lectura, contexto };
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
  if (d.estado === "confirmado" || d.estado === "descartado") {
    // Lo ya resuelto no se toca (ni se le suman correcciones).
    return { ok: false, documentoId, error: "ya_confirmado", mensaje: d.estado === "confirmado" ? "Este mensaje ya se guardó." : "Este mensaje se descartó." };
  }
  const correcciones = [...(Array.isArray(d.c) ? (d.c as string[]) : []), texto.trim()];
  await ctx.db.update(documentoRecibido).set({ correcciones }).where(eq(documentoRecibido.id, documentoId));
  return leerDocumento(ctx, documentoId);
}

export const MENSAJE_YA_RESUELTO = "Ese mensaje ya se guardó o se descartó";
/** Lo ya confirmado o descartado no vuelve a «por confirmar» (si no, un segundo guardar duplicaría el gasto). */
const RESUELTOS: EstadoLectura[] = ["confirmado", "descartado"];

/** Sin fila actualizada: o el mensaje no existe, o ya se guardó o descartó. */
async function noActualizado(ctx: Contexto, documentoId: number): Promise<never> {
  const [existe] = await ctx.db.select({ id: documentoRecibido.id }).from(documentoRecibido).where(eq(documentoRecibido.id, documentoId));
  throw new ErrorNegocio(existe ? MENSAJE_YA_RESUELTO : "El mensaje no existe");
}

/** Cuando la persona elige la categoría y escribe el monto (la foto no se pudo leer). */
export async function fijarLectura(ctx: Contexto, documentoId: number, lectura: Lectura): Promise<Lectura> {
  const v = esquemaLectura.safeParse(lectura);
  if (!v.success) throw new ErrorNegocio("Datos del gasto no válidos");
  const [f] = await ctx.db.update(documentoRecibido).set({ estadoLectura: "por_confirmar", datosExtraidos: v.data, clasificacion: v.data.tipo, proximoIntentoEn: null })
    .where(and(eq(documentoRecibido.id, documentoId), notInArray(documentoRecibido.estadoLectura, RESUELTOS))).returning({ estado: documentoRecibido.estadoLectura });
  if (!f) return noActualizado(ctx, documentoId);
  return v.data;
}

/**
 * Guarda lo leído como gasto (en la unidad y su viaje en curso) o como entrega de dinero del viaje.
 * El paso «por confirmar → confirmado» es atómico: un segundo clic no duplica nada.
 */
export async function confirmarLectura(
  ctx: Contexto, documentoId: number,
  o: { vehiculoId?: number | null; usuarioId?: number; /** Estado al que vuelve si no se puede guardar (el que tenía antes de `fijarLectura`). */ siFalla?: EstadoLectura },
): Promise<ResultadoConfirmacion> {
  const [d] = await ctx.db.update(documentoRecibido).set({ estadoLectura: "confirmado" })
    .where(and(eq(documentoRecibido.id, documentoId), eq(documentoRecibido.estadoLectura, "por_confirmar")))
    .returning();
  if (!d) {
    const [existe] = await ctx.db.select({ estado: documentoRecibido.estadoLectura }).from(documentoRecibido).where(eq(documentoRecibido.id, documentoId));
    if (!existe) throw new ErrorNegocio("El mensaje no existe");
    if (existe.estado === "confirmado") return { tipo: "ya_confirmado" };
    throw new ErrorNegocio("Este mensaje todavía no tiene una lectura para confirmar");
  }
  // Un mensaje con error sigue con error (y en «Necesita tu atención»): un intento fallido no lo pasa a «por confirmar».
  // «pendiente» no sirve de destino: fijarLectura ya borró su próximo intento y quedaría atascado (el worker lo salta).
  const siFalla = o.siFalla && !RESUELTOS.includes(o.siFalla) && o.siFalla !== "pendiente" ? o.siFalla : "por_confirmar";
  const devolver = () => ctx.db.update(documentoRecibido).set({ estadoLectura: siFalla }).where(eq(documentoRecibido.id, documentoId));
  try {
    const l = esquemaLectura.parse(d.datosExtraidos);
    const hoyStr = hoy(ctx);
    if (l.tipo === "gasto") {
      // Se registra en el momento: la fecha es hoy (la de la boleta queda en la lectura).
      const cat = await categoriaValida(ctx.db, l.categoria).catch(() => null);
      const r = await registrarGasto(ctx, {
        categoria: cat ? l.categoria : "otros_viaje", monto: aCentimos(l.monto), fecha: hoyStr, vehiculoId: o.vehiculoId ?? null,
        nota: [cat ? null : `categoría leída: ${l.categoria}`, l.nota].filter(Boolean).join(" · ") || null, proveedorNombre: l.proveedorNombre,
        proveedorRuc: l.proveedorRuc && validarRuc(l.proveedorRuc) ? l.proveedorRuc : null, comprobante: l.comprobante,
        medioPago: l.medioPago ?? undefined, kmVehiculo: l.kmOdometro,
        rutaFoto: d.tipo === "foto" ? d.rutaArchivo : null, documentoId, origen: "telegram", usuarioId: o.usuarioId,
      });
      return { tipo: "gasto", gastoId: r.id, viajeCodigo: r.viajeCodigo, monto: aCentimos(l.monto), avisoKm: r.avisoKm };
    }
    if (l.tipo === "entrega") {
      if (!o.vehiculoId) throw new ErrorNegocio("¿De qué unidad es el viaje?");
      const v = await viajeEnCursoDeUnidad(ctx, o.vehiculoId);
      if (!v) throw new ErrorNegocio("Esa unidad no tiene un viaje en curso: inicia uno con /viaje para anotar el dinero entregado.");
      const r = await registrarEntrega(ctx, { viajeId: v.id, monto: aCentimos(l.monto), medio: l.medio, fecha: l.fecha && l.fecha <= hoyStr ? l.fecha : hoyStr, documentoId, usuarioId: o.usuarioId });
      return { tipo: "entrega", entregaId: r.id, viajeCodigo: r.viajeCodigo, monto: aCentimos(l.monto) };
    }
    if (l.tipo === "inicio_viaje") {
      if (!o.vehiculoId) throw new ErrorNegocio("¿Qué unidad sale?");
      if (!l.destino) throw new ErrorNegocio("No sé a dónde va: toca ✏️ Corregir y escribe, por ejemplo, «a Puno».");
      // Sin origen, sale de donde terminó su último viaje (o de la base).
      const [ultimo] = await ctx.db.select({ destino: viaje.destinoLugar }).from(viaje).where(eq(viaje.vehiculoId, o.vehiculoId)).orderBy(desc(viaje.fechaSalida), desc(viaje.id)).limit(1);
      const origen = l.origen ?? ultimo?.destino ?? "Base";
      const v = await registrarViajeFlota(ctx, { vehiculoId: o.vehiculoId, origenLugar: origen, destinoLugar: l.destino, estado: "en_curso", origen: "telegram", usuarioId: o.usuarioId });
      const adelanto = l.adelanto ? aCentimos(l.adelanto) : 0;
      if (adelanto) await registrarEntrega(ctx, { viajeId: v.id, monto: adelanto, medio: "efectivo", nota: "Adelanto de salida", documentoId, usuarioId: o.usuarioId });
      return { tipo: "inicio_viaje", viajeId: v.id, viajeCodigo: v.codigo, ruta: `${origen} → ${l.destino}`, adelanto };
    }
    if (l.tipo === "fin_viaje") {
      if (!o.vehiculoId) throw new ErrorNegocio("¿Qué unidad llegó?");
      const v = await viajeEnCursoDeUnidad(ctx, o.vehiculoId);
      if (!v) throw new ErrorNegocio("Esa unidad no tiene un viaje en curso.");
      await finalizarViajeFlota(ctx, { viajeId: v.id, usuarioId: o.usuarioId });
      return { tipo: "fin_viaje", viajeId: v.id, viajeCodigo: v.codigo };
    }
    throw new ErrorNegocio("No hay un gasto ni una entrega que guardar en este mensaje");
  } catch (e) {
    await devolver();
    throw e;
  }
}

export async function descartarLectura(ctx: Contexto, documentoId: number, usuarioId?: number): Promise<void> {
  const [f] = await ctx.db.update(documentoRecibido).set({ estadoLectura: "descartado", proximoIntentoEn: null })
    .where(and(eq(documentoRecibido.id, documentoId), notInArray(documentoRecibido.estadoLectura, RESUELTOS))).returning({ id: documentoRecibido.id });
  if (!f) return noActualizado(ctx, documentoId);
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

// ── Por revisar (web) ───────────────────────────────────────────────────────

export interface ItemPorRevisar {
  documentoId: number;
  /** Quién lo mandó por Telegram (null si no se sabe). */
  usuarioId: number | null;
  tipo: TipoMensaje;
  estado: EstadoLectura;
  desde: Date;
  lectura: Lectura | null;
  texto: string | null;
  rutaArchivo: string | null;
  mime: string;
  error: string | null;
}

const DIA_MS = 86_400_000;

/**
 * Lo que quedó a medias: mensajes con error, sin confirmar hace más de 24 h o que la IA no pudo
 * leer tras varios intentos. Los PDF (guías) tienen su propio flujo y no aparecen aquí.
 */
export async function listarPorRevisar(ctx: Contexto): Promise<ItemPorRevisar[]> {
  const limite = new Date(ctx.reloj().getTime() - DIA_MS);
  const filas = await ctx.db.select().from(documentoRecibido)
    .where(and(
      ne(documentoRecibido.tipo, "pdf"),
      or(
        eq(documentoRecibido.estadoLectura, "error"),
        and(eq(documentoRecibido.estadoLectura, "por_confirmar"), lt(documentoRecibido.creadoEn, limite)),
        and(eq(documentoRecibido.estadoLectura, "pendiente"), gte(documentoRecibido.intentosLectura, 3)),
      ),
    ))
    .orderBy(desc(documentoRecibido.creadoEn)).limit(100);
  const errores = filas.length
    ? await ctx.db.select({ documentoId: lecturaIa.documentoId, error: lecturaIa.error }).from(lecturaIa)
      .where(inArray(lecturaIa.documentoId, filas.map((f) => f.id))).orderBy(lecturaIa.id)
    : [];
  return filas.map((d) => aItem(d, errores));
}

function aItem(d: typeof documentoRecibido.$inferSelect, errores: Array<{ documentoId: number; error: string | null }>): ItemPorRevisar {
  const l = esquemaLectura.safeParse(d.datosExtraidos);
  return {
    documentoId: d.id, usuarioId: d.usuarioId, tipo: d.tipo, estado: d.estadoLectura, desde: d.creadoEn, lectura: l.success ? l.data : null, texto: d.texto,
    rutaArchivo: d.rutaArchivo, mime: d.mime, error: errores.filter((e) => e.documentoId === d.id && e.error).at(-1)?.error ?? null,
  };
}

/**
 * Un mensaje del chofer por su número mientras no esté guardado ni descartado, aunque todavía no
 * figure en «Necesita tu atención»: así un intento fallido no lo esconde. null si no existe o ya se resolvió.
 */
export async function documentoPorConfirmar(ctx: Contexto, documentoId: number): Promise<ItemPorRevisar | null> {
  const [d] = await ctx.db.select().from(documentoRecibido).where(eq(documentoRecibido.id, documentoId));
  if (!d || d.tipo === "pdf" || RESUELTOS.includes(d.estadoLectura)) return null;
  const errores = await ctx.db.select({ documentoId: lecturaIa.documentoId, error: lecturaIa.error }).from(lecturaIa)
    .where(eq(lecturaIa.documentoId, documentoId)).orderBy(lecturaIa.id);
  return aItem(d, errores);
}

/** «V2B-845», «v2b 845» → «V2B845». */
const placaNormal = (t: string) => t.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * La placa aparece como palabra entera, o partida en palabras seguidas («XYZ 987», «XYZ-987»):
 * «ABC1234» o «XABC123» no son la placa ABC-123.
 */
function tienePlaca(palabras: string[], placa: string): boolean {
  for (let i = 0; i < palabras.length; i++) {
    let junto = "";
    for (let j = i; j < palabras.length && junto.length < placa.length; j++) {
      junto += palabras[j];
      if (junto === placa) return true;
    }
  }
  return false;
}

/**
 * De qué camión es un mensaje del chofer, en este orden: (a) una placa escrita en el texto o leída
 * en la boleta; (b) el viaje en curso de quien lo mandó; (c) el último camión con que anotó un gasto.
 * null si no hay cómo saberlo (se pregunta).
 */
export async function camionDeMensaje(
  ctx: Contexto, m: Pick<ItemPorRevisar, "usuarioId" | "texto" | "lectura">,
): Promise<{ vehiculoId: number; por: "placa" | "viaje" | "ultimo" } | null> {
  const l = m.lectura;
  const leido = l?.tipo === "gasto" ? [l.nota, l.proveedorNombre, l.comprobante] : [];
  const palabras = [m.texto, ...leido].filter(Boolean).join(" ").toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  if (palabras.length) {
    const u = (await listarUnidades(ctx)).find((x) => x.placa && placaNormal(x.placa).length >= 5 && tienePlaca(palabras, placaNormal(x.placa)));
    if (u) return { vehiculoId: u.id, por: "placa" };
  }
  if (m.usuarioId === null) return null;
  const c = await capturarContexto(ctx, { usuarioId: m.usuarioId });
  if (c.viajeId !== null && c.vehiculoId !== null) return { vehiculoId: c.vehiculoId, por: "viaje" };
  const ultimo = await ultimaUnidadDeUsuario(ctx, m.usuarioId);
  return ultimo !== null ? { vehiculoId: ultimo, por: "ultimo" } : null;
}

/** Gastos que llegaron por Telegram sin viaje (la unidad no tenía viaje en curso). */
export async function gastosSinViaje(ctx: Contexto, dias = 60) {
  const desde = fechaHoraLima(new Date(ctx.reloj().getTime() - dias * DIA_MS)).fecha;
  return ctx.db.select({
    id: gasto.id, fecha: gasto.fecha, categoria: gasto.categoria, monto: gasto.monto, vehiculoId: gasto.vehiculoId, nota: gasto.nota,
    proveedorNombre: gasto.proveedorNombre, conFoto: sql<boolean>`${gasto.rutaFoto} is not null`,
  }).from(gasto)
    .where(and(isNull(gasto.viajeId), eq(gasto.origen, "telegram"), notInArray(gasto.categoria, ["reparacion_ruta", "mantenimiento"]), gte(gasto.fecha, desde)))
    .orderBy(desc(gasto.fecha), desc(gasto.id));
}

/** Pasa un gasto a un viaje (y a la unidad del viaje). */
export async function asignarViajeGasto(ctx: Contexto, gastoId: number, viajeId: number, usuarioId?: number): Promise<string> {
  const [v] = await ctx.db.select({ codigo: viaje.codigo, vehiculoId: viaje.vehiculoId }).from(viaje).where(eq(viaje.id, viajeId));
  if (!v) throw new ErrorNegocio("El viaje no existe");
  const [g] = await ctx.db.update(gasto).set({ viajeId, vehiculoId: v.vehiculoId, editadoEn: ctx.reloj() }).where(eq(gasto.id, gastoId)).returning({ id: gasto.id });
  if (!g) throw new ErrorNegocio("El gasto no existe");
  await registrarAuditoria(ctx.db, { usuarioId, accion: "gasto_asignado_viaje", entidad: "gasto", entidadId: gastoId, detalle: { viajeId } });
  return v.codigo;
}

/** Costo de la IA en un mes (AAAA-MM), en dólares, y cuántas lecturas se hicieron. */
export async function costoIaDelMes(ctx: Contexto, mes: string): Promise<{ usd: number; lecturas: number }> {
  const [f] = await ctx.db.select({ micro: sql<number>`coalesce(sum(${lecturaIa.costoMicroUsd}), 0)`, n: sql<number>`count(*)` }).from(lecturaIa)
    .where(sql`to_char(${lecturaIa.creadoEn} at time zone 'America/Lima', 'YYYY-MM') = ${mes}`);
  return { usd: Number(f?.micro ?? 0) / 1_000_000, lecturas: Number(f?.n ?? 0) };
}

/** El archivo original de un mensaje (foto o nota de voz), para verlo en la web. */
export async function archivoDeDocumento(ctx: Contexto, documentoId: number): Promise<{ ruta: string; mime: string } | null> {
  const [d] = await ctx.db.select({ ruta: documentoRecibido.rutaArchivo, mime: documentoRecibido.mime }).from(documentoRecibido).where(eq(documentoRecibido.id, documentoId));
  return d?.ruta ? { ruta: d.ruta, mime: d.mime } : null;
}

/** Cuántas cosas esperan revisión (para el aviso del inicio). */
export async function contarPorRevisar(ctx: Contexto): Promise<number> {
  const [a, b, c] = await Promise.all([listarPorRevisar(ctx), gastosSinViaje(ctx), viajesPorRevisar(ctx)]);
  return a.length + b.length + c.length;
}
