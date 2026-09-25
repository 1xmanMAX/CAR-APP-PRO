/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import {
  ajustarVidaParte, ErrorNegocio, estadoPorZona, instalarParte, listarTiposParte, listarUnidades, listarViajesFlota, partesDeUnidad,
  puedeEditar, viajesDesde, ZONAS, type ParteConDesgaste,
} from "@sunatapp/core";
import { accion, formulario, pagina, type App, type C, type Deps } from "../base";
import { Barra, ChipEstado, Datos, ETIQUETA_ESTADO, fechaMedia, miles, Panel, soles2, Vacio } from "../ui";

const entero = (v: string | undefined): number | null => {
  if (v === undefined || v.trim() === "") return null;
  const n = Number(v.replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : NaN;
};

function Contador(p: { etiqueta: string; uso: number; vida: number | null; unidad: string; manda: boolean }) {
  if (p.vida === null) return null;
  const r = Math.round((p.uso / p.vida) * 100);
  const estado = r >= 90 ? "cambiar" : r >= 70 ? "proximo" : "ok";
  return (
    <div class={`contador${p.manda ? " manda" : ""}`}>
      <div style="display:flex;justify-content:space-between;gap:6px">
        <span class="lbl">{p.etiqueta}{p.manda ? <b class="t-cambiar"> · MANDA</b> : null}</span>
        <span style="font-size:12px"><b>{miles(p.uso)}</b> / {miles(p.vida)} {p.unidad}</span>
      </div>
      <Barra pct={r} estado={estado} />
    </div>
  );
}

async function vista(c: C, d: Deps) {
  const ctx = d.ctx;
  const unidades = await listarUnidades(ctx);
  if (unidades.length === 0) {
    return pagina(c, d, { titulo: "Trailer 3D", seccion: "trailer" }, <Panel titulo="TRAILER 3D"><Vacio>No hay unidades. <a href="/flota">Agrega una en Flota</a>.</Vacio></Panel>);
  }
  const idParam = Number(c.req.param("id"));
  const unidad = unidades.find((u) => u.id === idParam) ?? unidades[0]!;
  const partes = await partesDeUnidad(ctx, unidad.id);
  const parteId = Number(c.req.query("parte"));
  const sel: ParteConDesgaste | undefined = partes.find((p) => p.id === parteId) ?? partes[0];
  const zonas = estadoPorZona(partes);
  const puedeEditarTaller = puedeEditar(c.get("usuario").rol, "reparaciones");
  const viajes = await listarViajesFlota(ctx, { vehiculoId: unidad.id, limite: 24 });
  const kmViajes = viajes.filter((v) => v.km).reverse();
  const maxKm = Math.max(1, ...kmViajes.map((v) => v.km!));
  const conKm = viajes.filter((v) => v.km);
  const kmPorViaje = conKm.length ? Math.round(conKm.reduce((s, v) => s + v.km!, 0) / conKm.length) : null;
  const desdeCambio = sel ? (await viajesDesde(ctx, unidad.id, sel.fechaInstalacion, 50)).slice(0, Math.max(0, sel.uso.viajes)) : [];
  const conteo = { ok: partes.filter((p) => p.estado === "ok").length, proximo: partes.filter((p) => p.estado === "proximo").length, cambiar: partes.filter((p) => p.estado === "cambiar").length };
  const tipos = await listarTiposParte(ctx);
  const faltantes = tipos.filter((t) => !partes.some((p) => p.tipoParteId === t.id));

  const datosVisor = {
    zonaSeleccionada: sel?.zona ?? null,
    autogiro: false,
    zonas: Object.fromEntries(Object.entries(zonas).map(([z, v]) => {
      const peor = partes.find((p) => p.zona === z)!;
      return [z, { ...v, nombre: ZONAS[z as keyof typeof ZONAS], url: `/trailer/${unidad.id}?parte=${peor.id}` }];
    })),
  };

  return pagina(c, d, { titulo: `Trailer 3D · ${unidad.codigo}`, seccion: "trailer", scripts: ["/static/trailer3d.js"], importmap: true }, (
    <>
      <Datos id="datos-visor" valor={datosVisor} />
      <section class="panel" style="flex-direction:row;align-items:center;flex-wrap:wrap">
        <span class="lbl-12">UNIDAD · ELIGE EL TRAILER</span>
        <div class="acciones">
          {unidades.map((u) => <a class={`btn chico${u.id === unidad.id ? " primario" : ""}`} href={`/trailer/${u.id}`} aria-current={u.id === unidad.id ? "page" : undefined}>{u.codigo}</a>)}
        </div>
        <span class="muted" style="margin-left:auto;font-size:12px">{unidad.placa}{unidad.carreta ? ` + ${unidad.carreta.placa}` : ""} · {[unidad.marca, unidad.modelo].filter(Boolean).join(" ") || "—"}</span>
      </section>

      <div class="grid g-trailer">
        <Panel titulo="PARTES · ORDEN POR DESGASTE">
          {partes.length === 0 ? <Vacio>Esta unidad no tiene partes controladas todavía.</Vacio> : (
            <div class="filas">
              {partes.map((p) => (
                <a class={`fila-parte${p.id === sel?.id ? " sel" : ""}`} href={`/trailer/${unidad.id}?parte=${p.id}`} aria-current={p.id === sel?.id ? "true" : undefined}>
                  <span style="font-size:12px">{p.nombre}</span>
                  <b class={`t-${p.estado} mono-t`}>{p.pct}%</b>
                  <Barra pct={p.pct} estado={p.estado} />
                  <span class="rest">{p.viajesRestantes === null ? `Cambiar en ~${p.restanteTexto.toLowerCase()}` : `≈ ${p.restanteTexto.toLowerCase()} restantes`}</span>
                </a>
              ))}
            </div>
          )}
          {puedeEditarTaller && faltantes.length > 0 ? (
            <details class="plegable">
              <summary><span class="btn chico fantasma">+ CONTROLAR OTRA PARTE</span></summary>
              <form method="post" action={`/trailer/${unidad.id}/instalar`} class="filas" style="margin-top:8px">
                <label class="campo"><span>Parte</span>
                  <select name="tipoParteId">{faltantes.map((t) => <option value={t.id}>{t.nombre}</option>)}<option value="todas">— Todas las que faltan —</option></select>
                </label>
                <label class="campo"><span>Instalada el</span><input type="date" name="fecha" /></label>
                <label class="campo"><span>Odómetro al instalar (km)</span><input name="km" inputmode="numeric" placeholder={String(unidad.odometroKm)} /></label>
                <label class="campo"><span>Viajes hechos desde entonces</span><input name="viajesDesde" inputmode="numeric" placeholder="0" /></label>
                <button class="btn primario" type="submit">GUARDAR</button>
                <span class="muted" style="font-size:11px">Si no sabes la fecha exacta, déjala vacía: se cuenta desde hoy.</span>
              </form>
            </details>
          ) : null}
        </Panel>

        <div class="filas" style="gap:10px;min-width:0">
          <div class="visor" id="visor">
            <canvas aria-label={`Modelo 3D de ${unidad.codigo}: cada punto es parte del trailer y su color es el desgaste. Arrastra para girar, rueda para acercar, clic en una zona para verla.`} role="img"></canvas>
            <div class="cab">
              <span class="lbl-12" style="color:var(--dark-text)"><b>{unidad.codigo} · MODELO DE PUNTOS · EN VIVO</b><br /><span style="color:var(--dark-muted)">CADA PUNTO ES PARTE DEL TRAILER · EL COLOR ES SU DESGASTE</span></span>
              <div class="der">
                <button class="btn chico" id="btn-izq" type="button" aria-label="Girar a la izquierda">&lt;</button>
                <button class="btn chico" id="btn-der" type="button" aria-label="Girar a la derecha">&gt;</button>
                <button class="btn chico" id="btn-girar" type="button" aria-pressed="false">GIRAR</button>
                <span class="lbl" style="color:var(--dark-muted)">ÁNGULO <span id="angulo">0</span>°</span>
              </div>
            </div>
            {sel ? (
              <div class="etiqueta" hidden>
                <span class="lbl" style="color:var(--dark-muted)">PARTE SELECCIONADA</span><br />
                {sel.nombreCorto} · DESGASTE <b>{sel.pct}%</b>
              </div>
            ) : null}
            <div class="pie"><span><i class="d-ok"></i>OK</span><span><i class="d-proximo"></i>PRÓXIMO (70%+)</span><span><i class="d-cambiar"></i>CAMBIAR (90%+)</span><span><i style="background:#E9E3D6;opacity:.5"></i>SIN CONTROL</span></div>
            <div class="sin-webgl" hidden>Tu navegador no puede mostrar el modelo 3D (WebGL desactivado). La lista de partes funciona igual.</div>
          </div>
          <div class="datos-visor">
            <div><span class="lbl">KM TOTAL</span><b>{miles(unidad.odometroKm)}</b></div>
            <div><span class="lbl">VIAJES</span><b>{miles(unidad.viajesTotales)}</b></div>
            <div><span class="lbl">KM/VIAJE</span><b>{miles(kmPorViaje)}</b></div>
            <div><span class="lbl">OK</span><b class="t-ok">{conteo.ok}</b></div>
            <div><span class="lbl">PRÓXIMAS</span><b class="t-proximo">{conteo.proximo}</b></div>
            <div><span class="lbl">CAMBIAR YA</span><b class="t-cambiar">{conteo.cambiar}</b></div>
          </div>
          <Panel titulo="KM POR VIAJE · NO TODOS LOS VIAJES DESGASTAN IGUAL" der={<span class="lbl">ÚLTIMOS {kmViajes.length} VIAJES</span>}>
            {kmViajes.length === 0 ? <Vacio>Aún no hay viajes con km registrados.</Vacio> : (
              <>
                <div class="barras-v" role="img" aria-label="Km de cada viaje, del más antiguo al más reciente">
                  {kmViajes.map((v) => {
                    const r = v.km! / maxKm;
                    return <i title={`${v.fecha} · ${v.ruta} · ${miles(v.km)} km`} style={`height:${Math.max(6, r * 100)}%;background:${r > 0.82 ? "var(--accent)" : r > 0.59 ? "var(--amber-bar)" : "var(--ok)"}`}></i>;
                  })}
                </div>
                <div class="leyenda" style="justify-content:space-between"><span>MÁS ANTIGUO</span><span>RUTAS LARGAS / SUBIDAS = MÁS DESGASTE POR VIAJE</span><span>HOY</span></div>
              </>
            )}
          </Panel>
        </div>

        <div class="filas" style="gap:10px;min-width:0">
          {sel ? (
            <Panel titulo={sel.nombre} der={<ChipEstado estado={sel.estado} />}>
              <span class="muted" style="font-size:11px">INSTALADO {fechaMedia(sel.fechaInstalacion)} · REPUESTO {sel.repuesto?.codigo ?? "—"} · COSTO {sel.costo ? soles2(sel.costo) : "—"}</span>
              <Contador etiqueta="KILÓMETROS" uso={sel.uso.km} vida={sel.vida.km} unidad="km" manda={sel.manda === "km"} />
              <Contador etiqueta="VIAJES" uso={sel.uso.viajes} vida={sel.vida.viajes} unidad="viajes" manda={sel.manda === "viajes"} />
              <Contador etiqueta="DÍAS" uso={sel.uso.dias} vida={sel.vida.dias} unidad="días" manda={sel.manda === "dias"} />
              <div class="caja-oscura">
                <span class="lbl">CAMBIAR ANTES DE</span>
                <b>{sel.restanteTexto}</b>
                <span class="muted" style="font-size:11px">Manda el contador que se cumpla primero · desgaste {sel.pct}% · {ETIQUETA_ESTADO[sel.estado]}</span>
              </div>
              <div class="acciones">
                {puedeEditarTaller ? <a class="btn primario" href={`/reparaciones?unidad=${unidad.id}&parte=${sel.id}#registrar`}>REGISTRAR CAMBIO</a> : null}
                <a class="btn" href={`/inventario?tipo=${sel.tipoParteId}`}>VER EN STOCK</a>
              </div>
              {puedeEditarTaller ? (
                <details class="plegable">
                  <summary><span class="lbl-12" style="text-decoration:underline;cursor:pointer">Ajustar vida útil de esta parte</span></summary>
                  <form method="post" action={`/parte/${sel.id}/vida?volver=${encodeURIComponent(`/trailer/${unidad.id}?parte=${sel.id}`)}`} class="form-grid" style="margin-top:8px">
                    <label class="campo"><span>Km</span><input name="vidaKm" inputmode="numeric" value={sel.vida.km ?? ""} /></label>
                    <label class="campo"><span>Viajes</span><input name="vidaViajes" inputmode="numeric" value={sel.vida.viajes ?? ""} /></label>
                    <label class="campo"><span>Días</span><input name="vidaDias" inputmode="numeric" value={sel.vida.dias ?? ""} /></label>
                    <button class="btn" type="submit">GUARDAR VIDA ÚTIL</button>
                  </form>
                </details>
              ) : null}
            </Panel>
          ) : <Panel titulo="DETALLE"><Vacio>Selecciona una parte.</Vacio></Panel>}
          {sel ? (
            <Panel titulo={`VIAJES DESDE EL CAMBIO · ${sel.uso.viajes} VIAJES`}>
              {desdeCambio.length === 0 ? <Vacio>Sin viajes registrados desde la instalación.</Vacio> : (
                <div class="tabla-wrap"><table class="t"><tbody>
                  {desdeCambio.slice(0, 8).map((v) => (
                    <tr><td class="nowrap">{v.guiaRef ?? v.codigo}</td><td>{v.origenLugar && v.destinoLugar ? `${v.origenLugar} → ${v.destinoLugar}` : "—"}</td><td class="num">{miles(v.km)} km</td></tr>
                  ))}
                </tbody></table></div>
              )}
              {desdeCambio.length > 8 ? <span class="muted" style="font-size:11px">… y {desdeCambio.length - 8} viajes más</span> : null}
              <a class="lbl-12" href={`/viajes?unidad=${unidad.id}`}>VER TODOS LOS VIAJES →</a>
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  ));
}

export function rutasTrailer(app: App, d: Deps): void {
  app.get("/trailer", (c) => vista(c, d));
  app.get("/trailer/:id", (c) => vista(c, d));
  app.post("/trailer/:id/instalar", async (c) => {
    const id = Number(c.req.param("id"));
    const f = await formulario(c);
    return accion(c, `/trailer/${id}`, async () => {
      const km = entero(f.km);
      const viajesDesdeInst = entero(f.viajesDesde) ?? 0;
      if (Number.isNaN(km) || Number.isNaN(viajesDesdeInst) || viajesDesdeInst < 0) throw new ErrorNegocio("Números no válidos");
      const unidad = (await listarUnidades(d.ctx)).find((u) => u.id === id);
      if (!unidad) throw new ErrorNegocio("La unidad no existe");
      const tipos = f.tipoParteId === "todas"
        ? (await listarTiposParte(d.ctx)).map((t) => t.id)
        : [Number(f.tipoParteId)];
      const existentes = new Set((await partesDeUnidad(d.ctx, id)).map((p) => p.tipoParteId));
      let n = 0;
      for (const t of tipos) {
        if (existentes.has(t)) continue;
        await instalarParte(d.ctx, {
          vehiculoId: id, tipoParteId: t, fecha: f.fecha || undefined, km: km ?? undefined,
          viajes: Math.max(0, unidad.viajesTotales - viajesDesdeInst),
        }, d.ctx.db, c.get("usuario").id);
        n++;
      }
      return `${n} ${n === 1 ? "parte controlada" : "partes controladas"} en ${unidad.codigo}`;
    });
  });
  app.post("/parte/:id/vida", async (c) => {
    const f = await formulario(c);
    const volverA = c.req.query("volver")?.startsWith("/") ? c.req.query("volver")! : "/trailer";
    return accion(c, volverA, async () => {
      const v = { vidaKm: entero(f.vidaKm), vidaViajes: entero(f.vidaViajes), vidaDias: entero(f.vidaDias) };
      if (Object.values(v).some((x) => Number.isNaN(x))) throw new ErrorNegocio("Números no válidos");
      await ajustarVidaParte(d.ctx, Number(c.req.param("id")), v, c.get("usuario").id);
      return "Vida útil actualizada";
    });
  });
}
