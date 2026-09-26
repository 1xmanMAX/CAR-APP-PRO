/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import {
  borrarGasto, CATEGORIAS_GASTO, crearPrestamo, deudaPrestamos, ErrorNegocio, flujoCaja, hoy, listarMovimientos, listarPrestamos,
  listarReinversiones, listarUnidades, NOMBRE_CATEGORIA, obtenerGasto, pagarCuota, parsearMonto, puedeEditar, rangoMes,
  registrarGasto, registrarIngreso, registrarReinversion, reinvertidoEnAnio, resumenFinanciero, type CategoriaGasto,
} from "@sunatapp/core";
import { accion, formulario, formularioMultiparte, pagina, servirDeAlmacen, type App, type C, type Deps } from "../base";
import { enteroONull } from "./flota";
import { fechaCorta, fechaMedia, Kpi, Origen, Panel, soles, soles2, Vacio } from "../ui";

const CHIP_MOV: Record<string, string> = { INGRESO: "ok", GASTO: "cambiar", "REINVERSIÓN": "proximo", CUOTA: "oscuro", COMPRA: "neutro" };

function GraficoFlujo({ semanas }: { semanas: Array<{ desde: string; entra: number; sale: number }> }) {
  const W = 720, H = 200, medio = H / 2, ancho = W / semanas.length;
  const max = Math.max(1, ...semanas.flatMap((s) => [s.entra, s.sale]));
  return (
    <svg class="graf" viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label="Flujo de caja semanal: barras hacia arriba entran, hacia abajo salen">
      <line x1="0" x2={W} y1={medio} y2={medio} stroke="#CDBFA5" />
      {semanas.map((s, i) => {
        const he = (s.entra / max) * (medio - 6), hs = (s.sale / max) * (medio - 6);
        const x = i * ancho + ancho * 0.18, w = ancho * 0.64;
        return (
          <g>
            <title>{`Semana del ${s.desde}: entra ${soles(s.entra)}, sale ${soles(s.sale)}`}</title>
            <rect x={x} y={medio - he} width={w} height={he} fill="#2D5B7A" rx="1" />
            <rect x={x} y={medio} width={w} height={hs} fill="#B8236E" rx="1" />
            <text x={x + w / 2} y={H + 14} font-size="10" text-anchor="middle" fill="#6B6254">{fechaCorta(s.desde)}</text>
          </g>
        );
      })}
    </svg>
  );
}

async function vista(c: C, d: Deps) {
  const ctx = d.ctx;
  const h = hoy(ctx);
  const mes = c.req.query("mes") ?? h.slice(0, 7);
  const { desde, hasta } = rangoMes(`${mes}-01`);
  const anio = h.slice(0, 4);
  const [fin, deuda, reinv, flujo, movs, prestamos, reinversiones, unidades] = await Promise.all([
    resumenFinanciero(ctx, desde, hasta), deudaPrestamos(ctx), reinvertidoEnAnio(ctx, anio), flujoCaja(ctx, 12),
    listarMovimientos(ctx, desde, hasta, 200), listarPrestamos(ctx), listarReinversiones(ctx, anio), listarUnidades(ctx),
  ]);
  const edita = puedeEditar(c.get("usuario").rol, "finanzas");
  const SelUnidad = () => (
    <label class="campo"><span>Unidad</span><select name="vehiculoId"><option value="">— general —</option>{unidades.map((u) => <option value={u.id}>{u.codigo}</option>)}</select></label>
  );

  return pagina(c, d, { titulo: "Finanzas", seccion: "finanzas" }, (
    <>
      <section class="kpis">
        <Kpi etiqueta="INGRESOS DEL MES" valor={soles(fin.ingresos)} />
        <Kpi etiqueta="GASTOS DEL MES" valor={soles(fin.gastos)} />
        <Kpi oscuro etiqueta="GANANCIA NETA" valor={soles(fin.ganancia)} sub={fin.margenPct !== null ? `margen ${fin.margenPct}%` : undefined} />
        <Kpi etiqueta={`REINVERTIDO ${anio}`} valor={soles(reinv)} />
        <Kpi etiqueta="DEUDA PRÉSTAMOS" valor={soles(deuda)} />
      </section>

      <div class="grid g-lado">
        <div class="filas" style="gap:10px;min-width:0">
          <Panel titulo="FLUJO DE CAJA · 12 SEMANAS" der={<span class="leyenda"><span><i style="background:#2D5B7A"></i>ARRIBA ENTRA</span><span><i style="background:#B8236E"></i>ABAJO SALE</span></span>}>
            <GraficoFlujo semanas={flujo} />
          </Panel>
          <Panel titulo="MOVIMIENTOS · GASTOS, INGRESOS, REINVERSIONES" der={
            <>
              <form method="get" action="/finanzas" class="linea"><input type="month" name="mes" value={mes} aria-label="Mes" style="width:auto" /><button class="btn chico">VER</button></form>
              {edita ? <><a class="btn chico" href="#nuevo">+ REINVERSIÓN</a><a class="btn primario chico" href="#nuevo">+ GASTO</a></> : null}
            </>
          }>
            <div class="tabla-wrap">
              <table class="t">
                <thead><tr><th>Fecha</th><th>Tipo</th><th>Detalle</th><th>Unid.</th><th class="num">Monto</th><th>Origen</th>{edita ? <th></th> : null}</tr></thead>
                <tbody>
                  {movs.length === 0 ? <tr><td colspan={7}><Vacio>Sin movimientos en {mes}.</Vacio></td></tr> : movs.map((m) => (
                    <tr>
                      <td class="nowrap">{fechaCorta(m.fecha)}</td>
                      <td><span class={`chip ${CHIP_MOV[m.tipo]}`}>{m.tipo}</span></td>
                      <td>{m.detalle}</td><td>{m.unidad}</td>
                      <td class={`num ${m.monto < 0 ? "t-cambiar" : "t-ok"}`}>{m.monto < 0 ? "−" : "+"}{soles2(Math.abs(m.monto))}</td>
                      <td><Origen origen={m.origen} /></td>
                      {edita ? (
                        <td class="nowrap">
                          {m.ref.entidad === "gasto" ? <a href={`/archivo/gasto/${m.ref.id}`} title="Ver voucher">📷</a> : null}
                          {m.ref.entidad === "gasto" ? (
                            <form method="post" action={`/finanzas/gasto/${m.ref.id}/borrar`} style="display:inline" data-confirmar="¿Borrar este gasto?">
                              <button class="btn chico" type="submit" aria-label="Borrar gasto" style="min-height:28px;margin-left:4px">×</button>
                            </form>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {edita ? (
            <div class="grid g-3" id="nuevo">
              <form method="post" action="/finanzas/gasto" class="panel" enctype="multipart/form-data">
                <b class="lbl-12">+ GASTO</b>
                <label class="campo"><span>Categoría</span><select name="categoria">{CATEGORIAS_GASTO.map((k) => <option value={k}>{NOMBRE_CATEGORIA[k]}</option>)}</select></label>
                <label class="campo"><span>Monto S/</span><input name="monto" inputmode="decimal" required /></label>
                <SelUnidad />
                <label class="campo"><span>Fecha</span><input type="date" name="fecha" value={h} /></label>
                <label class="campo"><span>Detalle</span><input name="nota" /></label>
                <label class="campo"><span>Foto del voucher</span><input type="file" name="foto" accept="image/*,application/pdf" /></label>
                <button class="btn primario" type="submit">GUARDAR GASTO</button>
              </form>
              <form method="post" action="/finanzas/ingreso" class="panel">
                <b class="lbl-12">+ OTRO INGRESO</b>
                <span class="muted" style="font-size:11px">Los fletes entran solos desde Viajes.</span>
                <label class="campo"><span>Concepto</span><input name="concepto" required /></label>
                <label class="campo"><span>Monto S/</span><input name="monto" inputmode="decimal" required /></label>
                <SelUnidad />
                <label class="campo"><span>Fecha</span><input type="date" name="fecha" value={h} /></label>
                <button class="btn" type="submit">GUARDAR INGRESO</button>
              </form>
              <form method="post" action="/finanzas/reinversion" class="panel">
                <b class="lbl-12">+ REINVERSIÓN</b>
                <label class="campo"><span>Concepto</span><input name="concepto" required placeholder="Compra de carreta, GPS, …" /></label>
                <label class="campo"><span>Monto S/</span><input name="monto" inputmode="decimal" required /></label>
                <SelUnidad />
                <label class="campo"><span>Fecha</span><input type="date" name="fecha" value={h} /></label>
                <button class="btn" type="submit">GUARDAR REINVERSIÓN</button>
              </form>
            </div>
          ) : null}
        </div>

        <div class="filas" style="gap:10px">
          <Panel titulo="PRÉSTAMOS · CUOTAS">
            {prestamos.length === 0 ? <Vacio>Sin préstamos activos.</Vacio> : prestamos.map((p) => (
              <div class="filas" style="border-bottom:1px solid var(--divider);padding-bottom:10px">
                <div style="display:flex;justify-content:space-between"><b>{p.entidad}</b><span class="muted">TASA {p.tasaAnual}%</span></div>
                <div><b class="mono-t" style="font-size:18px">{soles(p.saldo)}</b> <span class="lbl">PENDIENTE</span></div>
                <div class="tira" aria-label={`${p.pagadas} de ${p.total} cuotas pagadas`}>{p.cuotas.map((q) => <i style={`width:8px;height:14px;background:${q.pagada ? "var(--accent)" : "var(--divider)"}`} title={`Cuota ${q.numero} · ${q.vencimiento} · ${soles2(q.monto)}`}></i>)}</div>
                <div style="display:flex;justify-content:space-between;font-size:11px"><span>{p.pagadas} DE {p.total} CUOTAS</span><span>PRÓXIMA {p.proxima ? `${fechaMedia(p.proxima.vencimiento)} · ${soles2(p.proxima.monto)}` : "—"}</span></div>
                {edita && p.proxima ? (
                  <form method="post" action={`/finanzas/prestamo/${p.id}/pagar`} data-confirmar={`¿Registrar el pago de la cuota de ${soles2(p.proxima.monto)}?`}>
                    <button class="btn chico" type="submit">PAGAR CUOTA</button>
                  </form>
                ) : null}
              </div>
            ))}
            {edita ? (
              <details class="plegable"><summary><span class="btn chico fantasma">+ PRÉSTAMO</span></summary>
                <form method="post" action="/finanzas/prestamo" class="filas" style="margin-top:8px">
                  <label class="campo"><span>Entidad</span><input name="entidad" required placeholder="Banco / financiera" /></label>
                  <div class="form-grid">
                    <label class="campo"><span>Monto S/</span><input name="monto" inputmode="decimal" required /></label>
                    <label class="campo"><span>TEA %</span><input name="tasa" inputmode="decimal" required /></label>
                    <label class="campo"><span>Cuotas</span><input name="cuotas" inputmode="numeric" required /></label>
                    <label class="campo"><span>Desembolso</span><input type="date" name="fecha" value={h} /></label>
                  </div>
                  <SelUnidad />
                  <button class="btn primario" type="submit">CREAR CRONOGRAMA</button>
                </form>
              </details>
            ) : null}
          </Panel>
          <Panel titulo={`REINVERSIONES · ${anio}`}>
            {reinversiones.length === 0 ? <Vacio>Sin reinversiones este año.</Vacio> : (
              <div class="filas">{reinversiones.map((r) => (
                <div style="display:flex;justify-content:space-between;gap:8px;font-size:12px"><span>{r.r.concepto}{r.codigo ? <span class="muted"> · {r.codigo}</span> : null}</span><b>{soles(r.r.monto)}</b></div>
              ))}</div>
            )}
          </Panel>
        </div>
      </div>
    </>
  ));
}

function montoObligatorio(v: string | undefined): number {
  const m = parsearMonto(v ?? "");
  if (m === null) throw new ErrorNegocio("Monto no válido");
  return m;
}

export function rutasFinanzas(app: App, d: Deps): void {
  app.get("/finanzas", (c) => vista(c, d));
  app.post("/finanzas/gasto", async (c) => {
    const { campos: f, archivos } = await formularioMultiparte(c);
    return accion(c, "/finanzas", async () => {
      let rutaFoto: string | null = null;
      const foto = archivos.foto;
      if (foto) {
        if (foto.size > 8 * 1024 * 1024) throw new ErrorNegocio("La foto pesa más de 8 MB");
        const ext = (foto.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
        rutaFoto = await d.ctx.almacen.guardar(`vouchers/${Date.now()}-web.${ext}`, Buffer.from(await foto.arrayBuffer()));
      }
      await registrarGasto(d.ctx, {
        categoria: f.categoria as CategoriaGasto, monto: montoObligatorio(f.monto), vehiculoId: f.vehiculoId ? Number(f.vehiculoId) : null,
        fecha: f.fecha || undefined, nota: f.nota || null, rutaFoto, origen: "web", usuarioId: c.get("usuario").id,
      });
      return "Gasto guardado";
    });
  });
  app.post("/finanzas/gasto/:id/borrar", async (c) => accion(c, "/finanzas", async () => {
    await borrarGasto(d.ctx, Number(c.req.param("id")), c.get("usuario").id);
    return "Gasto borrado";
  }));
  app.post("/finanzas/ingreso", async (c) => {
    const f = await formulario(c);
    return accion(c, "/finanzas", async () => {
      await registrarIngreso(d.ctx, { concepto: f.concepto ?? "", monto: montoObligatorio(f.monto), vehiculoId: f.vehiculoId ? Number(f.vehiculoId) : null, fecha: f.fecha || undefined, origen: "web", usuarioId: c.get("usuario").id });
      return "Ingreso guardado";
    });
  });
  app.post("/finanzas/reinversion", async (c) => {
    const f = await formulario(c);
    return accion(c, "/finanzas", async () => {
      await registrarReinversion(d.ctx, { concepto: f.concepto ?? "", monto: montoObligatorio(f.monto), vehiculoId: f.vehiculoId ? Number(f.vehiculoId) : null, fecha: f.fecha || undefined, origen: "web", usuarioId: c.get("usuario").id });
      return "Reinversión guardada";
    });
  });
  app.post("/finanzas/prestamo", async (c) => {
    const f = await formulario(c);
    return accion(c, "/finanzas", async () => {
      const tasa = Number((f.tasa ?? "").replace(",", "."));
      if (!Number.isFinite(tasa)) throw new ErrorNegocio("Tasa no válida");
      await crearPrestamo(d.ctx, {
        entidad: f.entidad ?? "", monto: montoObligatorio(f.monto), tasaAnual: tasa, cuotas: enteroONull(f.cuotas) ?? 0,
        fechaInicio: f.fecha || undefined, vehiculoId: f.vehiculoId ? Number(f.vehiculoId) : null, usuarioId: c.get("usuario").id,
      });
      return "Préstamo creado con su cronograma de cuotas";
    });
  });
  app.post("/finanzas/prestamo/:id/pagar", async (c) => accion(c, "/finanzas", async () => {
    const r = await pagarCuota(d.ctx, Number(c.req.param("id")), undefined, c.get("usuario").id);
    return `Cuota ${r.numero} pagada (${soles2(r.monto)})`;
  }));
  app.get("/archivo/gasto/:id", async (c) => {
    const g = await obtenerGasto(d.ctx, Number(c.req.param("id")));
    return servirDeAlmacen(c, d, g?.rutaFoto ?? null);
  });
}
