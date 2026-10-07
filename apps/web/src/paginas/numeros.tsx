/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import { gastosPorCategoria, hoy, listarViajesFlota, mesAnterior, rangoMes } from "@sunatapp/core";
import { pagina, type App, type C, type Deps } from "../base";
import { Barra, Cabecera, fechaDia, soles, Vacio } from "../ui";

const PERIODOS = [["mes", "Este mes"], ["pasado", "Mes pasado"], ["anio", "Año"]] as const;
type Periodo = (typeof PERIODOS)[number][0];

const VER_MAS = [
  { href: "/numeros/caja", texto: "Caja (entradas y salidas)" },
  { href: "/numeros/prestamos", texto: "Préstamos y cuotas" },
  { href: "/numeros/cotizar", texto: "Cotizar un viaje" },
  { href: "/numeros/rentabilidad", texto: "Rentabilidad detallada (por viaje, por mes, por camión)" },
  { href: "/numeros/graficos", texto: "Gráficos y Excel para el contador" },
];

async function vista(c: C, d: Deps) {
  const ctx = d.ctx;
  const h = hoy(ctx);
  const periodo: Periodo = PERIODOS.find(([p]) => p === c.req.query("periodo"))?.[0] ?? "mes";
  const actual = rangoMes(h);
  const rango = periodo === "mes" ? actual : periodo === "pasado" ? rangoMes(`${mesAnterior(actual.mes)}-01`) : { desde: `${h.slice(0, 4)}-01-01`, hasta: h };
  const [viajes, gastos] = await Promise.all([
    listarViajesFlota(ctx, { desde: rango.desde, hasta: rango.hasta, limite: 2000 }), gastosPorCategoria(ctx, rango.desde, rango.hasta),
  ]);
  // «Deja» = flete − gastos del viaje, igual que en Viajes; sin flete no entra al ranking.
  const ranking = viajes.filter((v) => v.flete > 0).map((v) => ({ ...v, dejo: v.flete - v.costo })).sort((a, b) => b.dejo - a.dejo);
  const maxGasto = Math.max(1, ...gastos.map((g) => g.monto));
  return pagina(c, d, { titulo: "Números", seccion: "finanzas" }, (
    <>
      <Cabecera titulo="Números" />
      <nav class="segmentos" aria-label="Periodo">
        {PERIODOS.map(([p, t]) => <a href={`/numeros?periodo=${p}`} class={p === periodo ? "activo" : undefined} aria-current={p === periodo ? "page" : undefined}>{t}</a>)}
      </nav>
      <div class="numeros-cols">
        <section class="col">
          <h2 class="titulo-seccion">¿Qué viaje dejó más?</h2>
          <div class="lista-filas">
            {ranking.length === 0 ? <Vacio>No hay viajes con flete en este periodo.</Vacio> : ranking.slice(0, 6).map((v) => (
              <a class="fila-aviso" href={`/viajes/${v.id}`}>
                <span class="txt">{v.ruta} <span class="muted">· {fechaDia(v.fecha)} · {v.unidad}</span></span>
                <b class={v.dejo < 0 ? "t-cambiar" : "t-ok"}>{soles(v.dejo)}</b>
              </a>
            ))}
          </div>
          {ranking.length > 6 ? <a class="ver-mas" href={`/numeros/rentabilidad?vista=viaje&desde=${rango.desde.slice(0, 7)}&hasta=${rango.hasta.slice(0, 7)}`}>Ver los {ranking.length} viajes</a> : null}
        </section>
        <section class="col">
          <h2 class="titulo-seccion">¿En qué se va la plata?</h2>
          <div class="lista-filas barras-gasto">
            {gastos.length === 0 ? <Vacio>Sin gastos en este periodo.</Vacio> : gastos.slice(0, 6).map((g) => (
              <div class="fila-barra">
                <div class="fila-sep"><span>{g.nombre}</span><b>{soles(g.monto)}</b></div>
                <Barra pct={(g.monto / maxGasto) * 100} color="var(--accent)" />
              </div>
            ))}
          </div>
        </section>
      </div>
      <section class="col">
        <h2 class="titulo-seccion">Ver más</h2>
        <div class="lista-filas">
          {VER_MAS.map((x) => <a class="fila-aviso" href={x.href}><span class="txt">{x.texto}</span><span class="flecha" aria-hidden="true">›</span></a>)}
        </div>
      </section>
    </>
  ));
}

export function rutasNumeros(app: App, d: Deps): void {
  app.get("/numeros", (c) => vista(c as C, d));
}
