/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import {
  editarViajeFlota, emitirFactura, enlazarGuia, ErrorNegocio, finalizarViajeFlota, hoy, listarCobrosPendientes, listarGuias,
  listarUnidades, listarViajesFlota, parsearMonto, prepararFactura, puedeEditar, rangoMes, registrarCobro, registrarViajeFlota,
  sumarDias, formatearSoles, archivosDocumento,
} from "@sunatapp/core";
import { accion, formulario, pagina, servirDeAlmacen, type App, type C, type Deps } from "../base";
import { enteroONull } from "./flota";
import { fechaCorta, Kpi, miles, Origen, Panel, soles, soles2, Vacio } from "../ui";

const CHIP_FACTURA: Record<string, string> = { PAGADA: "ok", PENDIENTE: "proximo", VENCIDA: "cambiar", "SIN FACTURA": "neutro" };
const ESTADO_GUIA: Record<string, string> = { borrador: "neutro", pendiente_envio: "proximo", enviada: "proximo", aceptada: "ok", rechazada: "cambiar" };

function diasEntre(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

async function vista(c: C, d: Deps) {
  const ctx = d.ctx;
  const h = hoy(ctx);
  const mes = c.req.query("mes") ?? h.slice(0, 7);
  const { desde, hasta } = rangoMes(`${mes}-01`);
  const unidadId = c.req.query("unidad") ? Number(c.req.query("unidad")) : undefined;
  const [unidades, viajes, cobros, guias, enCurso] = await Promise.all([
    listarUnidades(ctx),
    listarViajesFlota(ctx, { desde, hasta, vehiculoId: unidadId }),
    listarCobrosPendientes(ctx),
    listarGuias(ctx, 15),
    listarViajesFlota(ctx, { desde: sumarDias(h, -120), hasta: h }).then((v) => v.filter((x) => x.estado === "en_curso")),
  ]);
  const conFlete = viajes.filter((v) => v.flete > 0);
  const km = viajes.reduce((s, v) => s + (v.km ?? 0), 0);
  const edita = puedeEditar(c.get("usuario").rol, "viajes");
  const viajesSinGuia = (await listarViajesFlota(ctx, { desde: sumarDias(h, -60), hasta: h })).filter((v) => v.guia === "—" || !v.facturas.length);

  return pagina(c, d, { titulo: "Viajes, guías y facturas", seccion: "viajes" }, (
    <>
      <section class="kpis">
        <Kpi oscuro etiqueta="VIAJES DEL MES" valor={viajes.length} sub={mes} />
        <Kpi etiqueta="KM RECORRIDOS" valor={miles(km)} />
        <Kpi etiqueta="FLETE PROMEDIO" valor={soles(conFlete.length ? conFlete.reduce((s, v) => s + v.flete, 0) / conFlete.length : 0)} />
        <Kpi etiqueta="POR COBRAR" valor={soles(cobros.totalPendiente)} sub={cobros.totalVencido ? `${soles(cobros.totalVencido)} vencido` : undefined} negativo={cobros.totalVencido > 0} />
      </section>

      <div class="grid g-lado">
        <div class="filas" style="gap:10px;min-width:0">
          <Panel titulo="VIAJES · CADA VIAJE SUMA KM Y 1 VIAJE A LAS PARTES DE SU UNIDAD" der={
            <>
              <form method="get" action="/viajes" class="linea">
                <input type="month" name="mes" value={mes} aria-label="Mes" style="width:auto" />
                <select name="unidad" aria-label="Unidad" style="width:auto"><option value="">TODAS</option>{unidades.map((u) => <option value={u.id} selected={u.id === unidadId}>{u.codigo}</option>)}</select>
                <button class="btn chico" type="submit">VER</button>
              </form>
              {edita ? <a class="btn primario chico" href="#nuevo-viaje">+ VIAJE</a> : null}
            </>
          }>
            <div class="tabla-wrap">
              <table class="t">
                <thead><tr><th>Guía</th><th>Unid.</th><th>Ruta</th><th class="num">Km</th><th class="num">Ton</th><th class="num">Flete</th><th class="num">Costo</th><th class="num">Marg.</th><th>Factura</th><th>Origen</th></tr></thead>
                <tbody>
                  {viajes.length === 0 ? <tr><td colspan={10}><Vacio>Sin viajes en {mes}.</Vacio></td></tr> : viajes.map((v) => (
                    <tr>
                      <td class="nowrap"><b>{v.guia}</b><div class="muted" style="font-size:10px">{v.codigo} · {fechaCorta(v.fecha)}</div></td>
                      <td><b>{v.unidad}</b></td>
                      <td>{v.ruta}{v.estado === "en_curso" ? <> <span class="chip ok">EN CURSO</span></> : null}</td>
                      <td class="num">{miles(v.km)}</td>
                      <td class="num">{v.toneladas ?? "—"}</td>
                      <td class="num">{v.flete ? soles(v.flete) : "—"}</td>
                      <td class="num">{soles(v.costo)}</td>
                      <td class={`num ${v.margenPct !== null && v.margenPct < 0 ? "t-cambiar" : ""}`}>{v.margenPct === null ? "—" : `${v.margenPct}%`}</td>
                      <td><span class={`chip ${CHIP_FACTURA[v.factura]}`}>{v.factura}</span>{v.facturas.length ? <div class="muted" style="font-size:10px">{v.facturas.join(", ")}</div> : null}</td>
                      <td><Origen origen={v.origen} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {edita ? (
            <div class="grid g-2">
              <Panel titulo="+ REGISTRAR VIAJE" id="nuevo-viaje">
                <form method="post" action="/viajes" class="filas">
                  <div class="form-grid">
                    <label class="campo"><span>Unidad</span><select name="vehiculoId">{unidades.map((u) => <option value={u.id}>{u.codigo} · {u.placa}</option>)}</select></label>
                    <label class="campo"><span>Fecha</span><input type="date" name="fecha" value={h} /></label>
                    <label class="campo"><span>Origen *</span><input name="origen" required placeholder="Juliaca" /></label>
                    <label class="campo"><span>Destino *</span><input name="destino" required placeholder="Arequipa" /></label>
                    <label class="campo"><span>Km</span><input name="km" inputmode="numeric" placeholder="1290" /></label>
                    <label class="campo"><span>Toneladas</span><input name="toneladas" inputmode="decimal" /></label>
                    <label class="campo"><span>Flete S/ (sin IGV)</span><input name="flete" inputmode="decimal" /></label>
                    <label class="campo"><span>Guía</span><input name="guia" placeholder="T001-0214" /></label>
                  </div>
                  <fieldset class="campo" style="border:0;padding:0;margin:0"><legend class="lbl">ESTADO</legend>
                    <div class="radios">
                      <label><input type="radio" name="estado" value="cerrado" checked /><span>YA SE HIZO (suma los km)</span></label>
                      <label><input type="radio" name="estado" value="en_curso" /><span>SALE AHORA</span></label>
                    </div>
                  </fieldset>
                  <button class="btn primario" type="submit">REGISTRAR VIAJE</button>
                </form>
              </Panel>
              <Panel titulo="CERRAR VIAJE EN CURSO">
                {enCurso.length === 0 ? <Vacio>No hay viajes en curso.</Vacio> : (
                  <form method="post" action="/viajes/fin" class="filas">
                    <label class="campo"><span>Viaje</span><select name="viajeId">{enCurso.map((v) => <option value={v.id}>{v.unidad} · {v.codigo} · {v.ruta}</option>)}</select></label>
                    <div class="form-grid">
                      <label class="campo"><span>Odómetro final (km)</span><input name="odometro" inputmode="numeric" /></label>
                      <label class="campo"><span>o km recorridos</span><input name="km" inputmode="numeric" /></label>
                      <label class="campo"><span>Flete S/</span><input name="flete" inputmode="decimal" /></label>
                    </div>
                    <button class="btn primario" type="submit">CERRAR VIAJE</button>
                  </form>
                )}
                <hr style="border:0;border-top:1px solid var(--divider);width:100%" />
                <b class="lbl-12">CORREGIR FLETE DE UN VIAJE</b>
                <form method="post" action="/viajes/flete" class="linea">
                  <select name="viajeId" aria-label="Viaje" style="flex:2">{viajes.map((v) => <option value={v.id}>{v.codigo} · {v.unidad} · {v.ruta}</option>)}</select>
                  <input name="flete" inputmode="decimal" placeholder="S/" aria-label="Flete" style="flex:1" />
                  <button class="btn chico" type="submit">GUARDAR</button>
                </form>
              </Panel>
            </div>
          ) : null}

          <Panel titulo="GUÍAS DE REMISIÓN · SUNAT" der={<span class="lbl">SE EMITEN DESDE EL BOT: ENVÍALE EL PDF DEL REMITENTE</span>}>
            <div class="tabla-wrap">
              <table class="t">
                <thead><tr><th>Guía</th><th>Traslado</th><th>Remitente</th><th>Destinatario</th><th>Estado</th><th>Archivos</th>{edita ? <th>Acciones</th> : null}</tr></thead>
                <tbody>
                  {guias.length === 0 ? <tr><td colspan={7}><Vacio>Sin guías todavía.</Vacio></td></tr> : guias.map((g) => (
                    <tr>
                      <td class="nowrap"><b>{g.serieNumero}</b></td><td>{fechaCorta(g.fechaTraslado)}</td><td>{g.remitente}</td><td>{g.destinatario}</td>
                      <td><span class={`chip ${ESTADO_GUIA[g.estado]}`}>{g.estado.toUpperCase().replace("_", " ")}</span>{g.facturada ? <span class="chip ok" style="margin-left:4px">FACTURADA</span> : null}</td>
                      <td class="nowrap"><a href={`/guias/${g.id}/pdf`}>PDF</a> · <a href={`/guias/${g.id}/xml`}>XML</a> · <a href={`/guias/${g.id}/cdr`}>CDR</a></td>
                      {edita ? (
                        <td>
                          {g.estado === "aceptada" && !g.facturada ? (
                            <details class="plegable"><summary><span class="btn chico">+ FACTURA</span></summary>
                              <form method="post" action={`/guias/${g.id}/facturar`} class="filas" style="margin-top:6px;min-width:220px">
                                <label class="campo"><span>Monto S/</span><input name="monto" inputmode="decimal" required /></label>
                                <label class="campo"><span>El monto…</span><select name="igv"><option value="sin">no incluye IGV</option><option value="con">ya incluye IGV</option></select></label>
                                <label class="campo"><span>Pago</span><select name="pago"><option value="contado">Contado</option><option value="credito">Crédito</option></select></label>
                                <label class="campo"><span>Días de crédito</span><input name="dias" inputmode="numeric" placeholder="30" /></label>
                                <button class="btn primario chico" type="submit">EMITIR FACTURA</button>
                              </form>
                            </details>
                          ) : null}
                          <details class="plegable"><summary><span class="lbl-12" style="text-decoration:underline;cursor:pointer">enlazar a viaje</span></summary>
                            <form method="post" action={`/guias/${g.id}/enlazar`} class="linea" style="margin-top:6px">
                              <select name="viajeId" aria-label="Viaje">{viajesSinGuia.map((v) => <option value={v.id}>{v.codigo} · {v.unidad} · {v.ruta}</option>)}</select>
                              <select name="tramo" aria-label="Tramo"><option value="ida">ida</option><option value="retorno">retorno</option></select>
                              <button class="btn chico" type="submit">ENLAZAR</button>
                            </form>
                          </details>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        <Panel clase="oscuro" titulo="POR COBRAR · ANTIGÜEDAD">
          {cobros.filas.length === 0 ? <span class="muted">No hay facturas por cobrar. 👌</span> : (
            <div class="filas">
              {[...cobros.filas].sort((a, b) => a.fechaVencimiento.localeCompare(b.fechaVencimiento)).map((f) => {
                const dias = diasEntre(f.fechaVencimiento, h);
                return (
                  <div style="border-bottom:1px solid #243034;padding-bottom:8px">
                    <div style="display:flex;justify-content:space-between;gap:6px"><b>{f.serieNumero}</b><b style="color:var(--accent-on-dark)">{soles2(f.saldo)}</b></div>
                    <div style="display:flex;justify-content:space-between;gap:6px;font-size:11px"><span class="muted">{f.cliente}</span>
                      <span style={dias > 0 ? "color:var(--accent-on-dark-2)" : dias === 0 ? "color:var(--amber-dark)" : "color:var(--ok-dark)"}>{dias > 0 ? `${dias} DÍAS VENCIDA` : dias === 0 ? "VENCE HOY" : `VENCE EN ${-dias} DÍAS`}</span>
                    </div>
                    {edita ? (
                      <details class="plegable"><summary><span class="lbl" style="text-decoration:underline;cursor:pointer;color:var(--dark-text)">registrar cobro</span></summary>
                        <form method="post" action={`/cobros/${f.facturaId}`} class="linea" style="margin-top:6px">
                          <input name="monto" inputmode="decimal" placeholder={String(f.saldo / 100)} aria-label="Monto cobrado" style="flex:1" />
                          <select name="medio" aria-label="Medio" style="flex:1"><option value="transferencia">Transferencia</option><option value="efectivo">Efectivo</option><option value="otro">Otro</option></select>
                          <button class="btn chico" type="submit">OK</button>
                        </form>
                      </details>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
          {edita && cobros.filas.length ? (
            <form method="post" action="/cobros/recordar"><button class="btn primario" type="submit" style="width:100%">RECORDAR COBRO POR TELEGRAM</button></form>
          ) : null}
        </Panel>
      </div>
    </>
  ));
}

export function rutasViajes(app: App, d: Deps): void {
  app.get("/viajes", (c) => vista(c, d));
  app.post("/viajes", async (c) => {
    const f = await formulario(c);
    return accion(c, "/viajes", async () => {
      const flete = f.flete ? parsearMonto(f.flete) : null;
      if (f.flete && flete === null) throw new ErrorNegocio("Flete no válido");
      const ton = f.toneladas ? Number(f.toneladas.replace(",", ".")) : null;
      if (ton !== null && !Number.isFinite(ton)) throw new ErrorNegocio("Toneladas no válidas");
      const r = await registrarViajeFlota(d.ctx, {
        vehiculoId: Number(f.vehiculoId), origenLugar: f.origen ?? "", destinoLugar: f.destino ?? "", km: enteroONull(f.km), toneladas: ton,
        flete, guiaRef: f.guia || null, fecha: f.fecha || undefined, estado: f.estado === "en_curso" ? "en_curso" : "cerrado",
        origen: "web", usuarioId: c.get("usuario").id,
      });
      return `Viaje ${r.codigo} registrado`;
    });
  });
  app.post("/viajes/fin", async (c) => {
    const f = await formulario(c);
    return accion(c, "/viajes", async () => {
      const flete = f.flete ? parsearMonto(f.flete) : undefined;
      if (flete === null) throw new ErrorNegocio("Flete no válido");
      const r = await finalizarViajeFlota(d.ctx, {
        viajeId: Number(f.viajeId), odometroFin: enteroONull(f.odometro) ?? undefined, km: enteroONull(f.km) ?? undefined, flete, usuarioId: c.get("usuario").id,
      });
      return `Viaje ${r.codigo} cerrado${r.km ? ` · ${r.km.toLocaleString("en-US")} km sumados a las partes` : ""}`;
    });
  });
  app.post("/viajes/flete", async (c) => {
    const f = await formulario(c);
    return accion(c, "/viajes", async () => {
      const flete = f.flete ? parsearMonto(f.flete) : null;
      await editarViajeFlota(d.ctx, Number(f.viajeId), { flete }, c.get("usuario").id);
      return "Flete actualizado";
    });
  });
  app.post("/guias/:id/facturar", async (c) => {
    const f = await formulario(c);
    return accion(c, "/viajes", async () => {
      const monto = parsearMonto(f.monto ?? "");
      if (monto === null) throw new ErrorNegocio("Monto no válido");
      const credito = f.pago === "credito";
      const { facturaId } = await prepararFactura(d.ctx, {
        guiaId: Number(c.req.param("id")), montoCentimos: monto, incluyeIgv: f.igv === "con", formaPago: credito ? "credito" : "contado",
        diasCredito: credito ? (enteroONull(f.dias) ?? 30) : undefined,
      }, c.get("usuario").id);
      const r = await emitirFactura(d.ctx, facturaId);
      return `Factura ${r.serieNumero}: ${r.estado}${r.mensaje ? ` · ${r.mensaje}` : ""}`;
    });
  });
  app.post("/guias/:id/enlazar", async (c) => {
    const f = await formulario(c);
    return accion(c, "/viajes", async () => {
      await enlazarGuia(d.ctx, Number(c.req.param("id")), Number(f.viajeId), f.tramo === "retorno" ? "retorno" : "ida", c.get("usuario").id);
      return "Guía enlazada al viaje";
    });
  });
  app.post("/cobros/recordar", async (c) => accion(c, "/viajes", async () => {
    const { filas, totalPendiente } = await listarCobrosPendientes(d.ctx);
    if (!filas.length) return "No hay cobros pendientes";
    const h = hoy(d.ctx);
    const lineas = filas.map((f) => `• ${f.serieNumero} · ${f.cliente} · ${formatearSoles(f.saldo)} · ${f.fechaVencimiento < h ? `vencida ${diasEntre(f.fechaVencimiento, h)} d` : `vence ${f.fechaVencimiento}`}`);
    await d.avisar(`💰 COBROS PENDIENTES · ${formatearSoles(totalPendiente)}\n${lineas.join("\n")}`);
    return "Recordatorio enviado al grupo de Telegram";
  }));
  app.post("/cobros/:id", async (c) => {
    const f = await formulario(c);
    return accion(c, "/viajes", async () => {
      const monto = parsearMonto(f.monto ?? "");
      if (monto === null) throw new ErrorNegocio("Monto no válido");
      const r = await registrarCobro(d.ctx, { facturaId: Number(c.req.param("id")), montoCentimos: monto, fecha: hoy(d.ctx), medio: (f.medio as "efectivo") ?? "transferencia", usuarioId: c.get("usuario").id });
      return r.estadoCobro === "pagada" ? "Factura pagada por completo" : `Cobro registrado · saldo ${soles2(r.saldo)}`;
    });
  });
  for (const tipo of ["guia", "factura"] as const) {
    app.get(`/${tipo}s/:id/:archivo`, async (c) => {
      const a = await archivosDocumento(d.ctx, tipo, Number(c.req.param("id")));
      const k = c.req.param("archivo") as "pdf" | "xml" | "cdr";
      return servirDeAlmacen(c, d, a && k in a ? a[k] : null, k !== "pdf");
    });
  }
}
