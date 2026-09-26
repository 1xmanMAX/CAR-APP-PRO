/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import {
  ajustarVidaParte, ErrorNegocio, GRUPOS_PIEZA, hoy, instalarParte, listarReparaciones, listarRepuestos, listarTiposParte,
  listarUnidades, listarViajesFlota, parsearMonto, partesDePieza, partesDeUnidad, pieza, PIEZAS, puedeEditar, registrarCambio, TIPOS_REPARACION, viajesDesde, ZONAS,
  type GrupoPieza, type ParteConDesgaste, type TipoReparacion,
} from "@sunatapp/core";
import { raw } from "hono/html";
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

  const piezaSel = pieza(c.req.query("pieza"));
  const [historial, repuestos] = await Promise.all([
    listarReparaciones(ctx, { vehiculoId: unidad.id, conPieza: true, limite: 400 }),
    puedeEditarTaller ? listarRepuestos(ctx) : Promise.resolve([]),
  ]);
  const porPieza: Record<string, Array<{ fecha: string; trabajo: string; tipo: string; km: string; costo: string | null; taller: string | null }>> = {};
  for (const h of historial) {
    (porPieza[h.componente!] ??= []).push({
      fecha: fechaMedia(h.fecha), trabajo: h.trabajo, tipo: TIPOS_REPARACION[h.tipo], km: miles(h.odometro),
      costo: h.costoTotal ? soles2(h.costoTotal) : null, taller: h.taller,
    });
  }
  // Por pieza: sus partes controladas (para el color y para reiniciar su contador al registrar).
  const partesPieza: Record<string, Array<{ id: number; nombre: string; pct: number; estado: string; url: string }>> = {};
  for (const pz of PIEZAS) {
    const suyas = partesDePieza(pz, partes).sort((a, b) => b.pct - a.pct);
    if (suyas.length) partesPieza[pz.id] = suyas.map((p) => ({ id: p.id, nombre: p.nombre, pct: p.pct, estado: p.estado, url: `/trailer/${unidad.id}?parte=${p.id}` }));
  }

  const datosVisor = {
    parteSeleccionada: piezaSel ? null : sel?.id ?? null,
    piezaSeleccionada: piezaSel?.id ?? null,
    autogiro: false,
    nombresZona: ZONAS,
    piezas: PIEZAS,
    historial: porPieza,
    partesPieza,
  };
  const grupos = Object.keys(GRUPOS_PIEZA) as GrupoPieza[];
  const conHistorial = new Set(Object.keys(porPieza));

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
            <canvas aria-label={`Modelo 3D de ${unidad.codigo}: cada pieza (llantas, retrovisores, faros, puertas…) va por separado y su color es el desgaste. Arrastra para girar, pellizca o usa la rueda para acercar, toca una pieza para resaltarla y ver su historial.`} role="img"></canvas>
            <div class="cab">
              <span class="lbl-12" style="color:var(--dark-text)"><b>{unidad.codigo} · MODELO DE PUNTOS · {PIEZAS.length} PIEZAS</b><br /><span style="color:var(--dark-muted)">TOCA UNA PIEZA PARA RESALTARLA · EL COLOR ES SU DESGASTE</span></span>
              <div class="der">
                <button class="btn chico" id="btn-izq" type="button" aria-label="Girar a la izquierda">&lt;</button>
                <button class="btn chico" id="btn-der" type="button" aria-label="Girar a la derecha">&gt;</button>
                <button class="btn chico" id="btn-girar" type="button" aria-pressed="false">GIRAR</button>
                <button class="btn chico" id="btn-todo" type="button">VER TODO</button>
                <span class="lbl" style="color:var(--dark-muted)">ÁNGULO <span id="angulo">0</span>°</span>
              </div>
            </div>
            {sel ? (
              <div class="etiqueta" hidden>
                <span class="lbl" style="color:var(--dark-muted)">PARTE SELECCIONADA</span><br />
                {sel.nombreCorto} · DESGASTE <b>{sel.pct}%</b>
              </div>
            ) : null}
            <div class="pie"><span><i style="background:#FFE08A"></i>SELECCIONADA</span><span><i class="d-ok"></i>OK</span><span><i class="d-proximo"></i>PRÓXIMO (70%+)</span><span><i class="d-cambiar"></i>CAMBIAR (90%+)</span><span><i style="background:#E9E3D6;opacity:.5"></i>SIN CONTROL</span></div>
            {raw(`<script>setTimeout(function(){if(!window.__visor3d){var e=document.querySelector("#visor .sin-webgl");if(e)e.hidden=false;}},6000)</script>`)}
            <div class="sin-webgl" hidden>Este navegador no puede mostrar el modelo 3D (WebGL o navegador desactualizado: actualiza "Android System WebView" o Chrome). La lista de partes funciona igual.</div>
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
          <Panel titulo="PIEZA DEL MODELO" id="panel-pieza" der={<span class="lbl">TÓCALA EN EL 3D</span>}>
            <label class="campo"><span>Buscar pieza</span>
              <select id="sel-pieza">
                <option value="">— toca una pieza en el modelo o elígela aquí —</option>
                {grupos.map((g) => (
                  <optgroup label={GRUPOS_PIEZA[g]}>
                    {PIEZAS.filter((p) => p.grupo === g).map((p) => <option value={p.id} selected={p.id === piezaSel?.id}>{p.nombre}{conHistorial.has(p.id) ? " •" : ""}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            <div id="pieza-detalle" class="filas" hidden={!piezaSel}>
              <div>
                <b id="pieza-nombre" class="mono-t" style="font-size:15px">{piezaSel?.nombre ?? ""}</b><br />
                <span id="pieza-zona" class="muted" style="font-size:11px"></span>
              </div>
              <div id="pieza-partes" class="filas"></div>
              <span class="lbl">HISTORIAL DE ESTA PIEZA</span>
              <div id="pieza-historial" class="filas"></div>
              {puedeEditarTaller ? (
                <details class="plegable" id="pieza-registrar">
                  <summary><span class="btn primario chico">+ REGISTRAR EN ESTA PIEZA</span></summary>
                  <form method="post" action={`/trailer/${unidad.id}/pieza`} class="filas" style="margin-top:8px">
                    <input type="hidden" name="componente" id="pieza-id" value={piezaSel?.id ?? ""} />
                    <div class="radios">
                      {(Object.keys(TIPOS_REPARACION) as TipoReparacion[]).map((t, i) => (
                        <label><input type="radio" name="tipo" value={t} checked={i === 0} /><span>{TIPOS_REPARACION[t]}</span></label>
                      ))}
                    </div>
                    <label class="campo"><span>¿Qué pasó o qué se hizo?</span><input name="trabajo" id="pieza-trabajo" required maxlength={200} placeholder="Qué pasó o qué se hizo" /></label>
                    <div class="form-grid">
                      <label class="campo"><span>Fecha</span><input type="date" name="fecha" value={hoy(ctx)} /></label>
                      <label class="campo"><span>Odómetro (km)</span><input name="odometro" inputmode="numeric" placeholder={String(unidad.odometroKm)} /></label>
                      <label class="campo"><span>Mano de obra S/</span><input name="manoObra" inputmode="decimal" placeholder="0.00" /></label>
                      <label class="campo"><span>Taller / mecánico</span><input name="taller" /></label>
                    </div>
                    <div class="linea">
                      <label class="campo" style="flex:3"><span>Repuesto usado (sale del inventario)</span>
                        <select name="repuestoId"><option value="">— ninguno —</option>{repuestos.filter((r) => r.stock > 0).map((r) => <option value={r.id}>{r.codigo} · {r.nombre} (stock {r.stock})</option>)}</select>
                      </label>
                      <label class="campo" style="flex:1"><span>Cant.</span><input name="cantidad" inputmode="numeric" value="1" /></label>
                    </div>
                    <label class="campo"><span>¿Reinicia el contador de una parte controlada?</span>
                      <select name="parteId" id="pieza-parte"><option value="">— no reinicia ningún contador —</option></select>
                    </label>
                    <button class="btn primario" type="submit">GUARDAR EN ESTA PIEZA</button>
                    <span class="muted" style="font-size:11px">Queda en el historial de la pieza y en Reparaciones. Sin costo sirve para anotar un incidente (por ejemplo, se abrió el retrovisor).</span>
                  </form>
                </details>
              ) : null}
            </div>
          </Panel>
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
  app.post("/trailer/:id/pieza", async (c) => {
    const id = Number(c.req.param("id"));
    const f = await formulario(c);
    const p = pieza(f.componente);
    return accion(c, p ? `/trailer/${id}?pieza=${p.id}` : `/trailer/${id}`, async () => {
      if (!puedeEditar(c.get("usuario").rol, "reparaciones")) throw new ErrorNegocio("Tu rol no puede registrar reparaciones");
      if (!p) throw new ErrorNegocio("Elige una pieza del modelo");
      if (!f.trabajo?.trim()) throw new ErrorNegocio("Escribe qué pasó o qué se hizo");
      const tipo = (f.tipo ?? "correctivo") as TipoReparacion;
      if (!(tipo in TIPOS_REPARACION)) throw new ErrorNegocio("Tipo no válido");
      const manoObra = f.manoObra ? parsearMonto(f.manoObra) : 0;
      if (manoObra === null) throw new ErrorNegocio("Mano de obra no válida");
      const odometro = entero(f.odometro);
      const cantidad = entero(f.cantidad) ?? 1;
      if (Number.isNaN(odometro) || Number.isNaN(cantidad)) throw new ErrorNegocio("Números no válidos");
      const r = await registrarCambio(d.ctx, {
        vehiculoId: id, componente: p.id, parteInstaladaId: f.parteId ? Number(f.parteId) : null, tipo, trabajo: f.trabajo,
        odometro: odometro ?? undefined, fecha: f.fecha || undefined, manoObra, taller: f.taller || null,
        repuestos: f.repuestoId ? [{ repuestoId: Number(f.repuestoId), cantidad }] : [], origen: "web", usuarioId: c.get("usuario").id,
      });
      await d.avisar(r.resumen).catch(() => {});
      return `Guardado en ${p.nombre}${r.costoTotal ? ` · ${soles2(r.costoTotal)}` : ""}`;
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
