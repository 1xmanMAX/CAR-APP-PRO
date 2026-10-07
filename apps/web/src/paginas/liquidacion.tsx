/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import type { FC } from "hono/jsx";
import {
  actualizarPresupuestoViaje, AVISO_RETORNO_VACIO, borrarEntrega, borrarGasto, choferDeViaje, desenlazarGuia, editarGasto, enlazarGuia, ErrorNegocio,
  finalizarViajeFlota, hoy, listarCategorias, listarCobrosPendientes, listarGuiasSinViaje, listarViajesFlota, liquidacionViaje, MEDIOS_ENTREGA, nombreCategoria,
  parsearMonto, puedeEditar, reabrirViaje, rentabilidadDeViaje, type Categoria, type LiquidacionViaje, type Semaforo,
} from "@sunatapp/core";
import { accion, formulario, pagina, type App, type C, type Deps } from "../base";
import { guardarEntrega } from "../acciones";
import { Barra, Cabecera, CHIP_FACTURA, Cifra, diasEntre, ESTADO_GUIA, fechaCorta, soles, soles2, Vacio } from "../ui";
import { enteroONull } from "./flota";
import { CamposPlantilla, categoriasDeViaje, plantillaDeFormulario } from "./rutas";
import { avisosRetornoVacio, FormFacturar } from "./viajes";

const ESTADO_SEMAFORO: Record<Semaforo, "ok" | "proximo" | "cambiar"> = { ok: "ok", alerta: "proximo", excedido: "cambiar" };

function textoSaldo(l: LiquidacionViaje): string {
  if (l.saldo > 0) return `El chofer tiene ${soles2(l.saldo)} por rendir o devolver`;
  if (l.saldo < 0) return `La empresa le debe ${soles2(-l.saldo)} al chofer`;
  return "Cuentas en cero";
}

const TablaGastos: FC<{ l: LiquidacionViaje; categorias: Categoria[]; edita: boolean }> = ({ l, categorias, edita }) => (
  <div class="tabla-wrap"><table class="t">
    <thead><tr><th>Fecha</th><th>En qué</th><th>Detalle</th><th class="num">Monto</th><th></th>{edita ? <th></th> : null}</tr></thead>
    <tbody>{l.gastos.map((g) => (
      <tr>
        <td class="nowrap">{fechaCorta(g.fecha)}</td><td>{nombreCategoria(g.categoria, categorias)}</td><td>{g.detalle ?? "—"}</td>
        <td class="num">{soles2(g.monto)}</td><td>{g.conFoto ? <a href={`/archivo/gasto/${g.id}`} title="Ver la boleta">📷</a> : null}</td>
        {edita ? (
          <td>
            <details class="plegable"><summary class="btn chico">Corregir</summary>
              <form method="post" action={`/viajes/${l.viaje.id}/gasto/${g.id}`} class="filas sub-form">
                <label class="campo"><span>En qué</span><select name="categoria">{categorias.map((k) => <option value={k.clave} selected={k.clave === g.categoria}>{k.nombre}</option>)}</select></label>
                <label class="campo"><span>Monto S/</span><input name="monto" inputmode="decimal" value={(g.monto / 100).toFixed(2)} /></label>
                <label class="campo"><span>Fecha</span><input name="fecha" type="date" value={g.fecha} /></label>
                <button class="btn primario chico" type="submit">Guardar</button>
              </form>
              <form method="post" action={`/viajes/${l.viaje.id}/gasto/${g.id}/borrar`} data-confirmar="¿Borrar este gasto?"><button class="btn chico fantasma" type="submit">Borrar</button></form>
            </details>
          </td>
        ) : null}
      </tr>
    ))}</tbody>
  </table></div>
);

/**
 * **Un viaje**: lo que deja, la plata del chofer, los gastos contra el presupuesto, los papeles
 * (guía, factura, cobro) y el cierre. Lo avanzado (presupuesto, enlazar guía, flete, reabrir) va en «Ver más».
 */
async function vista(c: C, d: Deps) {
  const ctx = d.ctx;
  const id = Number(c.req.param("id"));
  const l = await liquidacionViaje(ctx, id);
  const [categorias, variables, sinViaje, rent, chofer, cobros, propios, retornoVacio] = await Promise.all([
    listarCategorias(ctx, { soloActivas: true }), categoriasDeViaje(d), listarGuiasSinViaje(ctx), rentabilidadDeViaje(ctx, id), choferDeViaje(ctx, id),
    listarCobrosPendientes(ctx), listarViajesFlota(ctx, { vehiculoId: l.viaje.vehiculoId, limite: 500 }), avisosRetornoVacio(ctx, l.guias.filter((g) => g.flete === null)),
  ]);
  const fila = propios.find((v) => v.id === id);
  const edita = puedeEditar(c.get("usuario").rol, "viajes");
  const enCurso = l.viaje.estado === "en_curso";
  const aqui = `/viajes/${id}`;
  // Lo mismo que «Dejó» en la lista: flete − gastos del viaje. Los fijos del mes van en «Ver más».
  const deja = l.ganancia;
  const margen = l.margenPct;
  const porCobrar = cobros.filas.filter((f) => fila?.facturas.includes(f.serieNumero));
  const top = [...l.lineas].sort((a, b) => b.real - a.real).slice(0, 3);
  const maxLinea = Math.max(1, ...top.map((x) => Math.max(x.real, x.presupuesto)));
  const porFacturar = l.guias.filter((g) => g.estado === "aceptada" && g.flete === null);
  const origen = l.presupuestoOrigen.tipo === "viaje" ? "presupuesto del viaje"
    : l.presupuestoOrigen.tipo === "promedio" ? `promedio de los últimos ${l.presupuestoOrigen.viajes} viajes de esta ruta` : "sin presupuesto";
  return pagina(c, d, { titulo: `Viaje ${l.viaje.codigo}`, seccion: "viajes" }, (
    <>
      <Cabecera volver="/viajes" titulo={l.viaje.ruta}
        sub={`${l.viaje.unidad} · ${chofer} · ${enCurso ? `en ruta, día ${diasEntre(l.viaje.fechaSalida, hoy(ctx)) + 1}` : `cerrado el ${fechaCorta(l.viaje.fechaRegreso)}`} · ${l.viaje.codigo}`} />
      <div class="viaje-cols">
        <div class="col">
          <section class="tarjeta-oscura">
            <span class="lbl">Este viaje te deja{enCurso ? " (por ahora)" : ""}</span>
            <b class={`cifra-grande${deja !== null && deja < 0 ? " neg" : ""}`}>{deja === null ? "Falta el flete" : soles(deja)}</b>
            <span class="sub">Flete {soles(l.flete)} − gastos {soles(l.gastado)}{margen !== null ? ` · margen ${margen}%` : ""}</span>
          </section>
          <div class="dos-cifras">
            <Cifra etiqueta={`Le diste a ${chofer}`} valor={soles(l.entregado)} />
            <Cifra etiqueta={l.saldo >= 0 ? "Le queda" : "Le debes"} valor={soles(Math.abs(l.saldo))} tono={l.saldo < 0 ? "cambiar" : "ok"} />
          </div>
          <p class="muted nota-saldo">{textoSaldo(l)}.</p>
          <section class="col">
            <h2 class="titulo-seccion">Gastos del viaje · {soles2(l.gastado)}{l.presupuestoTotal ? ` de ${soles2(l.presupuestoTotal)} previstos` : ""}</h2>
            <div class="lista-filas">
              {top.length === 0 ? <Vacio>Todavía no hay gastos. El chofer los manda por Telegram (foto de la boleta o «grifo 350»).</Vacio> : top.map((x) => (
                <div class="fila-barra">
                  <div class="fila-sep"><span>{x.nombre}</span><b>{soles(x.real)}{x.presupuesto ? <span class="muted"> / {soles(x.presupuesto)}</span> : null}</b></div>
                  <Barra pct={(x.real / maxLinea) * 100} estado={ESTADO_SEMAFORO[x.semaforo]} linea100={x.presupuesto ? (x.presupuesto / maxLinea) * 100 : undefined} />
                </div>
              ))}
            </div>
            {l.gastos.length ? (
              <details class="plegable"><summary class="ver-mas">Ver los {l.gastos.length} gastos</summary><TablaGastos l={l} categorias={categorias} edita={edita} /></details>
            ) : null}
          </section>
        </div>
        <div class="col">
          <section class="col">
            <h2 class="titulo-seccion">Papeles y cobro</h2>
            <div class="lista-filas">
              {l.guias.length === 0 ? (
                <div class="fila-papel"><span class="chip proximo">FALTA</span><span>Guía de remisión <span class="muted">· la emite el bot con el PDF del remitente</span></span></div>
              ) : l.guias.map((g) => (
                <div class="fila-papel">
                  <span class={`chip ${ESTADO_GUIA[g.estado] ?? "neutro"}`}>{g.estado === "aceptada" ? "SUNAT OK" : g.estado.toUpperCase().replace("_", " ")}</span>
                  <span>Guía {g.serieNumero}{g.tramo ? ` · ${g.tramo}` : ""}</span>
                  <a class="btn chico" href={`/guias/${g.id}/pdf`}>PDF</a>
                </div>
              ))}
              <div class="fila-papel">
                {fila?.facturas.length ? <span class={`chip ${CHIP_FACTURA[fila.factura] ?? "neutro"}`}>{fila.factura}</span> : <span class="chip proximo">FALTA</span>}
                <span>Factura{fila?.facturas.length ? ` ${fila.facturas.join(", ")}` : ""}</span>
                {edita ? porFacturar.map((g) => (
                  <FormFacturar guiaId={g.id} etiqueta={porFacturar.length > 1 ? `Facturar ${g.serieNumero}` : "Facturar"} volver={aqui} aviso={retornoVacio.has(g.id) ? AVISO_RETORNO_VACIO : null} />
                )) : null}
              </div>
              {porCobrar.map((f) => (
                <div class="fila-papel">
                  <span class={`chip ${f.estado === "vencida" ? "cambiar" : "proximo"}`}>{f.estado === "vencida" ? "VENCIDA" : "DESPUÉS"}</span>
                  <span>Cobro a {f.cliente} · {soles2(f.saldo)}</span>
                  {edita ? <a class="btn chico" href={`/anotar?tipo=cobro&facturaId=${f.facturaId}&volver=${encodeURIComponent(aqui)}`} data-abrir-panel="">Me pagaron</a> : null}
                </div>
              ))}
            </div>
          </section>
          {edita ? (
            <div class={`acciones-viaje${enCurso ? "" : " una"}`}>
              <a class="btn grande" href={`/anotar?tipo=gaste&viajeId=${id}&volver=${encodeURIComponent(aqui)}`} data-abrir-panel="">+ Anotar</a>
              {enCurso ? (
                <details class="plegable" id="cerrar">
                  <summary class="btn primario grande">Cerrar viaje</summary>
                  <form method="post" action={`${aqui}/cerrar`} class="filas sub-form">
                    {fila?.km ? null : <label class="campo"><span>Km recorridos</span><input name="km" inputmode="numeric" placeholder="380" /></label>}
                    {l.flete > 0 ? null : <label class="campo"><span>Flete S/ (sin IGV)</span><input name="flete" inputmode="decimal" /></label>}
                    {fila?.km && l.flete > 0 ? <p class="muted">Ya tiene km y flete: solo confirma.</p> : null}
                    {fila?.km ? null : (
                      <details class="plegable"><summary class="ver-mas">¿Tienes el odómetro al llegar?</summary>
                        <label class="campo"><span>Odómetro final (km)</span><input name="odometro" inputmode="numeric" /></label>
                      </details>
                    )}
                    <button class="btn primario" type="submit">Cerrar el viaje</button>
                  </form>
                </details>
              ) : null}
            </div>
          ) : null}
          <details class="plegable panel">
            <summary class="ver-mas">Ver más</summary>
            <div class="filas">
              {rent ? (
                <div class="tres-cifras">
                  <Cifra etiqueta="Flete − del viaje" valor={soles2(rent.contribucion)} />
                  <Cifra etiqueta="Fijo asignado" valor={soles2(rent.fijoAsignado)} sub={rent.provisional ? "cambia hasta fin de mes" : "del mes de cierre"} />
                  <Cifra etiqueta="Después de los fijos" valor={soles2(rent.ganancia)} tono={rent.ganancia < 0 ? "cambiar" : undefined} />
                </div>
              ) : null}
              <h3 class="titulo-seccion">Plata que le diste a {chofer}</h3>
              {l.entregas.length === 0 ? <Vacio>Sin entregas. También puede avisar por Telegram («me yapearon 500»).</Vacio> : (
                <div class="tabla-wrap"><table class="t"><tbody>{l.entregas.map((e) => (
                  <tr>
                    <td class="nowrap">{fechaCorta(e.fecha)}</td><td>{MEDIOS_ENTREGA[e.medio]}{e.nota ? <div class="muted">{e.nota}</div> : null}</td>
                    <td class="num">{soles2(e.monto)}</td>
                    <td>{edita ? <form method="post" action={`${aqui}/entrega/${e.id}/borrar`}><button class="btn chico fantasma" type="submit" aria-label="Borrar entrega">×</button></form> : null}</td>
                  </tr>
                ))}</tbody></table></div>
              )}
              {edita ? (
                <>
                  <details class="plegable"><summary class="ver-mas">Presupuesto del viaje <span class="muted">({origen})</span></summary>
                    <form method="post" action={`${aqui}/presupuesto`} class="filas sub-form">
                      <CamposPlantilla categorias={variables} valores={new Map(l.lineas.filter((x) => l.presupuestoOrigen.tipo === "viaje" && x.presupuesto > 0).map((x) => [x.categoria, x.presupuesto]))}
                        promedio={new Map(l.lineas.filter(() => l.presupuestoOrigen.tipo === "promedio").map((x) => [x.categoria, x.presupuesto]))} />
                      <button class="btn primario chico" type="submit">Guardar presupuesto</button>
                    </form>
                  </details>
                  {sinViaje.length ? (
                    <form method="post" action={`${aqui}/guia`} class="linea">
                      <select name="guiaId" aria-label="Guía">{sinViaje.map((g) => <option value={g.id}>{g.serieNumero} · {fechaCorta(g.fechaTraslado)}</option>)}</select>
                      <select name="tramo" aria-label="Tramo"><option value="ida">Ida</option><option value="retorno">Retorno</option></select>
                      <button class="btn chico" type="submit">Enlazar guía</button>
                    </form>
                  ) : null}
                  {l.guias.map((g) => (
                    <form method="post" action={`${aqui}/guia/${g.id}/quitar`} class="linea"><span>Guía {g.serieNumero}</span><button class="btn chico fantasma" type="submit">Quitar del viaje</button></form>
                  ))}
                  <form method="post" action="/viajes/flete" class="linea">
                    <input type="hidden" name="viajeId" value={id} /><input type="hidden" name="volver" value={aqui} />
                    <input name="flete" inputmode="decimal" placeholder={l.flete ? (l.flete / 100).toFixed(2) : "S/"} aria-label="Flete" />
                    <button class="btn chico" type="submit">Corregir flete</button>
                  </form>
                  {enCurso ? null : <form method="post" action={`${aqui}/reabrir`}><button class="btn" type="submit">Reabrir viaje</button></form>}
                </>
              ) : null}
            </div>
          </details>
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
      await editarGasto(d.ctx, Number(c.req.param("g")), { categoria: f.categoria, monto, fecha: f.fecha || undefined }, c.get("usuario").id);
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
      await actualizarPresupuestoViaje(d.ctx, id, plantillaDeFormulario(f, await categoriasDeViaje(d)), c.get("usuario").id);
      return "Presupuesto del viaje guardado";
    });
  });
  app.post("/viajes/:id{[0-9]+}/entrega", async (c) => {
    const id = Number(c.req.param("id"));
    const f = await formulario(c);
    return accion(c, `/viajes/${id}`, () => guardarEntrega(d, c.get("usuario").id, id, f));
  });
  app.post("/viajes/:id{[0-9]+}/entrega/:entrega{[0-9]+}/borrar", async (c) => {
    const id = Number(c.req.param("id"));
    return accion(c, `/viajes/${id}`, async () => {
      await borrarEntrega(d.ctx, Number(c.req.param("entrega")), c.get("usuario").id);
      return "Entrega borrada";
    });
  });
}
