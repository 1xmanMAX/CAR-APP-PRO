/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import {
  borrarGasto, deudaPrestamos, flujoCaja, hoy, listarMovimientos, listarPrestamos, listarReinversiones, obtenerGasto, puedeEditar, rangoMes,
  reinvertidoEnAnio, resumenFinanciero,
} from "@sunatapp/core";
import { accion, formulario, formularioMultiparte, pagina, servirDeAlmacen, type App, type C, type Deps } from "../base";
import { guardarGasto, guardarIngreso, guardarPrestamo, guardarReinversion, pagarCuotaDe } from "../acciones";
import { redirigir } from "../redirecciones";
import { Cabecera, Cifra, fechaDia, fechaMedia, mesLargo, Origen, Panel, soles, soles2, Vacio } from "../ui";

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
            <text x={x + w / 2} y={H + 14} font-size="12" text-anchor="middle" fill="#6B6254">{fechaDia(s.desde)}</text>
          </g>
        );
      })}
    </svg>
  );
}

async function vistaCaja(c: C, d: Deps) {
  const ctx = d.ctx;
  const h = hoy(ctx);
  const pedido = c.req.query("mes") ?? "";
  const mes = /^\d{4}-\d{2}$/.test(pedido) ? pedido : h.slice(0, 7);
  const { desde, hasta } = rangoMes(`${mes}-01`);
  const [fin, flujo, movs] = await Promise.all([resumenFinanciero(ctx, desde, hasta), flujoCaja(ctx, 12), listarMovimientos(ctx, desde, hasta, 200)]);
  const edita = puedeEditar(c.get("usuario").rol, "finanzas");
  return pagina(c, d, { titulo: "Caja", seccion: "finanzas" }, (
    <>
      <Cabecera volver="/numeros" titulo="Caja" sub={`Entradas y salidas de ${mesLargo(mes)}`} der={
        <form method="get" action="/numeros/caja" class="linea filtro"><input type="month" name="mes" value={mes} aria-label="Mes" /><button class="btn chico" type="submit">Ver</button></form>
      } />
      <div class="tres-cifras">
        <Cifra etiqueta="Entró" valor={soles(fin.ingresos)} tono="ok" />
        <Cifra etiqueta="Salió" valor={soles(fin.gastos)} sub={`del viaje ${soles(fin.gastosVariables)} · del mes ${soles(fin.gastosFijos)}`} />
        <Cifra etiqueta="Te quedó" valor={soles(fin.ganancia)} tono={fin.ganancia < 0 ? "cambiar" : undefined} sub={fin.margenPct !== null ? `margen ${fin.margenPct}%` : undefined} />
      </div>
      <Panel titulo="Flujo de caja · 12 semanas" der={<span class="leyenda"><span><i style="background:#2D5B7A"></i>arriba entra</span><span><i style="background:#B8236E"></i>abajo sale</span></span>}>
        <GraficoFlujo semanas={flujo} />
      </Panel>
      <Panel titulo={`Movimientos · ${movs.length}`} der={edita ? <a class="btn chico" href="/anotar?tipo=gaste&volver=%2Fnumeros%2Fcaja" data-abrir-panel="">+ Anotar</a> : null}>
        <div class="tabla-wrap">
          <table class="t">
            <thead><tr><th>Fecha</th><th>Qué</th><th>Detalle</th><th>Camión</th><th class="num">Monto</th><th>De</th>{edita ? <th></th> : null}</tr></thead>
            <tbody>
              {movs.length === 0 ? <tr><td colspan={7}><Vacio>Sin movimientos en {mesLargo(mes)}.</Vacio></td></tr> : movs.map((m) => (
                <tr>
                  <td class="nowrap">{fechaDia(m.fecha)}</td>
                  <td><span class={`chip ${CHIP_MOV[m.tipo]}`}>{m.tipo}</span></td>
                  <td>{m.detalle}</td><td>{m.unidad}</td>
                  <td class={`num ${m.monto < 0 ? "t-cambiar" : "t-ok"}`}>{m.monto < 0 ? "−" : "+"}{soles2(Math.abs(m.monto))}</td>
                  <td><Origen origen={m.origen} /></td>
                  {edita ? (
                    <td class="nowrap">
                      {m.ref.entidad === "gasto" ? <a class="btn chico" href={`/archivo/gasto/${m.ref.id}`} title="Ver la foto del voucher">Foto</a> : null}
                      {m.ref.entidad === "gasto" ? (
                        <form method="post" action={`/finanzas/gasto/${m.ref.id}/borrar`} style="display:inline;margin-left:4px" data-confirmar="¿Borrar este gasto?">
                          <button class="btn chico" type="submit" aria-label="Borrar gasto">×</button>
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
    </>
  ));
}

async function vistaPrestamos(c: C, d: Deps) {
  const ctx = d.ctx;
  const anio = hoy(ctx).slice(0, 4);
  const [deuda, prestamos, reinv, reinversiones] = await Promise.all([deudaPrestamos(ctx), listarPrestamos(ctx), reinvertidoEnAnio(ctx, anio), listarReinversiones(ctx, anio)]);
  const edita = puedeEditar(c.get("usuario").rol, "finanzas");
  return pagina(c, d, { titulo: "Préstamos y cuotas", seccion: "finanzas" }, (
    <>
      <Cabecera volver="/numeros" titulo="Préstamos y cuotas" der={edita ? <a class="btn primario chico" href="/anotar?tipo=prestamo&modo=nuevo&volver=%2Fnumeros%2Fprestamos" data-abrir-panel="">+ Préstamo nuevo</a> : null} />
      <div class="dos-cifras">
        <Cifra etiqueta="Debes en préstamos" valor={soles(deuda)} tono={deuda > 0 ? "cambiar" : undefined} />
        <Cifra etiqueta={`Reinvertido en ${anio}`} valor={soles(reinv)} />
      </div>
      <Panel titulo="Préstamos">
        {prestamos.length === 0 ? <Vacio>Sin préstamos activos.</Vacio> : prestamos.map((p) => (
          <div class="filas" style="border-bottom:1px solid var(--divider);padding-bottom:10px">
            <div class="fila-sep"><b>{p.entidad}</b><span class="muted">TEA {p.tasaAnual}%</span></div>
            <div><b class="mono-t" style="font-size:18px">{soles(p.saldo)}</b> <span class="lbl">por pagar</span></div>
            <div class="tira" aria-label={`${p.pagadas} de ${p.total} cuotas pagadas`}>{p.cuotas.map((q) => <i style={`width:8px;height:14px;background:${q.pagada ? "var(--accent)" : "var(--divider)"}`} title={`Cuota ${q.numero} · ${q.vencimiento} · ${soles2(q.monto)}`}></i>)}</div>
            <div class="fila-sep"><span>{p.pagadas} de {p.total} cuotas</span><span>Próxima {p.proxima ? `${fechaMedia(p.proxima.vencimiento).toLowerCase()} · ${soles2(p.proxima.monto)}` : "—"}</span></div>
            {edita && p.proxima ? (
              <form method="post" action={`/finanzas/prestamo/${p.id}/pagar`} data-confirmar={`¿Registrar el pago de la cuota de ${soles2(p.proxima.monto)}?`}>
                <button class="btn chico" type="submit">Pagar cuota</button>
              </form>
            ) : null}
          </div>
        ))}
      </Panel>
      <Panel titulo={`Reinversiones ${anio}`} der={edita ? <a class="btn chico" href="/anotar?tipo=prestamo&modo=reinversion&volver=%2Fnumeros%2Fprestamos" data-abrir-panel="">+ Reinversión</a> : null}>
        {reinversiones.length === 0 ? <Vacio>Sin reinversiones este año.</Vacio> : (
          <div class="filas">{reinversiones.map((r) => <div class="fila-sep"><span>{r.r.concepto}{r.codigo ? <span class="muted"> · {r.codigo}</span> : null}</span><b>{soles(r.r.monto)}</b></div>)}</div>
        )}
      </Panel>
    </>
  ));
}

export function rutasFinanzas(app: App, d: Deps): void {
  app.get("/numeros/caja", (c) => vistaCaja(c as C, d));
  app.get("/numeros/prestamos", (c) => vistaPrestamos(c as C, d));
  redirigir(app, "/finanzas", () => "/numeros/caja", ["mes"]);
  app.post("/finanzas/gasto", async (c) => {
    const { campos: f, archivos } = await formularioMultiparte(c);
    return accion(c, "/numeros/caja", () => guardarGasto(d, c.get("usuario").id, f, archivos.foto));
  });
  app.post("/finanzas/gasto/:id/borrar", async (c) => accion(c, "/numeros/caja", async () => {
    await borrarGasto(d.ctx, Number(c.req.param("id")), c.get("usuario").id);
    return "Gasto borrado";
  }));
  app.post("/finanzas/ingreso", async (c) => {
    const f = await formulario(c);
    return accion(c, "/numeros/caja", () => guardarIngreso(d, c.get("usuario").id, f));
  });
  app.post("/finanzas/reinversion", async (c) => {
    const f = await formulario(c);
    return accion(c, "/numeros/prestamos", () => guardarReinversion(d, c.get("usuario").id, f));
  });
  app.post("/finanzas/prestamo", async (c) => {
    const f = await formulario(c);
    return accion(c, "/numeros/prestamos", () => guardarPrestamo(d, c.get("usuario").id, f));
  });
  app.post("/finanzas/prestamo/:id/pagar", async (c) => accion(c, "/numeros/prestamos", () => pagarCuotaDe(d, c.get("usuario").id, Number(c.req.param("id")))));
  app.get("/archivo/gasto/:id", async (c) => {
    const g = await obtenerGasto(d.ctx, Number(c.req.param("id")));
    return servirDeAlmacen(c, d, g?.rutaFoto ?? null);
  });
}
