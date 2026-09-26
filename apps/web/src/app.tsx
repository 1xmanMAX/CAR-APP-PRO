/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import { getCookie, deleteCookie, setCookie } from "hono/cookie";
import { Hono } from "hono";
import {
  canjearEnlaceWeb, cerrarSesion, crearSesion, duenoParaEntradaDirecta, encolarAviso, entrarConClave, guardarUsuario, necesitaConfiguracionInicial,
  ErrorNegocio, obtenerEmpresa, primerUsuarioId, sembrarDatosIniciales, validarRuc, puedeEditar, puedeVer, usuarioDeSesion, type Contexto, type Seccion, type UsuarioWeb,
} from "@sunatapp/core";
import {
  COOKIE, datosCabecera, esDelMismoEquipo, formulario, mensajeError, PUBLICO, servirArchivo, THREE,
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
import { rutasEmpezar } from "./paginas/empezar";
import { rutasDispositivo } from "./paginas/dispositivo";

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
    servicios: opciones.servicios ?? null,
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

  /**
   * Entrada directa (en desarrollo): desde este mismo equipo se entra como dueño sin formulario.
   * Devuelve el usuario con la sesión ya fijada, o null si no aplica.
   */
  const entrarDirecto = async (c: C): Promise<UsuarioWeb | null> => {
    if (!opciones.entradaDirecta || !esDelMismoEquipo(c)) return null;
    const { usuario, creado } = await duenoParaEntradaDirecta(ctx);
    await fijarSesion(c, usuario.id);
    // Con un usuario ya puede arrancar el bot (si el dispositivo tiene token).
    if (creado) await deps.servicios?.alConfigurar().catch((e: unknown) => ctx.log?.("error", "no se pudo arrancar el bot tras la entrada directa", e));
    return usuario;
  };

  /** Campos de la configuración inicial de un dispositivo sin datos (lo que en la PC hacía `pnpm sembrar`). */
  const CamposEmpresa = (p: { f: Record<string, string> }) => {
    const v = (k: string) => p.f[k] ?? "";
    return (
      <>
        <span class="lbl">EMPRESA (sale en guías y facturas)</span>
        <label class="campo"><span>RUC</span><input name="ruc" required inputmode="numeric" maxlength={11} pattern="\d{11}" value={v("ruc")} /></label>
        <label class="campo"><span>Razón social</span><input name="razonSocial" required value={v("razonSocial")} /></label>
        <label class="campo"><span>Dirección fiscal</span><input name="direccion" required value={v("direccion")} /></label>
        <div class="linea">
          <label class="campo" style="flex:1"><span>Ubigeo (6 dígitos)</span><input name="ubigeo" required inputmode="numeric" maxlength={6} pattern="\d{6}" placeholder="150101" value={v("ubigeo")} /></label>
          <label class="campo" style="flex:1"><span>Registro MTC</span><input name="registroMtc" required value={v("registroMtc")} /></label>
        </div>
        <label class="campo"><span>Cuenta de detracciones (Banco de la Nación, opcional)</span><input name="cuentaDetraccion" value={v("cuentaDetraccion")} /></label>
        <span class="lbl">UNIDAD</span>
        <div class="linea">
          <label class="campo" style="flex:1"><span>Placa del tracto</span><input name="placa" required style="text-transform:uppercase" value={v("placa")} /></label>
          <label class="campo" style="flex:1"><span>Placa de la carreta (opcional)</span><input name="placaCarreta" style="text-transform:uppercase" value={v("placaCarreta")} /></label>
        </div>
        <span class="lbl">CHOFER</span>
        <div class="linea">
          <label class="campo" style="flex:1"><span>DNI</span><input name="dni" required inputmode="numeric" maxlength={8} pattern="\d{8}" value={v("dni")} /></label>
          <label class="campo" style="flex:1"><span>Licencia</span><input name="licencia" required value={v("licencia")} /></label>
        </div>
        <div class="linea">
          <label class="campo" style="flex:1"><span>Nombres</span><input name="nombresChofer" required value={v("nombresChofer")} /></label>
          <label class="campo" style="flex:1"><span>Apellidos</span><input name="apellidosChofer" required value={v("apellidosChofer")} /></label>
        </div>
        <span class="lbl">TU ACCESO (DUEÑO)</span>
      </>
    );
  };

  const vistaEntrar = (error?: string, configurar = false, pedirEmpresa = false, f: Record<string, string> = {}) => (
    <PaginaSimple titulo="Entrar">
      <div class="panel">
        {configurar ? (
          <>
            <h2 class="mono-t">Configuración inicial</h2>
            <p class="muted">{pedirEmpresa
              ? "Los datos de tu empresa, tu primera unidad y su chofer, y tu acceso de dueño. Después podrás agregar más unidades e invitar al contador y al encargado de taller."
              : "Crea el acceso del dueño. Después podrás invitar al contador y al encargado de taller desde Ajustes."}</p>
          </>
        ) : <h2 class="mono-t">Entrar</h2>}
        {error ? <div class="aviso error" role="alert">{error}</div> : null}
        {configurar ? (
          <a class="btn" href="/empezar" style="width:100%;text-align:center">¿YA USAS CONTROL FLOTA EN OTRO DISPOSITIVO? TRAER SUS DATOS</a>
        ) : null}
        <form method="post" action={configurar ? "/configurar" : "/entrar"} class="filas">
          {pedirEmpresa ? <CamposEmpresa f={f} /> : null}
          {configurar ? <label class="campo"><span>Tu nombre</span><input name="nombre" required autocomplete="name" value={f.nombre ?? ""} /></label> : null}
          <label class="campo"><span>Correo</span><input name="email" type="email" required autocomplete="username" value={f.email ?? ""} /></label>
          <label class="campo"><span>Contraseña{configurar ? " (mínimo 8)" : ""}</span><input name="clave" type="password" required minlength={configurar ? 8 : undefined} autocomplete={configurar ? "new-password" : "current-password"} /></label>
          <button class="btn primario" type="submit">{configurar ? (pedirEmpresa ? "GUARDAR Y EMPEZAR" : "CREAR ACCESO") : "ENTRAR"}</button>
        </form>
        {!configurar ? <p class="muted" style="font-size:12px">También puedes entrar con el enlace que te da el bot con <b>/web</b>.</p> : null}
      </div>
    </PaginaSimple>
  );

  app.get("/entrar", async (c) => {
    if (await entrarDirecto(c as C)) return c.redirect("/");
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
    if (await entrarDirecto(c as C)) return c.redirect("/");
    if (!(await necesitaConfiguracionInicial(ctx))) return c.redirect("/entrar");
    return c.html("<!doctype html>" + vistaEntrar(undefined, true, !(await obtenerEmpresa(ctx))).toString());
  });
  app.post("/configurar", async (c) => {
    if (!(await necesitaConfiguracionInicial(ctx))) return c.redirect("/entrar", 303);
    const f = await formulario(c as C);
    const pedirEmpresa = !(await obtenerEmpresa(ctx));
    try {
      if (pedirEmpresa) {
        const t = (k: string) => (f[k] ?? "").trim();
        if (!validarRuc(t("ruc"))) throw new ErrorNegocio("El RUC no es válido");
        if (!/^\d{6}$/.test(t("ubigeo"))) throw new ErrorNegocio("El ubigeo son 6 dígitos (por ejemplo 150101)");
        if (!/^\d{8}$/.test(t("dni"))) throw new ErrorNegocio("El DNI del chofer son 8 dígitos");
        if (!t("email")) throw new ErrorNegocio("Escribe tu correo");
        await sembrarDatosIniciales(ctx.db, {
          empresa: {
            ruc: t("ruc"), razonSocial: t("razonSocial"), direccion: t("direccion"), ubigeo: t("ubigeo"), registroMtc: t("registroMtc"),
            ...(t("cuentaDetraccion") ? { cuentaDetraccionBn: t("cuentaDetraccion") } : {}),
          },
          vehiculo: { placa: t("placa").toUpperCase() },
          ...(t("placaCarreta") ? { vehiculoSecundario: { placa: t("placaCarreta").toUpperCase() } } : {}),
          conductor: { numeroDoc: t("dni"), nombres: t("nombresChofer"), apellidos: t("apellidosChofer"), licencia: t("licencia") },
          usuario: { nombre: t("nombre") || "Dueño", email: t("email") },
        });
      }
      // El primer usuario (el sembrado, dueño del bot) recibe el correo y la contraseña; si no hay, se crea.
      const primero = await primerUsuarioId(ctx);
      const id = await guardarUsuario(ctx, { id: primero ?? undefined, nombre: f.nombre ?? "Dueño", email: f.email, rol: "dueno", clave: f.clave });
      await fijarSesion(c as C, id);
      // Con usuarios ya puede arrancar el bot (si el dispositivo tiene token).
      await deps.servicios?.alConfigurar().catch((e: unknown) => ctx.log?.("error", "no se pudo arrancar el bot tras configurar", e));
      return c.redirect("/", 303);
    } catch (error) {
      return c.html("<!doctype html>" + vistaEntrar(mensajeError(error), true, pedirEmpresa, f).toString(), 400);
    }
  });
  rutasEmpezar(app, deps);
  app.post("/salir", async (c) => {
    const token = getCookie(c, COOKIE);
    if (token) await cerrarSesion(ctx, token);
    deleteCookie(c, COOKIE, { path: "/" });
    return c.redirect("/entrar", 303);
  });

  // Sesión y permisos por rol.
  app.use("*", async (c, next) => {
    const u = (await usuarioDeSesion(ctx, getCookie(c, COOKIE))) ?? (await entrarDirecto(c as C));
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

  for (const m of [rutasDashboard, rutasTrailer, rutasFlota, rutasInventario, rutasReparaciones, rutasViajes, rutasFinanzas, rutasRentabilidad, rutasTelegram, rutasDispositivo, rutasAjustes, rutasSincronizar]) {
    m(app, deps);
  }
  return app;
}

