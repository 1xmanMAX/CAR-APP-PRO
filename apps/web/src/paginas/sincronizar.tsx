/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import QRCode from "qrcode";
import { raw } from "hono/html";
import {
  codigoDispositivo, codigoLegible, crearGrupo, direccionesLocales, ErrorNegocio, historialSinc, identidad, nuevaIdentidad,
  renombrarDispositivo, salirDelGrupo, unirseAGrupo,
} from "@sunatapp/core";
import { accion, formulario, pagina, type App, type C, type Deps } from "../base";
import { Datos, Panel, Vacio } from "../ui";

function hora(v: string | Date | null): string {
  if (!v) return "—";
  return new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(v));
}

async function vista(c: C, d: Deps) {
  const i = await identidad(d.ctx);
  const miCodigo = codigoDispositivo(i.yo.id);
  const red = d.red;
  const ips = direccionesLocales();
  const puerto = red?.puerto ?? 0;
  const qr = i.grupo ? await QRCode.toString(`controlflota:grupo:${i.grupo}`, { type: "svg", margin: 1, color: { dark: "#121719", light: "#FAF7F0" } }) : "";
  const historial = await historialSinc(d.ctx, 12);
  const otros = i.miembros.filter((m) => m.id !== i.yo.id);

  return pagina(c, d, { titulo: "Sincronizar", seccion: "sincronizar", scripts: ["/static/sincronizar.js"] }, (
    <>
      <Datos id="datos-sinc" valor={{ enGrupo: !!i.grupo }} />
      <section class="panel oscuro" style="gap:6px">
        <b class="mono-t" style="font-size:16px;color:var(--accent-on-dark)">SINCRONIZAR SIN SERVIDOR · POR TU WI-FI</b>
        <span style="font-size:12px">Cada dispositivo guarda su propia copia completa y funciona sin internet. Al sincronizar solo viajan <b>los cambios</b>, cifrados con el código del grupo.
          Cada registro lleva <b>tres códigos</b> que no cambian nunca —su código único, el dispositivo donde nació con su número (<code>47·{miCodigo}</code>) y su hora de creación—, así cada cambio llega siempre al registro correcto.
          Si dos dispositivos cambiaron lo mismo, se juntan campo por campo; si tocaron el mismo campo, gana el cambio más reciente.</span>
      </section>

      <div class="grid g-lado">
        <div class="filas" style="gap:10px;min-width:0">
          <Panel titulo="DISPOSITIVOS CERCA · MISMO GRUPO Y MISMO WI-FI" der={<span class="vivo" id="sinc-vivo">● BUSCANDO</span>}>
            {!red ? <div class="aviso info">La sincronización se activa al arrancar la app con <code>pnpm app</code>, <code>INICIAR.bat</code> o la app de Android.</div> : null}
            {!i.grupo ? <Vacio>Primero crea un grupo o únete con el código de otro dispositivo (a la derecha).</Vacio> : (
              <>
                <div id="sinc-progreso" class="caja-oscura" hidden>
                  <span class="lbl">SINCRONIZANDO</span>
                  <b id="sinc-mensaje" style="font-size:16px">…</b>
                  <div class="barra" style="background:#243034"><i id="sinc-barra" class="b-cambiar" style="width:0%"></i></div>
                </div>
                <div id="sinc-resultado"></div>
                <div class="filas" id="sinc-vecinos"><span class="muted" style="font-size:12px">Buscando dispositivos del grupo en la red… Abre Control Flota en el otro dispositivo.</span></div>
                {otros.length ? (
                  <>
                    <span class="lbl">DISPOSITIVOS DEL GRUPO QUE YA CONOCE ESTE</span>
                    <div class="filas">
                      {otros.map((m) => (
                        <form method="post" action="/sincronizar/con" class="fila-flota" style="grid-template-columns:minmax(0,1fr) auto">
                          <div><b>{m.nombre}</b> <span class="chip neutro">{codigoDispositivo(m.id)}</span><div class="muted" style="font-size:11px">{m.direccion ? `última dirección ${m.direccion}` : "sin dirección guardada"}{m.visto ? ` · visto ${hora(new Date(m.visto))}` : ""}</div></div>
                          {m.direccion ? <><input type="hidden" name="destino" value={m.direccion} /><button class="btn chico" type="submit">SINCRONIZAR</button></> : <span></span>}
                        </form>
                      ))}
                    </div>
                  </>
                ) : null}
                <details class="plegable">
                  <summary><span class="lbl-12" style="text-decoration:underline;cursor:pointer">¿No aparece? Escribe su dirección</span></summary>
                  <form method="post" action="/sincronizar/con" class="linea" style="margin-top:8px">
                    <input name="destino" required placeholder="192.168.1.20" aria-label="Dirección del otro dispositivo" style="flex:1" />
                    <button class="btn primario chico" type="submit">SINCRONIZAR</button>
                  </form>
                  <span class="muted" style="font-size:11px">La dirección de cada dispositivo aparece en su pantalla Sincronizar («Este dispositivo»). Si hay firewall en la PC, permite Node.js en redes privadas (puertos 47474 y 47475).</span>
                </details>
              </>
            )}
          </Panel>

          <Panel titulo="HISTORIAL">
            {historial.length === 0 ? <Vacio>Todavía no se sincronizó con nadie.</Vacio> : (
              <div class="tabla-wrap"><table class="t">
                <thead><tr><th>Cuándo</th><th>Con</th><th>Quién pidió</th><th>Resultado</th></tr></thead>
                <tbody>{historial.map((h) => {
                  const r = (typeof h.resultado === "string" ? JSON.parse(h.resultado) : h.resultado) as { traidas?: number; mandadas?: number; fusionadas?: number; borradas?: number; archivos?: number; avisos?: string[] } | null;
                  return (
                    <tr>
                      <td class="nowrap">{hora(h.inicio)}</td>
                      <td><b>{h.par_nombre}</b></td>
                      <td>{h.dirigi ? "este" : "el otro"}</td>
                      <td>{h.error ? <span class="t-cambiar">✗ {h.error}</span> : r && r.traidas !== undefined ? `↓${r.traidas} ↑${r.mandadas} ⇄${r.fusionadas} ✕${r.borradas}${r.archivos ? ` · ${r.archivos} archivos` : ""}${r.avisos?.length ? ` · ⚠ ${r.avisos.length}` : ""}` : "✓"}</td>
                    </tr>
                  );
                })}</tbody>
              </table></div>
            )}
            <span class="muted" style="font-size:11px">↓ recibidos · ↑ enviados · ⇄ juntados (cambiados en los dos) · ✕ borrados</span>
          </Panel>
        </div>

        <div class="filas" style="gap:10px">
          <Panel titulo="ESTE DISPOSITIVO">
            <form method="post" action="/sincronizar/nombre" class="linea">
              <label class="campo" style="flex:1"><span>Nombre (lo ven los demás)</span><input name="nombre" value={i.yo.nombre} maxlength={40} required /></label>
              <button class="btn chico" type="submit">GUARDAR</button>
            </form>
            <div style="font-size:12px"><span class="lbl">CÓDIGO</span> <b class="mono-t" style="font-size:18px">{miCodigo}</b></div>
            <div style="font-size:12px"><span class="lbl">DIRECCIÓN EN LA RED</span><br />
              {ips.length ? ips.map((x) => <div><b>{x.ip}</b>{puerto && puerto !== 47474 ? `:${puerto}` : ""} <span class="muted">({x.nombre})</span></div>) : <span class="muted">sin red local</span>}
            </div>
          </Panel>

          <Panel titulo="GRUPO">
            {i.grupo ? (
              <>
                <span class="lbl">CÓDIGO DEL GRUPO · TECLÉALO EN LOS DEMÁS DISPOSITIVOS</span>
                <b class="mono-t" style="font-size:24px;letter-spacing:.08em">{codigoLegible(i.grupo)}</b>
                <div style="max-width:180px">{raw(qr)}</div>
                <span class="muted" style="font-size:11px">Quien tenga este código puede sincronizar con tus dispositivos: compártelo solo con tu equipo.</span>
                <form method="post" action="/sincronizar/salir" data-confirmar="¿Salir del grupo? Los datos se quedan en este dispositivo, pero deja de sincronizar.">
                  <button class="btn chico" type="submit">SALIR DEL GRUPO</button>
                </form>
              </>
            ) : (
              <>
                <form method="post" action="/sincronizar/crear">
                  <button class="btn primario" type="submit" style="width:100%">CREAR UN GRUPO</button>
                </form>
                <span class="muted" style="font-size:11px">Hazlo en el primer dispositivo (por ejemplo la PC). Te dará un código de 10 signos.</span>
                <hr style="border:0;border-top:1px solid var(--divider);width:100%" />
                <form method="post" action="/sincronizar/unirse" class="filas">
                  <label class="campo"><span>Unirme con un código</span><input name="codigo" required placeholder="K7Q2M-9XMPA" autocomplete="off" style="text-transform:uppercase" /></label>
                  <button class="btn" type="submit">UNIRME</button>
                </form>
              </>
            )}
          </Panel>

          <Panel titulo="AVANZADO">
            <form method="post" action="/sincronizar/identidad" data-confirmar="Solo si copiaste la carpeta de datos desde otro dispositivo. ¿Crear una identidad nueva para este?">
              <button class="btn chico" type="submit">NUEVA IDENTIDAD</button>
            </form>
            <span class="muted" style="font-size:11px">Úsalo si copiaste la carpeta de datos de otro dispositivo: los dos tendrían el mismo código y no podrían sincronizar.</span>
          </Panel>
        </div>
      </div>
    </>
  ));
}

export function rutasSincronizar(app: App, d: Deps): void {
  app.get("/sincronizar", (c) => vista(c, d));
  app.get("/api/sincro", async (c) => {
    const red = d.red;
    return c.json({ vecinos: red?.cerca() ?? [], estado: red?.estado ?? null });
  });
  app.post("/sincronizar/nombre", async (c) => {
    const f = await formulario(c);
    return accion(c, "/sincronizar", async () => {
      await renombrarDispositivo(d.ctx, f.nombre ?? "");
      return "Nombre guardado";
    });
  });
  app.post("/sincronizar/crear", async (c) => accion(c, "/sincronizar", async () => {
    const codigo = await crearGrupo(d.ctx);
    return `Grupo creado. Código: ${codigoLegible(codigo)}`;
  }));
  app.post("/sincronizar/unirse", async (c) => {
    const f = await formulario(c);
    return accion(c, "/sincronizar", async () => {
      try {
        await unirseAGrupo(d.ctx, f.codigo ?? "");
      } catch (e) {
        throw new ErrorNegocio((e as Error).message);
      }
      return "Te uniste al grupo. Abre Sincronizar en otro dispositivo del grupo y sincroniza.";
    });
  });
  app.post("/sincronizar/salir", async (c) => accion(c, "/sincronizar", async () => {
    await salirDelGrupo(d.ctx);
    return "Saliste del grupo";
  }));
  app.post("/sincronizar/identidad", async (c) => accion(c, "/sincronizar", async () => {
    await nuevaIdentidad(d.ctx);
    return "Este dispositivo tiene una identidad nueva";
  }));
  app.post("/sincronizar/con", async (c) => {
    const f = await formulario(c);
    return accion(c, "/sincronizar", async () => {
      if (!d.red) throw new ErrorNegocio("La red de sincronización no está activa en este arranque");
      const destino = (f.destino ?? "").trim();
      if (!/^[\w.-]+(:\d+)?$/.test(destino)) throw new ErrorNegocio("Escribe una dirección como 192.168.1.20");
      // En segundo plano: la pantalla sigue el avance.
      d.red.sincronizar(destino).catch(() => {});
      return "Sincronizando…";
    });
  });
}
