/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import { codigoDispositivo, codigoLegible, direccionesLocales, identidad, necesitaConfiguracionInicial, renombrarDispositivo, salirDelGrupo, unirseAGrupo } from "@sunatapp/core";
import { formulario, mensajeError, type App, type C, type Deps } from "../base";
import { PaginaSimple } from "../ui";

/**
 * **Primer uso en un dispositivo nuevo**: en vez de crear otro dueño, se une al grupo y se trae
 * todos los datos (con los usuarios y sus contraseñas) de un dispositivo que ya los tiene.
 * Solo está abierto mientras este dispositivo no tenga ningún usuario con contraseña.
 */
export function rutasEmpezar(app: App, d: Deps): void {
  const vista = async (c: C, error?: string, ok?: string) => {
    const i = await identidad(d.ctx);
    const ips = direccionesLocales();
    return c.html("<!doctype html>" + (
      <PaginaSimple titulo="Traer datos">
        <div class="panel">
          <h2 class="mono-t">Traer los datos de otro dispositivo</h2>
          <p class="muted" style="font-size:12px">Para usar la misma información que ya tienes en la PC u otro celular. Los dos deben estar en el <b>mismo Wi-Fi</b> (o uno conectado al punto de acceso del otro), con Control Flota abierto. No hace falta internet.</p>
          {error ? <div class="aviso error" role="alert">{error}</div> : null}
          {ok ? <div class="aviso ok" role="status">{ok}</div> : null}
          {!i.grupo ? (
            <form method="post" action="/empezar/unirse" class="filas">
              <span class="lbl">1 · EN EL OTRO DISPOSITIVO ABRE «SINCRONIZAR» Y COPIA EL CÓDIGO DEL GRUPO</span>
              <label class="campo"><span>Nombre de este dispositivo</span><input name="nombre" value={i.yo.nombre} maxlength={40} required /></label>
              <label class="campo"><span>Código del grupo</span><input name="codigo" required placeholder="K7Q2M-9XMPA" autocomplete="off" style="text-transform:uppercase" /></label>
              <button class="btn primario" type="submit">UNIRME AL GRUPO</button>
            </form>
          ) : (
            <div class="filas">
              <span class="lbl">2 · ELIGE EL DISPOSITIVO DEL QUE TRAER LOS DATOS</span>
              <span class="muted" style="font-size:11px">Grupo {codigoLegible(i.grupo)} · este dispositivo: <b>{i.yo.nombre}</b> ({codigoDispositivo(i.yo.id)}){ips[0] ? ` · ${ips[0].ip}` : ""}</span>
              <div id="emp-progreso" class="caja-oscura" hidden>
                <span class="lbl">TRAYENDO DATOS</span>
                <b id="emp-mensaje">…</b>
                <div class="barra" style="background:#243034"><i id="emp-barra" class="b-cambiar" style="width:0%"></i></div>
              </div>
              <div id="emp-resultado"></div>
              <div class="filas" id="emp-vecinos"><span class="muted" style="font-size:12px">Buscando dispositivos del grupo en la red…</span></div>
              <form method="post" action="/empezar/con" class="linea">
                <input name="destino" required placeholder="192.168.1.20" aria-label="Dirección del otro dispositivo" style="flex:1" />
                <button class="btn chico" type="submit">TRAER</button>
              </form>
              <span class="muted" style="font-size:11px">Si no aparece, escribe la dirección que muestra el otro dispositivo en Sincronizar → «Este dispositivo».</span>
              <form method="post" action="/empezar/otro"><button class="btn chico" type="submit">USAR OTRO CÓDIGO DE GRUPO</button></form>
            </div>
          )}
          <a class="lbl-12" href="/configurar" style="text-decoration:underline">← Es el primer dispositivo: crear el acceso del dueño</a>
        </div>
        <script src="/static/empezar.js" defer></script>
      </PaginaSimple>
    ).toString());
  };

  // Todo esto se cierra en cuanto hay un usuario con contraseña.
  app.use("/empezar/*", async (c, next) => {
    if (!(await necesitaConfiguracionInicial(d.ctx))) {
      if (c.req.path === "/empezar/estado") return c.json({ listo: true, vecinos: [], estado: d.red?.estado ?? null });
      return c.redirect("/entrar", 303);
    }
    await next();
  });
  app.get("/empezar", async (c) => {
    if (!(await necesitaConfiguracionInicial(d.ctx))) return c.redirect("/entrar");
    return vista(c as C);
  });
  app.get("/empezar/estado", (c) => c.json({ listo: false, vecinos: d.red?.cerca() ?? [], estado: d.red?.estado ?? null }));
  app.post("/empezar/unirse", async (c) => {
    const f = await formulario(c as C);
    try {
      if (f.nombre?.trim()) await renombrarDispositivo(d.ctx, f.nombre);
      await unirseAGrupo(d.ctx, f.codigo ?? "");
      return c.redirect("/empezar", 303);
    } catch (e) {
      return vista(c as C, mensajeError(e));
    }
  });
  app.post("/empezar/otro", async (c) => {
    await salirDelGrupo(d.ctx);
    return c.redirect("/empezar", 303);
  });
  app.post("/empezar/con", async (c) => {
    const f = await formulario(c as C);
    const destino = (f.destino ?? "").trim();
    if (!d.red) return vista(c as C, "La red de sincronización no está activa en este arranque");
    if (!/^[\w.-]+(:\d+)?$/.test(destino)) return vista(c as C, "Escribe una dirección como 192.168.1.20");
    d.red.sincronizar(destino).catch(() => {});
    return c.redirect("/empezar", 303);
  });
}
