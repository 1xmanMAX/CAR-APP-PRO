/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import {
  CATEGORIAS_GASTO, ErrorNegocio, guardarCotizacion, guardarParametrosCotizador, guardarPresupuestoMensual, hoy, listarCotizaciones,
  listarUnidades, marcarCotizacionEnviada, NOMBRE_CATEGORIA, parametrosCotizador, parsearMonto, pdfDeCotizacion, presupuestoMensual,
  presupuestoVsReal, proyeccion, puedeEditar, rangoMes, rentabilidadPorUnidad, type CategoriaGasto,
} from "@sunatapp/core";
import { accion, formulario, pagina, type App, type C, type Deps } from "../base";
import { Barra, Datos, fechaCorta, nombreMes, Panel, soles, soles2, Vacio } from "../ui";

function GraficoProyeccion({ meses }: { meses: Array<{ mes: string; ingresos: number; costos: number; proyectado: boolean }> }) {
  const W = 640, H = 190, pad = 6;
  const max = Math.max(1, ...meses.flatMap((m) => [m.ingresos, m.costos]));
  const ancho = W / meses.length;
  return (
    <svg class="graf" viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label="Ingresos y costos por mes: sólidos reales, claros proyectados">
      <line x1="0" x2={W} y1={H} y2={H} stroke="#CDBFA5" />
      {meses.map((m, i) => {
        const hi = (m.ingresos / max) * (H - pad), hc = (m.costos / max) * (H - pad);
        const x = i * ancho + ancho * 0.14, w = ancho * 0.34;
        return (
          <g>
            <title>{`${nombreMes(m.mes)}${m.proyectado ? " (proyectado)" : ""}: ingresos ${soles(m.ingresos)}, costos ${soles(m.costos)}`}</title>
            <rect x={x} y={H - hi} width={w} height={hi} fill={m.proyectado ? "#8FB4CC" : "#2D5B7A"} rx="1" />
            <rect x={x + w + 2} y={H - hc} width={w} height={hc} fill={m.proyectado ? "#F7D3E5" : "#B8236E"} rx="1" />
            <text x={x + w} y={H + 14} font-size="10" text-anchor="middle" fill={m.proyectado ? "#9A8F7E" : "#6B6254"}>{nombreMes(m.mes)}</text>
          </g>
        );
      })}
    </svg>
  );
}

async function vista(c: C, d: Deps) {
  const ctx = d.ctx;
  const h = hoy(ctx);
  const { desde, hasta } = rangoMes(h);
  const [unidades, params, rent, proy, pvr, cotizaciones, presupuesto] = await Promise.all([
    listarUnidades(ctx), parametrosCotizador(ctx), rentabilidadPorUnidad(ctx, desde, hasta), proyeccion(ctx), presupuestoVsReal(ctx, h),
    listarCotizaciones(ctx, 8), presupuestoMensual(ctx),
  ]);
  const edita = puedeEditar(c.get("usuario").rol, "rentabilidad");
  const desgaste = params.desgasteSolesKm ?? params.desgasteAuto ?? 0.35;
  const datos = {
    unidades: unidades.map((u) => ({ id: u.id, codigo: u.codigo, rendimiento: u.rendimientoKmGal })),
    params: { ...params, desgaste },
  };
  const maxPvr = Math.max(100, ...pvr.map((b) => b.pct ?? 0));

  return pagina(c, d, { titulo: "Rentabilidad y fletes", seccion: "rentabilidad", scripts: ["/static/cotizador.js"] }, (
    <>
      <Datos id="datos-coti" valor={datos} />
      {/^\d+$/.test(c.req.query("pdf") ?? "") ? (
        <div class="aviso info">Presupuesto listo: <a href={`/cotizacion/${c.req.query("pdf")}.pdf`} target="_blank" rel="noopener"><b>ABRIR PDF P-{c.req.query("pdf")!.padStart(4, "0")}</b></a></div>
      ) : null}
      <div class="grid g-coti">
        <Panel titulo="COTIZADOR DE FLETE · PRESUPUESTO AL INSTANTE" der={<span class="lbl">CAMBIA LOS VALORES Y EL PRECIO SE RECALCULA</span>}>
          <form method="post" action="/rentabilidad/cotizacion" class="filas" id="form-coti">
            <label class="campo"><span>Ruta</span><input name="ruta" required placeholder="Juliaca → Arequipa" /></label>
            <label class="campo"><span>Trailer</span>
              <select name="vehiculoId" id="c-unidad"><option value="">— cualquiera —</option>{unidades.map((u) => <option value={u.id}>{u.codigo}</option>)}</select>
            </label>
            <div class="form-grid">
              <label class="campo"><span>Distancia (km)</span><input name="km" id="c-km" inputmode="decimal" value="1290" required /></label>
              <label class="campo"><span>Toneladas</span><input name="toneladas" id="c-ton" inputmode="decimal" value="30" /></label>
              <label class="campo"><span>Combustible S/ por galón</span><input name="precioGal" id="c-precio" inputmode="decimal" value={params.precioGal} /></label>
              <label class="campo"><span>Rendimiento km/gal</span><input name="rendimiento" id="c-rend" inputmode="decimal" value={params.rendimientoKmGal} /></label>
              <label class="campo"><span>Peajes S/</span><input name="peajes" id="c-peajes" inputmode="decimal" value="0" /></label>
              <label class="campo"><span>Viáticos S/</span><input name="viaticos" id="c-viaticos" inputmode="decimal" value={params.viaticosDia * 2} /></label>
              <label class="campo"><span>Desgaste S/ por km {params.desgasteAuto !== null ? <em style="text-transform:none">(auto {params.desgasteAuto})</em> : null}</span><input name="desgaste" id="c-desgaste" inputmode="decimal" value={desgaste} /></label>
              <label class="campo"><span>Margen deseado %</span><input name="margen" id="c-margen" inputmode="decimal" value={params.margenPct} /></label>
            </div>
            <div class="tabla-wrap"><table class="t"><tbody id="c-desglose">
              <tr><td>Combustible</td><td class="num" data-k="combustible">—</td></tr>
              <tr><td>Peajes</td><td class="num" data-k="peajes">—</td></tr>
              <tr><td>Viáticos</td><td class="num" data-k="viaticos">—</td></tr>
              <tr><td>Desgaste de unidad</td><td class="num" data-k="desgaste">—</td></tr>
              <tr><td><b>COSTO DEL VIAJE</b></td><td class="num"><b data-k="costo">—</b></td></tr>
            </tbody></table></div>
            <div class="caja-oscura">
              <span class="lbl">FLETE SUGERIDO · MARGEN <span data-k="margen">—</span>%</span>
              <b style="font-size:30px" data-k="flete">—</b>
              <span style="font-size:12px"><span data-k="porTon">—</span> por tonelada · <span data-k="porKm">—</span> por km · ganancia <span data-k="ganancia">—</span></span>
            </div>
            <div class="acciones">
              <button class="btn primario" type="submit" name="accion" value="pdf">GENERAR PRESUPUESTO (PDF)</button>
              <button class="btn oscuro" type="submit" name="accion" value="telegram">ENVIAR POR TELEGRAM</button>
            </div>
          </form>
          {cotizaciones.length ? (
            <div class="tabla-wrap"><table class="t">
              <thead><tr><th>Presupuestos</th><th class="num">Km</th><th class="num">Flete</th><th></th></tr></thead>
              <tbody>{cotizaciones.map((q) => (
                <tr><td>P-{String(q.id).padStart(4, "0")} · {q.ruta} <span class="muted">{fechaCorta(q.creadoEn.toISOString().slice(0, 10))}</span></td><td class="num">{q.km}</td><td class="num">{soles2(q.flete)}</td><td><a href={`/cotizacion/${q.id}.pdf`}>PDF</a>{q.enviadaTelegram ? " · ✈" : ""}</td></tr>
              ))}</tbody>
            </table></div>
          ) : null}
        </Panel>

        <div class="filas" style="gap:10px;min-width:0">
          <Panel titulo="RENTABILIDAD · POR TRAILER, ESTE MES">
            <div class="tabla-wrap"><table class="t">
              <thead><tr><th>Unidad</th><th class="num">Viajes</th><th class="num">Ingresos</th><th class="num">Costos</th><th class="num">S/ por km</th><th style="width:30%">Margen</th></tr></thead>
              <tbody>{rent.length === 0 ? <tr><td colspan={6}><Vacio>Sin unidades.</Vacio></td></tr> : rent.map((r) => (
                <tr>
                  <td><b>{r.unidad}</b></td><td class="num">{r.viajes}</td><td class="num">{soles(r.ingresos)}</td><td class="num">{soles(r.costos)}</td>
                  <td class="num">{r.solesPorKm ?? "—"}</td>
                  <td><div style="display:flex;gap:6px;align-items:center"><div style="flex:1"><Barra pct={Math.max(0, r.margenPct ?? 0)} color={(r.margenPct ?? 0) < 0 ? "var(--accent)" : "var(--ok)"} /></div><b class="mono-t" style="width:44px;text-align:right">{r.margenPct === null ? "—" : `${r.margenPct}%`}</b></div></td>
                </tr>
              ))}</tbody>
            </table></div>
          </Panel>
          <div class="grid g-2">
            <Panel titulo="PROYECCIÓN · 6 MESES" der={<span class="leyenda"><span><i style="background:#2D5B7A"></i>INGRESOS</span><span><i style="background:#B8236E"></i>COSTOS</span><span>CLARO = PROYECTADO</span></span>}>
              <GraficoProyeccion meses={proy.meses} />
              <span class="muted" style="font-size:11px">Se proyecta con {proy.base.viajesMes} viajes/mes, flete promedio {soles(proy.base.fletePromedio)}, {proy.base.kmPorViaje} km/viaje a S/ {(proy.base.costoPorKm / 100).toFixed(2)} por km (sin repuestos) más los cambios de repuestos que ya vienen en camino según los contadores de desgaste.</span>
            </Panel>
            <Panel titulo="PRESUPUESTO VS REAL · MES" der={edita ? <a class="lbl-12" href="#presupuesto">EDITAR</a> : null}>
              {pvr.length === 0 ? <Vacio>Sin gastos ni presupuesto este mes.</Vacio> : (
                <div class="filas">
                  {pvr.map((b) => (
                    <div>
                      <div style="display:flex;justify-content:space-between;font-size:12px"><span>{b.nombre}</span><span class={b.pct !== null && b.pct > 100 ? "t-cambiar" : ""}><b>{b.pct === null ? "sin presupuesto" : `${b.pct}%`}</b> <span class="muted">{soles(b.real)} / {soles(b.presupuesto)}</span></span></div>
                      <Barra pct={((b.pct ?? 0) / maxPvr) * 100} color={b.pct !== null && b.pct > 100 ? "var(--accent)" : b.pct !== null && b.pct >= 90 ? "var(--amber-bar)" : "var(--ok)"} linea100={(100 / maxPvr) * 100} />
                    </div>
                  ))}
                  <span class="lbl">LÍNEA NEGRA = 100% DEL PRESUPUESTO</span>
                </div>
              )}
            </Panel>
          </div>
          {edita ? (
            <div class="grid g-2">
              <Panel titulo="PARÁMETROS DEL COTIZADOR">
                <form method="post" action="/rentabilidad/parametros" class="form-grid">
                  <label class="campo"><span>S/ por galón</span><input name="precioGal" inputmode="decimal" value={params.precioGal} /></label>
                  <label class="campo"><span>Rendimiento km/gal</span><input name="rendimiento" inputmode="decimal" value={params.rendimientoKmGal} /></label>
                  <label class="campo"><span>Viáticos por día S/</span><input name="viaticos" inputmode="decimal" value={params.viaticosDia} /></label>
                  <label class="campo"><span>Desgaste S/km (vacío = auto)</span><input name="desgaste" inputmode="decimal" value={params.desgasteSolesKm ?? ""} placeholder={params.desgasteAuto !== null ? String(params.desgasteAuto) : "sin historial"} /></label>
                  <label class="campo"><span>Margen %</span><input name="margen" inputmode="decimal" value={params.margenPct} /></label>
                  <button class="btn" type="submit">GUARDAR</button>
                </form>
              </Panel>
              <Panel titulo="PRESUPUESTO MENSUAL POR CATEGORÍA" id="presupuesto">
                <form method="post" action="/rentabilidad/presupuesto" class="form-grid">
                  {CATEGORIAS_GASTO.map((k) => (
                    <label class="campo"><span>{NOMBRE_CATEGORIA[k]}</span><input name={k} inputmode="decimal" value={presupuesto[k] !== undefined ? String(presupuesto[k]! / 100) : ""} /></label>
                  ))}
                  <button class="btn" type="submit">GUARDAR</button>
                </form>
              </Panel>
            </div>
          ) : null}
        </div>
      </div>
    </>
  ));
}

const dec = (v: string | undefined, nombre: string, def?: number): number => {
  if ((v === undefined || v === "") && def !== undefined) return def;
  const n = Number((v ?? "").replace(/,/g, "."));
  if (!Number.isFinite(n) || n < 0) throw new ErrorNegocio(`${nombre} no válido`);
  return n;
};

export function rutasRentabilidad(app: App, d: Deps): void {
  app.get("/rentabilidad", (c) => vista(c, d));
  app.post("/rentabilidad/cotizacion", async (c) => {
    const f = await formulario(c);
    return accion(c, "/rentabilidad", async () => {
      const { id, resultado } = await guardarCotizacion(d.ctx, {
        ruta: f.ruta ?? "", vehiculoId: f.vehiculoId ? Number(f.vehiculoId) : null, usuarioId: c.get("usuario").id,
        entrada: {
          km: dec(f.km, "Distancia"), toneladas: dec(f.toneladas, "Toneladas", 0), precioGal: dec(f.precioGal, "Precio del combustible"),
          rendimientoKmGal: dec(f.rendimiento, "Rendimiento"), peajes: dec(f.peajes, "Peajes", 0), viaticos: dec(f.viaticos, "Viáticos", 0),
          desgasteSolesKm: dec(f.desgaste, "Desgaste", 0), margenPct: dec(f.margen, "Margen", 0),
        },
      });
      if (f.accion === "telegram") {
        const p = await pdfDeCotizacion(d.ctx, id);
        await d.avisar(p.texto, { contenido: p.pdf, nombre: p.nombre });
        await marcarCotizacionEnviada(d.ctx, id);
        return `Presupuesto P-${String(id).padStart(4, "0")} enviado por Telegram · flete ${soles2(Math.round(resultado.flete * 100))}`;
      }
      return { ok: `Presupuesto P-${String(id).padStart(4, "0")} guardado`, ruta: `/rentabilidad?pdf=${id}` };
    });
  });
  app.get("/cotizacion/:archivo", async (c) => {
    const id = Number(c.req.param("archivo").replace(/\.pdf$/, ""));
    const p = await pdfDeCotizacion(d.ctx, id);
    return c.body(new Uint8Array(p.pdf), 200, { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${p.nombre}"` });
  });
  app.post("/rentabilidad/parametros", async (c) => {
    const f = await formulario(c);
    return accion(c, "/rentabilidad", async () => {
      await guardarParametrosCotizador(d.ctx, {
        precioGal: dec(f.precioGal, "Precio"), rendimientoKmGal: dec(f.rendimiento, "Rendimiento"), viaticosDia: dec(f.viaticos, "Viáticos", 0),
        desgasteSolesKm: f.desgaste ? dec(f.desgaste, "Desgaste") : null, margenPct: dec(f.margen, "Margen"),
      });
      return "Parámetros guardados";
    });
  });
  app.post("/rentabilidad/presupuesto", async (c) => {
    const f = await formulario(c);
    return accion(c, "/rentabilidad", async () => {
      const p: Partial<Record<CategoriaGasto, number>> = {};
      for (const k of CATEGORIAS_GASTO) {
        if (!f[k]) continue;
        const m = parsearMonto(f[k]!);
        if (m === null && f[k] !== "0") throw new ErrorNegocio(`Monto no válido en ${NOMBRE_CATEGORIA[k]}`);
        p[k] = m ?? 0;
      }
      await guardarPresupuestoMensual(d.ctx, p);
      return "Presupuesto mensual guardado";
    });
  });
}
