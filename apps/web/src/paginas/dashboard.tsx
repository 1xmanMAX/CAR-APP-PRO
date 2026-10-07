/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import type { FC } from "hono/jsx";
import {
  gastosSinViaje, hoy, listarCategorias, listarCobrosPendientes, listarDocumentosAtascados, listarEventos, listarPorRevisar, listarViajesFlota, nombreCategoria, primerNombre,
  puedeEditar, puedeVer, resumenInicio, saludFlota, viajesEnRuta, viajesPorRevisar, type Contexto, type RolUsuario,
} from "@sunatapp/core";
import { pagina, type App, type C, type Deps } from "../base";
import { RUTA, veAjustes } from "../lugares";
import { Cabecera, Cifra, diasEntre, fechaCorta, nDias, Icono, ListaViajes, mesLargo, soles, soles2, TarjetaEnRuta, Vacio, type DatosCabecera } from "../ui";
import { ESTADO_LECTURA } from "./revisar";

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
  /** Ya sale con detalle en su propia sección de `/?ver=atencion` (no se repite en «Otros avisos»). */
  conSeccion?: boolean;
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
      // Uno solo abre Anotar precargado; varios, la lista completa.
      r.push({
        color: "proximo", fijo: true, conSeccion: true, texto: `${docs.length} ${docs.length === 1 ? "foto o mensaje del chofer" : "fotos o mensajes del chofer"} por confirmar`,
        href: docs.length === 1 ? `/anotar?documento=${docs[0]!.documentoId}` : RUTA.revisar,
      });
    }
    const sueltos = await gastosSinViaje(ctx);
    if (sueltos.length) r.push({ color: "proximo", conSeccion: true, texto: `${sueltos.length} ${sueltos.length === 1 ? "gasto del chofer" : "gastos del chofer"} sin viaje`, href: RUTA.revisar });
    const cobros = await listarCobrosPendientes(ctx);
    for (const f of cobros.filas.filter((x) => x.estado === "vencida").slice(0, 2)) {
      r.push({ color: "cambiar", texto: `${f.cliente} debe ${soles(f.saldo)} hace ${nDias(diasEntre(f.fechaVencimiento, h))}`, href: RUTA.cobrar(f.facturaId) });
    }
    const sinGuia = (await viajesPorRevisar(ctx)).filter((x) => x.motivo === "sin_guia" && x.viajeId !== null);
    if (sinGuia.length === 1) r.push({ color: "proximo", conSeccion: true, texto: `${sinGuia[0]!.codigo} no tiene guía`, href: `/viajes/${sinGuia[0]!.viajeId}` });
    else if (sinGuia.length > 1) r.push({ color: "proximo", conSeccion: true, texto: `${sinGuia.length} viajes sin guía`, href: RUTA.revisar });
  }
  if (puedeVer(rol, "trailer")) {
    for (const s of await saludFlota(ctx)) {
      for (const p of s.partes.filter((x) => x.estado === "cambiar").slice(0, 2)) {
        r.push({ color: "cambiar", texto: `${enOracion(p.nombreCorto)} de ${s.unidad.codigo}: cambiar ya`, href: RUTA.camion(s.unidad.id, `?parte=${p.id}`) });
      }
    }
  }
  if (rol === "dueno") {
    const a = await listarDocumentosAtascados(ctx);
    const n = a.facturas.length + a.porReemitir.length + a.guias.length;
    if (n) r.push({ color: "cambiar", fijo: true, texto: `${n} ${n === 1 ? "documento de SUNAT espera" : "documentos de SUNAT esperan"} tu ayuda`, href: "/viajes#sunat-atascados" });
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

const MOTIVO_REVISAR: Record<string, string> = { sin_guia: "SIN GUÍA", guia_rechazada: "GUÍA RECHAZADA", cierre_automatico: "CERRADO SOLO", guia_sin_viaje: "GUÍA SIN VIAJE" };
const NOMBRE_MENSAJE: Record<string, string> = { foto: "Foto", voz: "Nota de voz", texto: "Mensaje" };

/** «Necesita tu atención» completo (antes «Por revisar»): mensajes del chofer, viajes y guías, gastos sin viaje y el resto de avisos. */
async function vistaAtencion(c: C, d: Deps) {
  const ctx = d.ctx;
  const u = c.get("usuario");
  const veViajes = puedeVer(u.rol, "viajes");
  const edita = puedeEditar(u.rol, "viajes");
  const cab = await d.cabecera();
  const [docs, viajesRev, sueltos, viajes, categorias, avisos] = await Promise.all([
    veViajes ? listarPorRevisar(ctx) : Promise.resolve([]),
    veViajes ? viajesPorRevisar(ctx) : Promise.resolve([]),
    veViajes ? gastosSinViaje(ctx) : Promise.resolve([]),
    veViajes ? listarViajesFlota(ctx, { limite: 60 }) : Promise.resolve([]),
    listarCategorias(ctx, { soloActivas: true }),
    atenciones(ctx, u.rol, cab),
  ]);
  const otros = elegirAvisos(avisos.filter((a) => !a.conSeccion), true);
  /** «S/ 350.00 · Combustible» o «S/ 500.00 · Plata al chofer»: lo que leyó la IA, para reconocerlo sin abrirlo. */
  const leidoCorto = (l: (typeof docs)[number]["lectura"]) =>
    l?.tipo === "gasto" ? `S/ ${l.monto.toFixed(2)} · ${nombreCategoria(l.categoria, categorias)}` : l?.tipo === "entrega" ? `S/ ${l.monto.toFixed(2)} · Plata al chofer` : null;
  return pagina(c, d, { titulo: "Necesita tu atención", seccion: "dashboard" }, (
    <>
      <Cabecera titulo="Necesita tu atención" volver="/" />
      {docs.length ? (
        <section class="col">
          <h2 class="titulo-seccion">Fotos y mensajes del chofer · {docs.length}</h2>
          <div class="lista-filas">
            {docs.map((x) => {
              const txt = (
                <span class="txt">{NOMBRE_MENSAJE[x.tipo] ?? "Mensaje"} del {fechaCorta(x.desde.toISOString().slice(0, 10))} · <span class="muted">{ESTADO_LECTURA[x.estado] ?? x.estado}</span>
                  {leidoCorto(x.lectura) ? <><br /><b>{leidoCorto(x.lectura)}</b></> : null}
                  {x.texto ? <><br /><span class="muted">«{x.texto}»</span></> : null}</span>
              );
              return edita ? (
                <a class="fila-aviso" href={`/anotar?documento=${x.documentoId}&volver=%2F%3Fver%3Datencion`}>
                  <span class="punto" style="background:var(--amber-bar)"></span>{txt}<span class="flecha" aria-hidden="true">›</span>
                </a>
              ) : <div class="fila-aviso"><span class="punto" style="background:var(--amber-bar)"></span>{txt}</div>;
            })}
          </div>
        </section>
      ) : null}
      {viajesRev.length ? (
        <section class="col">
          <h2 class="titulo-seccion">Viajes y guías · {viajesRev.length}</h2>
          <div class="lista-filas">
            {viajesRev.map((x) => (
              <a class="fila-aviso" href={x.viajeId ? `/viajes/${x.viajeId}` : "/viajes"}>
                <span class={`chip ${x.motivo === "guia_rechazada" ? "cambiar" : "proximo"}`}>{MOTIVO_REVISAR[x.motivo] ?? x.motivo}</span>
                <span class="txt"><b>{x.codigo}</b> · {x.detalle}</span><span class="flecha" aria-hidden="true">›</span>
              </a>
            ))}
          </div>
        </section>
      ) : null}
      {sueltos.length ? (
        <section class="col">
          <h2 class="titulo-seccion">Gastos sin viaje · {sueltos.length}</h2>
          <div class="lista-filas">
            {sueltos.map((g) => {
              const opciones = viajes.filter((v) => !g.vehiculoId || v.vehiculoId === g.vehiculoId);
              return (
                <form method="post" action={`/revisar/gasto/${g.id}`} class="fila-papel asignar">
                  <span><b>{fechaCorta(g.fecha)}</b> · {nombreCategoria(g.categoria, categorias)} · <b>{soles2(g.monto)}</b>
                    {g.nota || g.proveedorNombre ? <span class="muted"> · {[g.proveedorNombre, g.nota].filter(Boolean).join(" · ")}</span> : null}
                    {g.conFoto ? <> · <a href={`/archivo/gasto/${g.id}`} target="_blank">ver foto</a></> : null}</span>
                  {edita ? (
                    opciones.length ? (
                      <>
                        <select name="viajeId" aria-label="¿A qué viaje?">{opciones.map((v) => <option value={v.id}>{v.ruta} · {v.codigo}</option>)}</select>
                        <button class="btn chico" type="submit">Asignar</button>
                      </>
                    ) : <span class="muted">Ese camión no tiene viajes todavía.</span>
                  ) : null}
                </form>
              );
            })}
          </div>
        </section>
      ) : null}
      {otros.length ? <section class="col"><h2 class="titulo-seccion">Otros avisos</h2><ListaAtencion items={otros} /></section> : null}
      {!docs.length && !viajesRev.length && !sueltos.length && !otros.length ? <div class="lista-filas"><Vacio>Todo en orden. 👌</Vacio></div> : null}
    </>
  ));
}

async function vista(c: C, d: Deps) {
  if (c.req.query("ver") === "atencion") return vistaAtencion(c, d);
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
            <Cifra etiqueta="Entró" valor={soles(res.entro)} sub={`${res.viajes} ${res.viajes === 1 ? "viaje" : "viajes"} (con los en ruta)`} tono="ok" />
            <Cifra etiqueta="Salió" valor={soles(res.salio)} />
            <Cifra etiqueta="Te deben" valor={soles(res.teDeben)} sub={`${res.facturasPorCobrar} facturas`} tono={res.vencido > 0 ? "cambiar" : undefined} />
          </div>
        </div>
      ) : null}
      <div class="inicio-cols">
        <section class="col">
          <h2 class="titulo-seccion">Necesita tu atención</h2>
          {avisos.length === 0 ? <div class="lista-filas"><Vacio>Todo en orden. 👌</Vacio></div> : <ListaAtencion items={elegirAvisos(avisos, false)} />}
          {avisos.length > MAX_AVISOS ? <a class="ver-mas" href={RUTA.revisar}>Ver los {avisos.length} avisos</a> : null}
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
