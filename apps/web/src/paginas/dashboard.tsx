/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import type { FC } from "hono/jsx";
import {
  hoy, listarCobrosPendientes, listarEventos, listarPorRevisar, listarViajesFlota, primerNombre, puedeVer, resumenInicio, saludFlota,
  viajeDeFactura, viajesEnRuta, viajesPorRevisar, type Contexto, type RolUsuario,
} from "@sunatapp/core";
import { pagina, type App, type C, type Deps } from "../base";
import { RUTA, veAjustes } from "../lugares";
import { Cabecera, Cifra, diasEntre, Icono, ListaViajes, mesLargo, soles, TarjetaEnRuta, Vacio, type DatosCabecera } from "../ui";

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

export interface Atencion {
  color: "proximo" | "cambiar";
  texto: string;
  href: string;
  /** Siempre entra en los 5 primeros (las fotos y mensajes del chofer por confirmar, spec §4.1). */
  fijo?: boolean;
}
const COLOR_ATENCION: Record<Atencion["color"], string> = { proximo: "var(--amber-bar)", cambiar: "var(--accent)" };
export const MAX_AVISOS = 5;

/** «FRENOS SEMIRREMOLQUE» → «Frenos semirremolque» (solo si viene todo en mayúsculas). */
export function enOracion(s: string): string {
  const t = s.trim();
  return t && t === t.toUpperCase() ? t[0]! + t.slice(1).toLowerCase() : t;
}

/** Lo fijo primero, luego lo urgente (magenta), luego lo demás; corta en 5 salvo que se pidan todos. */
export function elegirAvisos(items: Atencion[], todos: boolean): Atencion[] {
  const rango = (a: Atencion) => (a.fijo ? 0 : a.color === "cambiar" ? 1 : 2);
  const orden = [...items].sort((a, b) => rango(a) - rango(b));
  return todos ? orden : orden.slice(0, MAX_AVISOS);
}

/** Lo que necesita atención según el rol (sin cortar ni ordenar: ver `elegirAvisos`). */
export async function atenciones(ctx: Contexto, rol: RolUsuario, cab: DatosCabecera): Promise<Atencion[]> {
  const r: Atencion[] = [];
  const h = hoy(ctx);
  if (puedeVer(rol, "viajes")) {
    const docs = await listarPorRevisar(ctx);
    if (docs.length) {
      r.push({ color: "proximo", fijo: true, texto: `${docs.length} ${docs.length === 1 ? "foto o mensaje del chofer" : "fotos o mensajes del chofer"} por confirmar`, href: RUTA.revisar });
    }
    const cobros = await listarCobrosPendientes(ctx);
    for (const f of cobros.filas.filter((x) => x.estado === "vencida").slice(0, 2)) {
      r.push({ color: "cambiar", texto: `${f.cliente} debe ${soles(f.saldo)} hace ${diasEntre(f.fechaVencimiento, h)} días`, href: RUTA.cobrar(await viajeDeFactura(ctx, f.facturaId)) });
    }
    const sinGuia = (await viajesPorRevisar(ctx)).filter((x) => x.motivo === "sin_guia" && x.viajeId !== null);
    if (sinGuia.length === 1) r.push({ color: "proximo", texto: `${sinGuia[0]!.codigo} no tiene guía`, href: `/viajes/${sinGuia[0]!.viajeId}` });
    else if (sinGuia.length > 1) r.push({ color: "proximo", texto: `${sinGuia.length} viajes sin guía`, href: RUTA.revisar });
  }
  if (puedeVer(rol, "trailer")) {
    for (const s of await saludFlota(ctx)) {
      for (const p of s.partes.filter((x) => x.estado === "cambiar").slice(0, 2)) {
        r.push({ color: "cambiar", texto: `${enOracion(p.nombreCorto)} de ${s.unidad.codigo}: cambiar ya`, href: RUTA.camion(s.unidad.id, `?parte=${p.id}`) });
      }
    }
  }
  if (cab.simulado && puedeVer(rol, "ajustes")) r.push({ color: "proximo", texto: "SUNAT en modo simulado: las guías y facturas no son reales", href: "/ajustes/dispositivo" });
  if (!cab.botEnLinea) r.push({ color: "proximo", texto: "El bot de Telegram está desconectado", href: "/telegram" });
  return r;
}

/** Texto de la tarjeta oscura: «Ganaste» o «Perdiste» (monto sin signo) y la comparación con el mes anterior. */
export function textoGanancia(ganancia: number, anterior: number, mesAnterior: string): { etiqueta: string; monto: string; sub: string; perdida: boolean } {
  const perdida = ganancia < 0;
  const cuanto = (n: number) => (n === 0 ? soles(0) : `${n > 0 ? "ganaste" : "perdiste"} ${soles(Math.abs(n))}`);
  const mes = mesLargo(mesAnterior);
  const comp = ganancia > anterior ? "Mejor que" : ganancia < anterior ? "Peor que" : "Igual que";
  return { etiqueta: perdida ? "Perdiste este mes" : "Ganaste este mes", monto: soles(Math.abs(ganancia)), sub: `${comp} ${mes} (${cuanto(anterior)})`, perdida };
}

export const ListaAtencion: FC<{ items: Atencion[] }> = ({ items }) => (
  <div class="lista-filas">
    {items.map((a) => (
      <a class="fila-aviso" href={a.href}>
        <span class="punto" style={`background:${COLOR_ATENCION[a.color]}`}></span>
        <span class="txt">{a.texto}</span>
        <span class="flecha" aria-hidden="true">›</span>
      </a>
    ))}
  </div>
);

async function vista(c: C, d: Deps) {
  const ctx = d.ctx;
  const u = c.get("usuario");
  const cab = await d.cabecera();
  const veViajes = puedeVer(u.rol, "viajes");
  const [res, enRuta, avisos, ultimos] = await Promise.all([
    puedeVer(u.rol, "finanzas") ? resumenInicio(ctx) : Promise.resolve(null),
    veViajes ? viajesEnRuta(ctx) : Promise.resolve([]),
    atenciones(ctx, u.rol, cab),
    veViajes ? listarViajesFlota(ctx, { limite: 30 }).then((vs) => vs.filter((v) => v.estado === "cerrado").slice(0, 5)) : Promise.resolve([]),
  ]);
  const mes = hoy(ctx).slice(0, 7);
  const todos = c.req.query("ver") === "atencion";
  const tg = res ? textoGanancia(res.ganancia, res.gananciaAnterior, res.mesAnterior) : null;
  return pagina(c, d, { titulo: "Inicio", seccion: "dashboard" }, (
    <>
      <Cabecera
        sobre={`${cab.empresa} · ${mesLargo(mes)}`} titulo={`Hola, ${primerNombre(u.nombre)}`}
        der={veAjustes(u.rol) ? <a class="btn-icono solo-movil" href="/ajustes" aria-label="Ajustes"><Icono n="ajustes" t={20} /></a> : undefined}
      />
      {res && tg ? (
        <div class="inicio-cifras">
          <section class={`tarjeta-oscura${tg.perdida ? " perdida" : ""}`}>
            <span class="lbl">{tg.etiqueta}</span>
            <b class={`cifra-grande${tg.perdida ? " neg" : ""}`}>{tg.monto}</b>
            <span class="sub">{tg.sub}</span>
          </section>
          <div class="tres-cifras">
            <Cifra etiqueta="Entró" valor={soles(res.entro)} sub={`${res.viajes} viajes`} tono="ok" />
            <Cifra etiqueta="Salió" valor={soles(res.salio)} />
            <Cifra etiqueta="Te deben" valor={soles(res.teDeben)} sub={`${res.facturasPorCobrar} facturas`} tono={res.vencido > 0 ? "cambiar" : undefined} />
          </div>
        </div>
      ) : null}
      <div class="inicio-cols">
        <section class="col">
          <h2 class="titulo-seccion">Necesita tu atención</h2>
          {avisos.length === 0 ? <div class="lista-filas"><Vacio>Todo en orden. 👌</Vacio></div> : <ListaAtencion items={elegirAvisos(avisos, todos)} />}
          {todos
            ? <a class="ver-mas" href="/">Ver menos</a>
            : avisos.length > MAX_AVISOS ? <a class="ver-mas" href="/?ver=atencion">Ver los {avisos.length} avisos</a> : null}
        </section>
        {veViajes ? (
          <section class="col">
            <h2 class="titulo-seccion">En ruta ahora</h2>
            {enRuta.length === 0 ? <div class="lista-filas"><Vacio>Ningún camión está en ruta.</Vacio></div> : enRuta.map((v) => <TarjetaEnRuta v={v} />)}
          </section>
        ) : null}
      </div>
      {ultimos.length ? (
        <section class="col solo-pc">
          <h2 class="titulo-seccion">Últimos viajes</h2>
          <ListaViajes viajes={ultimos} />
        </section>
      ) : null}
    </>
  ));
}

export function rutasDashboard(app: App, d: Deps): void {
  app.get("/", (c) => vista(c, d));
  app.get("/api/feed", async (c) => c.html(await htmlFeed(d.ctx, Math.min(60, Number(c.req.query("n")) || 14))));
}
