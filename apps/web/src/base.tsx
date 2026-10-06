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
  guardarUsuario, obtenerEmpresa, necesitaConfiguracionInicial, puedeEditar, puedeVer,
  usuarioDeSesion, type Contexto, type RedSinc, type Seccion, type UsuarioWeb,
} from "@sunatapp/core";
import { LUGAR_DE_SECCION, type Lugar } from "./lugares";
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
  /** Bot, SUNAT y ajustes de este dispositivo (los da el arranque completo: PC y Android). */
  servicios?: ServiciosDispositivo | null;
  /**
   * Entrada directa: quien abre la app desde el mismo equipo (la WebView de Android o el navegador
   * de la PC en localhost) entra como dueño sin formulario. Desde otro equipo se sigue pidiendo
   * correo y contraseña.
   */
  entradaDirecta?: boolean;
}

/** Estado de lo que corre en este dispositivo además de la web. */
export interface EstadoServicios {
  plataforma: "pc" | "android";
  /** Dónde se guardan los ajustes del dispositivo (su `.env`). */
  archivoAjustes: string;
  bot: { estado: "sin_token" | "conectando" | "en_linea" | "error" | "esperando_datos"; mensaje?: string; usuario?: string };
  sunat: { modo: "simulado" | "beta" | "real"; error?: string };
  /** Lector de boletas por Telegram: «reglas» (sin internet) o «deepseek», y si hay notas de voz. */
  ia: { lector: "reglas" | "deepseek"; voz: boolean; error?: string };
  /** Código para registrarse como dueño en el bot (solo mientras no hay dueño en Telegram). */
  codigoRegistro: string | null;
}

export interface ServiciosDispositivo {
  estado(): EstadoServicios;
  /** Valores actuales del `.env` del dispositivo. */
  ajustes(): Record<string, string>;
  /** Guarda en el `.env` del dispositivo y vuelve a arrancar bot y SUNAT con los valores nuevos. */
  guardarAjustes(cambios: Record<string, string | null>, certificado?: Buffer): Promise<void>;
  /** Tras la configuración inicial: arranca lo que esperaba datos (el bot). */
  alConfigurar(): Promise<void>;
}

export type Variables = { usuario: UsuarioWeb };
export type App = Hono<{ Variables: Variables }>;
export type C = HonoContext<{ Variables: Variables }>;

export interface Deps {
  ctx: Contexto;
  avisar: NonNullable<OpcionesWeb["avisar"]>;
  cabecera: () => Promise<DatosCabecera>;
  red: RedSinc | null;
  servicios: ServiciosDispositivo | null;
}

export const COOKIE = "flota_sesion";
export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PUBLICO = process.env.CF_PUBLICO || join(RAIZ, "public");
export const THREE = process.env.CF_THREE || dirname(dirname(createRequire(import.meta.url).resolve("three")));

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

/**
 * ¿La petición viene de este mismo equipo? Por la conexión (loopback) y por el Host (así una web
 * de fuera que apunte su dominio a 127.0.0.1 no aprovecha la entrada directa).
 */
export function esDelMismoEquipo(c: C): boolean {
  const ip = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket?.remoteAddress ?? "";
  const local = ip === "::1" || ip.startsWith("127.") || ip.startsWith("::ffff:127.");
  const host = (c.req.header("host") ?? "").toLowerCase().replace(/:\d+$/, "");
  return local && ["127.0.0.1", "localhost", "[::1]"].includes(host);
}

/** Datos comunes del layout: se calculan en cada página (dos consultas baratas). */
export async function datosCabecera(ctx: Contexto): Promise<DatosCabecera> {
  const emp = await obtenerEmpresa(ctx);
  const bot = await estadoBot(ctx);
  return { empresa: (emp?.nombreComercial || emp?.razonSocial || "EMPRESA").toUpperCase(), botEnLinea: bot.enLinea, simulado: ctx.simulado };
}

/** Ruta actual sin los avisos (?ok= / ?error=). */
export function rutaActual(c: C): string {
  const u = new URL(c.req.url);
  u.searchParams.delete("ok");
  u.searchParams.delete("error");
  return u.pathname + u.search;
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

/** Destino seguro para volver después de guardar: solo rutas propias («/…», nunca «//…»). */
export function volverA(v: string | undefined, porDefecto: string): string {
  return v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : porDefecto;
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
  c: C, d: Deps,
  o: { titulo: string; seccion: Seccion; lugar?: Lugar; scripts?: string[]; importmap?: boolean; sinNavInferior?: boolean },
  cuerpo: Child,
) {
  const html = (
    <Layout
      titulo={o.titulo} lugar={o.lugar ?? LUGAR_DE_SECCION[o.seccion]} usuario={c.get("usuario")} cab={await d.cabecera()} ruta={rutaActual(c)}
      ok={c.req.query("ok")} error={c.req.query("error")} scripts={o.scripts} importmap={o.importmap} sinNavInferior={o.sinNavInferior}
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
