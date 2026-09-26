/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import {
  ErrorNegocio, guardarEmpresa, guardarTipoParte, guardarUsuario, listarTiposParte, listarUsuarios, NOMBRE_ROL, ZONAS, type RolUsuario, type ZonaModelo,
} from "@sunatapp/core";
import { accion, empresaActual, formulario, pagina, type App, type C, type Deps } from "../base";
import { enteroONull } from "./flota";
import { miles, Panel } from "../ui";

const ROLES = Object.keys(NOMBRE_ROL) as RolUsuario[];

async function vista(c: C, d: Deps) {
  const ctx = d.ctx;
  const [usuarios, tipos, emp] = await Promise.all([listarUsuarios(ctx), listarTiposParte(ctx, true), empresaActual(ctx)]);
  const yo = c.get("usuario");
  const e = d.servicios?.estado();
  return pagina(c, d, { titulo: "Ajustes", seccion: "ajustes" }, (
    <>
      <a href="/ajustes/dispositivo" class="panel" style="flex-direction:row;align-items:center;justify-content:space-between;gap:10px;text-decoration:none;color:inherit">
        <span><b class="mono-t">ESTE DISPOSITIVO · BOT DE TELEGRAM Y SUNAT</b><br />
          <span class="muted" style="font-size:12px">{e
            ? `Bot: ${{ sin_token: "apagado", conectando: "conectando", en_linea: "en línea", error: "no conecta", esperando_datos: "esperando datos" }[e.bot.estado]} · SUNAT: ${e.sunat.modo}${e.sunat.error ? " (con aviso)" : ""}`
            : "Token del bot, modo SUNAT, clave SOL y certificado"}</span></span>
        <span class="btn chico">ABRIR</span>
      </a>
      <div class="grid g-lado">
        <Panel titulo="USUARIOS Y ROLES">
          <div class="tabla-wrap"><table class="t">
            <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Telegram</th><th>Web</th><th>Editar</th></tr></thead>
            <tbody>{usuarios.map((u) => (
              <tr>
                <td><b>{u.nombre}</b>{!u.activo ? <span class="chip neutro" style="margin-left:4px">INACTIVO</span> : null}</td>
                <td>{u.email ?? "—"}</td><td>{NOMBRE_ROL[u.rol]}</td>
                <td>{u.telegramId ? <span class="chip tg">{u.telegramNombre ?? u.telegramId}</span> : "—"}</td>
                <td>{u.tieneClave ? "✓" : "—"}</td>
                <td>
                  <details class="plegable"><summary><span class="btn chico">EDITAR</span></summary>
                    <form method="post" action={`/ajustes/usuario/${u.id}`} class="filas" style="margin-top:6px;min-width:240px">
                      <label class="campo"><span>Nombre</span><input name="nombre" value={u.nombre} required /></label>
                      <label class="campo"><span>Correo</span><input name="email" type="email" value={u.email ?? ""} /></label>
                      <label class="campo"><span>Rol</span><select name="rol" disabled={u.id === yo.id}>{ROLES.map((r) => <option value={r} selected={r === u.rol}>{NOMBRE_ROL[r]}</option>)}</select></label>
                      {u.id === yo.id ? <input type="hidden" name="rol" value={u.rol} /> : null}
                      <label class="campo"><span>ID de Telegram</span><input name="telegramId" inputmode="numeric" value={u.telegramId ?? ""} /></label>
                      <label class="campo"><span>Nueva contraseña</span><input name="clave" type="password" minlength={8} autocomplete="new-password" /></label>
                      {u.id !== yo.id ? <label class="campo" style="flex-direction:row;gap:6px;align-items:center"><input type="checkbox" name="activo" value="1" checked={u.activo} style="width:auto;min-height:0" /><span style="text-transform:none">Activo</span></label> : <input type="hidden" name="activo" value="1" />}
                      <button class="btn primario chico" type="submit">GUARDAR</button>
                    </form>
                  </details>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
          <details class="plegable"><summary><span class="btn chico fantasma">+ AGREGAR USUARIO</span></summary>
            <form method="post" action="/ajustes/usuario" class="form-grid" style="margin-top:8px">
              <label class="campo"><span>Nombre *</span><input name="nombre" required /></label>
              <label class="campo"><span>Rol</span><select name="rol">{ROLES.map((r) => <option value={r}>{NOMBRE_ROL[r]}</option>)}</select></label>
              <label class="campo"><span>Correo (para la web)</span><input name="email" type="email" /></label>
              <label class="campo"><span>Contraseña (mín. 8)</span><input name="clave" type="password" minlength={8} autocomplete="new-password" /></label>
              <label class="campo"><span>ID de Telegram</span><input name="telegramId" inputmode="numeric" placeholder="el bot lo dice con /start" /></label>
              <button class="btn primario" type="submit">AGREGAR</button>
            </form>
          </details>
          <span class="muted" style="font-size:11px">Dueño: ve y edita todo. Contador: viajes, facturas, finanzas y rentabilidad. Taller: trailer 3D, flota, inventario y reparaciones. Chofer: solo Telegram.</span>
        </Panel>
        <Panel titulo="EMPRESA" id="empresa" der={emp ? null : <span class="lbl">SE PIDE AL EMITIR GUÍAS Y FACTURAS</span>}>
          {emp ? null : <span class="muted" style="font-size:12px">Todavía no hace falta: complétalo cuando vayas a emitir tu primera guía o factura. Queda guardado aquí.</span>}
          <form method="post" action="/ajustes/empresa" class="filas">
            <label class="campo"><span>RUC</span><input name="ruc" required inputmode="numeric" maxlength={11} pattern="\d{11}" value={emp?.ruc ?? ""} /></label>
            <label class="campo"><span>Razón social</span><input name="razonSocial" required value={emp?.razonSocial ?? ""} /></label>
            <label class="campo"><span>Nombre comercial (opcional)</span><input name="nombreComercial" value={emp?.nombreComercial ?? ""} /></label>
            <label class="campo"><span>Dirección fiscal</span><input name="direccion" required value={emp?.direccion ?? ""} /></label>
            <div class="linea">
              <label class="campo" style="flex:1"><span>Ubigeo (6 dígitos)</span><input name="ubigeo" required inputmode="numeric" maxlength={6} pattern="\d{6}" placeholder="150101" value={emp?.ubigeo ?? ""} /></label>
              <label class="campo" style="flex:1"><span>Registro MTC</span><input name="registroMtc" required value={emp?.registroMtc ?? ""} /></label>
            </div>
            <label class="campo"><span>Cuenta de detracciones (Banco de la Nación, opcional)</span><input name="cuentaDetraccion" value={emp?.cuentaDetraccionBn ?? ""} /></label>
            <button class="btn primario chico" type="submit">{emp ? "GUARDAR CAMBIOS" : "GUARDAR EMPRESA"}</button>
          </form>
          {emp ? (
            <span class="muted" style="font-size:11px">Series: guía {emp.serieGre} · factura {emp.serieFactura} · SUNAT {d.ctx.simulado ? "simulado / beta (sin validez tributaria)" : "real"}</span>
          ) : null}
        </Panel>
      </div>
      <Panel titulo="CATÁLOGO DE PARTES · VIDA ÚTIL POR DEFECTO" der={<span class="lbl">MANDA EL CONTADOR QUE SE CUMPLA PRIMERO · VACÍO = NO APLICA</span>}>
        <div class="tabla-wrap"><table class="t">
          <thead><tr><th>Parte</th><th>Zona del modelo 3D</th><th class="num">Km</th><th class="num">Viajes</th><th class="num">Días</th><th></th></tr></thead>
          <tbody>{tipos.map((t) => (
            <tr>
              <td colspan={6} style="padding:4px 8px">
                <form method="post" action={`/ajustes/parte/${t.id}`} class="linea" style="align-items:center">
                  <input name="nombre" value={t.nombre} aria-label="Nombre" style="flex:3;min-width:180px" />
                  <select name="zona" aria-label="Zona" style="flex:2;min-width:150px">{(Object.keys(ZONAS) as ZonaModelo[]).map((z) => <option value={z} selected={z === t.zona}>{ZONAS[z]}</option>)}</select>
                  <input name="vidaKm" value={t.vidaKm ?? ""} inputmode="numeric" aria-label="Vida en km" placeholder="km" style="flex:1;min-width:90px" />
                  <input name="vidaViajes" value={t.vidaViajes ?? ""} inputmode="numeric" aria-label="Vida en viajes" placeholder="viajes" style="flex:1;min-width:70px" />
                  <input name="vidaDias" value={t.vidaDias ?? ""} inputmode="numeric" aria-label="Vida en días" placeholder="días" style="flex:1;min-width:70px" />
                  <button class="btn chico" type="submit">GUARDAR</button>
                </form>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
        <details class="plegable"><summary><span class="btn chico fantasma">+ NUEVA PARTE</span></summary>
          <form method="post" action="/ajustes/parte" class="linea" style="margin-top:8px">
            <input name="nombre" required placeholder="Nombre de la parte" aria-label="Nombre" style="flex:3" />
            <select name="zona" aria-label="Zona" style="flex:2">{(Object.keys(ZONAS) as ZonaModelo[]).map((z) => <option value={z}>{ZONAS[z]}</option>)}</select>
            <input name="vidaKm" inputmode="numeric" placeholder="km" aria-label="Vida en km" style="flex:1" />
            <input name="vidaViajes" inputmode="numeric" placeholder="viajes" aria-label="Vida en viajes" style="flex:1" />
            <input name="vidaDias" inputmode="numeric" placeholder="días" aria-label="Vida en días" style="flex:1" />
            <button class="btn primario chico" type="submit">AGREGAR</button>
          </form>
        </details>
        <span class="muted" style="font-size:11px">Ejemplo actual: frenos del semirremolque {miles(tipos.find((t) => t.codigo === "frenos_sr")?.vidaKm)} km. Los valores iniciales son de ejemplo: ajústalos a tu experiencia. Cada parte instalada puede tener su propia vida útil (desde Trailer 3D).</span>
      </Panel>
    </>
  ));
}

export function rutasAjustes(app: App, d: Deps): void {
  app.get("/ajustes", (c) => vista(c, d));
  const guardar = async (c: C, id?: number) => {
    const f = await formulario(c);
    return accion(c, "/ajustes", async () => {
      const rol = f.rol as RolUsuario;
      if (!ROLES.includes(rol)) throw new ErrorNegocio("Rol no válido");
      await guardarUsuario(d.ctx, {
        id, nombre: f.nombre ?? "", email: f.email || null, rol, clave: f.clave || null,
        telegramId: f.telegramId ? enteroONull(f.telegramId) : null, activo: id === undefined ? true : f.activo === "1",
      }, c.get("usuario").id);
      return id === undefined ? "Usuario agregado" : "Usuario actualizado";
    });
  };
  app.post("/ajustes/empresa", async (c) => {
    const f = await formulario(c);
    return accion(c, "/ajustes", async () => {
      const { creada } = await guardarEmpresa(d.ctx, {
        ruc: f.ruc ?? "", razonSocial: f.razonSocial ?? "", nombreComercial: f.nombreComercial, direccion: f.direccion ?? "",
        ubigeo: f.ubigeo ?? "", registroMtc: f.registroMtc ?? "", cuentaDetraccionBn: f.cuentaDetraccion,
      }, c.get("usuario").id);
      // Con la empresa ya cargada, SUNAT (y su certificado de prueba) toman el RUC de verdad.
      if (creada) await d.servicios?.alConfigurar().catch((e: unknown) => d.ctx.log?.("error", "no se pudo reconfigurar tras guardar la empresa", e));
      return creada ? "Empresa guardada" : "Datos de la empresa actualizados";
    });
  });
  app.post("/ajustes/usuario", (c) => guardar(c));
  app.post("/ajustes/usuario/:id", (c) => guardar(c, Number(c.req.param("id"))));
  const guardarParte = async (c: C, id?: number) => {
    const f = await formulario(c);
    return accion(c, "/ajustes", async () => {
      const zona = f.zona as ZonaModelo;
      if (!(zona in ZONAS)) throw new ErrorNegocio("Zona no válida");
      await guardarTipoParte(d.ctx, {
        id, nombre: f.nombre ?? "", nombreCorto: id === undefined ? (f.nombre ?? "").split("·")[0]!.trim() : undefined, zona,
        vidaKm: enteroONull(f.vidaKm), vidaViajes: enteroONull(f.vidaViajes), vidaDias: enteroONull(f.vidaDias),
      }, c.get("usuario").id);
      return "Catálogo actualizado";
    });
  };
  app.post("/ajustes/parte", (c) => guardarParte(c));
  app.post("/ajustes/parte/:id", (c) => guardarParte(c, Number(c.req.param("id"))));
}
