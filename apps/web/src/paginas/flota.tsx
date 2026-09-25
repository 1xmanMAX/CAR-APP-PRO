/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import {
  actualizarUnidad, crearUnidad, ErrorNegocio, hoy, instalarParte, listarTiposParte, puedeEditar, rangoMes,
  registrarLecturaOdometro, resumenFinanciero, saludFlota, type EstadoUnidad,
} from "@sunatapp/core";
import { accion, formulario, pagina, type App, type C, type Deps } from "../base";
import { CHIP_UNIDAD, ESTADO_UNIDAD, miles, Panel, pct } from "../ui";

export const enteroONull = (v: string | undefined): number | null => {
  if (v === undefined || v.trim() === "") return null;
  const n = Number(v.replace(/[,\s]/g, ""));
  if (!Number.isFinite(n)) throw new ErrorNegocio(`"${v}" no es un número válido`);
  return Math.round(n);
};

async function vista(c: C, d: Deps) {
  const ctx = d.ctx;
  const salud = await saludFlota(ctx);
  const { desde, hasta } = rangoMes(hoy(ctx));
  const margenes = new Map<number, number | null>();
  for (const s of salud) margenes.set(s.unidad.id, (await resumenFinanciero(ctx, desde, hasta, s.unidad.id)).margenPct);
  const edita = puedeEditar(c.get("usuario").rol, "flota");

  return pagina(c, d, { titulo: "Flota", seccion: "flota" }, (
    <>
      <Panel titulo={`FLOTA · ${salud.length} ${salud.length === 1 ? "UNIDAD" : "UNIDADES"}`} der={edita ? <a class="btn primario chico" href="#nueva">+ AGREGAR UNIDAD</a> : null}>
        <div class="tarjetas">
          {salud.map((s) => {
            const u = s.unidad;
            return (
              <article class="tarjeta">
                <div style="display:flex;align-items:start;gap:8px">
                  <div>
                    <div class="id">{u.codigo}</div>
                    <div class="muted" style="font-size:11px">PLACA {u.placa}{u.carreta ? ` + ${u.carreta.placa}` : ""} · {[u.marca, u.modelo, u.anio].filter(Boolean).join(" ") || "—"}</div>
                  </div>
                  <span class={`chip ${CHIP_UNIDAD[u.estado]}`} style="margin-left:auto">{ESTADO_UNIDAD[u.estado]}</span>
                </div>
                <div class="tira">{s.partes.length ? s.partes.map((p) => <i class={`b-${p.estado}`} title={`${p.nombreCorto} ${p.pct}%`}></i>) : <span class="muted" style="font-size:11px">sin partes controladas</span>}</div>
                <div class="stats">
                  <div><span class="lbl">KM TOTAL</span><br /><b>{miles(u.odometroKm)}</b></div>
                  <div><span class="lbl">VIAJES</span><br /><b>{miles(u.viajesTotales)}</b></div>
                  <div><span class="lbl">MARGEN MES</span><br /><b class="t-cambiar">{pct(margenes.get(u.id))}</b></div>
                </div>
                <div style="font-size:12px" class={s.peor ? `t-${s.peor.estado}` : "muted"}>
                  PRÓXIMO CAMBIO · {s.peor ? `${s.peor.nombreCorto} · ${s.peor.restanteTexto}` : "—"}
                </div>
                <div class="acciones">
                  <a class="btn primario chico" href={`/trailer/${u.id}`}>ABRIR MODELO 3D</a>
                  <a class="btn chico" href={`/viajes?unidad=${u.id}`}>VIAJES</a>
                </div>
                {edita ? (
                  <details class="plegable">
                    <summary><span class="lbl-12" style="text-decoration:underline;cursor:pointer">Editar · odómetro · estado</span></summary>
                    <form method="post" action={`/flota/${u.id}/odometro`} class="linea" style="margin-top:8px">
                      <label class="campo" style="flex:1"><span>Lectura de odómetro (km)</span><input name="km" inputmode="numeric" required placeholder={String(u.odometroKm)} /></label>
                      <button class="btn chico" type="submit">REGISTRAR KM</button>
                    </form>
                    <form method="post" action={`/flota/${u.id}`} class="form-grid" style="margin-top:8px">
                      <label class="campo"><span>Estado</span>
                        <select name="estado">{(["en_base", "en_ruta", "en_taller", "inactivo"] as EstadoUnidad[]).map((e) => <option value={e} selected={e === u.estado}>{ESTADO_UNIDAD[e]}</option>)}</select>
                      </label>
                      <label class="campo"><span>Marca</span><input name="marca" value={u.marca ?? ""} /></label>
                      <label class="campo"><span>Modelo</span><input name="modelo" value={u.modelo ?? ""} /></label>
                      <label class="campo"><span>Año</span><input name="anio" inputmode="numeric" value={u.anio ?? ""} /></label>
                      <label class="campo"><span>Placa carreta</span><input name="placaCarreta" value={u.carreta?.placa ?? ""} /></label>
                      <label class="campo"><span>Rendimiento km/gal</span><input name="rendimiento" inputmode="decimal" value={u.rendimientoKmGal ?? ""} /></label>
                      <button class="btn chico" type="submit">GUARDAR</button>
                    </form>
                  </details>
                ) : null}
              </article>
            );
          })}
          {edita ? (
            <article class="tarjeta nueva" id="nueva">
              <b class="lbl-12">+ AGREGAR UNIDAD</b>
              <form method="post" action="/flota" class="form-grid" style="width:100%">
                <label class="campo"><span>Placa tracto *</span><input name="placa" required placeholder="ABC-123" /></label>
                <label class="campo"><span>Placa carreta</span><input name="placaCarreta" placeholder="XYZ-987" /></label>
                <label class="campo"><span>Marca</span><input name="marca" placeholder="Volvo" /></label>
                <label class="campo"><span>Modelo</span><input name="modelo" placeholder="FH 540" /></label>
                <label class="campo"><span>Año</span><input name="anio" inputmode="numeric" /></label>
                <label class="campo"><span>Odómetro actual (km)</span><input name="odometro" inputmode="numeric" placeholder="0" /></label>
                <label class="campo"><span>Viajes ya hechos</span><input name="viajesBase" inputmode="numeric" placeholder="0" /></label>
                <label class="campo" style="grid-column:1/-1;flex-direction:row;align-items:center;gap:8px"><input type="checkbox" name="catalogo" value="1" checked style="width:auto;min-height:0" /><span style="text-transform:none;letter-spacing:0;font-size:12px">Controlar todas las partes del catálogo desde hoy</span></label>
                <button class="btn primario" type="submit">AGREGAR</button>
              </form>
            </article>
          ) : null}
        </div>
      </Panel>
    </>
  ));
}

export function rutasFlota(app: App, d: Deps): void {
  app.get("/flota", (c) => vista(c, d));
  app.post("/flota", async (c) => {
    const f = await formulario(c);
    return accion(c, "/flota", async () => {
      const u = await crearUnidad(d.ctx, {
        placa: f.placa ?? "", marca: f.marca || null, modelo: f.modelo || null, anio: enteroONull(f.anio),
        odometroKm: enteroONull(f.odometro) ?? 0, viajesBase: enteroONull(f.viajesBase) ?? 0, placaCarreta: f.placaCarreta || null,
      }, c.get("usuario").id);
      if (f.catalogo) {
        for (const t of await listarTiposParte(d.ctx)) await instalarParte(d.ctx, { vehiculoId: u.id, tipoParteId: t.id }, d.ctx.db, c.get("usuario").id);
      }
      return { ok: `Unidad ${u.codigo} agregada`, ruta: `/trailer/${u.id}` };
    });
  });
  app.post("/flota/:id", async (c) => {
    const f = await formulario(c);
    return accion(c, "/flota", async () => {
      const rend = f.rendimiento ? Number(f.rendimiento.replace(",", ".")) : null;
      if (rend !== null && !(rend > 0)) throw new ErrorNegocio("Rendimiento no válido");
      await actualizarUnidad(d.ctx, Number(c.req.param("id")), {
        estado: f.estado as EstadoUnidad, marca: f.marca || null, modelo: f.modelo || null, anio: enteroONull(f.anio),
        placaCarreta: f.placaCarreta || null, rendimientoKmGal: rend,
      }, c.get("usuario").id);
      return "Unidad actualizada";
    });
  });
  app.post("/flota/:id/odometro", async (c) => {
    const f = await formulario(c);
    return accion(c, "/flota", async () => {
      const km = enteroONull(f.km);
      if (km === null) throw new ErrorNegocio("Indica la lectura del odómetro");
      const r = await registrarLecturaOdometro(d.ctx, { vehiculoId: Number(c.req.param("id")), km, origen: "web", usuarioId: c.get("usuario").id });
      return `Odómetro actualizado: +${r.sumados.toLocaleString("en-US")} km a todas las partes`;
    });
  });
}
