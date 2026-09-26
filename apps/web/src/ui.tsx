/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import type { Child, FC, PropsWithChildren } from "hono/jsx";
import { raw } from "hono/html";
import type { EstadoDesgaste, Seccion, UsuarioWeb } from "@sunatapp/core";
import { puedeVer } from "@sunatapp/core";

// ── Formato ──────────────────────────────────────────────────────────────────

/** Cambia en cada arranque del servidor: evita que el celular use CSS/JS viejos de su caché. */
export const V = Date.now().toString(36);

/** Céntimos → "S/ 1,234" (sin decimales, para KPIs y gráficos). */
export function soles(centimos: number): string {
  const s = Math.round(centimos / 100);
  return `${s < 0 ? "-" : ""}S/ ${Math.abs(s).toLocaleString("en-US")}`;
}
/** Céntimos → "S/ 1,234.50". */
export function soles2(centimos: number): string {
  const n = centimos / 100;
  return `${n < 0 ? "-" : ""}S/ ${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export const miles = (n: number | null | undefined) => (n === null || n === undefined ? "—" : Math.round(n).toLocaleString("en-US"));
const MESES = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SET", "OCT", "NOV", "DIC"];
/** "2026-09-13" → "13 SET". */
export function fechaCorta(f: string | null | undefined): string {
  if (!f) return "—";
  const [, m, d] = f.split("-");
  return `${d} ${MESES[Number(m) - 1]}`;
}
export function fechaMedia(f: string | null | undefined): string {
  if (!f) return "—";
  const [y, m, d] = f.split("-");
  return `${d} ${MESES[Number(m) - 1]} ${y!.slice(2)}`;
}
export const nombreMes = (mes: string) => `${MESES[Number(mes.slice(5, 7)) - 1]} ${mes.slice(2, 4)}`;
export const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n}%`);

export const ETIQUETA_ESTADO: Record<EstadoDesgaste, string> = { ok: "OK", proximo: "PRÓXIMO", cambiar: "CAMBIAR YA" };
export const ESTADO_UNIDAD: Record<string, string> = { en_ruta: "EN RUTA", en_base: "EN BASE", en_taller: "EN TALLER", inactivo: "INACTIVO" };
export const CHIP_UNIDAD: Record<string, string> = { en_ruta: "ok", en_base: "neutro", en_taller: "proximo", inactivo: "neutro" };

// ── Navegación ───────────────────────────────────────────────────────────────

export const NAV: Array<{ n: string; etiqueta: string; href: string; seccion: Seccion }> = [
  { n: "01", etiqueta: "DASHBOARD", href: "/", seccion: "dashboard" },
  { n: "02", etiqueta: "TRAILER 3D", href: "/trailer", seccion: "trailer" },
  { n: "03", etiqueta: "FLOTA", href: "/flota", seccion: "flota" },
  { n: "04", etiqueta: "INVENTARIO", href: "/inventario", seccion: "inventario" },
  { n: "05", etiqueta: "REPARACIONES", href: "/reparaciones", seccion: "reparaciones" },
  { n: "06", etiqueta: "VIAJES", href: "/viajes", seccion: "viajes" },
  { n: "07", etiqueta: "FINANZAS", href: "/finanzas", seccion: "finanzas" },
  { n: "08", etiqueta: "RENTABILIDAD", href: "/rentabilidad", seccion: "rentabilidad" },
  { n: "09", etiqueta: "TELEGRAM", href: "/telegram", seccion: "telegram" },
  { n: "10", etiqueta: "SINCRONIZAR", href: "/sincronizar", seccion: "sincronizar" },
];

export interface DatosCabecera {
  empresa: string;
  unidadesActivas: number;
  unidadesTotal: number;
  viajesMes: number;
  margenPct: number | null;
  botEnLinea: boolean;
  hora: string;
  simulado: boolean;
}

const Logo = () => (
  <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
    <rect width="40" height="40" rx="4" fill="#121719" />
    <circle cx="11" cy="13" r="3" fill="#E9E3D6" /><circle cx="20" cy="13" r="3" fill="#E9E3D6" /><circle cx="29" cy="13" r="3" fill="#FF5AAE" />
    <circle cx="11" cy="22" r="3" fill="#E9E3D6" /><circle cx="20" cy="22" r="3" fill="#F2C14E" /><circle cx="29" cy="22" r="3" fill="#E9E3D6" />
    <circle cx="13" cy="30" r="3.5" fill="#8FB4CC" /><circle cx="27" cy="30" r="3.5" fill="#8FB4CC" />
  </svg>
);

export interface PropsLayout {
  titulo: string;
  seccion: Seccion;
  usuario: UsuarioWeb;
  cab: DatosCabecera;
  ok?: string | null;
  error?: string | null;
  scripts?: string[];
  importmap?: boolean;
}

export const Layout: FC<PropsWithChildren<PropsLayout>> = (p) => (
  <html lang="es">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{`${p.titulo} · Control Flota`}</title>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Space+Mono:wght@400;700&display=swap" />
      <link rel="manifest" href="/manifest.webmanifest" />
      <meta name="theme-color" content="#121719" />
      <meta name="mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-title" content="Flota" />
      <link rel="apple-touch-icon" href="/static/iconos/apple-touch-icon.png" />
      <link rel="stylesheet" href={`/static/app.css?v=${V}`} />
      <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Crect width='40' height='40' rx='4' fill='%23121719'/%3E%3Ccircle cx='29' cy='13' r='5' fill='%23FF5AAE'/%3E%3Ccircle cx='13' cy='26' r='5' fill='%238FB4CC'/%3E%3C/svg%3E" />
      {p.importmap ? raw(`<script type="importmap">{"imports":{"three":"/vendor/three/build/three.module.js","three/addons/":"/vendor/three/examples/jsm/"}}</script>`) : null}
    </head>
    <body>
      <div class="pagina">
        <header class="header">
          <Logo />
          <a class="marca" href="/">
            <span class="t">{p.cab.empresa} · <span class="c">Control</span> <span class="f">Flota</span></span>
            <span class="s">TRANSPORTE DE CARGA PESADA · CADA PIEZA, CADA VIAJE, BAJO CONTROL</span>
          </a>
          <div class="datos">
            <div class="dato"><span class="lbl">UNIDADES</span><b>{p.cab.unidadesActivas}/{p.cab.unidadesTotal}</b></div>
            <div class="dato"><span class="lbl">VIAJES MES</span><b class="t-cambiar">{p.cab.viajesMes}</b></div>
            <div class="dato"><span class="lbl">MARGEN</span><b class="t-cambiar">{pct(p.cab.margenPct)}</b></div>
            <a href="/telegram" class={`bot-estado${p.cab.botEnLinea ? "" : " off"}`}>BOT TELEGRAM · {p.cab.botEnLinea ? "EN LÍNEA" : "DESCONECTADO"}</a>
            <span class="hora" data-reloj="">{p.cab.hora}</span>
            <button type="button" class="btn chico primario" id="instalar-app" hidden>⬇ INSTALAR APP</button>
            <div class="usuario-menu">
              <span class="muted">{p.usuario.nombre}</span>
              <form method="post" action="/salir"><button class="btn chico" type="submit">SALIR</button></form>
            </div>
          </div>
        </header>
        <nav class="nav" aria-label="Secciones">
          {NAV.filter((n) => puedeVer(p.usuario.rol, n.seccion)).map((n) => (
            <a href={n.href} class={n.seccion === p.seccion ? "activo" : ""} aria-current={n.seccion === p.seccion ? "page" : undefined}>{n.n} {n.etiqueta}</a>
          ))}
          {puedeVer(p.usuario.rol, "ajustes") ? <a href="/ajustes" class={p.seccion === "ajustes" ? "activo fin" : "fin"}>⚙ AJUSTES</a> : null}
          {p.cab.simulado ? <span class="chip proximo" title="SUNAT en modo simulado">SUNAT SIMULADO</span> : null}
        </nav>
        {p.ok ? <div class="aviso ok" role="status">{p.ok}</div> : null}
        {p.error ? <div class="aviso error" role="alert">{p.error}</div> : null}
        {p.children}
      </div>
      <script src={`/static/app.js?v=${V}`} defer></script>
      {(p.scripts ?? []).map((s) => <script type="module" src={`${s}?v=${V}`}></script>)}
    </body>
  </html>
);

// ── Piezas ───────────────────────────────────────────────────────────────────

export const Panel: FC<PropsWithChildren<{ titulo?: Child; der?: Child; clase?: string; id?: string }>> = (p) => (
  <section class={`panel ${p.clase ?? ""}`} id={p.id}>
    {p.titulo !== undefined ? <div class="panel-cab"><h2>{p.titulo}</h2>{p.der ? <div class="der">{p.der}</div> : null}</div> : null}
    {p.children}
  </section>
);

export const Kpi: FC<{ etiqueta: string; valor: Child; sub?: Child; oscuro?: boolean; negativo?: boolean }> = (p) => (
  <div class={`kpi${p.oscuro ? " oscuro" : ""}`}>
    <span class="lbl">{p.etiqueta}</span>
    <b class={p.negativo ? "neg" : ""}>{p.valor}</b>
    {p.sub ? <span class="sub">{p.sub}</span> : null}
  </div>
);

export const Barra: FC<{ pct: number; estado?: EstadoDesgaste; color?: string; gruesa?: boolean; meta?: [number, number]; linea100?: number }> = (p) => (
  <div class={`barra${p.gruesa ? " gruesa" : ""}`} role="img" aria-label={`${Math.round(p.pct)}%`}>
    {p.meta ? <span class="meta" style={`left:${p.meta[0]}%;width:${p.meta[1] - p.meta[0]}%`}></span> : null}
    <i class={p.estado ? `b-${p.estado}` : ""} style={`width:${Math.max(0, Math.min(100, p.pct))}%${p.color ? `;background:${p.color}` : ""}`}></i>
    {p.linea100 !== undefined ? <span class="linea100" style={`left:calc(${p.linea100}% - 1px)`}></span> : null}
  </div>
);

export const ChipEstado: FC<{ estado: EstadoDesgaste }> = (p) => <span class={`chip ${p.estado}`}>{ETIQUETA_ESTADO[p.estado]}</span>;

export const Origen: FC<{ origen: string }> = (p) => (
  <span class={`chip ${p.origen === "telegram" ? "tg" : "neutro"}`}>{p.origen === "telegram" ? "TELEGRAM" : p.origen === "web" ? "WEB" : "SISTEMA"}</span>
);

export const Vacio: FC<PropsWithChildren> = (p) => <div class="vacio">{p.children}</div>;

/** Contenedor de datos JSON para los scripts del cliente. */
export const Datos: FC<{ id: string; valor: unknown }> = (p) =>
  raw(`<script type="application/json" id="${p.id}">${JSON.stringify(p.valor).replace(/</g, "\\u003c")}</script>`);

export const PaginaSimple: FC<PropsWithChildren<{ titulo: string }>> = (p) => (
  <html lang="es">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{`${p.titulo} · Control Flota`}</title>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Space+Mono:wght@400;700&display=swap" />
      <link rel="manifest" href="/manifest.webmanifest" />
      <meta name="theme-color" content="#121719" />
      <meta name="mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-title" content="Flota" />
      <link rel="apple-touch-icon" href="/static/iconos/apple-touch-icon.png" />
      <link rel="stylesheet" href={`/static/app.css?v=${V}`} />
      <link rel="icon" type="image/svg+xml" href="/static/iconos/icono.svg" />
    </head>
    <body>
      <div class="pagina login">
        <div class="header" style="justify-content:center">
          <Logo />
          <div class="marca"><span class="t"><span class="c">Control</span> <span class="f">Flota</span></span><span class="s">TRANSPORTE DE CARGA PESADA</span></div>
        </div>
        {p.children}
      </div>
      <script src={`/static/app.js?v=${V}`} defer></script>
    </body>
  </html>
);
