/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import ExcelJS from "exceljs";
import {
  estadisticas, hoy, listarCobrosPendientes, listarViajesFlota, liquidacionViaje, rentabilidadPorMes, rentabilidadPorViaje, sumarDias, type Estadisticas,
} from "@sunatapp/core";
import { pagina, type App, type C, type Deps } from "../base";
import { redirigir } from "../redirecciones";
import { Barra, Cabecera, Kpi, Panel, soles, soles2, Vacio } from "../ui";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function rango(c: C, d: Deps): { desde: string; hasta: string } {
  const h = hoy(d.ctx);
  const desde = c.req.query("desde") ?? "";
  const hasta = c.req.query("hasta") ?? "";
  return { desde: FECHA.test(desde) ? desde : `${sumarDias(h, -150).slice(0, 7)}-01`, hasta: FECHA.test(hasta) ? hasta : h };
}

/** Barras en SVG hechas en el servidor: ingresos, gastos y ganancia de cada mes. */
function BarrasMeses(p: { meses: Estadisticas["meses"] }) {
  const max = Math.max(1, ...p.meses.flatMap((m) => [m.ingresos, m.gastos, Math.abs(m.ganancia)]));
  const ancho = 36, sep = 16, alto = 150;
  const w = p.meses.length * (ancho * 3 + sep) + sep;
  return (
    <svg viewBox={`0 0 ${w} ${alto + 34}`} role="img" aria-label="Ingresos, gastos y ganancia por mes" style="width:100%;max-height:230px">
      {p.meses.map((m, i) => {
        const x = sep + i * (ancho * 3 + sep);
        const barra = (v: number, k: number, color: string) => {
          const h = (Math.abs(v) / max) * alto;
          return <rect x={x + k * ancho} y={alto - h} width={ancho - 4} height={h} fill={color}><title>{soles(v)}</title></rect>;
        };
        return (
          <g>
            {barra(m.ingresos, 0, "var(--ok)")}{barra(m.gastos, 1, "var(--accent)")}{barra(m.ganancia, 2, m.ganancia >= 0 ? "var(--amber-bar)" : "#B00020")}
            <text x={x + ancho * 1.5} y={alto + 16} text-anchor="middle" font-size="12" fill="currentColor">{m.mes}</text>
            <text x={x + ancho * 1.5} y={alto + 30} text-anchor="middle" font-size="12" fill="currentColor" opacity=".7">{m.viajes} viajes</text>
          </g>
        );
      })}
    </svg>
  );
}

async function vista(c: C, d: Deps) {
  const { desde, hasta } = rango(c, d);
  const e = await estadisticas(d.ctx, desde, hasta);
  const maxCat = Math.max(1, ...e.porCategoria.map((x) => x.monto));
  const maxGrifo = Math.max(1, ...e.combustiblePorGrifo.map((x) => x.monto));
  return pagina(c, d, { titulo: "Estadísticas", seccion: "finanzas" }, (
    <>
      <Cabecera volver="/numeros" titulo="Gráficos y Excel" sub="Para el contador" der={
        <form method="get" action="/numeros/graficos" class="linea filtro">
          <input type="date" name="desde" value={desde} aria-label="Desde" />
          <input type="date" name="hasta" value={hasta} aria-label="Hasta" />
          <button class="btn chico" type="submit">Ver</button>
          <a class="btn primario chico" href={`/estadisticas.xlsx?desde=${desde}&hasta=${hasta}`}>⬇ Excel</a>
        </form>
      } />
      <section class="kpis">
        <Kpi oscuro etiqueta="GANANCIA DEL PERIODO" valor={soles(e.totales.ganancia)} negativo={e.totales.ganancia < 0} />
        <Kpi etiqueta="INGRESOS" valor={soles(e.totales.ingresos)} />
        <Kpi etiqueta="GASTOS" valor={soles(e.totales.gastos)} />
        <Kpi etiqueta="VIAJES" valor={e.totales.viajes} />
      </section>
      <Panel titulo="INGRESOS · GASTOS · GANANCIA POR MES" der={<span class="leyenda"><span><i style="background:var(--ok)"></i>ingresos</span><span><i style="background:var(--accent)"></i>gastos</span><span><i style="background:var(--amber-bar)"></i>ganancia</span></span>}>
        {e.meses.length === 0 ? <Vacio>Sin datos.</Vacio> : <BarrasMeses meses={e.meses} />}
      </Panel>
      <div class="grid g-2">
        <Panel titulo="GASTO POR CATEGORÍA">
          {e.porCategoria.length === 0 ? <Vacio>Sin gastos en el periodo.</Vacio> : e.porCategoria.map((x) => (
            <div><div style="display:flex;justify-content:space-between;font-size:12px"><span>{x.nombre}</span><b>{soles(x.monto)}</b></div><Barra pct={(x.monto / maxCat) * 100} color="var(--accent)" /></div>
          ))}
        </Panel>
        <Panel titulo="COMBUSTIBLE POR GRIFO">
          {e.combustiblePorGrifo.length === 0 ? <Vacio>Sin combustible registrado.</Vacio> : e.combustiblePorGrifo.map((x) => (
            <div><div style="display:flex;justify-content:space-between;font-size:12px"><span>{x.grifo} <span class="muted">· {x.veces} veces</span></span><b>{soles(x.monto)}</b></div><Barra pct={(x.monto / maxGrifo) * 100} color="var(--ok)" /></div>
          ))}
        </Panel>
      </div>
      <Panel titulo="POR RUTA · PROMEDIO POR VIAJE" der={<span class="lbl">DESVÍO = GASTO PROMEDIO CONTRA LA PLANTILLA DE LA RUTA</span>}>
        {e.porRuta.length === 0 ? <Vacio>Sin viajes cerrados en el periodo.</Vacio> : (
          <div class="tabla-wrap"><table class="t">
            <thead><tr><th>Ruta</th><th class="num">Viajes</th><th class="num">Flete prom.</th><th class="num">Gasto prom.</th><th class="num">Ganancia prom.</th><th class="num">Plantilla</th><th class="num">Desvío</th></tr></thead>
            <tbody>{e.porRuta.map((r) => (
              <tr><td><b>{r.ruta}</b></td><td class="num">{r.viajes}</td><td class="num">{soles(r.flete)}</td><td class="num">{soles(r.gasto)}</td>
                <td class={`num ${r.ganancia < 0 ? "t-cambiar" : ""}`}>{soles(r.ganancia)}</td><td class="num">{r.presupuesto === null ? "—" : soles(r.presupuesto)}</td>
                <td class={`num ${r.desvioPct !== null && r.desvioPct > 0 ? "t-cambiar" : "t-ok"}`}>{r.desvioPct === null ? "—" : `${r.desvioPct > 0 ? "+" : ""}${r.desvioPct}%`}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
      <div class="grid g-2">
        <Panel titulo="COMBUSTIBLE POR VIAJE">
          {e.combustiblePorViaje.length === 0 ? <Vacio>Sin datos.</Vacio> : (
            <div class="tabla-wrap"><table class="t"><thead><tr><th>Viaje</th><th>Ruta</th><th class="num">Km</th><th class="num">Combustible</th><th class="num">S/ por km</th></tr></thead>
              <tbody>{e.combustiblePorViaje.map((x) => <tr><td>{x.codigo}</td><td>{x.ruta}</td><td class="num">{x.km ?? "—"}</td><td class="num">{soles2(x.monto)}</td><td class="num">{x.solesPorKm === null ? "—" : x.solesPorKm.toFixed(2)}</td></tr>)}</tbody></table></div>
          )}
        </Panel>
        <Panel titulo="GASTO POR PROVEEDOR">
          {e.porProveedor.length === 0 ? <Vacio>Los gastos leídos de boletas traen el proveedor.</Vacio> : (
            <div class="tabla-wrap"><table class="t"><tbody>{e.porProveedor.map((x) => <tr><td>{x.proveedor}</td><td class="num">{x.veces}</td><td class="num">{soles2(x.monto)}</td></tr>)}</tbody></table></div>
          )}
        </Panel>
      </div>
    </>
  ));
}

const SOLES = '"S/ "#,##0.00';

/** Excel del periodo: resumen mensual, viajes con su liquidación, gastos por categoría, rutas y cobros. */
export async function excelEstadisticas(d: Deps, desde: string, hasta: string): Promise<Buffer> {
  const e = await estadisticas(d.ctx, desde, hasta);
  const libro = new ExcelJS.Workbook();
  libro.creator = "Control Flota";
  const hoja = (nombre: string, columnas: Array<{ header: string; key: string; width?: number; soles?: boolean }>, filas: Array<Record<string, unknown>>) => {
    const h = libro.addWorksheet(nombre);
    h.columns = columnas.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 16, style: c.soles ? { numFmt: SOLES } : {} }));
    h.getRow(1).font = { bold: true };
    for (const f of filas) h.addRow(f);
    return h;
  };
  const cen = (v: number) => v / 100;
  hoja("Resumen mensual", [{ header: "Mes", key: "mes", width: 10 }, { header: "Viajes", key: "viajes", width: 8 }, { header: "Ingresos", key: "ingresos", soles: true }, { header: "Gastos", key: "gastos", soles: true }, { header: "Ganancia", key: "ganancia", soles: true }],
    e.meses.map((m) => ({ ...m, ingresos: cen(m.ingresos), gastos: cen(m.gastos), ganancia: cen(m.ganancia) })));
  const viajes = await listarViajesFlota(d.ctx, { desde, hasta, limite: 10000 });
  const filasViajes = [];
  for (const v of viajes) {
    const l = await liquidacionViaje(d.ctx, v.id);
    filasViajes.push({ codigo: v.codigo, fecha: v.fecha, unidad: v.unidad, ruta: v.ruta, estado: v.estado, km: v.km, flete: cen(l.flete), gastado: cen(l.gastado), entregado: cen(l.entregado), saldo: cen(l.saldo), ganancia: l.ganancia === null ? null : cen(l.ganancia) });
  }
  hoja("Viajes", [
    { header: "Código", key: "codigo", width: 10 }, { header: "Fecha", key: "fecha", width: 11 }, { header: "Unidad", key: "unidad", width: 8 }, { header: "Ruta", key: "ruta", width: 26 },
    { header: "Estado", key: "estado", width: 10 }, { header: "Km", key: "km", width: 8 }, { header: "Flete", key: "flete", soles: true }, { header: "Gastado", key: "gastado", soles: true },
    { header: "Entregado", key: "entregado", soles: true }, { header: "Saldo chofer", key: "saldo", soles: true }, { header: "Ganancia", key: "ganancia", soles: true },
  ], filasViajes);
  hoja("Gastos por categoría", [{ header: "Categoría", key: "nombre", width: 24 }, { header: "Monto", key: "monto", soles: true }], e.porCategoria.map((x) => ({ nombre: x.nombre, monto: cen(x.monto) })));
  hoja("Por ruta", [
    { header: "Ruta", key: "ruta", width: 26 }, { header: "Viajes", key: "viajes", width: 8 }, { header: "Flete prom.", key: "flete", soles: true }, { header: "Gasto prom.", key: "gasto", soles: true },
    { header: "Ganancia prom.", key: "ganancia", soles: true }, { header: "Plantilla", key: "presupuesto", soles: true }, { header: "Desvío %", key: "desvioPct", width: 10 },
  ], e.porRuta.map((r) => ({ ...r, flete: cen(r.flete), gasto: cen(r.gasto), ganancia: cen(r.ganancia), presupuesto: r.presupuesto === null ? null : cen(r.presupuesto) })));
  hoja("Combustible por grifo", [{ header: "Grifo", key: "grifo", width: 28 }, { header: "Veces", key: "veces", width: 8 }, { header: "Monto", key: "monto", soles: true }], e.combustiblePorGrifo.map((x) => ({ ...x, monto: cen(x.monto) })));
  const cobros = await listarCobrosPendientes(d.ctx);
  hoja("Cobros pendientes", [{ header: "Factura", key: "serieNumero", width: 14 }, { header: "Cliente", key: "cliente", width: 30 }, { header: "Saldo", key: "saldo", soles: true }],
    cobros.filas.map((f) => ({ serieNumero: f.serieNumero, cliente: f.cliente, saldo: cen(f.saldo) })));
  const pv = await rentabilidadPorViaje(d.ctx, { desde, hasta });
  hoja("Por viaje", [
    { header: "Viaje", key: "codigo", width: 10 }, { header: "Guía", key: "guia", width: 12 }, { header: "Unidad", key: "unidad", width: 8 }, { header: "Ruta", key: "ruta", width: 26 },
    { header: "Flete", key: "flete", soles: true }, { header: "Variables", key: "variables", soles: true }, { header: "Contribución", key: "contribucion", soles: true },
    { header: "Fijo asignado", key: "fijoAsignado", soles: true }, { header: "Ganancia", key: "ganancia", soles: true }, { header: "Margen %", key: "margenPct", width: 10 },
  ], pv.map((f) => ({ ...f, flete: cen(f.flete), variables: cen(f.variables), contribucion: cen(f.contribucion), fijoAsignado: cen(f.fijoAsignado), ganancia: cen(f.ganancia) })));
  const pm = await rentabilidadPorMes(d.ctx, { desde, hasta });
  hoja("Por mes", [
    { header: "Mes", key: "mes", width: 10 }, { header: "Viajes", key: "viajes", width: 8 }, { header: "Ingresos", key: "ingresos", soles: true },
    { header: "Variables", key: "variables", soles: true }, { header: "Contribución", key: "contribucion", soles: true }, { header: "Fijos", key: "fijos", soles: true },
    { header: "Ganancia neta", key: "ganancia", soles: true }, { header: "Margen %", key: "margenPct", width: 10 },
  ], pm.map((m) => ({ ...m, ingresos: cen(m.ingresos), variables: cen(m.variables), contribucion: cen(m.contribucion), fijos: cen(m.fijos), ganancia: cen(m.ganancia) })));
  return Buffer.from(await libro.xlsx.writeBuffer());
}

export function rutasEstadisticas(app: App, d: Deps): void {
  app.get("/numeros/graficos", (c) => vista(c as C, d));
  redirigir(app, "/estadisticas", () => "/numeros/graficos", ["desde", "hasta"]);
  app.get("/estadisticas.xlsx", async (c) => {
    const { desde, hasta } = rango(c as C, d);
    const archivo = await excelEstadisticas(d, desde, hasta);
    return c.body(new Uint8Array(archivo), 200, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="control-flota-${desde}-a-${hasta}.xlsx"`,
    });
  });
}
