/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import type { FC } from "hono/jsx";
import {
  hoy, listarCobrosPendientes, listarEventos, listarPorRevisar, listarViajesFlota, primerNombre, puedeVer, resumenInicio, saludFlota,
  viajesEnRuta, viajesPorRevisar, type Contexto, type RolUsuario,
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

export interface Atencion { color: "proximo" | "cambiar"; texto: string; href: string }
const COLOR_ATENCION: Record<Atencion["color"], string> = { proximo: "var(--amber-bar)", cambiar: "var(--accent)" };

/** Lo que necesita atención según el rol: lo urgente (magenta) primero. */
export async function atenciones(ctx: Contexto, rol: RolUsuario, cab: DatosCabecera): Promise<Atencion[]> {
  const r: Atencion[] = [];
  const h = hoy(ctx);
  if (puedeVer(rol, "viajes")) {
    const docs = await listarPorRevisar(ctx);
    if (docs.length) {
      r.push({ color: "proximo", texto: `${docs.length} ${docs.length === 1 ? "foto o mensaje del chofer" : "fotos o mensajes del chofer"} por confirmar`, href: RUTA.revisar });
    }
    const cobros = await listarCobrosPendientes(ctx);
    for (const f of cobros.filas.filter((x) => x.estado === "vencida").slice(0, 2)) {
      r.push({ color: "cambiar", texto: `${f.cliente} debe ${soles(f.saldo)} hace ${diasEntre(f.fechaVencimiento, h)} días`, href: RUTA.cobrar(f.facturaId) });
    }
    const sinGuia = (await viajesPorRevisar(ctx)).filter((x) => x.motivo === "sin_guia" && x.viajeId !== null);
    if (sinGuia.length === 1) r.push({ color: "proximo", texto: `${sinGuia[0]!.codigo} no tiene guía`, href: `/viajes/${sinGuia[0]!.viajeId}` });
    else if (sinGuia.length > 1) r.push({ color: "proximo", texto: `${sinGuia.length} viajes sin guía`, href: RUTA.revisar });
  }
  if (puedeVer(rol, "trailer")) {
    for (const s of await saludFlota(ctx)) {
      for (const p of s.partes.filter((x) => x.estado === "cambiar").slice(0, 2)) {
        r.push({ color: "cambiar", texto: `${p.nombreCorto} de ${s.unidad.codigo}: cambiar ya`, href: RUTA.camion(s.unidad.id, `?parte=${p.id}`) });
      }
    }
  }
  if (cab.simulado && puedeVer(rol, "ajustes")) r.push({ color: "proximo", texto: "SUNAT en modo simulado: las guías y facturas no son reales", href: "/ajustes/dispositivo" });
  if (!cab.botEnLinea) r.push({ color: "cambiar", texto: "El bot de Telegram está desconectado", href: "/telegram" });
  return r.sort((a, b) => Number(a.color !== "cambiar") - Number(b.color !== "cambiar"));
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
  return pagina(c, d, { titulo: "Inicio", seccion: "dashboard" }, (
    <>
      <Cabecera
        sobre={`${cab.empresa} · ${mesLargo(mes)}`} titulo={`Hola, ${primerNombre(u.nombre)}`}
        der={veAjustes(u.rol) ? <a class="btn-icono solo-movil" href="/ajustes" aria-label="Ajustes"><Icono n="ajustes" t={20} /></a> : undefined}
      />
      {res ? (
        <div class="inicio-cifras">
          <section class="tarjeta-oscura">
            <span class="lbl">Ganaste este mes</span>
            <b class={`cifra-grande${res.ganancia < 0 ? " neg" : ""}`}>{soles(res.ganancia)}</b>
            <span class="sub">{res.ganancia >= res.gananciaAnterior
              ? `Vas mejor que ${mesLargo(res.mesAnterior)} (${soles(res.gananciaAnterior)})`
              : `${mesLargo(res.mesAnterior)} fue mejor (${soles(res.gananciaAnterior)})`}</span>
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
          {avisos.length === 0 ? <div class="lista-filas"><Vacio>Todo en orden. 👌</Vacio></div> : <ListaAtencion items={avisos.slice(0, 5)} />}
          {avisos.length > 5 ? <a class="ver-mas" href={RUTA.revisar}>Ver los {avisos.length} avisos</a> : null}
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
