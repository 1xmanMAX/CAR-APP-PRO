/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import {
  ErrorNegocio, guardarCotizacion, guardarParametrosCotizador, guardarPresupuestoMensual, hoy, listarCotizaciones,
  listarCategorias, listarUnidades, marcarCotizacionEnviada, mesAnterior, parametrosCotizador, parsearMonto, pdfDeCotizacion, presupuestoMensual,
  presupuestoVsReal, proyeccion, puedeEditar, rangoMes, rentabilidadPorMes, rentabilidadPorUnidad, rentabilidadPorViaje,
} from "@sunatapp/core";
import { accion, formulario, pagina, type App, type C, type Deps } from "../base";
import { redirigir } from "../redirecciones";
import { Barra, Cabecera, Datos, deCada100, fechaDia, GrafScroll, mesCorto, Panel, SelectMes, soles, soles2, Vacio } from "../ui";

function GraficoProyeccion({ meses }: { meses: Array<{ mes: string; ingresos: number; costos: number; proyectado: boolean }> }) {
  const W = 640, H = 190, pad = 6;
  const max = Math.max(1, ...meses.flatMap((m) => [m.ingresos, m.costos]));
  const ancho = W / meses.length;
  return (
    <GrafScroll ancho={W}>
    <svg class="graf" viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label="Lo que entra y sale por mes: oscuro lo que pasó, claro lo que se espera">
      <line x1="0" x2={W} y1={H} y2={H} stroke="#CDBFA5" />
      {meses.map((m, i) => {
        const hi = (m.ingresos / max) * (H - pad), hc = (m.costos / max) * (H - pad);
        const x = i * ancho + ancho * 0.14, w = ancho * 0.34;
        return (
          <g>
            <title>{`${mesCorto(m.mes)}${m.proyectado ? " (lo que se espera)" : ""}: entra ${soles(m.ingresos)}, sale ${soles(m.costos)}`}</title>
            <rect x={x} y={H - hi} width={w} height={hi} fill={m.proyectado ? "#8FB4CC" : "#2D5B7A"} rx="1" />
            <rect x={x + w + 2} y={H - hc} width={w} height={hc} fill={m.proyectado ? "#F7D3E5" : "#B8236E"} rx="1" />
            <text x={x + w} y={H + 14} font-size="12" text-anchor="middle" fill={m.proyectado ? "#857A69" : "#6B6254"}>{mesCorto(m.mes)}</text>
          </g>
        );
      })}
    </svg>
    </GrafScroll>
  );
}

async function vista(c: C, d: Deps, parte: "rentabilidad" | "cotizar") {
  const ctx = d.ctx;
  const h = hoy(ctx);
  const { desde, hasta } = rangoMes(h);
  const categorias = await listarCategorias(ctx, { soloActivas: true });
  // Rentabilidad por viaje o por mes, con el fijo repartido (spec §7).
  const vistaSel = c.req.query("vista") === "mes" ? "mes" : "viaje";
  const unidadSel = c.req.query("unidad") ? Number(c.req.query("unidad")) : undefined;
  const mesValido = (m: string | undefined) => (m && /^\d{4}-\d{2}$/.test(m) ? m : undefined);
  const desdeMes = mesValido(c.req.query("desde")) ?? mesAnterior(h.slice(0, 7), 2);
  const hastaMes = mesValido(c.req.query("hasta")) ?? h.slice(0, 7);
  const rango = { desde: `${desdeMes}-01`, hasta: rangoMes(`${hastaMes}-01`).hasta, vehiculoId: unidadSel };
  const filasViaje = vistaSel === "viaje" ? await rentabilidadPorViaje(ctx, rango) : [];
  const filasMes = vistaSel === "mes" ? await rentabilidadPorMes(ctx, rango) : [];
  const enlace = (v: string) => `/numeros/rentabilidad?vista=${v}&desde=${desdeMes}&hasta=${hastaMes}${unidadSel ? `&unidad=${unidadSel}` : ""}`;
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

  // Por viaje: 20 filas y «ver todos» (en el celular la tabla larga no se puede leer).
  const todos = c.req.query("todos") === "1";
  const filasViajeVer = todos ? filasViaje : filasViaje.slice(0, 20);
  const aunPuedeCambiar = <span class="chip proximo" style="margin-left:4px">aún puede cambiar</span>;
  const bloqueRentabilidad = (
    <>
      <Panel titulo={vistaSel === "viaje" ? "Por viaje" : "Por mes"} der={
        <form method="get" action="/numeros/rentabilidad" class="linea filtro" style="flex-wrap:wrap">
          <a class={`btn chico${vistaSel === "viaje" ? " primario" : ""}`} href={enlace("viaje")}>Por viaje</a>
          <a class={`btn chico${vistaSel === "mes" ? " primario" : ""}`} href={enlace("mes")}>Por mes</a>
          <input type="hidden" name="vista" value={vistaSel} />
          <select name="unidad" aria-label="Camión"><option value="">Todos</option>{unidades.map((u) => <option value={u.id} selected={u.id === unidadSel}>{u.codigo}</option>)}</select>
          <SelectMes nombre="desde" valor={desdeMes} hasta={h.slice(0, 7)} etiqueta="Desde" />
          <SelectMes nombre="hasta" valor={hastaMes} hasta={h.slice(0, 7)} etiqueta="Hasta" />
          <button class="btn chico" type="submit">Ver</button>
        </form>
      }>
        <p class="muted nota-saldo">«Deja» es lo mismo que en Viajes: flete menos gastos del viaje. «Te quedó» además resta la parte que le toca de los gastos del mes (sueldos, SOAT, cuota, local…).</p>
        {vistaSel === "viaje" ? (
          filasViaje.length === 0 ? <Vacio>No hay viajes cerrados en esos meses.</Vacio> : (
            <>
              <div class="tabla-wrap"><table class="t">
                <thead><tr><th>Viaje</th><th class="ocultar-movil">Guía</th><th>Camión</th><th>Ruta</th><th class="num">Flete</th><th class="num">Gastos del viaje</th><th class="num">Deja (sin gastos del mes)</th><th class="num">Parte de gastos del mes</th><th class="num">Te quedó</th><th class="num">De cada S/ 100 te quedan</th></tr></thead>
                <tbody>{filasViajeVer.map((f) => (
                  <tr>
                    <td class="nowrap"><a href={`/viajes/${f.viajeId}`}>{f.codigo}</a></td><td class="ocultar-movil">{f.guia ?? <span class="chip cambiar">sin guía</span>}</td><td>{f.unidad}</td><td>{f.ruta}</td>
                    <td class="num">{soles(f.flete)}</td><td class="num">{soles(f.variables)}</td><td class="num">{soles(f.contribucion)}</td>
                    <td class="num">{soles(f.fijoAsignado)}{f.provisional ? aunPuedeCambiar : null}</td>
                    <td class="num"><b class={f.ganancia < 0 ? "t-cambiar" : undefined}>{soles(f.ganancia)}</b></td><td class="num">{deCada100(f.margenPct)}</td>
                  </tr>
                ))}</tbody>
              </table></div>
              {!todos && filasViaje.length > 20 ? <a class="ver-mas" href={`${enlace("viaje")}&todos=1`}>Ver los {filasViaje.length} viajes</a> : null}
            </>
          )
        ) : (
          <div class="tabla-wrap"><table class="t">
            <thead><tr><th>Mes</th><th>Camión</th><th class="num">Viajes</th><th class="num">Entró</th><th class="num">Gastos del viaje</th><th class="num">Deja (sin gastos del mes)</th><th class="num">Gastos del mes</th><th class="num">Te quedó</th><th class="num">De cada S/ 100 te quedan</th></tr></thead>
            <tbody>{filasMes.map((m) => (
              <tr>
                <td class="nowrap">{mesCorto(m.mes)}{m.provisional ? aunPuedeCambiar : null}</td><td>{m.unidad}</td>
                <td class="num">{m.viajes}</td><td class="num">{soles(m.ingresos)}</td><td class="num">{soles(m.variables)}</td><td class="num">{soles(m.contribucion)}</td>
                <td class="num">{m.fijosDetalle.length ? (
                  <details class="plegable"><summary>{soles(m.fijos)}</summary>{m.fijosDetalle.map((x) => <div style="font-size:12px">{x.nombre}: {soles(x.monto)}</div>)}</details>
                ) : soles(m.fijos)}</td>
                <td class="num"><b class={m.ganancia < 0 ? "t-cambiar" : undefined}>{soles(m.ganancia)}</b></td><td class="num">{deCada100(m.margenPct)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
      <Panel titulo="Por camión, este mes">
        <div class="tabla-wrap"><table class="t">
          <thead><tr><th>Camión</th><th class="num">Viajes</th><th class="num">Entró</th><th class="num">Gastos</th><th class="num">S/ por km</th><th style="width:30%">De cada S/ 100 te quedan</th></tr></thead>
          <tbody>{rent.length === 0 ? <tr><td colspan={6}><Vacio>Sin camiones.</Vacio></td></tr> : rent.map((r) => (
            <tr>
              <td><b>{r.unidad}</b></td><td class="num">{r.viajes}</td><td class="num">{soles(r.ingresos)}</td><td class="num">{soles(r.costos)}</td>
              <td class="num">{r.solesPorKm ?? "—"}</td>
              <td><div style="display:flex;gap:6px;align-items:center"><div style="flex:1;min-width:60px"><Barra pct={Math.max(0, r.margenPct ?? 0)} color={(r.margenPct ?? 0) < 0 ? "var(--accent)" : "var(--ok)"} /></div><b class="mono-t nowrap" style="text-align:right">{deCada100(r.margenPct)}</b></div></td>
            </tr>
          ))}</tbody>
        </table></div>
      </Panel>
      <div class="grid g-2">
        <Panel titulo="Lo que viene · 6 meses" der={<span class="leyenda"><span><i style="background:#2D5B7A"></i>entra</span><span><i style="background:#B8236E"></i>sale</span><span>claro = lo que se espera</span></span>}>
          <GraficoProyeccion meses={proy.meses} />
          <span class="muted" style="font-size:12px">Se calcula con {proy.base.viajesMes} viajes al mes, flete de {soles(proy.base.fletePromedio)} en promedio, {proy.base.kmPorViaje} km por viaje a S/ {(proy.base.costoPorKm / 100).toFixed(2)} por km (sin repuestos), más los repuestos que ya toca cambiar según el desgaste.</span>
        </Panel>
        <Panel titulo="Presupuesto vs lo gastado · este mes" der={edita ? <a class="btn chico" href="#presupuesto">Cambiar</a> : null}>
          {pvr.length === 0 ? <Vacio>Sin gastos ni presupuesto este mes.</Vacio> : (
            <div class="filas">
              {pvr.map((b) => (
                <div>
                  <div class="fila-sep" style="font-size:12px"><span>{b.nombre}</span><span class={b.pct !== null && b.pct > 100 ? "t-cambiar" : ""}><b>{b.pct === null ? "sin presupuesto" : `${b.pct}%`}</b> <span class="muted">{soles(b.real)} de {soles(b.presupuesto)}</span></span></div>
                  <Barra pct={((b.pct ?? 0) / maxPvr) * 100} color={b.pct !== null && b.pct > 100 ? "var(--accent)" : b.pct !== null && b.pct >= 90 ? "var(--amber-bar)" : "var(--ok)"} linea100={(100 / maxPvr) * 100} />
                </div>
              ))}
              <span class="muted" style="font-size:12px">La raya negra es lo que pensabas gastar.</span>
            </div>
          )}
        </Panel>
      </div>
      {edita ? (
        <Panel titulo="Cuánto piensas gastar al mes, por categoría" id="presupuesto">
          <form method="post" action="/rentabilidad/presupuesto" class="form-grid alinear">
            {categorias.map(({ clave: k, nombre }) => (
              <label class="campo"><span>{nombre}</span><input name={k} inputmode="decimal" value={presupuesto[k] !== undefined ? String(presupuesto[k]! / 100) : ""} /></label>
            ))}
            <button class="btn" type="submit">Guardar</button>
          </form>
        </Panel>
      ) : null}
    </>
  );
  const pdfListo = /^\d+$/.test(c.req.query("pdf") ?? "") ? c.req.query("pdf")! : null;
  const bloqueCotizar = (
    <>
      <Datos id="datos-coti" valor={datos} />
      {pdfListo ? (
        <div class="aviso info">Presupuesto listo: <a href={`/cotizacion/${pdfListo}.pdf`} target="_blank" rel="noopener"><b>Abrir el PDF P-{pdfListo.padStart(4, "0")}</b></a></div>
      ) : null}
      <Panel titulo="Cuánto cobrar" der={<span class="muted" style="font-size:12px">Cambia un dato y el precio se calcula solo</span>}>
        <form method="post" action="/rentabilidad/cotizacion" class="filas" id="form-coti">
          <label class="campo"><span>Ruta</span><input name="ruta" required placeholder="Juliaca → Arequipa" /></label>
          <label class="campo"><span>Camión</span>
            <select name="vehiculoId" id="c-unidad"><option value="">— cualquiera —</option>{unidades.map((u) => <option value={u.id}>{u.codigo}</option>)}</select>
          </label>
          <div class="form-grid alinear">
            <label class="campo"><span>Km</span><input name="km" id="c-km" inputmode="decimal" value="1290" required /></label>
            <label class="campo"><span>Toneladas</span><input name="toneladas" id="c-ton" inputmode="decimal" value="30" /></label>
            <label class="campo"><span>S/ por galón</span><input name="precioGal" id="c-precio" inputmode="decimal" value={params.precioGal} /></label>
            <label class="campo"><span>Km por galón</span><input name="rendimiento" id="c-rend" inputmode="decimal" value={params.rendimientoKmGal} /></label>
            <label class="campo"><span>Peajes S/</span><input name="peajes" id="c-peajes" inputmode="decimal" value="0" /></label>
            <label class="campo"><span>Viáticos S/</span><input name="viaticos" id="c-viaticos" inputmode="decimal" value={params.viaticosDia * 2} /></label>
            <label class="campo"><span>Desgaste por km S/{params.desgasteAuto !== null ? <em style="text-transform:none"> (auto {params.desgasteAuto})</em> : null}</span><input name="desgaste" id="c-desgaste" inputmode="decimal" value={desgaste} /></label>
            <label class="campo"><span>Ganar de cada S/ 100</span><input name="margen" id="c-margen" inputmode="decimal" value={params.margenPct} /></label>
          </div>
          <div class="tabla-wrap"><table class="t"><tbody id="c-desglose">
            <tr><td>Combustible</td><td class="num" data-k="combustible">—</td></tr>
            <tr><td>Peajes</td><td class="num" data-k="peajes">—</td></tr>
            <tr><td>Viáticos</td><td class="num" data-k="viaticos">—</td></tr>
            <tr><td>Desgaste del camión</td><td class="num" data-k="desgaste">—</td></tr>
            <tr><td><b>Lo que cuesta el viaje</b></td><td class="num"><b data-k="costo">—</b></td></tr>
          </tbody></table></div>
          <div class="caja-oscura">
            <span class="lbl">Cobra · ganas S/ <span data-k="margen">—</span> de cada S/ 100</span>
            <b style="font-size:30px" data-k="flete">—</b>
            <span style="font-size:12px"><span data-k="porTon">—</span> por tonelada · <span data-k="porKm">—</span> por km · te queda <span data-k="ganancia">—</span></span>
          </div>
          {edita ? (
            <div class="acciones">
              <button class="btn primario" type="submit" name="accion" value="pdf">Sacar presupuesto en PDF</button>
              <button class="btn oscuro" type="submit" name="accion" value="telegram">Mandar por Telegram</button>
            </div>
          ) : <p class="muted nota-saldo">Solo el dueño guarda y manda presupuestos.</p>}
        </form>
        {cotizaciones.length ? (
          <div class="tabla-wrap"><table class="t">
            <thead><tr><th>Presupuestos hechos</th><th class="num">Km</th><th class="num">Flete</th><th></th></tr></thead>
            <tbody>{cotizaciones.map((q) => (
              <tr><td>P-{String(q.id).padStart(4, "0")} · {q.ruta} <span class="muted">{fechaDia(q.creadoEn.toISOString().slice(0, 10))}</span></td><td class="num">{q.km}</td><td class="num">{soles2(q.flete)}</td><td class="nowrap"><a href={`/cotizacion/${q.id}.pdf`}>PDF</a>{q.enviadaTelegram ? " · ✈" : ""}</td></tr>
            ))}</tbody>
          </table></div>
        ) : null}
      </Panel>
      {edita ? (
        <Panel titulo="Valores de siempre del cotizador">
          <form method="post" action="/rentabilidad/parametros" class="form-grid alinear">
            <label class="campo"><span>S/ por galón</span><input name="precioGal" inputmode="decimal" value={params.precioGal} /></label>
            <label class="campo"><span>Km por galón</span><input name="rendimiento" inputmode="decimal" value={params.rendimientoKmGal} /></label>
            <label class="campo"><span>Viáticos por día S/</span><input name="viaticos" inputmode="decimal" value={params.viaticosDia} /></label>
            <label class="campo"><span>Desgaste por km (vacío = automático)</span><input name="desgaste" inputmode="decimal" value={params.desgasteSolesKm ?? ""} placeholder={params.desgasteAuto !== null ? String(params.desgasteAuto) : "sin historial"} /></label>
            <label class="campo"><span>Ganar de cada S/ 100</span><input name="margen" inputmode="decimal" value={params.margenPct} /></label>
            <button class="btn" type="submit">Guardar</button>
          </form>
        </Panel>
      ) : null}
    </>
  );
  return pagina(c, d, {
    titulo: parte === "cotizar" ? "Cotizar un viaje" : "Rentabilidad detallada", seccion: "rentabilidad",
    scripts: parte === "cotizar" ? ["/static/cotizador.js"] : undefined,
  }, (
    <>
      <Cabecera volver="/numeros" titulo={parte === "cotizar" ? "Cotizar un viaje" : "Rentabilidad detallada"} />
      <div class="filas">{parte === "cotizar" ? bloqueCotizar : bloqueRentabilidad}</div>
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
  app.get("/numeros/rentabilidad", (c) => vista(c as C, d, "rentabilidad"));
  app.get("/numeros/cotizar", (c) => vista(c as C, d, "cotizar"));
  redirigir(app, "/rentabilidad", (c) => (c.req.query("pdf") ? "/numeros/cotizar" : "/numeros/rentabilidad"), ["vista", "unidad", "desde", "hasta", "pdf"]);
  app.post("/rentabilidad/cotizacion", async (c) => {
    const f = await formulario(c);
    return accion(c, "/numeros/cotizar", async () => {
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
      return { ok: `Presupuesto P-${String(id).padStart(4, "0")} guardado`, ruta: `/numeros/cotizar?pdf=${id}` };
    });
  });
  app.get("/cotizacion/:archivo", async (c) => {
    const id = Number(c.req.param("archivo").replace(/\.pdf$/, ""));
    const p = await pdfDeCotizacion(d.ctx, id);
    return c.body(new Uint8Array(p.pdf), 200, { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${p.nombre}"` });
  });
  app.post("/rentabilidad/parametros", async (c) => {
    const f = await formulario(c);
    return accion(c, "/numeros/cotizar", async () => {
      await guardarParametrosCotizador(d.ctx, {
        precioGal: dec(f.precioGal, "Precio"), rendimientoKmGal: dec(f.rendimiento, "Rendimiento"), viaticosDia: dec(f.viaticos, "Viáticos", 0),
        desgasteSolesKm: f.desgaste ? dec(f.desgaste, "Desgaste") : null, margenPct: dec(f.margen, "Margen"),
      });
      return "Parámetros guardados";
    });
  });
  app.post("/rentabilidad/presupuesto", async (c) => {
    const f = await formulario(c);
    return accion(c, "/numeros/rentabilidad", async () => {
      const p: Partial<Record<string, number>> = {};
      for (const { clave: k, nombre } of await listarCategorias(d.ctx, { soloActivas: true })) {
        if (!f[k]) continue;
        const m = parsearMonto(f[k]!);
        if (m === null && f[k] !== "0") throw new ErrorNegocio(`Monto no válido en ${nombre}`);
        p[k] = m ?? 0;
      }
      await guardarPresupuestoMensual(d.ctx, p);
      return "Presupuesto mensual guardado";
    });
  });
}
