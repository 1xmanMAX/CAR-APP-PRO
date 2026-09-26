import { ajuste, desc, eq, eventoTelegram, usuario, vehiculo } from "@sunatapp/db";
import type { Contexto } from "../infra/contexto";

export interface EntradaEvento {
  usuarioId?: number | null;
  autor?: string | null;
  comando: string;
  texto: string;
  payload?: unknown;
  vehiculoId?: number | null;
  entidad?: string | null;
  entidadId?: number | null;
  estado?: "ok" | "error";
}

/** Cada interacción con el bot queda como evento: alimenta el feed del Dashboard. Nunca falla. */
export async function registrarEvento(ctx: Contexto, e: EntradaEvento): Promise<void> {
  try {
    await ctx.db.insert(eventoTelegram).values({
      usuarioId: e.usuarioId ?? null, autor: e.autor ?? null, comando: e.comando, texto: e.texto.slice(0, 500),
      payload: e.payload ?? null, vehiculoId: e.vehiculoId ?? null, entidad: e.entidad ?? null, entidadId: e.entidadId ?? null,
      estado: e.estado ?? "ok",
    });
  } catch (error) {
    ctx.log?.("error", "no se pudo registrar el evento de Telegram", error);
  }
}

export async function listarEventos(ctx: Contexto, limite = 20) {
  const filas = await ctx.db
    .select({ e: eventoTelegram, nombre: usuario.nombre, unidad: vehiculo.codigo })
    .from(eventoTelegram)
    .leftJoin(usuario, eq(usuario.id, eventoTelegram.usuarioId))
    .leftJoin(vehiculo, eq(vehiculo.id, eventoTelegram.vehiculoId))
    .orderBy(desc(eventoTelegram.id))
    .limit(limite);
  return filas.map(({ e, nombre, unidad }) => ({
    id: e.id, fecha: e.creadoEn, autor: e.autor ?? nombre ?? "—", comando: e.comando, texto: e.texto, unidad, estado: e.estado,
    entidad: e.entidad, entidadId: e.entidadId,
  }));
}

const CLAVE_LATIDO = "bot_latido";

/** El bot marca su latido cada minuto; la web lo lee para mostrar EN LÍNEA / DESCONECTADO. */
export async function marcarLatidoBot(ctx: Contexto, info: { usuario?: string } = {}): Promise<void> {
  const valor = { en: ctx.reloj().toISOString(), ...info };
  await ctx.db.insert(ajuste).values({ clave: CLAVE_LATIDO, valor }).onConflictDoUpdate({ target: ajuste.clave, set: { valor, actualizadoEn: new Date() } });
}

export async function estadoBot(ctx: Contexto): Promise<{ enLinea: boolean; ultimo: string | null; usuario: string | null }> {
  const [f] = await ctx.db.select().from(ajuste).where(eq(ajuste.clave, CLAVE_LATIDO));
  if (!f) return { enLinea: false, ultimo: null, usuario: null };
  const v = f.valor as { en: string; usuario?: string };
  const edad = ctx.reloj().getTime() - Date.parse(v.en);
  return { enLinea: edad < 3 * 60_000, ultimo: v.en, usuario: v.usuario ?? null };
}

/** Chat de Telegram al que van las alertas (grupo del equipo); null = al dueño por privado. */
export async function chatAlertas(ctx: Contexto): Promise<number | null> {
  const [f] = await ctx.db.select().from(ajuste).where(eq(ajuste.clave, "telegram_chat_alertas"));
  const v = f?.valor as { chatId?: number } | undefined;
  return typeof v?.chatId === "number" ? v.chatId : null;
}

export async function guardarChatAlertas(ctx: Contexto, chatId: number | null): Promise<void> {
  const valor = { chatId };
  await ctx.db.insert(ajuste).values({ clave: "telegram_chat_alertas", valor }).onConflictDoUpdate({ target: ajuste.clave, set: { valor, actualizadoEn: new Date() } });
}

/**
 * Cola de avisos que la web deja para el bot (la web puede correr en otro proceso). El bot la
 * vacía en su tarea de fondo y los envía al chat de alertas.
 */
export async function encolarAviso(ctx: Contexto, texto: string, extra: { documento?: string; nombreArchivo?: string } = {}): Promise<void> {
  const [f] = await ctx.db.select().from(ajuste).where(eq(ajuste.clave, "avisos_pendientes"));
  const lista = ((f?.valor as { lista?: unknown[] } | undefined)?.lista ?? []) as Array<{ texto: string }>;
  lista.push({ texto, ...extra });
  const valor = { lista: lista.slice(-100) };
  await ctx.db.insert(ajuste).values({ clave: "avisos_pendientes", valor }).onConflictDoUpdate({ target: ajuste.clave, set: { valor, actualizadoEn: new Date() } });
}

export async function tomarAvisos(ctx: Contexto): Promise<Array<{ texto: string; documento?: string; nombreArchivo?: string }>> {
  return ctx.db.transaction(async (tx) => {
    const [f] = await tx.select().from(ajuste).where(eq(ajuste.clave, "avisos_pendientes")).for("update");
    const lista = ((f?.valor as { lista?: unknown[] } | undefined)?.lista ?? []) as Array<{ texto: string; documento?: string; nombreArchivo?: string }>;
    if (lista.length) await tx.update(ajuste).set({ valor: { lista: [] } }).where(eq(ajuste.clave, "avisos_pendientes"));
    return lista;
  });
}
