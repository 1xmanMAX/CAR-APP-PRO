/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono, type Context as HonoContext } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Child } from "hono/jsx";
import {
  canjearEnlaceWeb, cerrarSesion, crearSesion, encolarAviso, entrarConClave, ErrorNegocio, ErrorValidacion, estadoBot,
  fechaHoraLima, guardarUsuario, listarUnidades, obtenerEmpresa, necesitaConfiguracionInicial, puedeEditar, puedeVer, rangoMes,
  resumenFinanciero, usuarioDeSesion, type Contexto, type RedSinc, type Seccion, type UsuarioWeb,
} from "@sunatapp/core";
import { Layout, PaginaSimple, type DatosCabecera } from "./ui";

export interface OpcionesWeb {
  /** URL pública (para validar el Origin de los POST). Vacío = se acepta el host de la petición. */
  urlPublica?: string | null;
  /** Envía un aviso al grupo de Telegram. Por defecto lo encola para que lo mande el bot. */
  avisar?: (texto: string, adjunto?: { contenido: Buffer; nombre: string }) => Promise<void>;
  /** Cookie `Secure` (cuando se sirve por HTTPS). */
  cookieSegura?: boolean;
  /** La red de sincronización entre dispositivos (sin ella, la pantalla Sincronizar lo explica). */
  red?: RedSinc | null;
}

export type Variables = { usuario: UsuarioWeb };
export type App = Hono<{ Variables: Variables }>;
export type C = HonoContext<{ Variables: Variables }>;

export interface Deps {
  ctx: Contexto;
  avisar: NonNullable<OpcionesWeb["avisar"]>;
  cabecera: () => Promise<DatosCabecera>;
  red: RedSinc | null;
}

export const COOKIE = "flota_sesion";
export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PUBLICO = join(RAIZ, "public");
export const THREE = dirname(dirname(createRequire(import.meta.url).resolve("three")));

const TIPOS: Record<string, string> = {
  ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".pdf": "application/pdf", ".xml": "application/xml", ".zip": "application/zip", ".webp": "image/webp",
};

export async function servirArchivo(c: C, base: string, ruta: string, cache = "public, max-age=3600") {
  const destino = resolve(base, ruta);
  if (destino !== base && !destino.startsWith(base + sep)) return c.notFound();
  try {
    const cuerpo = await readFile(destino);
    return c.body(new Uint8Array(cuerpo), 200, { "Content-Type": TIPOS[extname(destino)] ?? "application/octet-stream", "Cache-Control": cache });
  } catch {
    return c.notFound();
  }
}

/** Datos del header: se calculan en cada página (son consultas baratas). */
export async function datosCabecera(ctx: Contexto): Promise<DatosCabecera> {
  const { fecha, hora } = fechaHoraLima(ctx.reloj());
  const emp = await obtenerEmpresa(ctx);
  const todas = await listarUnidades(ctx, true);
  const activas = todas.filter((u) => u.estado !== "inactivo");
  const { desde, hasta } = rangoMes(fecha);
  const fin = await resumenFinanciero(ctx, desde, hasta);
  const bot = await estadoBot(ctx);
  return {
    empresa: (emp?.nombreComercial || emp?.razonSocial || "EMPRESA").toUpperCase(),
    unidadesActivas: activas.filter((u) => u.estado === "en_ruta" || u.estado === "en_base").length,
    unidadesTotal: activas.length,
    viajesMes: fin.viajes,
    margenPct: fin.margenPct,
    botEnLinea: bot.enLinea,
    hora: hora.slice(0, 5),
    simulado: ctx.simulado,
  };
}

/** Texto de error legible para el usuario (nunca el volcado interno). */
export function mensajeError(error: unknown): string {
  if (error instanceof ErrorNegocio || error instanceof ErrorValidacion) return error.message;
  return "Ocurrió un error inesperado. Revisa el log del servidor.";
}

/** Redirige con un aviso en la URL (?ok= / ?error=). */
export function volver(c: C, ruta: string, aviso: { ok?: string; error?: string }) {
  const url = new URL(ruta, "http://x");
  if (aviso.ok) url.searchParams.set("ok", aviso.ok);
  if (aviso.error) url.searchParams.set("error", aviso.error);
  return c.redirect(url.pathname + url.search, 303);
}

/** Ejecuta la acción de un formulario y vuelve con el resultado o el error. */
export async function accion(c: C, ruta: string, fn: () => Promise<string | { ok: string; ruta?: string }>) {
  try {
    const r = await fn();
    return typeof r === "string" ? volver(c, ruta, { ok: r }) : volver(c, r.ruta ?? ruta, { ok: r.ok });
  } catch (error) {
    if (!(error instanceof ErrorNegocio || error instanceof ErrorValidacion)) console.error(error);
    return volver(c, ruta, { error: mensajeError(error) });
  }
}

export async function formulario(c: C): Promise<Record<string, string>> {
  const cuerpo = await c.req.parseBody({ all: true });
  const r: Record<string, string> = {};
  for (const [k, v] of Object.entries(cuerpo)) {
    if (typeof v === "string") r[k] = v.trim();
    else if (Array.isArray(v)) r[k] = v.filter((x): x is string => typeof x === "string").join("\u0001");
  }
  return r;
}

export async function formularioMultiparte(c: C): Promise<{ campos: Record<string, string>; archivos: Record<string, File> }> {
  const cuerpo = await c.req.parseBody({ all: true });
  const campos: Record<string, string> = {};
  const archivos: Record<string, File> = {};
  for (const [k, v] of Object.entries(cuerpo)) {
    if (typeof v === "string") campos[k] = v.trim();
    else if (v instanceof File && v.size > 0) archivos[k] = v;
    else if (Array.isArray(v)) campos[k] = v.filter((x): x is string => typeof x === "string").join("\u0001");
  }
  return { campos, archivos };
}

/** Renderiza una página con el layout común. */
export async function pagina(
  c: C, d: Deps, o: { titulo: string; seccion: Seccion; scripts?: string[]; importmap?: boolean }, cuerpo: Child,
) {
  const html = (
    <Layout
      titulo={o.titulo} seccion={o.seccion} usuario={c.get("usuario")} cab={await d.cabecera()}
      ok={c.req.query("ok")} error={c.req.query("error")} scripts={o.scripts} importmap={o.importmap}
    >
      {cuerpo}
    </Layout>
  );
  return c.html("<!doctype html>" + html.toString());
}

export const empresaActual = obtenerEmpresa;

/** Sirve un archivo del almacén (PDF, XML, fotos) solo a usuarios con sesión; nunca por ruta libre. */
export async function servirDeAlmacen(c: C, d: Deps, ruta: string | null, descargar = false) {
  if (!ruta) return c.text("El archivo no existe (todavía no se generó)", 404);
  try {
    const contenido = await d.ctx.almacen.leer(ruta);
    const nombre = ruta.split("/").pop() ?? "archivo";
    return c.body(new Uint8Array(contenido), 200, {
      "Content-Type": TIPOS[extname(ruta).toLowerCase()] ?? "application/octet-stream",
      "Content-Disposition": `${descargar ? "attachment" : "inline"}; filename="${nombre.replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=300",
    });
  } catch {
    return c.text("El archivo no se encontró en el almacén", 404);
  }
}
