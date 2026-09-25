import { createHash, createHmac, pbkdf2Sync, randomBytes, randomInt, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { sql } from "@sunatapp/db";
import type { Contexto } from "../infra/contexto";

/**
 * Identidad del dispositivo y del grupo (portado de PixPin, `sincro/Identidad.kt`).
 *
 * - Cada dispositivo tiene un **id** al azar (nunca se enseña) y un **código** de cuatro signos que
 *   sale de ese id (`K7Q2`): es el que va en el código de cada cosa que nace aquí (`47·K7Q2`).
 * - El **grupo** es un código de diez signos que se teclea en cada dispositivo. De él salen la clave
 *   con la que se cifra lo que viaja y la etiqueta con la que un dispositivo se anuncia en la red sin
 *   revelar el código.
 */

/** Sin 0/O ni 1/I/L: se dicta en voz alta y se teclea sin dudar. 31 signos: diez dan casi 50 bits. */
export const SIGNOS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const LARGO_GRUPO = 10;

export interface Dispositivo {
  id: string;
  nombre: string;
}

export interface Identidad {
  yo: Dispositivo;
  /** Código del grupo sin guiones; null si no está en ninguno. */
  grupo: string | null;
  /** Los dispositivos del grupo que se conocen, este incluido. Viaja en cada saludo y se junta. */
  miembros: Array<Dispositivo & { visto?: number; direccion?: string }>;
}

/** Los cuatro signos fijos del dispositivo, sacados de su id. */
export function codigoDispositivo(id: string): string {
  const h = createHash("sha256").update(id).digest();
  return Array.from({ length: 4 }, (_, i) => SIGNOS[h[i]! % SIGNOS.length]).join("");
}

export function nuevoCodigoGrupo(): string {
  return Array.from({ length: LARGO_GRUPO }, () => SIGNOS[randomInt(SIGNOS.length)]).join("");
}

export function limpiarCodigo(tecleado: string): string {
  return tecleado.toUpperCase().split("").filter((c) => SIGNOS.includes(c)).join("");
}

export function codigoValido(codigo: string): boolean {
  return codigo.length === LARGO_GRUPO && codigo.split("").every((c) => SIGNOS.includes(c));
}

/** `K7Q2M-9XMPA`: en dos mitades, como se lee y se copia sin perderse. */
export function codigoLegible(codigo: string): string {
  return codigo.length <= 5 ? codigo : `${codigo.slice(0, 5)}-${codigo.slice(5)}`;
}

/** La clave del grupo: PBKDF2 con muchas vueltas para que probar códigos a ciegas cueste de verdad. */
export function claveGrupo(codigo: string): Buffer {
  return pbkdf2Sync(codigo, "controlflota-sincro-grupo", 60_000, 32, "sha256");
}

export function hmac(clave: Buffer, ...partes: Array<Buffer | string>): Buffer {
  const m = createHmac("sha256", clave);
  for (const p of partes) m.update(p);
  return m.digest();
}

/** Lo que se anuncia en la red: dieciséis cifras que no dejan sacar el código. */
export function etiquetaGrupo(clave: Buffer): string {
  return hmac(clave, "etiqueta").subarray(0, 8).toString("hex");
}

/** Los miembros de dos dispositivos, juntos. Por id; el que habla por sí mismo trae su nombre al día. */
export function juntarMiembros(mios: Identidad["miembros"], suyos: Identidad["miembros"], quienHabla?: Dispositivo): Identidad["miembros"] {
  const porId = new Map<string, Identidad["miembros"][number]>();
  for (const a of mios) porId.set(a.id, a);
  for (const a of suyos) if (!porId.has(a.id)) porId.set(a.id, { id: a.id, nombre: a.nombre });
  if (quienHabla) porId.set(quienHabla.id, { ...porId.get(quienHabla.id), id: quienHabla.id, nombre: quienHabla.nombre, visto: Date.now() });
  return [...porId.values()];
}

// ── Guardado (tabla local sinc_estado, no se sincroniza) ─────────────────────

async function leerEstado(ctx: Contexto, clave: string): Promise<string | null> {
  const r = await ctx.db.execute(sql`select valor from sinc_estado where clave = ${clave}`);
  const fila = (r as unknown as { rows: Array<{ valor: string }> }).rows[0];
  return fila?.valor ?? null;
}

async function guardarEstado(ctx: Contexto, clave: string, valor: string): Promise<void> {
  await ctx.db.execute(sql`insert into sinc_estado (clave, valor) values (${clave}, ${valor})
    on conflict (clave) do update set valor = excluded.valor`);
}

/**
 * La identidad de este dispositivo; la crea la primera vez. Al crearla, se sellan con su código las
 * filas que aún no tenían dispositivo de origen (lo que existía antes de sincronizar).
 */
export async function identidad(ctx: Contexto): Promise<Identidad> {
  const guardada = await leerEstado(ctx, "identidad");
  if (guardada) return JSON.parse(guardada) as Identidad;
  const yo: Dispositivo = { id: randomUUID(), nombre: nombreDePorOmision() };
  const nueva: Identidad = { yo, grupo: null, miembros: [yo] };
  await guardarIdentidad(ctx, nueva);
  return nueva;
}

function nombreDePorOmision(): string {
  const h = (() => { try { return hostname(); } catch { return ""; } })();
  if (process.env.ANDROID_DATA || process.platform === "android") return "Celular";
  return h ? `PC ${h}`.slice(0, 40) : "Este dispositivo";
}

export async function guardarIdentidad(ctx: Contexto, i: Identidad): Promise<void> {
  await guardarEstado(ctx, "identidad", JSON.stringify(i));
  const codigo = codigoDispositivo(i.yo.id);
  // Lo creado antes de tener identidad se queda sin dispositivo de origen: así dos copias de la misma
  // base inicial siguen siendo idénticas y no hay nada que juntar entre ellas.
  if ((await leerEstado(ctx, "disp")) !== codigo) await guardarEstado(ctx, "disp", codigo);
}

export async function renombrarDispositivo(ctx: Contexto, nombre: string): Promise<void> {
  const i = await identidad(ctx);
  const limpio = nombre.trim().slice(0, 40);
  if (!limpio) return;
  i.yo.nombre = limpio;
  i.miembros = juntarMiembros(i.miembros, [], i.yo);
  await guardarIdentidad(ctx, i);
}

/** Crea un grupo nuevo con este dispositivo dentro. Devuelve el código para teclearlo en los demás. */
export async function crearGrupo(ctx: Contexto): Promise<string> {
  const i = await identidad(ctx);
  i.grupo = nuevoCodigoGrupo();
  i.miembros = [i.yo];
  await guardarIdentidad(ctx, i);
  return i.grupo;
}

/** Entra al grupo con un código tecleado. Los demás miembros se conocen al sincronizar la primera vez. */
export async function unirseAGrupo(ctx: Contexto, codigo: string): Promise<void> {
  const limpio = limpiarCodigo(codigo);
  if (!codigoValido(limpio)) throw new Error(`El código del grupo tiene ${LARGO_GRUPO} signos (letras y números, sin 0, 1, I, L ni O)`);
  const i = await identidad(ctx);
  i.grupo = limpio;
  i.miembros = [i.yo];
  await guardarIdentidad(ctx, i);
}

export async function salirDelGrupo(ctx: Contexto): Promise<void> {
  const i = await identidad(ctx);
  i.grupo = null;
  i.miembros = [i.yo];
  await guardarIdentidad(ctx, i);
  await ctx.db.execute(sql`delete from sinc_base`);
}

/**
 * **Nueva identidad**: para cuando la carpeta de datos se copió de otro dispositivo (los dos tendrían
 * el mismo id y el mismo código, y sus números chocarían). Lo ya creado conserva su código de origen.
 */
export async function nuevaIdentidad(ctx: Contexto): Promise<void> {
  const i = await identidad(ctx);
  const yo = { id: randomUUID(), nombre: i.yo.nombre };
  await guardarIdentidad(ctx, { yo, grupo: i.grupo, miembros: [yo] });
  await ctx.db.execute(sql`delete from sinc_base`);
  await ctx.db.execute(sql`select setval('sinc_contador', greatest(nextval('sinc_contador'), 1))`);
}

export const aleatorio = (n: number) => randomBytes(n);
