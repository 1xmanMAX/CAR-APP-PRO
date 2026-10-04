/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import ExcelJS from "exceljs";
import {
  estadisticas, hoy, listarCobrosPendientes, listarViajesFlota, liquidacionViaje, NOMBRE_CATEGORIA, sumarDias, type Estadisticas,
} from "@sunatapp/core";
import { pagina, type App, type C, type Deps } from "../base";
import { Barra, Kpi, Panel, soles, soles2, Vacio } from "../ui";

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
            <text x={x + ancho * 1.5} y={alto + 30} text-anchor="middle" font-size="10" fill="currentColor" opacity=".7">{m.viajes} viajes</text>
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
      <section class="panel" style="flex-direction:row;align-items:center;flex-wrap:wrap;gap:10px">
        <b class="mono-t" style="font-size:16px">ESTADÍSTICAS</b>
        <form method="get" action="/estadisticas" class="linea" style="margin-left:auto" data-auto="">
          <input type="date" name="desde" value={desde} aria-label="Desde" style="width:auto" />
          <input type="date" name="hasta" value={hasta} aria-label="Hasta" style="width:auto" />
          <button class="btn chico" type="submit">VER</button>
          <a class="btn primario chico" href={`/estadisticas.xlsx?desde=${desde}&hasta=${hasta}`}>⬇ EXCEL</a>
        </form>
      </section>
      <section class="kpis">
        <Kpi oscuro etiqueta="GANANCIA DEL PERIODO" valor={soles(e.totales.ganancia)} negativo={e.totales.ganancia < 0} />
        <Kpi etiqueta="INGRESOS" valor={soles(e.totales.ingresos)} />
        <Kpi etiqueta="GASTOS" valor={soles(e.totales.gastos)} />
        <Kpi etiqueta="VIAJES" valor={e.totales.viajes} />
      </section>
      <Panel titulo="INGRESOS · GASTOS · GANANCIA POR MES" der={<span class="lbl"><span class="t-ok">■ INGRESOS</span> <span style="color:var(--accent)">■ GASTOS</span> <span style="color:var(--amber-bar)">■ GANANCIA</span></span>}>
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
          <div class="tabla-wrap" data-sin-tarjetas=""><table class="t">
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
            <div class="tabla-wrap" data-sin-tarjetas=""><table class="t"><thead><tr><th>Viaje</th><th>Ruta</th><th class="num">Km</th><th class="num">Combustible</th><th class="num">S/ por km</th></tr></thead>
              <tbody>{e.combustiblePorViaje.map((x) => <tr><td>{x.codigo}</td><td>{x.ruta}</td><td class="num">{x.km ?? "—"}</td><td class="num">{soles2(x.monto)}</td><td class="num">{x.solesPorKm === null ? "—" : x.solesPorKm.toFixed(2)}</td></tr>)}</tbody></table></div>
          )}
        </Panel>
        <Panel titulo="GASTO POR PROVEEDOR">
          {e.porProveedor.length === 0 ? <Vacio>Los gastos leídos de boletas traen el proveedor.</Vacio> : (
            <div class="tabla-wrap" data-sin-tarjetas=""><table class="t"><tbody>{e.porProveedor.map((x) => <tr><td>{x.proveedor}</td><td class="num">{x.veces}</td><td class="num">{soles2(x.monto)}</td></tr>)}</tbody></table></div>
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
  void NOMBRE_CATEGORIA;
  return Buffer.from(await libro.xlsx.writeBuffer());
}

export function rutasEstadisticas(app: App, d: Deps): void {
  app.get("/estadisticas", (c) => vista(c, d));
  app.get("/estadisticas.xlsx", async (c) => {
    const { desde, hasta } = rango(c as C, d);
    const archivo = await excelEstadisticas(d, desde, hasta);
    return c.body(new Uint8Array(archivo), 200, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="control-flota-${desde}-a-${hasta}.xlsx"`,
    });
  });
}
