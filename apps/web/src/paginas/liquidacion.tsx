/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import {
  actualizarPresupuestoViaje, borrarEntrega, borrarGasto, CATEGORIAS_GASTO, desenlazarGuia, editarGasto, enlazarGuia, ErrorNegocio, finalizarViajeFlota,
  listarGuiasSinViaje, reabrirViaje, type CategoriaGasto, hoy, liquidacionViaje, MEDIOS_ENTREGA, NOMBRE_CATEGORIA, parsearMonto, puedeEditar, registrarEntrega,
  type LiquidacionViaje, type Semaforo,
} from "@sunatapp/core";
import { accion, formulario, pagina, type App, type C, type Deps } from "../base";
import { Barra, fechaCorta, Kpi, Panel, soles2, Vacio } from "../ui";
import { enteroONull } from "./flota";
import { CamposPlantilla, plantillaDeFormulario } from "./rutas";

const ESTADO_SEMAFORO: Record<Semaforo, "ok" | "proximo" | "cambiar"> = { ok: "ok", alerta: "proximo", excedido: "cambiar" };
const TEXTO_SEMAFORO: Record<Semaforo, string> = { ok: "DENTRO", alerta: "AL LÍMITE", excedido: "EXCEDIDO" };

function textoSaldo(l: LiquidacionViaje): string {
  if (l.saldo > 0) return `El chofer tiene ${soles2(l.saldo)} por rendir o devolver`;
  if (l.saldo < 0) return `La empresa le debe ${soles2(-l.saldo)} al chofer`;
  return "Cuentas en cero";
}

/**
 * **Liquidación de un viaje**: el dinero entregado al chofer contra sus gastos (con el semáforo de
 * cada categoría frente al presupuesto) y la ganancia real del viaje.
 */
async function vista(c: C, d: Deps) {
  const l = await liquidacionViaje(d.ctx, Number(c.req.param("id")));
  const sinViaje = await listarGuiasSinViaje(d.ctx);
  const edita = puedeEditar(c.get("usuario").rol, "viajes");
  const origen = l.presupuestoOrigen.tipo === "viaje" ? "presupuesto del viaje"
    : l.presupuestoOrigen.tipo === "promedio" ? `promedio de los últimos ${l.presupuestoOrigen.viajes} viajes de esta ruta` : "sin presupuesto ni viajes anteriores de esta ruta";
  return pagina(c, d, { titulo: `Liquidación · ${l.viaje.codigo}`, seccion: "viajes" }, (
    <>
      <section class="panel" style="flex-direction:row;align-items:center;flex-wrap:wrap;gap:10px">
        <a class="btn chico" href="/viajes">← VIAJES</a>
        <b class="mono-t" style="font-size:16px">{l.viaje.codigo} · {l.viaje.unidad} · {l.viaje.ruta}</b>
        <span class="muted" style="font-size:12px">Salió {fechaCorta(l.viaje.fechaSalida)}{l.viaje.fechaRegreso ? ` · volvió ${fechaCorta(l.viaje.fechaRegreso)}` : ""}</span>
        <span class={`chip ${l.viaje.estado === "en_curso" ? "ok" : "neutro"}`}>{l.viaje.estado === "en_curso" ? "EN CURSO" : "CERRADO"}</span>
      </section>
      <section class="kpis">
        <Kpi oscuro etiqueta="ENTREGADO AL CHOFER" valor={soles2(l.entregado)} />
        <Kpi etiqueta="GASTADO" valor={soles2(l.gastado)} sub={l.presupuestoTotal ? `de ${soles2(l.presupuestoTotal)} previstos` : undefined} negativo={l.semaforoTotal === "excedido"} />
        <Kpi etiqueta="SALDO" valor={soles2(Math.abs(l.saldo))} sub={textoSaldo(l)} negativo={l.saldo < 0} />
        <Kpi etiqueta="GANANCIA DEL VIAJE" valor={l.ganancia === null ? "—" : soles2(l.ganancia)} sub={l.margenPct === null ? "falta el flete" : `margen ${l.margenPct}% · flete ${soles2(l.flete)}`} negativo={(l.ganancia ?? 0) < 0} />
      </section>
      <div class="grid g-lado">
        <div class="filas" style="gap:10px;min-width:0">
          <Panel titulo="GASTOS POR CATEGORÍA · SEMÁFORO" der={<span class="lbl">{origen.toUpperCase()}</span>}>
            {l.lineas.length === 0 ? <Vacio>Todavía no hay gastos en este viaje. El chofer los manda por Telegram (foto de la boleta o «grifo 350»).</Vacio> : (
              <div class="filas">
                {l.lineas.map((x) => (
                  <div>
                    <div style="display:flex;justify-content:space-between;font-size:12px;gap:8px">
                      <span><b>{x.nombre}</b> <span class="muted">{soles2(x.real)}{x.presupuesto ? ` / ${soles2(x.presupuesto)}` : ""}</span></span>
                      <span class={`t-${ESTADO_SEMAFORO[x.semaforo]}`}><b>{x.pct === null ? "—" : `${x.pct}%`}</b> · {x.presupuesto ? TEXTO_SEMAFORO[x.semaforo] : "SIN PREVISTO"}</span>
                    </div>
                    <Barra pct={x.presupuesto ? (x.real / x.presupuesto) * 100 : 100} estado={ESTADO_SEMAFORO[x.semaforo]} linea100={x.presupuesto ? 90 : undefined} />
                  </div>
                ))}
                <div class="leyenda"><span class="t-ok">VERDE &lt;90%</span><span class="t-proximo">ÁMBAR 90–100%</span><span class="t-cambiar">ROJO &gt;100%</span></div>
              </div>
            )}
          </Panel>
          {edita ? (
            <details class="plegable panel" style="background:var(--white)">
              <summary><span class="lbl-12" style="text-decoration:underline;cursor:pointer">EDITAR EL PRESUPUESTO DE ESTE VIAJE</span></summary>
              <form method="post" action={`/viajes/${l.viaje.id}/presupuesto`} class="filas" style="margin-top:8px">
                <CamposPlantilla valores={new Map(l.lineas.filter((x) => l.presupuestoOrigen.tipo === "viaje" && x.presupuesto > 0).map((x) => [x.categoria, x.presupuesto]))}
                  promedio={new Map(l.lineas.filter((x) => l.presupuestoOrigen.tipo === "promedio").map((x) => [x.categoria, x.presupuesto]))} />
                <button class="btn primario chico" type="submit">GUARDAR PRESUPUESTO</button>
                <span class="muted" style="font-size:11px">Las plantillas por ruta se editan en <a href="/rutas">Rutas</a>.</span>
              </form>
            </details>
          ) : null}
          <Panel titulo={`GASTOS DEL VIAJE · ${l.gastos.length}`}>
            {l.gastos.length === 0 ? <Vacio>Sin gastos.</Vacio> : (
              <div class="tabla-wrap"><table class="t">
                <thead><tr><th>Fecha</th><th>Categoría</th><th>Detalle</th><th class="num">Monto</th><th></th>{edita ? <th></th> : null}</tr></thead>
                <tbody>{l.gastos.map((g) => (
                  <tr>
                    <td class="nowrap">{fechaCorta(g.fecha)}</td><td>{NOMBRE_CATEGORIA[g.categoria]}</td><td>{g.detalle ?? "—"}</td>
                    <td class="num">{soles2(g.monto)}</td><td>{g.conFoto ? <a href={`/archivo/gasto/${g.id}`} title="Ver la boleta">📷</a> : null}</td>
                    {edita ? (
                      <td>
                        <details class="plegable"><summary><span class="btn chico">EDITAR</span></summary>
                          <form method="post" action={`/viajes/${l.viaje.id}/gasto/${g.id}`} class="filas" style="margin-top:6px;min-width:220px">
                            <label class="campo"><span>Categoría</span><select name="categoria">{CATEGORIAS_GASTO.map((k) => <option value={k} selected={k === g.categoria}>{NOMBRE_CATEGORIA[k]}</option>)}</select></label>
                            <label class="campo"><span>Monto S/</span><input name="monto" inputmode="decimal" value={(g.monto / 100).toFixed(2)} /></label>
                            <label class="campo"><span>Fecha</span><input name="fecha" type="date" value={g.fecha} /></label>
                            <button class="btn primario chico" type="submit">GUARDAR</button>
                          </form>
                          <form method="post" action={`/viajes/${l.viaje.id}/gasto/${g.id}/borrar`} data-confirmar="¿Borrar este gasto?"><button class="btn chico fantasma" type="submit">BORRAR</button></form>
                        </details>
                      </td>
                    ) : null}
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </Panel>
        </div>
        <div class="filas" style="gap:10px;min-width:0">
          <Panel titulo="DINERO ENTREGADO AL CHOFER">
            {l.entregas.length === 0 ? <Vacio>Sin entregas. El chofer también puede avisar por Telegram («me yapearon 500»).</Vacio> : (
              <div class="tabla-wrap"><table class="t"><tbody>{l.entregas.map((e) => (
                <tr>
                  <td class="nowrap">{fechaCorta(e.fecha)}</td><td>{MEDIOS_ENTREGA[e.medio]}{e.nota ? <div class="muted" style="font-size:11px">{e.nota}</div> : null}</td>
                  <td class="num">{soles2(e.monto)}</td>
                  <td>{edita ? <form method="post" action={`/viajes/${l.viaje.id}/entrega/${e.id}/borrar`}><button class="btn chico fantasma" type="submit" aria-label="Borrar entrega">×</button></form> : null}</td>
                </tr>
              ))}</tbody></table></div>
            )}
            {edita ? (
              <form method="post" action={`/viajes/${l.viaje.id}/entrega`} class="filas">
                <div class="form-grid">
                  <label class="campo"><span>Monto S/</span><input name="monto" inputmode="decimal" required /></label>
                  <label class="campo"><span>Medio</span><select name="medio">{Object.entries(MEDIOS_ENTREGA).map(([k, v]) => <option value={k}>{v}</option>)}</select></label>
                  <label class="campo"><span>Fecha</span><input name="fecha" type="date" value={hoy(d.ctx)} /></label>
                </div>
                <label class="campo"><span>Nota</span><input name="nota" placeholder="Adelanto de salida" /></label>
                <button class="btn primario" type="submit">+ ANOTAR ENTREGA</button>
              </form>
            ) : null}
          </Panel>
          <Panel titulo="GUÍAS DEL VIAJE (IDA Y RETORNO)">
            {l.guias.length === 0 ? <Vacio>Sin guías enlazadas. Las que se emiten con el viaje en curso se enlazan solas.</Vacio> : (
              <div class="tabla-wrap"><table class="t"><tbody>{l.guias.map((g) => (
                <tr>
                  <td><b>{g.serieNumero}</b> <span class="chip neutro">{(g.tramo ?? "—").toUpperCase()}</span></td>
                  <td class="num">{g.flete === null ? <span class="muted">sin factura</span> : soles2(g.flete)}</td>
                  <td>{edita ? <form method="post" action={`/viajes/${l.viaje.id}/guia/${g.id}/quitar`}><button class="btn chico fantasma" type="submit" aria-label="Quitar guía del viaje">×</button></form> : null}</td>
                </tr>
              ))}</tbody></table></div>
            )}
            {edita && sinViaje.length ? (
              <form method="post" action={`/viajes/${l.viaje.id}/guia`} class="linea">
                <select name="guiaId" aria-label="Guía" style="flex:2">{sinViaje.map((g) => <option value={g.id}>{g.serieNumero} · {fechaCorta(g.fechaTraslado)}</option>)}</select>
                <select name="tramo" aria-label="Tramo" style="flex:1"><option value="ida">Ida</option><option value="retorno">Retorno</option></select>
                <button class="btn chico" type="submit">ENLAZAR</button>
              </form>
            ) : null}
          </Panel>
          {edita ? (
            l.viaje.estado === "en_curso" ? (
              <Panel titulo="CERRAR ESTE VIAJE">
                <form method="post" action={`/viajes/${l.viaje.id}/cerrar`} class="filas">
                  <div class="form-grid">
                    <label class="campo"><span>Odómetro final (km)</span><input name="odometro" inputmode="numeric" /></label>
                    <label class="campo"><span>o km recorridos</span><input name="km" inputmode="numeric" /></label>
                    <label class="campo"><span>Flete S/ (sin IGV)</span><input name="flete" inputmode="decimal" /></label>
                  </div>
                  <button class="btn primario" type="submit">CERRAR VIAJE</button>
                </form>
              </Panel>
            ) : (
              <form method="post" action={`/viajes/${l.viaje.id}/reabrir`}><button class="btn" type="submit" style="width:100%">REABRIR VIAJE</button></form>
            )
          ) : null}
          <section class="panel oscuro" style="gap:4px">
            <span class="lbl" style="color:var(--dark-muted)">RESULTADO</span>
            <b style="font-size:15px">{textoSaldo(l)}</b>
            <span style="font-size:12px">Entregado {soles2(l.entregado)} − gastado {soles2(l.gastado)}. El chofer lo ve en Telegram con /saldo.</span>
          </section>
        </div>
      </div>
    </>
  ));
}

export function rutasLiquidacion(app: App, d: Deps): void {
  app.get("/viajes/:id{[0-9]+}", (c) => vista(c, d));
  const conId = (c: C) => Number(c.req.param("id"));
  app.post("/viajes/:id{[0-9]+}/gasto/:g{[0-9]+}", async (c) => {
    const f = await formulario(c);
    return accion(c, `/viajes/${conId(c)}`, async () => {
      const monto = f.monto ? parsearMonto(f.monto) : undefined;
      if (monto === null) throw new ErrorNegocio("Monto no válido");
      await editarGasto(d.ctx, Number(c.req.param("g")), { categoria: f.categoria as CategoriaGasto, monto, fecha: f.fecha || undefined }, c.get("usuario").id);
      return "Gasto corregido";
    });
  });
  app.post("/viajes/:id{[0-9]+}/gasto/:g{[0-9]+}/borrar", async (c) => accion(c, `/viajes/${conId(c)}`, async () => {
    await borrarGasto(d.ctx, Number(c.req.param("g")), c.get("usuario").id);
    return "Gasto borrado";
  }));
  app.post("/viajes/:id{[0-9]+}/guia", async (c) => {
    const f = await formulario(c);
    return accion(c, `/viajes/${conId(c)}`, async () => {
      await enlazarGuia(d.ctx, Number(f.guiaId), conId(c), f.tramo === "retorno" ? "retorno" : "ida", c.get("usuario").id);
      return "Guía enlazada";
    });
  });
  app.post("/viajes/:id{[0-9]+}/guia/:g{[0-9]+}/quitar", async (c) => accion(c, `/viajes/${conId(c)}`, async () => {
    await desenlazarGuia(d.ctx, Number(c.req.param("g")), c.get("usuario").id);
    return "Guía quitada del viaje";
  }));
  app.post("/viajes/:id{[0-9]+}/cerrar", async (c) => {
    const f = await formulario(c);
    return accion(c, `/viajes/${conId(c)}`, async () => {
      const flete = f.flete ? parsearMonto(f.flete) : undefined;
      if (flete === null) throw new ErrorNegocio("Flete no válido");
      const r = await finalizarViajeFlota(d.ctx, { viajeId: conId(c), odometroFin: enteroONull(f.odometro) ?? undefined, km: enteroONull(f.km) ?? undefined, flete, usuarioId: c.get("usuario").id });
      return `Viaje ${r.codigo} cerrado`;
    });
  });
  app.post("/viajes/:id{[0-9]+}/reabrir", async (c) => accion(c, `/viajes/${conId(c)}`, async () => {
    await reabrirViaje(d.ctx, conId(c), c.get("usuario").id);
    return "Viaje reabierto";
  }));
  app.post("/viajes/:id{[0-9]+}/presupuesto", async (c) => {
    const id = Number(c.req.param("id"));
    const f = await formulario(c);
    return accion(c, `/viajes/${id}`, async () => {
      await actualizarPresupuestoViaje(d.ctx, id, plantillaDeFormulario(f), c.get("usuario").id);
      return "Presupuesto del viaje guardado";
    });
  });
  app.post("/viajes/:id{[0-9]+}/entrega", async (c) => {
    const id = Number(c.req.param("id"));
    const f = await formulario(c);
    return accion(c, `/viajes/${id}`, async () => {
      const monto = parsearMonto(f.monto ?? "");
      if (monto === null) throw new ErrorNegocio("Monto no válido");
      await registrarEntrega(d.ctx, { viajeId: id, monto, medio: (f.medio as "efectivo") ?? "efectivo", fecha: f.fecha || undefined, nota: f.nota || null, usuarioId: c.get("usuario").id });
      return `Entrega de ${soles2(monto)} anotada`;
    });
  });
  app.post("/viajes/:id{[0-9]+}/entrega/:entrega{[0-9]+}/borrar", async (c) => {
    const id = Number(c.req.param("id"));
    return accion(c, `/viajes/${id}`, async () => {
      await borrarEntrega(d.ctx, Number(c.req.param("entrega")), c.get("usuario").id);
      return "Entrega borrada";
    });
  });
}
