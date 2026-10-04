/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import type { Child, FC, PropsWithChildren } from "hono/jsx";
import { raw } from "hono/html";
import type { EstadoDesgaste, Pieza, Seccion, UsuarioWeb } from "@sunatapp/core";
import { listaDePiezas, puedeVer } from "@sunatapp/core";

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

/** Estado con símbolo además del color (● ▲ ■): se distingue sin ver colores (WCAG 1.4.1). */
export const ETIQUETA_ESTADO: Record<EstadoDesgaste, string> = { ok: "● OK", proximo: "▲ PRÓXIMO", cambiar: "■ CAMBIAR YA" };
export const ESTADO_UNIDAD: Record<string, string> = { en_ruta: "EN RUTA", en_base: "EN BASE", en_taller: "EN TALLER", inactivo: "INACTIVO" };
export const CHIP_UNIDAD: Record<string, string> = { en_ruta: "ok", en_base: "neutro", en_taller: "proximo", inactivo: "neutro" };

// ── Navegación ───────────────────────────────────────────────────────────────

/** Íconos de línea (24×24) para la barra inferior y el menú «Más»: siempre con su texto al lado. */
const ICONOS: Record<string, string> = {
  inicio: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
  viajes: "M4 19c3-6 6-2 8-7s5-6 8-7M4 19h0M20 5h0M4 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM20 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  finanzas: "M3 7h18v12H3zM3 11h18M7 15h3",
  trailer: "M2 7h11v9H2zM13 10h4l4 3v3h-8zM6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  flota: "M3 6h18M3 12h18M3 18h18",
  inventario: "M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10",
  reparaciones: "M14 6a4 4 0 0 0-5 5l-6 6 3 3 6-6a4 4 0 0 0 5-5l-2 2-3-3z",
  rentabilidad: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  telegram: "M21 4L3 11l6 2 2 6 3-4 5 4z",
  sincronizar: "M4 12a8 8 0 0 1 14-5l2 2M20 12a8 8 0 0 1-14 5l-2-2M20 4v5h-5M4 20v-5h5",
  ajustes: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-1-3-2 .5-1.5-1.5L17 5l-3-1-1 2h-2L10 4 7 5l.5 2L6 8.5 4 8l-1 3 2 1v0l-2 1 1 3 2-.5L7.5 16 7 18l3 1 1-2h2l1 2 3-1-.5-2 1.5-1.5 2 .5 1-3z",
  mas: "M5 12h0M12 12h0M19 12h0",
};
export const Icono: FC<{ n: string }> = (p) => (
  <svg class="ico" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={p.n === "mas" ? 3.2 : 1.8} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d={ICONOS[p.n] ?? ICONOS.mas} />
  </svg>
);

/** Secciones. Las `principal` van en la barra inferior del celular (al alcance del pulgar); el resto, en «Más». */
export const NAV: Array<{ etiqueta: string; corto: string; href: string; seccion: Seccion; principal?: boolean }> = [
  { etiqueta: "INICIO", corto: "Inicio", href: "/", seccion: "dashboard", principal: true },
  { etiqueta: "VIAJES", corto: "Viajes", href: "/viajes", seccion: "viajes", principal: true },
  { etiqueta: "FINANZAS", corto: "Gastos", href: "/finanzas", seccion: "finanzas", principal: true },
  { etiqueta: "TRAILER 3D", corto: "Trailer 3D", href: "/trailer", seccion: "trailer", principal: true },
  { etiqueta: "FLOTA", corto: "Flota", href: "/flota", seccion: "flota" },
  { etiqueta: "REPARACIONES", corto: "Reparaciones", href: "/reparaciones", seccion: "reparaciones" },
  { etiqueta: "INVENTARIO", corto: "Inventario", href: "/inventario", seccion: "inventario" },
  { etiqueta: "RENTABILIDAD", corto: "Rentabilidad", href: "/rentabilidad", seccion: "rentabilidad" },
  { etiqueta: "TELEGRAM", corto: "Telegram", href: "/telegram", seccion: "telegram" },
  { etiqueta: "SINCRONIZAR", corto: "Sincronizar", href: "/sincronizar", seccion: "sincronizar" },
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
          <span class="titulo-movil">{p.titulo.split(/ · |, /)[0]}</span>
          <a class="bot-punto" href="/telegram" title={`Bot de Telegram ${p.cab.botEnLinea ? "en línea" : "desconectado"}`}><i class={p.cab.botEnLinea ? "on" : ""}></i>BOT</a>
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
            <a href={n.href} class={n.seccion === p.seccion ? "activo" : ""} aria-current={n.seccion === p.seccion ? "page" : undefined}>{n.etiqueta}</a>
          ))}
          {puedeVer(p.usuario.rol, "ajustes") ? <a href="/ajustes" class={p.seccion === "ajustes" ? "activo fin" : "fin"}>⚙ AJUSTES</a> : null}
          {p.cab.simulado ? <span class="chip proximo" title="SUNAT en modo simulado">SUNAT SIMULADO</span> : null}
        </nav>
        {p.ok ? <div class="aviso ok toast" role="status" data-toast="">✓ {p.ok}</div> : null}
        {p.error ? <div class="aviso error" role="alert">{p.error}</div> : null}
        {p.children}
      </div>
      <BarraInferior seccion={p.seccion} usuario={p.usuario} cab={p.cab} />
      <script src={`/static/app.js?v=${V}`} defer></script>
      {(p.scripts ?? []).map((s) => <script type="module" src={`${s}?v=${V}`}></script>)}
    </body>
  </html>
);

/**
 * Barra inferior del celular: las 4 secciones de todos los días + «Más» (el resto, ajustes y
 * salir). Solo se ve en pantallas angostas; en la PC queda la barra de arriba.
 */
const BarraInferior: FC<{ seccion: Seccion; usuario: UsuarioWeb; cab: DatosCabecera }> = (p) => {
  const visibles = NAV.filter((n) => puedeVer(p.usuario.rol, n.seccion));
  const principales = [...visibles.filter((n) => n.principal), ...visibles.filter((n) => !n.principal)].slice(0, 4);
  const resto = visibles.filter((n) => !principales.includes(n));
  const enMas = !principales.some((n) => n.seccion === p.seccion);
  return (
    <nav class="tabbar" aria-label="Secciones principales">
      {principales.map((n) => (
        <a href={n.href} class={n.seccion === p.seccion ? "activo" : ""} aria-current={n.seccion === p.seccion ? "page" : undefined}><Icono n={n.seccion === "dashboard" ? "inicio" : n.seccion} /><span>{n.corto}</span></a>
      ))}
      <details class={`mas${enMas ? " activo" : ""}`}>
        <summary aria-label="Más secciones"><Icono n="mas" /><span>Más</span></summary>
        <div class="hoja" role="menu">
          <div class="hoja-cab"><b>{p.cab.empresa}</b><span class="muted">{p.usuario.nombre}</span></div>
          {resto.map((n) => <a role="menuitem" href={n.href} class={n.seccion === p.seccion ? "activo" : ""}><Icono n={n.seccion} />{n.corto}</a>)}
          {puedeVer(p.usuario.rol, "ajustes") ? <a role="menuitem" href="/ajustes" class={p.seccion === "ajustes" ? "activo" : ""}><Icono n="ajustes" />Ajustes</a> : null}
          <a role="menuitem" href="/telegram"><span class={`punto${p.cab.botEnLinea ? " on" : ""}`}></span>Bot de Telegram · {p.cab.botEnLinea ? "en línea" : "desconectado"}</a>
          <form method="post" action="/salir"><button class="btn" type="submit" style="width:100%">Salir</button></form>
        </div>
      </details>
    </nav>
  );
};

// ── Piezas ───────────────────────────────────────────────────────────────────

/**
 * `plegable`: en el celular el formulario queda cerrado (solo su título, como un botón) hasta que
 * se toca o se llega con su enlace (#id). Así la pantalla muestra primero lo que se consulta.
 */
export const Panel: FC<PropsWithChildren<{ titulo?: Child; der?: Child; clase?: string; id?: string; plegable?: boolean }>> = (p) => (
  <section class={`panel ${p.clase ?? ""}`} id={p.id} data-plegable={p.plegable ? "" : undefined}>
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

/** Opciones de piezas del modelo 3D por grupo: cada conjunto y debajo sus piezas (sangradas). */
export function OpcionesPiezas(p: { piezas?: Pieza[]; elegidas?: Iterable<string>; marca?: Set<string> }) {
  const el = new Set(p.elegidas ?? []);
  return (
    <>
      {listaDePiezas(p.piezas).map((g) => (
        <optgroup label={g.nombre}>
          {g.items.map((i) => <option value={i.id} selected={el.has(i.id)}>{i.nivel ? "\u00a0\u00a0└ " : ""}{i.nombre}{p.marca?.has(i.id) ? " •" : ""}</option>)}
        </optgroup>
      ))}
    </>
  );
}
