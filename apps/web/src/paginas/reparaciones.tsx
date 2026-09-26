/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import {
  ErrorNegocio, etiquetaCambio, GRUPOS_PIEZA, hoy, pieza, PIEZAS, listarReparaciones, listarRepuestos, listarUnidades, parsearMonto, partesConDesgaste,
  registrarCambio, TIPOS_REPARACION, type GrupoPieza, type TipoReparacion,
} from "@sunatapp/core";
import { accion, formulario, pagina, type App, type C, type Deps } from "../base";
import { enteroONull } from "./flota";
import { Barra, Datos, fechaMedia, miles, Origen, Panel, soles, soles2, Vacio } from "../ui";

async function vista(c: C, d: Deps) {
  const ctx = d.ctx;
  const unidades = await listarUnidades(ctx);
  const unidadSel = Number(c.req.query("unidad")) || unidades[0]?.id;
  const parteSel = Number(c.req.query("parte")) || undefined;
  const piezaSel = pieza(c.req.query("pieza"))?.id;
  const filtroHist = c.req.query("h") ? Number(c.req.query("h")) : undefined;
  const [partes, repuestos, historial] = await Promise.all([
    partesConDesgaste(ctx, unidades.map((u) => u.id)),
    listarRepuestos(ctx),
    listarReparaciones(ctx, { vehiculoId: filtroHist, limite: 60 }),
  ]);
  const aTiempo = historial.filter((h) => h.desgastePct !== null).slice(0, 12);
  const disponibles = repuestos.filter((r) => r.stock > 0);

  return pagina(c, d, { titulo: "Reparaciones", seccion: "reparaciones", scripts: ["/static/reparaciones.js"] }, (
    <>
      <Datos id="datos-rep" valor={{
        partes: partes.map((p) => ({ id: p.id, vehiculoId: p.vehiculoId, nombre: `${p.nombre} · ${p.pct}%`, tipoParteId: p.tipoParteId })),
        repuestos: disponibles.map((r) => ({ id: r.id, codigo: r.codigo, nombre: r.nombre, costo: r.costoUnitario, stock: r.stock, tipoParteId: r.tipoParteId })),
        odometros: Object.fromEntries(unidades.map((u) => [u.id, u.odometroKm])),
      }} />
      <div class="grid g-2">
        <Panel titulo="REGISTRAR CAMBIO · REINICIA EL CONTADOR DE LA PARTE" id="registrar" der={<span class="lbl">TAMBIÉN DESDE TELEGRAM CON /cambio</span>}>
          {unidades.length === 0 ? <Vacio>Agrega unidades en Flota.</Vacio> : (
            <form method="post" action="/reparaciones" class="filas" id="form-cambio">
              <div class="form-grid">
                <label class="campo"><span>Trailer</span>
                  <select name="vehiculoId" id="sel-unidad">{unidades.map((u) => <option value={u.id} selected={u.id === unidadSel}>{u.codigo} · {u.placa}</option>)}</select>
                </label>
                <label class="campo"><span>Parte del modelo</span>
                  <select name="parteId" id="sel-parte">
                    <option value="">— reparación general (sin parte) —</option>
                    {partes.filter((p) => p.vehiculoId === unidadSel).map((p) => <option value={p.id} selected={p.id === parteSel}>{p.nombre} · {p.pct}%</option>)}
                  </select>
                </label>
                <label class="campo"><span>Pieza exacta (modelo 3D, opcional)</span>
                  <select name="componente">
                    <option value="">— sin pieza —</option>
                    {(Object.keys(GRUPOS_PIEZA) as GrupoPieza[]).map((g) => (
                      <optgroup label={GRUPOS_PIEZA[g]}>{PIEZAS.filter((p) => p.grupo === g).map((p) => <option value={p.id} selected={p.id === piezaSel}>{p.nombre}</option>)}</optgroup>
                    ))}
                  </select>
                </label>
                <label class="campo"><span>Odómetro actual (km)</span><input name="odometro" id="odometro" inputmode="numeric" placeholder={String(unidades.find((u) => u.id === unidadSel)?.odometroKm ?? "")} /></label>
                <label class="campo"><span>Fecha</span><input name="fecha" type="date" value={hoy(ctx)} /></label>
              </div>
              <fieldset class="campo" style="border:0;padding:0;margin:0">
                <legend class="lbl" style="margin-bottom:4px">TIPO</legend>
                <div class="radios">
                  {(Object.keys(TIPOS_REPARACION) as TipoReparacion[]).map((t, i) => (
                    <label><input type="radio" name="tipo" value={t} checked={i === 0} /><span>{TIPOS_REPARACION[t]}</span></label>
                  ))}
                </div>
              </fieldset>
              <div>
                <span class="lbl">REPUESTOS USADOS · SALEN DEL INVENTARIO</span>
                <div class="tabla-wrap" style="margin-top:4px">
                  <table class="t" id="tabla-repuestos">
                    <thead><tr><th>Repuesto</th><th class="num">Cant.</th><th class="num">Subtotal</th><th></th></tr></thead>
                    <tbody>
                      <tr class="fila-rep">
                        <td><select name="repuestoId" class="sel-rep"><option value="">— ninguno —</option>{disponibles.map((r) => <option value={r.id}>{r.codigo} · {r.nombre} (stock {r.stock})</option>)}</select></td>
                        <td class="num" style="width:90px"><input name="cantidad" inputmode="numeric" value="1" class="cant" /></td>
                        <td class="num subtotal">—</td>
                        <td><button type="button" class="btn chico quitar" aria-label="Quitar repuesto">×</button></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <button type="button" class="btn chico fantasma" id="agregar-rep" style="margin-top:6px">+ AGREGAR REPUESTO</button>
                {disponibles.length === 0 ? <span class="muted" style="font-size:11px"> No hay repuestos con stock. <a href="/inventario">Registra una compra</a>.</span> : null}
              </div>
              <div class="form-grid">
                <label class="campo"><span>Mano de obra S/</span><input name="manoObra" id="mano-obra" inputmode="decimal" placeholder="0.00" /></label>
                <label class="campo"><span>Taller / mecánico</span><input name="taller" /></label>
              </div>
              <label class="campo"><span>Trabajo (opcional)</span><input name="trabajo" placeholder="Se completa con el nombre de la parte" /></label>
              <div class="caja-oscura">
                <span class="lbl">AL GUARDAR</span>
                <span style="font-size:12px">01 el contador de la parte vuelve a 0 km · 0 viajes · 0 días</span>
                <span style="font-size:12px">02 el stock se descuenta del inventario</span>
                <span style="font-size:12px">03 el costo <b style="font-size:14px;color:var(--accent-on-dark)" id="costo-total">S/ 0.00</b> entra como gasto de la unidad</span>
                <span style="font-size:12px">04 aviso al grupo de Telegram</span>
              </div>
              <button class="btn primario" type="submit">GUARDAR CAMBIO</button>
            </form>
          )}
        </Panel>

        <Panel titulo="¿SE CAMBIÓ A TIEMPO? · DESGASTE AL MOMENTO DEL CAMBIO" der={<span class="lbl">META: CAMBIAR ENTRE 80% Y 95%</span>}>
          {aTiempo.length === 0 ? <Vacio>Aquí aparecerá cada cambio de parte con el % que tenía al cambiarse.</Vacio> : (
            <div class="filas">
              {aTiempo.map((t) => {
                const e = etiquetaCambio(t.desgastePct!);
                const clase = e === "A TIEMPO" ? "ok" : e === "TARDE" ? "cambiar" : "proximo";
                return (
                  <div>
                    <div style="display:flex;justify-content:space-between;font-size:12px;gap:8px">
                      <span><b>{t.unidad}</b> · {t.parte ?? t.trabajo} <span class="muted">· {fechaMedia(t.fecha)}</span></span>
                      <span class={`t-${clase}`}><b>{t.desgastePct}%</b> · {e}</span>
                    </div>
                    <Barra pct={Math.min(100, t.desgastePct!)} estado={clase as "ok"} meta={[80, 95]} />
                  </div>
                );
              })}
              <div class="leyenda"><span>FRANJA = META 80–95%</span><span class="t-proximo">MUY PRONTO &lt;80</span><span class="t-ok">A TIEMPO 80–100</span><span class="t-cambiar">TARDE &gt;100</span></div>
            </div>
          )}
        </Panel>
      </div>

      <Panel titulo="HISTORIAL" der={
        <form method="get" action="/reparaciones" class="linea">
          <select name="h" aria-label="Filtrar por unidad" onchange="this.form.submit()"><option value="">TODAS LAS UNIDADES</option>{unidades.map((u) => <option value={u.id} selected={u.id === filtroHist}>{u.codigo}</option>)}</select>
          <noscript><button class="btn chico">VER</button></noscript>
        </form>
      }>
        <div class="tabla-wrap">
          <table class="t">
            <thead><tr><th>Fecha</th><th>Unid.</th><th>Trabajo</th><th>Pieza</th><th>Tipo</th><th class="num">Odómetro</th><th class="num">Desgaste</th><th class="num">Costo</th><th>Taller</th><th>Origen</th></tr></thead>
            <tbody>
              {historial.length === 0 ? <tr><td colspan={10}><Vacio>Sin reparaciones registradas.</Vacio></td></tr> : historial.map((h) => (
                <tr>
                  <td class="nowrap">{fechaMedia(h.fecha)}</td><td><b>{h.unidad}</b></td><td>{h.trabajo}</td>
                  <td>{h.componente ? <a href={`/trailer/${h.vehiculoId}?pieza=${h.componente}`} title="Ver dónde está en el modelo 3D">{h.pieza} · VER EN 3D</a> : "—"}</td>
                  <td><span class="chip neutro">{TIPOS_REPARACION[h.tipo]}</span></td>
                  <td class="num">{miles(h.odometro)}</td><td class="num">{h.desgastePct === null ? "—" : `${h.desgastePct}%`}</td>
                  <td class="num">{soles2(h.costoTotal)}</td><td>{h.taller ?? "—"}</td><td><Origen origen={h.origen} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <span class="muted" style="font-size:11px">Total en el historial: {soles(historial.reduce((s, h) => s + h.costoTotal, 0))}</span>
      </Panel>
    </>
  ));
}

export function rutasReparaciones(app: App, d: Deps): void {
  app.get("/reparaciones", (c) => vista(c, d));
  app.post("/reparaciones", async (c) => {
    const f = await formulario(c);
    const vehiculoId = Number(f.vehiculoId);
    return accion(c, `/reparaciones?unidad=${vehiculoId}`, async () => {
      const ids = (f.repuestoId ?? "").split("\u0001");
      const cants = (f.cantidad ?? "").split("\u0001");
      const usados = new Map<number, number>();
      ids.forEach((id, k) => {
        if (!id) return;
        const n = enteroONull(cants[k]) ?? 1;
        usados.set(Number(id), (usados.get(Number(id)) ?? 0) + n);
      });
      const manoObra = f.manoObra ? parsearMonto(f.manoObra) : 0;
      if (manoObra === null) throw new ErrorNegocio("Mano de obra no válida");
      const tipo = (f.tipo ?? "preventivo") as TipoReparacion;
      if (!(tipo in TIPOS_REPARACION)) throw new ErrorNegocio("Tipo no válido");
      const r = await registrarCambio(d.ctx, {
        vehiculoId, parteInstaladaId: f.parteId ? Number(f.parteId) : null, tipo, odometro: enteroONull(f.odometro) ?? undefined,
        fecha: f.fecha || undefined, repuestos: [...usados].map(([repuestoId, cantidad]) => ({ repuestoId, cantidad })),
        manoObra, taller: f.taller || null, trabajo: f.trabajo || null, componente: f.componente || null, origen: "web", usuarioId: c.get("usuario").id,
      });
      let aviso = r.resumen;
      if (r.stockBajo.length) aviso += `\n⚠️ Stock bajo: ${r.stockBajo.map((s) => `${s.codigo} (${s.stock})`).join(", ")}`;
      await d.avisar(aviso).catch(() => {});
      return `Cambio guardado · ${r.trabajo} · ${soles2(r.costoTotal)}${r.desgastePct !== null ? ` · ${r.desgastePct}% ${r.etiqueta}` : ""}`;
    });
  });
}
