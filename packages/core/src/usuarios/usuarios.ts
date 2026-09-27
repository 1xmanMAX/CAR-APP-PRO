import { createHash, randomInt } from "node:crypto";
import { and, auditoria, eq, gt, invitacion, isNotNull, isNull, sql, usuario } from "@sunatapp/db";
import { ErrorNegocio } from "../errores";
import { registrarAuditoria } from "../infra/auditoria";
import type { Contexto } from "../infra/contexto";

export type Usuario = typeof usuario.$inferSelect;

export async function hayUsuarios(ctx: Contexto): Promise<boolean> {
  const filas = await ctx.db.select({ id: usuario.id }).from(usuario).limit(1);
  return filas.length > 0;
}

export async function hayDueno(ctx: Contexto): Promise<boolean> {
  const [fila] = await ctx.db.select({ id: usuario.id }).from(usuario).where(isNotNull(usuario.telegramId)).limit(1);
  return fila !== undefined;
}

/**
 * Asigna telegramId al primer usuario (menor id) que todavía no tenga uno. Se bloquea toda la
 * tabla `usuario` con FOR UPDATE dentro de la transacción para que dos registros concurrentes no
 * asignen el mismo dueño dos veces: el segundo verá ya el telegramId puesto por el primero.
 */
export async function registrarUsuarioTelegram(ctx: Contexto, telegramId: number): Promise<Usuario> {
  return ctx.db.transaction(async (tx) => {
    const filas = await tx.select().from(usuario).orderBy(usuario.id).for("update");
    if (filas.length === 0) throw new ErrorNegocio("Ejecuta pnpm sembrar primero");
    if (filas.some((u) => u.telegramId !== null)) throw new ErrorNegocio("El bot ya tiene dueño");
    const primero = filas[0]!;
    const [actualizado] = await tx.update(usuario).set({ telegramId }).where(eq(usuario.id, primero.id)).returning();
    return actualizado!;
  });
}

export async function usuarioPorTelegram(ctx: Contexto, telegramId: number): Promise<Usuario | null> {
  const [u] = await ctx.db.select().from(usuario).where(and(eq(usuario.telegramId, telegramId), eq(usuario.activo, true)));
  return u ?? null;
}

export async function duenoTelegramId(ctx: Contexto): Promise<number | null> {
  const [u] = await ctx.db.select({ telegramId: usuario.telegramId }).from(usuario).where(isNotNull(usuario.telegramId)).orderBy(usuario.id).limit(1);
  return u?.telegramId ?? null;
}

export async function auditarTelegramDesconocido(ctx: Contexto, telegramId: number, texto: string | undefined): Promise<void> {
  await registrarAuditoria(ctx.db, {
    accion: "telegram_desconocido",
    entidad: "usuario",
    entidadId: telegramId,
    detalle: texto !== undefined ? { texto } : null,
  });
}

export async function contarAuditoria(ctx: Contexto, accion: string): Promise<number> {
  const [fila] = await ctx.db.select({ n: sql<number>`count(*)` }).from(auditoria).where(eq(auditoria.accion, accion));
  return Number(fila?.n ?? 0);
}

// ── Invitaciones (/invitar) ─────────────────────────────────────────────────

const hashCodigo = (codigo: string) => createHash("sha256").update(codigo).digest("hex");

/**
 * Código de 6 dígitos (24 h, un solo uso) para que alguien del equipo entre al bot: quien se lo
 * manda queda registrado como chofer (el dueño le cambia el rol en Ajustes si hace falta).
 */
export async function crearInvitacion(ctx: Contexto, creadaPor: number): Promise<{ codigo: string; expiraEn: Date }> {
  const codigo = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiraEn = new Date(ctx.reloj().getTime() + 24 * 3_600_000);
  await ctx.db.insert(invitacion).values({ codigoHash: hashCodigo(codigo), creadaPor, expiraEn });
  await registrarAuditoria(ctx.db, { usuarioId: creadaPor, accion: "invitacion_creada", entidad: "invitacion", detalle: { expiraEn } });
  return { codigo, expiraEn };
}

/** Usa un código de invitación: crea el usuario de Telegram. null si no vale (vencido, usado o inventado). */
export async function usarInvitacion(ctx: Contexto, codigo: string, telegramId: number, nombre: string): Promise<Usuario | null> {
  if (!/^\d{6}$/.test(codigo.trim())) return null;
  return ctx.db.transaction(async (tx) => {
    const [inv] = await tx.update(invitacion).set({ usadaEn: ctx.reloj() })
      .where(and(eq(invitacion.codigoHash, hashCodigo(codigo.trim())), isNull(invitacion.usadaEn), gt(invitacion.expiraEn, ctx.reloj())))
      .returning({ id: invitacion.id, creadaPor: invitacion.creadaPor });
    if (!inv) return null;
    const [u] = await tx.insert(usuario).values({ nombre: nombre.trim() || "Chofer", rol: "chofer", telegramId, telegramNombre: nombre.trim() || null }).returning();
    await tx.update(invitacion).set({ usadaPor: u!.id }).where(eq(invitacion.id, inv.id));
    await registrarAuditoria(tx, { usuarioId: u!.id, accion: "invitacion_usada", entidad: "usuario", entidadId: u!.id, detalle: { invitacionId: inv.id, creadaPor: inv.creadaPor } });
    return u!;
  });
}
