/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import type { Child } from "hono/jsx";
import {
  crearCategoria, crearCostoFijo, desactivarCategoria, editarCostoFijo, ErrorNegocio, guardarEmpresa, guardarTipoParte, guardarUsuario, listarCategorias,
  listarCostosFijos, listarTiposParte, listarUnidades, listarUsuarios, nombreCategoria, NOMBRE_ROL, parsearMonto, puedeVer, ZONAS, type RolUsuario, type ZonaModelo,
} from "@sunatapp/core";
import { accion, empresaActual, formulario, pagina, type App, type C, type Deps } from "../base";
import { enteroONull } from "./flota";
import { Cabecera, miles, Panel, soles2 } from "../ui";

const ROLES = Object.keys(NOMBRE_ROL) as RolUsuario[];

async function cargar(c: C, d: Deps) {
  const ctx = d.ctx;
  const [usuarios, tipos, emp, categorias, fijos, unidades] = await Promise.all([
    listarUsuarios(ctx), listarTiposParte(ctx, true), empresaActual(ctx), listarCategorias(ctx), listarCostosFijos(ctx, false), listarUnidades(ctx),
  ]);
  return { usuarios, tipos, emp, categorias, fijos, unidades, yo: c.get("usuario"), d };
}
type DatosAjustes = Awaited<ReturnType<typeof cargar>>;

function PanelUsuarios(x: DatosAjustes): Child {
  const { usuarios, yo } = x;
  return (
    <Panel>
      <div class="tabla-wrap"><table class="t t-tarjetas">
        <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Telegram</th><th>Web</th><th>Editar</th></tr></thead>
        <tbody>{usuarios.map((u) => (
          <tr>
            <td><b>{u.nombre}</b>{!u.activo ? <span class="chip neutro" style="margin-left:4px">INACTIVO</span> : null}</td>
            <td data-etq="Correo">{u.email ?? "—"}</td><td data-etq="Rol">{NOMBRE_ROL[u.rol]}</td>
            <td data-etq="Telegram">{u.telegramId ? <span class="chip tg">{u.telegramNombre ?? u.telegramId}</span> : "—"}</td>
            <td data-etq="Entra a la web">{u.tieneClave ? "✓" : "—"}</td>
            <td class="t-acciones">
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
      <span class="muted" style="font-size:12px">Dueño: ve y edita todo. Contador: viajes, facturas, finanzas y rentabilidad. Taller: trailer 3D, flota, inventario y reparaciones. Chofer: solo Telegram.</span>
    </Panel>
  );
}
function PanelEmpresa(x: DatosAjustes): Child {
  const { emp, d } = x;
  return (
    <Panel id="empresa">
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
        <span class="muted" style="font-size:12px">Series: guía {emp.serieGre} · factura {emp.serieFactura} · SUNAT {d.ctx.simulado ? "simulado / beta (sin validez tributaria)" : "real"}</span>
      ) : null}
      <span class="muted" style="font-size:12px">La placa, la configuración vehicular y la carga útil de cada camión van en <a href="/camiones">Camiones</a> › Datos. Las claves SOL y el certificado, en <a href="/ajustes/dispositivo">Este dispositivo y SUNAT</a>.</span>
    </Panel>
  );
}
function PanelCostosFijos(x: DatosAjustes): Child {
  const { fijos, categorias, unidades } = x;
  return (
    <Panel>
      {fijos.length ? (
        <div class="tabla-wrap"><table class="t t-tarjetas">
          <thead><tr><th>Concepto</th><th>Categoría</th><th>Unidad</th><th class="num">Monto</th><th>Cada</th><th>Desde</th><th></th></tr></thead>
          <tbody>{fijos.map((f) => (
            <tr>
              <td><b>{f.concepto}</b>{!f.activo ? <span class="chip neutro" style="margin-left:4px">INACTIVO</span> : null}</td>
              <td data-etq="Categoría">{nombreCategoria(f.categoria, categorias)}</td><td data-etq="Unidad">{f.unidad ?? "General"}</td><td class="num" data-etq="Monto">{soles2(f.monto)}</td>
              <td data-etq="Cada">{f.periodicidad === "anual" ? "año (1/12 por mes)" : "mes"}</td><td data-etq="Desde">{f.desde}</td>
              <td class="t-acciones"><details class="plegable"><summary><span class="btn chico">EDITAR</span></summary>
                <form method="post" action={`/ajustes/costo-fijo/${f.id}`} class="filas" style="margin-top:6px;min-width:200px">
                  <label class="campo"><span>Monto S/</span><input name="monto" inputmode="decimal" value={(f.monto / 100).toFixed(2)} /></label>
                  <label class="campo" style="flex-direction:row;gap:6px;align-items:center"><input type="checkbox" name="activo" value="1" checked={f.activo} style="width:auto;min-height:0" /><span style="text-transform:none">Activo</span></label>
                  <button class="btn primario chico" type="submit">GUARDAR</button>
                </form>
              </details></td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : <span class="muted" style="font-size:12px">Todavía no hay costos fijos: agrega sueldos, SOAT, seguro, GPS, contador…</span>}
      <form method="post" action="/ajustes/costo-fijo" class="form-grid" style="margin-top:8px">
        <label class="campo"><span>Concepto *</span><input name="concepto" required placeholder="Sueldo chofer T-01" /></label>
        <label class="campo"><span>Categoría</span><select name="categoria">{categorias.filter((k) => k.tipo === "fijo" && k.activa).map((k) => <option value={k.clave}>{k.nombre}</option>)}</select></label>
        <label class="campo"><span>Monto S/ *</span><input name="monto" inputmode="decimal" required /></label>
        <label class="campo"><span>Cada</span><select name="periodicidad"><option value="mensual">mes</option><option value="anual">año</option></select></label>
        <label class="campo"><span>Unidad</span><select name="vehiculoId"><option value="">General</option>{unidades.map((u) => <option value={u.id}>{u.codigo}</option>)}</select></label>
        <label class="campo"><span>Desde</span><input type="date" name="desde" /></label>
        <button class="btn primario" type="submit">AGREGAR FIJO</button>
      </form>
    </Panel>
  );
}
function PanelCategorias(x: DatosAjustes): Child {
  const { categorias } = x;
  return (
    <Panel>
      <div class="tabla-wrap"><table class="t">
        <thead><tr><th>Nombre</th><th>Tipo</th><th></th></tr></thead>
        <tbody>{categorias.map((k) => (
          <tr>
            <td>{k.nombre}{k.sistema ? <span class="chip neutro" style="margin-left:4px">DE FÁBRICA</span> : null}{!k.activa ? <span class="chip neutro" style="margin-left:4px">INACTIVA</span> : null}</td>
            <td>{k.tipo === "fijo" ? "Fijo" : "Variable"}</td>
            <td>{k.activa ? <form method="post" action={`/ajustes/categoria/${k.clave}/desactivar`}><button class="btn chico fantasma" type="submit">DESACTIVAR</button></form> : null}</td>
          </tr>
        ))}</tbody>
      </table></div>
      <form method="post" action="/ajustes/categoria" class="linea" style="gap:6px;margin-top:8px;flex-wrap:wrap">
        <input name="nombre" required placeholder="Nueva categoría" style="flex:2;min-width:160px" />
        <select name="tipo" style="flex:1;min-width:140px"><option value="variable">Variable (del viaje)</option><option value="fijo">Fijo (del mes)</option></select>
        <button class="btn primario chico" type="submit">CREAR</button>
      </form>
    </Panel>
  );
}
/** Una parte del catálogo: en la PC una fila (con títulos arriba); en el celular una tarjeta con la etiqueta sobre cada casilla. */
function FilaParte(p: { t?: DatosAjustes["tipos"][number] }) {
  const t = p.t;
  const zonas = Object.keys(ZONAS) as ZonaModelo[];
  return (
    <form method="post" action={t ? `/ajustes/parte/${t.id}` : "/ajustes/parte"} class={`fila-parte${t ? "" : " nueva"}`}>
      <label class="campo c-nombre"><span>Parte</span><input name="nombre" value={t?.nombre ?? ""} required={!t} placeholder={t ? undefined : "Nombre de la parte"} /></label>
      <label class="campo c-zona"><span>Zona del modelo 3D</span><select name="zona">{zonas.map((z) => <option value={z} selected={z === t?.zona}>{ZONAS[z]}</option>)}</select></label>
      <label class="campo"><span>Km</span><input name="vidaKm" value={t?.vidaKm ?? ""} inputmode="numeric" /></label>
      <label class="campo"><span>Viajes</span><input name="vidaViajes" value={t?.vidaViajes ?? ""} inputmode="numeric" /></label>
      <label class="campo"><span>Días</span><input name="vidaDias" value={t?.vidaDias ?? ""} inputmode="numeric" /></label>
      <button class={`btn chico${t ? "" : " primario"}`} type="submit">{t ? "GUARDAR" : "AGREGAR"}</button>
    </form>
  );
}
function PanelPartes(x: DatosAjustes): Child {
  const { tipos } = x;
  return (
    <Panel>
      <div class="lista-partes">
        <div class="fila-parte cab" aria-hidden="true"><span>Parte</span><span>Zona del modelo 3D</span><span>Km</span><span>Viajes</span><span>Días</span><span></span></div>
        {tipos.map((t) => <FilaParte t={t} />)}
      </div>
      <details class="plegable"><summary><span class="btn chico fantasma">+ NUEVA PARTE</span></summary>
        <div style="margin-top:8px"><FilaParte /></div>
      </details>
      <span class="muted" style="font-size:12px">Ejemplo actual: frenos del semirremolque {miles(tipos.find((t) => t.codigo === "frenos_sr")?.vidaKm)} km. Los valores iniciales son de ejemplo: ajústalos a tu experiencia. Cada parte instalada puede tener su propia vida útil (desde Trailer 3D).</span>
    </Panel>
  );
}

const SUBPAGINAS: Record<string, { titulo: string; panel: (x: DatosAjustes) => Child; angosto?: boolean; sub?: string }> = {
  empresa: { titulo: "Empresa", panel: PanelEmpresa, angosto: true, sub: "Se pide al emitir guías y facturas" },
  usuarios: { titulo: "Usuarios", panel: PanelUsuarios },
  "costos-fijos": { titulo: "Costos fijos", panel: PanelCostosFijos, sub: "Se cargan solos cada mes. El anual se reparte 1/12 por mes; las cuotas de préstamo entran solas." },
  categorias: { titulo: "Categorías de gasto", panel: PanelCategorias, angosto: true, sub: "Variable = del viaje · Fijo = del mes" },
  partes: { titulo: "Catálogo de partes", panel: PanelPartes, sub: "Vida útil por defecto. Manda el contador que se cumpla primero; vacío = no aplica." },
};
type Sub = "empresa" | "usuarios" | "costos-fijos" | "categorias" | "partes";

async function subpagina(c: C, d: Deps, sub: Sub) {
  const s = SUBPAGINAS[sub]!;
  return pagina(c, d, { titulo: s.titulo, seccion: "ajustes" }, (
    <>
      <Cabecera titulo={s.titulo} volver="/ajustes" sub={s.sub} />
      {s.angosto ? <div class="ajustes-angosto">{s.panel(await cargar(c, d))}</div> : s.panel(await cargar(c, d))}
    </>
  ));
}

const BOT: Record<string, string> = { sin_token: "apagado", conectando: "conectando", en_linea: "en línea", error: "no conecta", esperando_datos: "esperando datos" };

async function hub(c: C, d: Deps) {
  const u = c.get("usuario");
  const [emp, cab] = await Promise.all([empresaActual(d.ctx), d.cabecera()]);
  const e = d.servicios?.estado();
  const dueno = puedeVer(u.rol, "ajustes");
  const tarjetas = [
    { href: "/ajustes/empresa", titulo: "Empresa", sub: emp?.razonSocial ?? "Falta completar: se pide al emitir guías y facturas", ve: dueno },
    { href: "/ajustes/usuarios", titulo: "Usuarios", sub: "Quién entra y qué puede hacer", ve: dueno },
    { href: "/ajustes/costos-fijos", titulo: "Costos fijos", sub: "Sueldos, SOAT, cuotas: se cargan solos cada mes", ve: dueno },
    { href: "/ajustes/categorias", titulo: "Categorías", sub: "En qué se gasta: del viaje o del mes", ve: dueno },
    { href: "/rutas", titulo: "Rutas y presupuestos", sub: "Cuánto debería costar cada ruta y su valor referencial MTC", ve: puedeVer(u.rol, "viajes") },
    { href: "/ajustes/partes", titulo: "Catálogo de partes", sub: "Vida útil de llantas, frenos, aceite…", ve: dueno },
    { href: "/telegram", titulo: "Telegram", sub: cab.botEnLinea ? "El bot está en línea" : "El bot está desconectado", ve: puedeVer(u.rol, "telegram") },
    { href: "/sincronizar", titulo: "Sincronizar", sub: "Otros celulares y PCs con los mismos datos", ve: puedeVer(u.rol, "sincronizar") },
    { href: "/ajustes/dispositivo", titulo: "Este dispositivo y SUNAT", sub: e ? `Bot: ${BOT[e.bot.estado]} · SUNAT: ${e.sunat.modo}${e.sunat.error ? " (con aviso)" : ""}` : "Token del bot, modo SUNAT, clave SOL y certificado", ve: dueno },
  ].filter((t) => t.ve);
  return pagina(c, d, { titulo: "Ajustes", seccion: "ajustes" }, (
    <>
      <Cabecera titulo="Ajustes" volver="/" />
      <div class="hub">
        {tarjetas.map((t) => <a class="tarjeta-hub" href={t.href}><b>{t.titulo}</b><span class="muted">{t.sub}</span><span class="flecha" aria-hidden="true">›</span></a>)}
      </div>
      <section class="panel solo-movil">
        <div class="fila-sep">
          <span>Entraste como <b>{u.nombre}</b> · {NOMBRE_ROL[u.rol]}</span>
          <div class="acciones">
            <button type="button" class="btn chico primario" data-instalar="" hidden>Instalar app</button>
            <form method="post" action="/salir"><button class="btn" type="submit">Salir</button></form>
          </div>
        </div>
      </section>
    </>
  ));
}

export function rutasAjustes(app: App, d: Deps): void {
  app.get("/ajustes", (c) => hub(c as C, d));
  app.get("/ajustes/:sub{empresa|usuarios|costos-fijos|categorias|partes}", (c) => subpagina(c as C, d, c.req.param("sub") as Sub));
  const guardar = async (c: C, id?: number) => {
    const f = await formulario(c);
    return accion(c, "/ajustes/usuarios", async () => {
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
    return accion(c, "/ajustes/empresa", async () => {
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
    return accion(c, "/ajustes/partes", async () => {
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
  app.post("/ajustes/categoria", async (c) => {
    const f = await formulario(c);
    return accion(c, "/ajustes/categorias", async () => {
      await crearCategoria(d.ctx, { nombre: f.nombre ?? "", tipo: f.tipo === "fijo" ? "fijo" : "variable", usuarioId: c.get("usuario").id });
      return "Categoría creada";
    });
  });
  app.post("/ajustes/categoria/:clave/desactivar", async (c) => accion(c, "/ajustes/categorias", async () => {
    await desactivarCategoria(d.ctx, c.req.param("clave"), c.get("usuario").id);
    return "Categoría desactivada";
  }));
  app.post("/ajustes/costo-fijo", async (c) => {
    const f = await formulario(c);
    return accion(c, "/ajustes/costos-fijos", async () => {
      const monto = parsearMonto(f.monto ?? "");
      if (monto === null) throw new ErrorNegocio("Monto no válido");
      await crearCostoFijo(d.ctx, {
        concepto: f.concepto ?? "", categoria: f.categoria ?? "", monto, periodicidad: f.periodicidad === "anual" ? "anual" : "mensual",
        vehiculoId: f.vehiculoId ? Number(f.vehiculoId) : null, desde: f.desde || undefined, usuarioId: c.get("usuario").id,
      });
      return "Costo fijo agregado: se carga solo cada mes";
    });
  });
  app.post("/ajustes/costo-fijo/:id", async (c) => {
    const f = await formulario(c);
    return accion(c, "/ajustes/costos-fijos", async () => {
      const monto = f.monto ? parsearMonto(f.monto) : undefined;
      if (monto === null) throw new ErrorNegocio("Monto no válido");
      await editarCostoFijo(d.ctx, Number(c.req.param("id")), { ...(monto !== undefined ? { monto } : {}), activo: f.activo === "1" }, c.get("usuario").id);
      return "Costo fijo guardado";
    });
  });
}
