/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import { getCookie, deleteCookie, setCookie } from "hono/cookie";
import { Hono } from "hono";
import {
  canjearEnlaceWeb, cerrarSesion, crearSesion, encolarAviso, entrarConClave, guardarUsuario, necesitaConfiguracionInicial,
  primerUsuarioId, puedeEditar, puedeVer, usuarioDeSesion, type Contexto, type Seccion,
} from "@sunatapp/core";
import {
  COOKIE, datosCabecera, formulario, mensajeError, PUBLICO, servirArchivo, THREE,
  type App, type C, type Deps, type OpcionesWeb, type Variables,
} from "./base";
import { PaginaSimple } from "./ui";
import { rutasDashboard } from "./paginas/dashboard";
import { rutasTrailer } from "./paginas/trailer";
import { rutasFlota } from "./paginas/flota";
import { rutasInventario } from "./paginas/inventario";
import { rutasReparaciones } from "./paginas/reparaciones";
import { rutasViajes } from "./paginas/viajes";
import { rutasFinanzas } from "./paginas/finanzas";
import { rutasRentabilidad } from "./paginas/rentabilidad";
import { rutasTelegram } from "./paginas/telegram";
import { rutasAjustes } from "./paginas/ajustes";
import { rutasSincronizar } from "./paginas/sincronizar";

export type { OpcionesWeb } from "./base";

/** Qué sección protege cada ruta, para aplicar los permisos por rol. */
function seccionDeRuta(ruta: string): Seccion | null {
  const primero = ruta.split("/")[1] ?? "";
  const mapa: Record<string, Seccion> = {
    "": "dashboard", trailer: "trailer", parte: "trailer", flota: "flota", inventario: "inventario", reparaciones: "reparaciones",
    viajes: "viajes", guias: "viajes", facturas: "viajes", cobros: "viajes", finanzas: "finanzas", rentabilidad: "rentabilidad",
    cotizacion: "rentabilidad", telegram: "telegram", ajustes: "ajustes", sincronizar: "sincronizar", archivo: "dashboard", api: "dashboard",
  };
  return mapa[primero] ?? null;
}

export function crearWeb(ctx: Contexto, opciones: OpcionesWeb = {}): App {
  const app: App = new Hono<{ Variables: Variables }>();
  const deps: Deps = {
    ctx,
    avisar: opciones.avisar ?? (async (texto) => encolarAviso(ctx, texto)),
    cabecera: () => datosCabecera(ctx),
    red: opciones.red ?? null,
  };
  const origenPermitido = opciones.urlPublica ? new URL(opciones.urlPublica).origin : null;

  app.onError((error, c) => {
    console.error(error);
    return c.html(
      "<!doctype html>" + (<PaginaSimple titulo="Error"><div class="panel"><h2>Algo salió mal</h2><p>{mensajeError(error)}</p><a class="btn" href="/">VOLVER AL INICIO</a></div></PaginaSimple>).toString(),
      500,
    );
  });

  app.get("/static/*", (c) => servirArchivo(c as C, PUBLICO, c.req.path.slice("/static/".length)));
  app.get("/vendor/three/*", (c) => servirArchivo(c as C, THREE, c.req.path.slice("/vendor/three/".length), "public, max-age=86400"));
  app.get("/salud", (c) => c.json({ ok: true }));
  // PWA: el manifiesto y el service worker van en la raíz (el alcance del SW es su carpeta).
  app.get("/manifest.webmanifest", async (c) => {
    const r = await servirArchivo(c as C, PUBLICO, "manifest.webmanifest", "public, max-age=3600");
    r.headers.set("Content-Type", "application/manifest+json");
    return r;
  });
  app.get("/sw.js", async (c) => {
    const r = await servirArchivo(c as C, PUBLICO, "sw.js", "no-cache");
    r.headers.set("Service-Worker-Allowed", "/");
    return r;
  });
  app.get("/sin-conexion", (c) =>
    c.html("<!doctype html>" + (
      <PaginaSimple titulo="Sin conexión">
        <div class="panel">
          <h2 class="mono-t">Sin conexión</h2>
          <p class="muted">No se pudo llegar al servidor de Control Flota. Revisa tu internet (o que la PC con la app esté encendida) y vuelve a intentar.</p>
          <a class="btn primario" href="/">REINTENTAR</a>
        </div>
      </PaginaSimple>
    ).toString()),
  );

  // Protección CSRF: todo POST debe venir de la misma web.
  app.use("*", async (c, next) => {
    if (c.req.method === "POST") {
      const origen = c.req.header("origin");
      const esperado = origenPermitido ?? new URL(c.req.url).origin;
      if (origen && origen !== esperado && origen !== new URL(c.req.url).origin) return c.text("Origen no permitido", 403);
      if (!origen) {
        const ref = c.req.header("referer");
        if (ref && new URL(ref).origin !== esperado && new URL(ref).origin !== new URL(c.req.url).origin) return c.text("Origen no permitido", 403);
      }
    }
    await next();
  });

  const fijarSesion = async (c: C, usuarioId: number) => {
    const { token, expira } = await crearSesion(ctx, usuarioId);
    setCookie(c, COOKIE, token, { httpOnly: true, sameSite: "Lax", secure: opciones.cookieSegura ?? false, path: "/", expires: expira });
  };

  const vistaEntrar = (error?: string, configurar = false) => (
    <PaginaSimple titulo="Entrar">
      <div class="panel">
        {configurar ? (
          <>
            <h2 class="mono-t">Configuración inicial</h2>
            <p class="muted">Crea el acceso del dueño. Después podrás invitar al contador y al encargado de taller desde Ajustes.</p>
          </>
        ) : <h2 class="mono-t">Entrar</h2>}
        {error ? <div class="aviso error" role="alert">{error}</div> : null}
        <form method="post" action={configurar ? "/configurar" : "/entrar"} class="filas">
          {configurar ? <label class="campo"><span>Tu nombre</span><input name="nombre" required autocomplete="name" /></label> : null}
          <label class="campo"><span>Correo</span><input name="email" type="email" required autocomplete="username" /></label>
          <label class="campo"><span>Contraseña{configurar ? " (mínimo 8)" : ""}</span><input name="clave" type="password" required minlength={configurar ? 8 : undefined} autocomplete={configurar ? "new-password" : "current-password"} /></label>
          <button class="btn primario" type="submit">{configurar ? "CREAR ACCESO" : "ENTRAR"}</button>
        </form>
        {!configurar ? <p class="muted" style="font-size:12px">También puedes entrar con el enlace que te da el bot con <b>/web</b>.</p> : null}
      </div>
    </PaginaSimple>
  );

  app.get("/entrar", async (c) => {
    if (await necesitaConfiguracionInicial(ctx)) return c.redirect("/configurar");
    return c.html("<!doctype html>" + vistaEntrar(c.req.query("error")).toString());
  });
  app.post("/entrar", async (c) => {
    const f = await formulario(c as C);
    try {
      const u = await entrarConClave(ctx, f.email ?? "", f.clave ?? "");
      await fijarSesion(c as C, u.id);
      return c.redirect("/", 303);
    } catch (error) {
      return c.html("<!doctype html>" + vistaEntrar(mensajeError(error)).toString(), 401);
    }
  });
  app.get("/entrar/enlace", async (c) => {
    try {
      const usuarioId = await canjearEnlaceWeb(ctx, c.req.query("t") ?? "");
      await fijarSesion(c as C, usuarioId);
      return c.redirect("/", 303);
    } catch (error) {
      return c.html("<!doctype html>" + vistaEntrar(mensajeError(error)).toString(), 401);
    }
  });
  app.get("/configurar", async (c) => {
    if (!(await necesitaConfiguracionInicial(ctx))) return c.redirect("/entrar");
    return c.html("<!doctype html>" + vistaEntrar(undefined, true).toString());
  });
  app.post("/configurar", async (c) => {
    if (!(await necesitaConfiguracionInicial(ctx))) return c.redirect("/entrar", 303);
    const f = await formulario(c as C);
    try {
      // El primer usuario (el sembrado, dueño del bot) recibe el correo y la contraseña; si no hay, se crea.
      const primero = await primerUsuarioId(ctx);
      const id = await guardarUsuario(ctx, { id: primero ?? undefined, nombre: f.nombre ?? "Dueño", email: f.email, rol: "dueno", clave: f.clave });
      await fijarSesion(c as C, id);
      return c.redirect("/", 303);
    } catch (error) {
      return c.html("<!doctype html>" + vistaEntrar(mensajeError(error), true).toString(), 400);
    }
  });
  app.post("/salir", async (c) => {
    const token = getCookie(c, COOKIE);
    if (token) await cerrarSesion(ctx, token);
    deleteCookie(c, COOKIE, { path: "/" });
    return c.redirect("/entrar", 303);
  });

  // Sesión y permisos por rol.
  app.use("*", async (c, next) => {
    const u = await usuarioDeSesion(ctx, getCookie(c, COOKIE));
    if (!u) {
      if (c.req.path.startsWith("/api/")) return c.json({ error: "sin sesión" }, 401);
      return c.redirect((await necesitaConfiguracionInicial(ctx)) ? "/configurar" : "/entrar");
    }
    const seccion = seccionDeRuta(c.req.path);
    if (seccion) {
      const ok = c.req.method === "GET" ? puedeVer(u.rol, seccion) || seccion === "dashboard" : puedeEditar(u.rol, seccion);
      if (!ok) {
        if (c.req.method === "GET") return c.redirect("/?error=" + encodeURIComponent("Tu rol no tiene acceso a esa sección"));
        return c.text("Tu rol no puede modificar esta sección", 403);
      }
    }
    c.set("usuario", u);
    await next();
  });

  for (const m of [rutasDashboard, rutasTrailer, rutasFlota, rutasInventario, rutasReparaciones, rutasViajes, rutasFinanzas, rutasRentabilidad, rutasTelegram, rutasAjustes, rutasSincronizar]) {
    m(app, deps);
  }
  return app;
}

