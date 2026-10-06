/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import type { Child, FC, PropsWithChildren } from "hono/jsx";
import { raw } from "hono/html";
import type { EstadoDesgaste, FilaViajeFlota, UsuarioWeb, ViajeEnRuta } from "@sunatapp/core";
import { menuDe, veAjustes, type EntradaMenu, type Lugar } from "./lugares";

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
const MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
/** "2026-10" → "octubre". */
export const mesLargo = (mes: string) => MESES_LARGOS[Number(mes.slice(5, 7)) - 1] ?? mes;
/** Días entre dos fechas AAAA-MM-DD (b − a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
export const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n}%`);

export const ETIQUETA_ESTADO: Record<EstadoDesgaste, string> = { ok: "OK", proximo: "PRÓXIMO", cambiar: "CAMBIAR YA" };
export const ESTADO_UNIDAD: Record<string, string> = { en_ruta: "EN RUTA", en_base: "EN BASE", en_taller: "EN TALLER", inactivo: "INACTIVO" };
export const CHIP_UNIDAD: Record<string, string> = { en_ruta: "ok", en_base: "neutro", en_taller: "proximo", inactivo: "neutro" };

// ── Navegación ───────────────────────────────────────────────────────────────

export interface DatosCabecera {
  empresa: string;
  botEnLinea: boolean;
  simulado: boolean;
}

/** Íconos de trazo (24×24), los mismos del lienzo aprobado. Son constantes: se insertan sin escapar. */
const ICONOS = {
  inicio: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  viajes: '<path d="M4 19l4-14h8l4 14"/><path d="M12 7v2M12 12v2M12 17v2"/>',
  camiones: '<path d="M2 16V7h11v9M13 10h5l4 4v2h-9"/><circle cx="6" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
  numeros: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  ajustes: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.6 15H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9.7 4.4V4a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
  mas: '<path d="M12 5v14M5 12h14"/>',
  volver: '<path d="M15 6l-6 6 6 6"/>',
  gaste: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h3"/>',
  chofer: '<circle cx="9" cy="7" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5M17 8h5M19.5 5.5v5"/>',
  cobro: '<path d="M12 3v18M7 8l5-5 5 5"/>',
  repare: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z"/>',
  empresa: '<path d="M4 21V8l8-5 8 5v13M9 21v-6h6v6"/>',
  prestamo: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M8 15h2M14 15h2"/>',
  combustible: '<path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M14 9h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V8l-3-3"/><path d="M7 7h4"/>',
  peaje: '<path d="M3 20h18M6 20V9h12v11M4 9l8-5 8 5"/>',
  comida: '<path d="M4 11h16a8 8 0 0 1-16 0zM8 7c0-2 2-2 2-4M13 7c0-2 2-2 2-4"/>',
  otro: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M8 12h8"/>',
  camara: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
} as const;
export type NombreIcono = keyof typeof ICONOS;

export const Icono: FC<{ n: NombreIcono; t?: number }> = (p) =>
  raw(`<svg width="${p.t ?? 22}" height="${p.t ?? 22}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">${ICONOS[p.n]}</svg>`);

/** Título de cada pantalla: botón volver (opcional), texto arriba/abajo y acciones a la derecha. */
export const Cabecera: FC<{ titulo: Child; sobre?: Child; sub?: Child; volver?: string; der?: Child }> = (p) => (
  <header class="cab-pagina">
    {p.volver ? <a class="btn-icono" href={p.volver} aria-label="Volver"><Icono n="volver" t={20} /></a> : null}
    <div class="cab-textos">
      {p.sobre ? <span class="lbl">{p.sobre}</span> : null}
      <h1>{p.titulo}</h1>
      {p.sub ? <span class="muted">{p.sub}</span> : null}
    </div>
    {p.der ? <div class="der">{p.der}</div> : null}
  </header>
);

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
  lugar: Lugar;
  usuario: UsuarioWeb;
  cab: DatosCabecera;
  /** Ruta actual sin ?ok/?error (para volver aquí después de anotar). */
  ruta: string;
  ok?: string | null;
  error?: string | null;
  scripts?: string[];
  importmap?: boolean;
  /** Pantallas de un solo paso (Anotar en el celular): sin barra de abajo. */
  sinNavInferior?: boolean;
}

export const Layout: FC<PropsWithChildren<PropsLayout>> = (p) => {
  const menu = menuDe(p.usuario.rol);
  const enlace = (m: EntradaMenu) => (
    <a href={m.href} class={m.lugar === p.lugar ? "activo" : undefined} aria-current={m.lugar === p.lugar ? "page" : undefined}>
      <Icono n={m.lugar} />{m.etiqueta}
    </a>
  );
  return (
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
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
      <body class={p.sinNavInferior ? "sin-inferior" : undefined}>
        <div class="marco">
          <nav class="lateral" aria-label="Lugares">
            <a class="marca" href="/"><Logo /><span><b>Control Flota</b><span class="s">{p.cab.empresa}</span></span></a>
            {menu.map(enlace)}
            <div class="abajo">
              {veAjustes(p.usuario.rol) ? (
                <a href="/ajustes" class={p.lugar === "ajustes" ? "activo" : undefined} aria-current={p.lugar === "ajustes" ? "page" : undefined}><Icono n="ajustes" />Ajustes</a>
              ) : null}
              <span class="quien">{p.usuario.nombre}</span>
              <form method="post" action="/salir"><button class="btn chico" type="submit">Salir</button></form>
            </div>
          </nav>
          <main class="contenido" id="contenido">
            {p.ok ? <div class="aviso ok" role="status">{p.ok}</div> : null}
            {p.error ? <div class="aviso error" role="alert">{p.error}</div> : null}
            {p.children}
          </main>
        </div>
        {p.sinNavInferior ? null : <nav class="inferior" aria-label="Lugares" style={`--n:${menu.length}`}>{menu.map(enlace)}</nav>}
        <script src={`/static/app.js?v=${V}`} defer></script>
        {(p.scripts ?? []).map((s) => <script type="module" src={`${s}?v=${V}`}></script>)}
      </body>
    </html>
  );
};

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

/** Una cifra chica con su etiqueta (Entró / Salió / Te deben…). */
export const Cifra: FC<{ etiqueta: string; valor: Child; sub?: Child; tono?: "ok" | "cambiar" }> = (p) => (
  <div class="cifra">
    <span class="lbl">{p.etiqueta}</span>
    <b class={p.tono ? `t-${p.tono}` : undefined}>{p.valor}</b>
    {p.sub ? <span class="sub">{p.sub}</span> : null}
  </div>
);

/** Tarjeta de un viaje en curso: camión, ruta, día, gastado contra entregado y lo que deja. */
export const TarjetaEnRuta: FC<{ v: ViajeEnRuta }> = ({ v }) => {
  const pctGasto = v.entregado > 0 ? Math.min(100, (v.gastado / v.entregado) * 100) : v.gastado > 0 ? 100 : 0;
  return (
    <a class="tarjeta-ruta" href={`/viajes/${v.viajeId}`}>
      <div class="fila-sep"><b>{v.unidad} · {v.ruta}</b><span class="muted">día {v.dia}</span></div>
      <Barra pct={pctGasto} color={v.gastado > v.entregado ? "var(--accent)" : "var(--ok)"} />
      <span class="muted">
        {v.entregado > 0
          ? `Gastó ${soles(v.gastado)} de ${soles(v.entregado)} que le diste a ${v.chofer}`
          : v.gastado > 0 ? `Gastó ${soles(v.gastado)} · todavía no le diste plata a ${v.chofer}` : `Todavía no le diste plata a ${v.chofer}`}
        {v.deja !== null ? ` · deja ${soles(v.deja)}` : ""}
      </span>
    </a>
  );
};

const ESTADO_VIAJE: Record<FilaViajeFlota["estado"], [string, string]> = { en_curso: ["EN RUTA", "ok"], cerrado: ["CERRADO", "neutro"], planificado: ["PLANIFICADO", "proximo"] };

/** Lista de viajes: tarjetas en el celular, tabla corta en la PC (un solo marcado). */
export const ListaViajes: FC<{ viajes: FilaViajeFlota[] }> = ({ viajes }) => (
  <div class="lista-viajes" role="table" aria-label="Viajes">
    <div class="fila-viaje cab" role="row">
      <span role="columnheader">Viaje</span><span role="columnheader">Camión</span><span role="columnheader">Estado</span>
      <span class="num" role="columnheader">Flete</span><span class="num" role="columnheader">Gastos</span><span class="num" role="columnheader">Dejó</span>
    </div>
    {viajes.map((v) => {
      const dejo = v.flete > 0 ? v.flete - v.costo : null;
      return (
        <a class="fila-viaje" role="row" href={`/viajes/${v.id}`}>
          <span class="ruta" role="cell"><b>{v.ruta}</b> <span class="muted">· {fechaCorta(v.fecha)}</span></span>
          <span role="cell">{v.unidad}</span>
          <span role="cell"><span class={`chip ${ESTADO_VIAJE[v.estado][1]}`}>{ESTADO_VIAJE[v.estado][0]}</span></span>
          <span class="num" role="cell">{v.flete ? soles(v.flete) : "—"}</span>
          <span class="num" role="cell">{soles(v.costo)}</span>
          <b class={`num${dejo !== null && dejo < 0 ? " t-cambiar" : ""}`} role="cell">{dejo === null ? "falta flete" : soles(dejo)}</b>
        </a>
      );
    })}
  </div>
);

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
