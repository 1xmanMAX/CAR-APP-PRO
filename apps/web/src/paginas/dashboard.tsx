/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import type { FC } from "hono/jsx";
import {
  deudaPrestamos, estadoBot, gastosPorCategoria, hoy, listarEventos, listarRepuestos, listarViajesFlota, rangoMes, resumenFinanciero,
  resumirInventario, saludFlota, sumarDias, type Contexto,
} from "@sunatapp/core";
import { pagina, type App, type C, type Deps } from "../base";
import { Barra, CHIP_UNIDAD, ESTADO_UNIDAD, Kpi, Panel, soles, Vacio } from "../ui";

type Evento = Awaited<ReturnType<typeof listarEventos>>[number];

function horaLima(d: Date): string {
  return new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}

export const FeedTelegram: FC<{ eventos: Evento[] }> = ({ eventos }) =>
  eventos.length === 0 ? (
    <div class="muted" style="font-size:12px">Todavía no llegan mensajes del bot. Los choferes registran viajes, gastos y km con /viaje, /gasto y /km.</div>
  ) : (
    <div class="feed">
      {eventos.map((e) => (
        <div class={`ev${e.estado === "error" ? " error" : ""}`}>
          <span class="h">{horaLima(e.fecha)}</span>
          <div>
            <span class="cmd">{e.comando}</span>{e.unidad ? <span class="muted"> · {e.unidad}</span> : null} <span class="muted">· {e.autor}</span>
            <div>{e.texto}</div>
          </div>
        </div>
      ))}
    </div>
  );

export async function htmlFeed(ctx: Contexto, n = 14): Promise<string> {
  return (<FeedTelegram eventos={await listarEventos(ctx, n)} />).toString();
}

async function vista(c: C, d: Deps) {
  const ctx = d.ctx;
  const h = hoy(ctx);
  const { desde, hasta } = rangoMes(h);
  const [fin, repuestos, deuda, salud, eventos, bot, gastosCat, viajes30] = await Promise.all([
    resumenFinanciero(ctx, desde, hasta),
    listarRepuestos(ctx),
    deudaPrestamos(ctx),
    saludFlota(ctx),
    listarEventos(ctx, 14),
    estadoBot(ctx),
    gastosPorCategoria(ctx, desde, hasta),
    listarViajesFlota(ctx, { desde: sumarDias(h, -29), hasta: h, limite: 2000 }),
  ]);
  const inv = resumirInventario(repuestos);
  const todas = salud.flatMap((s) => s.partes.map((p) => ({ ...p, unidad: s.unidad.codigo })));
  const proximos = todas.filter((p) => p.pct >= 50).slice(0, 9);
  const maxGasto = Math.max(1, ...gastosCat.map((g) => g.monto));
  const maxKm = Math.max(1, ...viajes30.map((v) => v.km ?? 0));
  const diaIdx = (f: string) => 29 - Math.round((Date.parse(`${h}T00:00:00Z`) - Date.parse(`${f}T00:00:00Z`)) / 86_400_000);

  return pagina(c, d, { titulo: "Dashboard", seccion: "dashboard" }, (
    <>
      <section class="kpis" aria-label="Resumen del mes">
        <Kpi oscuro etiqueta="GANANCIA NETA · MES" valor={soles(fin.ganancia)} sub={fin.margenPct !== null ? `margen ${fin.margenPct}%` : undefined} />
        <Kpi etiqueta="INGRESOS · FLETES" valor={soles(fin.ingresos)} sub={`${fin.viajes} viajes · ${fin.km.toLocaleString("en-US")} km`} />
        <Kpi etiqueta="GASTOS" valor={soles(fin.gastos)} />
        <Kpi etiqueta="INVERTIDO EN REPUESTOS" valor={soles(inv.inversionTotal)} sub={`${soles(inv.enAlmacen)} en almacén`} />
        <Kpi etiqueta="DEUDA PRÉSTAMOS" valor={soles(deuda)} />
      </section>

      <div class="grid g-main">
        <Panel titulo="FLOTA · SALUD POR PARTE" der={<a href="/flota" class="lbl-12">VER →</a>}>
          {salud.length === 0 ? <Vacio>Agrega tu primera unidad en <a href="/flota">Flota</a>.</Vacio> : (
            <div class="filas">
              {salud.map((s) => (
                <a class="fila-flota" href={`/trailer/${s.unidad.id}`}>
                  <div>
                    <div class="mono-t" style="font-size:16px">{s.unidad.codigo}</div>
                    <span class={`chip ${CHIP_UNIDAD[s.unidad.estado]}`}>{ESTADO_UNIDAD[s.unidad.estado]}</span>
                  </div>
                  <div class="tira" aria-label={`${s.conteo.ok} ok, ${s.conteo.proximo} próximas, ${s.conteo.cambiar} por cambiar`}>
                    {s.partes.length ? s.partes.map((p) => <i class={`b-${p.estado}`} title={`${p.nombreCorto} ${p.pct}%`}></i>) : <span class="muted" style="font-size:11px">sin partes controladas</span>}
                  </div>
                  <div style="font-size:11px;text-align:right" class={s.peor ? `t-${s.peor.estado}` : "muted"}>
                    {s.peor ? <><b>{s.peor.nombreCorto}</b><br />{s.peor.restanteTexto}</> : "—"}
                  </div>
                </a>
              ))}
            </div>
          )}
          <span class="lbl">CADA CUADRO = UNA PARTE · AZUL OK · ÁMBAR PRÓXIMO · MAGENTA CAMBIAR</span>
        </Panel>

        <Panel titulo="PRÓXIMOS CAMBIOS · ANTES DE QUE FALLEN">
          {proximos.length === 0 ? <Vacio>Ninguna parte pasa del 50%. 👌</Vacio> : (
            <div class="filas">
              {proximos.map((p) => (
                <a class="fila-parte" href={`/trailer/${p.vehiculoId}?parte=${p.id}`}>
                  <span><b>{p.unidad}</b> · {p.nombreCorto} <span class="muted">· quedan {p.restanteTexto.toLowerCase()}</span></span>
                  <b class={`t-${p.estado} mono-t`}>{p.pct}%</b>
                  <Barra pct={p.pct} estado={p.estado} />
                </a>
              ))}
            </div>
          )}
        </Panel>

        <Panel clase="oscuro" titulo="TELEGRAM · ENTRADAS DEL BOT" der={<span class={`vivo${bot.enLinea ? "" : " off"}`}>● {bot.enLinea ? "LIVE" : "BOT APAGADO"}</span>}>
          <div data-refrescar="/api/feed" data-cada="20">
            <FeedTelegram eventos={eventos} />
          </div>
          <a href="/telegram" style="color:var(--accent-on-dark);font-size:11px">VER CONVERSACIÓN DEL BOT →</a>
        </Panel>
      </div>

      <div class="grid g-lado">
        <Panel titulo="VIAJES · CUÁNDO SALE CADA TRAILER" der={<span class="lbl">ÚLTIMOS 30 DÍAS · ALTURA = KM</span>}>
          {salud.length === 0 ? <Vacio>Sin unidades.</Vacio> : salud.map((s) => {
            const propios = viajes30.filter((v) => v.vehiculoId === s.unidad.id);
            return (
              <div class="carril">
                <b class="mono-t">{s.unidad.codigo}</b>
                <div class="pista" aria-label={`${propios.length} viajes en 30 días`}>
                  {propios.map((v) => (
                    <i title={`${v.fecha} · ${v.ruta} · ${v.km ?? "?"} km`} style={`left:calc(${(diaIdx(v.fecha) / 30) * 100}%);height:${v.km ? Math.max(12, (v.km / maxKm) * 100) : 20}%;${v.km ? "" : "opacity:.45"}`}></i>
                  ))}
                </div>
                <span class="muted" style="font-size:11px;text-align:right">{propios.length} viajes</span>
              </div>
            );
          })}
        </Panel>

        <Panel titulo="GASTOS · POR CATEGORÍA" der={<a class="lbl-12" href="/finanzas">FINANZAS →</a>}>
          {gastosCat.length === 0 ? <Vacio>Sin gastos este mes.</Vacio> : (
            <div class="filas">
              {gastosCat.map((g) => (
                <div>
                  <div style="display:flex;justify-content:space-between;font-size:12px"><span>{g.nombre}</span><b>{soles(g.monto)}</b></div>
                  <Barra pct={(g.monto / maxGasto) * 100} color="var(--accent)" />
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </>
  ));
}

export function rutasDashboard(app: App, d: Deps): void {
  app.get("/", (c) => vista(c, d));
  app.get("/api/feed", async (c) => c.html(await htmlFeed(d.ctx, Math.min(60, Number(c.req.query("n")) || 14))));
}
