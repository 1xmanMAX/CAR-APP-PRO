import { and, auditoria, eq, isNotNull, sql, usuario } from "@sunatapp/db";
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
