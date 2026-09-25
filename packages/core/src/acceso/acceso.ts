import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { and, eq, enlaceWeb, gt, isNull, sesionWeb, sql, usuario, type RolUsuario } from "@sunatapp/db";
import { ErrorNegocio } from "../errores";
import { registrarAuditoria } from "../infra/auditoria";
import type { Contexto } from "../infra/contexto";

export type Seccion =
  | "dashboard" | "trailer" | "flota" | "inventario" | "reparaciones" | "viajes" | "finanzas" | "rentabilidad" | "telegram" | "ajustes";

/** Qué ve cada rol (handoff §8). El chofer usa solo Telegram. */
export const PERMISOS: Record<RolUsuario, { ve: Seccion[]; edita: Seccion[] }> = {
  dueno: {
    ve: ["dashboard", "trailer", "flota", "inventario", "reparaciones", "viajes", "finanzas", "rentabilidad", "telegram", "ajustes"],
    edita: ["dashboard", "trailer", "flota", "inventario", "reparaciones", "viajes", "finanzas", "rentabilidad", "telegram", "ajustes"],
  },
  contador: { ve: ["dashboard", "viajes", "finanzas", "rentabilidad", "telegram"], edita: ["viajes", "finanzas"] },
  taller: { ve: ["dashboard", "trailer", "flota", "inventario", "reparaciones", "telegram"], edita: ["inventario", "reparaciones", "trailer"] },
  chofer: { ve: [], edita: [] },
};

export const NOMBRE_ROL: Record<RolUsuario, string> = { dueno: "Dueño / Admin", contador: "Contador", taller: "Encargado de taller", chofer: "Chofer" };

export function puedeVer(rol: RolUsuario, s: Seccion): boolean {
  return PERMISOS[rol].ve.includes(s);
}
export function puedeEditar(rol: RolUsuario, s: Seccion): boolean {
  return PERMISOS[rol].edita.includes(s);
}

const hash = (t: string) => createHash("sha256").update(t).digest("hex");

export function hashClave(clave: string): string {
  const sal = randomBytes(16);
  return `scrypt$${sal.toString("hex")}$${scryptSync(clave, sal, 64).toString("hex")}`;
}

export function verificarClave(clave: string, guardado: string | null): boolean {
  if (!guardado) return false;
  const [alg, sal, h] = guardado.split("$");
  if (alg !== "scrypt" || !sal || !h) return false;
  const esperado = Buffer.from(h, "hex");
  const calculado = scryptSync(clave, Buffer.from(sal, "hex"), esperado.length);
  return timingSafeEqual(esperado, calculado);
}

export type UsuarioWeb = { id: number; nombre: string; email: string | null; rol: RolUsuario; telegramId: number | null };

const DIAS_SESION = 30;

export async function crearSesion(ctx: Contexto, usuarioId: number): Promise<{ token: string; expira: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expira = new Date(ctx.reloj().getTime() + DIAS_SESION * 86_400_000);
  await ctx.db.insert(sesionWeb).values({ tokenHash: hash(token), usuarioId, expiraEn: expira });
  return { token, expira };
}

export async function usuarioDeSesion(ctx: Contexto, token: string | undefined): Promise<UsuarioWeb | null> {
  if (!token) return null;
  const [f] = await ctx.db
    .select({ id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol, telegramId: usuario.telegramId })
    .from(sesionWeb).innerJoin(usuario, eq(usuario.id, sesionWeb.usuarioId))
    .where(and(eq(sesionWeb.tokenHash, hash(token)), gt(sesionWeb.expiraEn, ctx.reloj()), eq(usuario.activo, true)));
  return f ?? null;
}

export async function cerrarSesion(ctx: Contexto, token: string): Promise<void> {
  await ctx.db.delete(sesionWeb).where(eq(sesionWeb.tokenHash, hash(token)));
}

export async function entrarConClave(ctx: Contexto, email: string, clave: string): Promise<UsuarioWeb> {
  const [u] = await ctx.db.select().from(usuario).where(and(sql`lower(${usuario.email}) = ${email.trim().toLowerCase()}`, eq(usuario.activo, true)));
  if (!u || !verificarClave(clave, u.passwordHash)) {
    await registrarAuditoria(ctx.db, { accion: "web_login_fallido", entidad: "usuario", detalle: { email } });
    throw new ErrorNegocio("Correo o contraseña incorrectos");
  }
  if (u.rol === "chofer") throw new ErrorNegocio("Los choferes usan la app por Telegram");
  return { id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, telegramId: u.telegramId };
}

/** Enlace de un solo uso (10 min) que entrega el bot con /web. */
export async function crearEnlaceWeb(ctx: Contexto, usuarioId: number): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await ctx.db.insert(enlaceWeb).values({ tokenHash: hash(token), usuarioId, expiraEn: new Date(ctx.reloj().getTime() + 10 * 60_000) });
  return token;
}

export async function canjearEnlaceWeb(ctx: Contexto, token: string): Promise<number> {
  const [f] = await ctx.db.update(enlaceWeb).set({ usadoEn: ctx.reloj() })
    .where(and(eq(enlaceWeb.tokenHash, hash(token)), isNull(enlaceWeb.usadoEn), gt(enlaceWeb.expiraEn, ctx.reloj())))
    .returning({ usuarioId: enlaceWeb.usuarioId });
  if (!f) throw new ErrorNegocio("El enlace venció o ya se usó. Pide uno nuevo con /web en el bot.");
  return f.usuarioId;
}

export async function listarUsuarios(ctx: Contexto) {
  return ctx.db.select({
    id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol, telegramId: usuario.telegramId,
    telegramNombre: usuario.telegramNombre, activo: usuario.activo, tieneClave: sql<boolean>`${usuario.passwordHash} is not null`,
  }).from(usuario).orderBy(usuario.id);
}

export async function guardarUsuario(
  ctx: Contexto,
  e: { id?: number; nombre: string; email?: string | null; rol: RolUsuario; clave?: string | null; telegramId?: number | null; activo?: boolean },
  autorId?: number,
): Promise<number> {
  if (!e.nombre.trim()) throw new ErrorNegocio("Falta el nombre");
  if (e.clave && e.clave.length < 8) throw new ErrorNegocio("La contraseña debe tener al menos 8 caracteres");
  const email = e.email?.trim().toLowerCase() || null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ErrorNegocio("Correo no válido");
  const valores: Partial<typeof usuario.$inferInsert> = { nombre: e.nombre.trim(), email, rol: e.rol };
  if (e.clave) valores.passwordHash = hashClave(e.clave);
  if (e.telegramId !== undefined) valores.telegramId = e.telegramId;
  if (e.activo !== undefined) valores.activo = e.activo;
  try {
    if (e.id !== undefined) {
      if (e.id === autorId && (e.rol !== "dueno" || e.activo === false)) throw new ErrorNegocio("No puedes quitarte tu propio acceso de dueño");
      const [f] = await ctx.db.update(usuario).set(valores).where(eq(usuario.id, e.id)).returning({ id: usuario.id });
      if (!f) throw new ErrorNegocio("El usuario no existe");
      await registrarAuditoria(ctx.db, { usuarioId: autorId, accion: "usuario_editado", entidad: "usuario", entidadId: f.id, detalle: { ...e, clave: e.clave ? "***" : undefined } });
      return f.id;
    }
    const [f] = await ctx.db.insert(usuario).values({ nombre: valores.nombre!, ...valores }).returning({ id: usuario.id });
    await registrarAuditoria(ctx.db, { usuarioId: autorId, accion: "usuario_creado", entidad: "usuario", entidadId: f!.id, detalle: { ...e, clave: e.clave ? "***" : undefined } });
    return f!.id;
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code;
    if (code === "23505") throw new ErrorNegocio("Ese correo o Telegram ya lo usa otro usuario");
    throw error;
  }
}

/** Primer usuario sin contraseña: la web permite crearla una sola vez (arranque inicial). */
export async function necesitaConfiguracionInicial(ctx: Contexto): Promise<boolean> {
  const [f] = await ctx.db.select({ n: sql<number>`count(*)` }).from(usuario).where(sql`${usuario.passwordHash} is not null`);
  return Number(f?.n ?? 0) === 0;
}
