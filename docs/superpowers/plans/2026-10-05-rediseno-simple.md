# Rediseño simple — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the web app's 11 tabs + 6 hidden pages into 4 places (Inicio, Viajes, Camiones, Números) + one big **Anotar** button + an Ajustes hub, without losing any function, looking good on a 390×844 phone and a 1440×900 PC.

**Architecture:** Same Hono JSX server-rendered app. A new layout (`ui.tsx` `Layout`) draws a 220 px side menu on PC and a fixed bottom bar on the phone; which places a role sees comes from a new `apps/web/src/lugares.ts`. Every money/repair entry goes through one page `/anotar` (`paginas/anotar.tsx`) that posts to one `POST /anotar`, which calls the same `packages/core` functions as before through shared handlers in `apps/web/src/acciones.ts` (the old POST routes call the same handlers, so nothing breaks). On PC `/anotar` also opens as a right side panel (fragment `?parcial=1` + `public/anotar.js`) with a live "Así queda" preview. Old GET routes 302-redirect to the new places with `redirigir()` (`apps/web/src/redirecciones.ts`). New read-only core helpers live in `packages/core/src/consultas/{inicio,asi-queda,vehiculo}.ts`.

**Tech Stack:** TypeScript, Hono 4 + hono/jsx SSR, PGlite (tests), Vitest 5, plain CSS (`apps/web/public/app.css`), vanilla JS on the client, Three.js viewer (`public/trailer3d.js`, unchanged), Playwright (`playwright-core` driving the locally installed Chromium) for screenshots.

**Spec:** `docs/superpowers/specs/2026-10-05-rediseno-simple-design.md` (binding). Visual target: the approved artboards (Main map; Inicio, Anotar, Viaje, Camion, Numeros at 390×844; Escritorio at 1440×900 with side menu + Anotar side panel).

---

## Global Constraints

- Breakpoint: **900 px** (`< 900` = phone layout with bottom bar; `≥ 900` = PC layout with 220 px side menu).
- Phone screenshots: **390×844**. Desktop screenshots: **1440×900**.
- Touch targets **≥ 44 px** high on the phone (buttons, inputs, selects, nav links, summaries).
- Text **≥ 12 px** everywhere on the phone (labels, chips, table headers and inline styles included).
- Contrast **≥ 4.5:1** for all text.
- Max 4 big figures per view; no form shows more than 4 fields before "cambiar" / "Más datos".
- Copy in **Spanish with street words** ("Gasté", "Me pagaron", "Te deben", "Este viaje te deja", "Le queda"); no "contribución" / "egreso" in first views.
- Keep the `app.css` palette (`:root` tokens) and fonts (Space Mono titles, IBM Plex Mono body); no new colors.
- Old GET routes (`/trailer`, `/trailer/:id`, `/flota`, `/inventario`, `/reparaciones`, `/finanzas`, `/rentabilidad`, `/estadisticas`, `/revisar`) answer **302** to their new place, keeping useful params (`pieza`, `parte`, `repuesto`, `q`, `mes`, `desde`, `hasta`, `vista`, `unidad`, `pdf`).
- Every existing **POST route is kept** with the same field names (bot links, tests and old forms keep working); only its redirect target may change.
- Roles stay as in `packages/core/src/acceso/acceso.ts` (`PERMISOS`, `puedeVer`, `puedeEditar`); a place hidden for a role answers GET with the existing `/?error=` redirect and POST with 403.
- `packages/core` gets only new **read-only** functions; no business logic changes; `public/trailer3d.js` is not edited (only where it is mounted).
- Every commit message ends with a blank line and the trailer line `Claude-Session: https://claude.ai/code/session_012rqk28jac1iV7v2GAJjggW` (pass it as a second `-m`).
- Work only in `F:\THE FORGE\SUNATAPP-rediseno` (branch `rediseno-simple`); never touch `F:\THE FORGE\SUNATAPP`.

## Review Focus

1. Roles: every new place/route (`/anotar`, `/camiones/*`, `/numeros/*`, the `/ajustes` hub) shows and accepts only what `PERMISOS` allows; `POST /anotar` re-checks the role per type and per sub-mode.
2. No lost function: each removed screen's actions are reachable in the new map (checklist in Task 12) and every old POST still works (existing `web.test.ts` cases are kept, only URLs/copy updated).
3. `POST /anotar` and the old POST routes call the same handlers in `acciones.ts` → same `packages/core` calls and the same Telegram aviso side effects.
4. Phone rules from `capturas/<etiqueta>/revision.json`: page width ≤ 390, no buttons < 44 px, no text < 12 px, no contrast < 4.5:1; screenshots match the artboards.
5. Merge safety with the SUNAT branch: core edits are additive (new files + appended `export *` lines in `packages/core/src/index.ts`); no edits to `facturas/`, `transporte/`, `flota/unidades.ts`.

## File map

| File | Status | Responsibility |
|---|---|---|
| `apps/web/src/lugares.ts` | new | Places (`Lugar`), menu per role (`menuDe`, `veAjustes`), `RUTA` targets, Anotar types per role (`TIPOS_ANOTAR`, `tiposAnotar`) |
| `apps/web/src/redirecciones.ts` | new | `conParametros`, `redirigir` (302 keeping params) |
| `apps/web/src/acciones.ts` | new | Shared POST handlers: `guardarGasto`, `guardarEntrega`, `guardarCobro`, `guardarIngreso`, `guardarCambio`, `guardarCompra`, `guardarGastoEmpresa`, `guardarPrestamo`, `pagarCuotaDe`, `guardarReinversion`, `montoObligatorio` |
| `apps/web/src/ui.tsx` | modify | New `Layout` (side menu / bottom bar / Anotar panel), `Icono`, `Cabecera`, `Cifra`, `TarjetaEnRuta`, `ListaViajes`, `mesLargo`, `diasEntre`, `CHIP_FACTURA`, `ESTADO_GUIA`; trimmed `DatosCabecera` |
| `apps/web/src/base.tsx` | modify | `pagina()` gets `lugar`, `sinNavInferior` and the current route; `volverA`; `rutaActual`; slimmer `datosCabecera` |
| `apps/web/src/app.tsx` | modify | `seccionDeRuta` for `camiones`, `numeros`, `anotar`, `/ajustes` hub; registers `rutasAnotar`, `rutasCamiones`, `rutasNumeros` |
| `apps/web/src/paginas/dashboard.tsx` | rewrite | Inicio (Ganaste, Entró/Salió/Te deben, Necesita tu atención, En ruta ahora, Últimos viajes) + `/?ver=atencion`; keeps `FeedTelegram`, `htmlFeed`, `/api/feed` |
| `apps/web/src/paginas/anotar.tsx` | new | `/anotar` page and fragment, `POST /anotar`, `/anotar/asi-queda`, Telegram document mode |
| `apps/web/src/paginas/viajes.tsx` | rewrite view | Viajes list (En ruta, month list, Nuevo viaje, Ver más: guías, cobros, rutas); POSTs kept |
| `apps/web/src/paginas/liquidacion.tsx` | rewrite view | `/viajes/:id` ("Este viaje te deja", Le diste / Le queda, gastos, Papeles y cobro, Cerrar viaje, Ver más) |
| `apps/web/src/paginas/camiones.tsx` | new | `/camiones`, `/camiones/:id` (chips, 3D, tabs Lo que toca / Historial / Repuestos / Datos), `/camiones/nuevo` |
| `apps/web/src/paginas/trailer.tsx`, `flota.tsx`, `inventario.tsx`, `reparaciones.tsx` | trim | Views removed; POSTs kept with new redirect targets; GETs redirect |
| `apps/web/src/paginas/numeros.tsx` | new | `/numeros` (periodo, ¿Qué viaje dejó más?, ¿En qué se va la plata?, Ver más) |
| `apps/web/src/paginas/finanzas.tsx` | modify | `/numeros/caja`, `/numeros/prestamos`; `/finanzas` redirect |
| `apps/web/src/paginas/rentabilidad.tsx` | modify | `/numeros/rentabilidad`, `/numeros/cotizar`; `/rentabilidad` redirect |
| `apps/web/src/paginas/estadisticas.tsx` | modify | `/numeros/graficos`; `/estadisticas` redirect |
| `apps/web/src/paginas/ajustes.tsx` | modify | Hub `/ajustes` + `/ajustes/{empresa,usuarios,costos-fijos,categorias,partes}` |
| `apps/web/src/paginas/{rutas,telegram,sincronizar,dispositivo}.tsx` | modify | "Volver a Ajustes" header, `lugar: "ajustes"` |
| `apps/web/src/paginas/revisar.tsx` | trim | `/revisar` → 302 `/?ver=atencion`; POSTs kept; exports `valoresLectura` |
| `apps/web/public/app.css` | modify | Responsive shell + styles of every place; min 12 px text, 44 px targets |
| `apps/web/public/anotar.js` | new | Side panel on PC, live "Así queda" |
| `apps/web/public/app.js` | modify | Opens `<details id=…>` named in the URL `#hash` |
| `apps/web/public/reparaciones.js` | delete | Script of the old repair form |
| `apps/web/scripts/capturas.ts`, `apps/web/scripts/lugares-captura.ts` | new | Playwright screenshots + automatic phone checks |
| `packages/core/src/consultas/inicio.ts` | new | `resumenInicio`, `viajesEnRuta`, `choferDeViaje`, `primerNombre`, `categoriasMasUsadas` |
| `packages/core/src/consultas/asi-queda.ts` | new | `asiQueda` |
| `packages/core/src/consultas/vehiculo.ts` | new | `datosSunatVehiculo` |
| `packages/core/src/index.ts` | modify | Append 3 `export *` lines |
| `packages/core/test/inicio.test.ts` | new | Tests of the read-only helpers |
| `apps/web/test/web.test.ts` | modify | New place / role / redirect / Anotar tests; old URLs and copy updated |
| `.gitignore`, `package.json`, `apps/web/package.json`, `apps/web/tsconfig.json` | modify | `capturas/`, `pnpm capturas`, `playwright-core`, include `scripts` |

Run every command from `F:\THE FORGE\SUNATAPP-rediseno` (Git Bash).

---

### Task 1: Layout shell — side menu (PC), bottom bar (phone), places per role, redirect helper

**Files:**
- Create: `apps/web/src/lugares.ts`, `apps/web/src/redirecciones.ts`
- Modify: `apps/web/src/ui.tsx` (replace `NAV`, `DatosCabecera`, `Layout`; add `Icono`, `Cabecera`), `apps/web/src/base.tsx` (`pagina`, `datosCabecera`, add `rutaActual`), `apps/web/public/app.css`, every `apps/web/src/**/*.tsx` with inline `font-size:10px|11px`
- Test: `apps/web/test/web.test.ts`

**Interfaces:**
- Consumes: `puedeVer`, `puedeEditar`, `type Seccion`, `type RolUsuario`, `type UsuarioWeb`, `obtenerEmpresa`, `estadoBot` from `@sunatapp/core`; `App`, `C` from `./base`.
- Produces: `type Lugar`, `LUGAR_DE_SECCION`, `RUTA`, `menuDe(rol): EntradaMenu[]`, `veAjustes(rol)`, `type TipoAnotar`, `TIPOS_ANOTAR`, `tiposAnotar(rol)` (lugares.ts); `conParametros(destino, query, conservar)`, `redirigir(app, desde, hacia, conservar)` (redirecciones.ts); `Icono`, `type NombreIcono`, `Cabecera`, `Layout` with props `lugar`, `ruta`, `sinNavInferior` (ui.tsx); `pagina(c, d, { titulo, seccion, lugar?, sinNavInferior?, scripts?, importmap? }, cuerpo)`, `rutaActual(c)`, `DatosCabecera = { empresa, botEnLinea, simulado }` (base.tsx / ui.tsx).

- [ ] **Step 1: Write the failing tests**

Add to the imports of `apps/web/test/web.test.ts`:

```ts
import { tiposAnotar } from "../src/lugares";
import { conParametros } from "../src/redirecciones";
```

Add these cases inside `describe("con el dueño configurado", …)`:

```ts
    it("menú: lateral en la PC, barra abajo en el celular y solo los lugares del rol", async () => {
      const cookie = await entrar();
      const html = await (await app.request("/", { headers: { cookie } })).text();
      expect(html).toContain('<nav class="lateral"');
      expect(html).toContain('<nav class="inferior"');
      expect(html).not.toContain('<header class="header"');
      for (const e of ["Inicio", "Viajes", "Camiones", "Números", "Ajustes"]) expect(html).toMatch(new RegExp(`${e}</a>`));
      await guardarUsuario(ctx, { nombre: "Conta", email: "conta@demo.pe", rol: "contador", clave: "clave-segura" });
      const conta = await (await app.request("/", { headers: { cookie: await entrar("conta@demo.pe") } })).text();
      expect(conta).not.toMatch(/Camiones<\/a>/);
      expect(conta).toMatch(/Números<\/a>/);
    });
```

Add these cases at the top level of `describe("web", …)`:

```ts
  it("tipos de Anotar según el rol", () => {
    expect(tiposAnotar("taller")).toEqual(["repare"]);
    expect(tiposAnotar("contador")).toEqual(["gaste", "chofer", "cobro", "empresa", "prestamo"]);
    expect(tiposAnotar("dueno")).toHaveLength(6);
    expect(tiposAnotar("chofer")).toEqual([]);
  });

  it("las redirecciones conservan solo los parámetros útiles", () => {
    expect(conParametros("/camiones/2", { pieza: "faro-der", ok: "x" }, ["pieza"])).toBe("/camiones/2?pieza=faro-der");
    expect(conParametros("/camiones?tab=repuestos", { q: "filtro" }, ["q"])).toBe("/camiones?tab=repuestos&q=filtro");
    expect(conParametros("/numeros/caja", {}, ["mes"])).toBe("/numeros/caja");
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm test apps/web/test/web.test.ts -t "menú|tipos de Anotar|redirecciones"`
Expected: FAIL — `Cannot find module '../src/lugares'` (and `../src/redirecciones`).

- [ ] **Step 3: Create `apps/web/src/lugares.ts`**

```ts
import { puedeEditar, puedeVer, type RolUsuario, type Seccion } from "@sunatapp/core";

/** Los lugares del menú nuevo (spec §2). */
export type Lugar = "inicio" | "viajes" | "camiones" | "numeros" | "ajustes" | "anotar";

/** A qué lugar pertenece cada sección vieja (marca el activo del menú). */
export const LUGAR_DE_SECCION: Record<Seccion, Lugar> = {
  dashboard: "inicio", trailer: "camiones", flota: "camiones", inventario: "camiones", reparaciones: "camiones",
  viajes: "viajes", finanzas: "numeros", rentabilidad: "numeros", telegram: "ajustes", ajustes: "ajustes", sincronizar: "ajustes",
};

/**
 * Adónde llevan los enlaces a lugares que se construyen en tareas posteriores. Cada tarea cambia
 * su entrada cuando el lugar nuevo existe (Camiones: tarea 8, Números: 9, Ajustes: 10, Revisar: 11).
 */
export const RUTA = {
  camiones: "/trailer",
  camion: (id: number, q = "") => `/trailer/${id}${q}`,
  numeros: "/finanzas",
  catalogoPartes: "/ajustes",
  revisar: "/revisar",
  cobrar: (_facturaId: number) => "/viajes",
};

export interface EntradaMenu { lugar: "inicio" | "viajes" | "camiones" | "numeros"; etiqueta: string; href: string; seccion: Seccion }

/** Los lugares que ve cada rol, en el orden del menú. Inicio lo ven todos. */
export function menuDe(rol: RolUsuario): EntradaMenu[] {
  const todos: EntradaMenu[] = [
    { lugar: "inicio", etiqueta: "Inicio", href: "/", seccion: "dashboard" },
    { lugar: "viajes", etiqueta: "Viajes", href: "/viajes", seccion: "viajes" },
    { lugar: "camiones", etiqueta: "Camiones", href: RUTA.camiones, seccion: "trailer" },
    { lugar: "numeros", etiqueta: "Números", href: RUTA.numeros, seccion: "finanzas" },
  ];
  return todos.filter((e) => e.seccion === "dashboard" || puedeVer(rol, e.seccion));
}

/** Por ahora Ajustes es solo del dueño; la tarea 10 lo abre a todos (el hub filtra las tarjetas). */
export const veAjustes = (rol: RolUsuario): boolean => puedeVer(rol, "ajustes");

export type TipoAnotar = "gaste" | "chofer" | "cobro" | "repare" | "empresa" | "prestamo";

/** Los 6 botones de «¿Qué pasó?» y la sección que hay que poder editar para usar cada uno. */
export const TIPOS_ANOTAR: Record<TipoAnotar, { etiqueta: string; corta: string; seccion: Seccion }> = {
  gaste: { etiqueta: "Gasté", corta: "Gasté", seccion: "finanzas" },
  chofer: { etiqueta: "Plata al chofer", corta: "Plata al chofer", seccion: "viajes" },
  cobro: { etiqueta: "Me pagaron", corta: "Me pagaron", seccion: "viajes" },
  repare: { etiqueta: "Reparé / repuesto", corta: "Reparé / repuesto", seccion: "reparaciones" },
  empresa: { etiqueta: "Gasto de la empresa", corta: "De la empresa", seccion: "finanzas" },
  prestamo: { etiqueta: "Préstamo o cuota", corta: "Préstamo o cuota", seccion: "finanzas" },
};

/** Taller: solo Reparé / repuesto. Contador: la plata. Dueño: todo. Chofer: nada (usa Telegram). */
export function tiposAnotar(rol: RolUsuario): TipoAnotar[] {
  return (Object.keys(TIPOS_ANOTAR) as TipoAnotar[]).filter((t) => puedeEditar(rol, TIPOS_ANOTAR[t].seccion));
}
```

- [ ] **Step 4: Create `apps/web/src/redirecciones.ts`**

```ts
import type { App, C } from "./base";

/** `destino` más los parámetros de `query` que se piden conservar (los vacíos no se pasan). */
export function conParametros(destino: string, query: Record<string, string>, conservar: string[]): string {
  const u = new URL(destino, "http://x");
  for (const k of conservar) if (query[k]) u.searchParams.set(k, query[k]!);
  return u.pathname + u.search;
}

/** Ruta vieja → lugar nuevo con 302, conservando los parámetros útiles (`?pieza=`, `?repuesto=`, …). */
export function redirigir(app: App, desde: string, hacia: (c: C) => string, conservar: string[] = []): void {
  app.get(desde, (c) => c.redirect(conParametros(hacia(c as C), c.req.query(), conservar), 302));
}
```

- [ ] **Step 5: Replace the navigation and layout in `apps/web/src/ui.tsx`**

Change the imports at the top to:

```tsx
/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import type { Child, FC, PropsWithChildren } from "hono/jsx";
import { raw } from "hono/html";
import type { EstadoDesgaste, UsuarioWeb } from "@sunatapp/core";
import { menuDe, veAjustes, type EntradaMenu, type Lugar } from "./lugares";
```

Delete the whole `// ── Navegación ──` block (`export const NAV …`), the old `export interface DatosCabecera { … }`, the old `export interface PropsLayout { … }` and the old `export const Layout …`, and put in their place:

```tsx
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
```

Keep `const Logo = …` as it is. Then add the new layout:

```tsx
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
```

(`pct`, `Panel`, `Kpi`, `Barra`, `ChipEstado`, `Origen`, `Vacio`, `Datos`, `PaginaSimple` and the format helpers stay.)

- [ ] **Step 6: Update `apps/web/src/base.tsx`**

Replace the `datosCabecera` function with (it no longer computes KPIs on every page):

```tsx
/** Datos comunes del layout: se calculan en cada página (dos consultas baratas). */
export async function datosCabecera(ctx: Contexto): Promise<DatosCabecera> {
  const emp = await obtenerEmpresa(ctx);
  const bot = await estadoBot(ctx);
  return { empresa: (emp?.nombreComercial || emp?.razonSocial || "EMPRESA").toUpperCase(), botEnLinea: bot.enLinea, simulado: ctx.simulado };
}

/** Ruta actual sin los avisos (?ok= / ?error=). */
export function rutaActual(c: C): string {
  const u = new URL(c.req.url);
  u.searchParams.delete("ok");
  u.searchParams.delete("error");
  return u.pathname + u.search;
}
```

Remove `fechaHoraLima`, `listarUnidades`, `rangoMes`, `resumenFinanciero` from its `@sunatapp/core` import if nothing else in the file uses them, add `import { LUGAR_DE_SECCION, type Lugar } from "./lugares";`, and replace `pagina` with:

```tsx
/** Renderiza una página con el layout común. */
export async function pagina(
  c: C, d: Deps,
  o: { titulo: string; seccion: Seccion; lugar?: Lugar; scripts?: string[]; importmap?: boolean; sinNavInferior?: boolean },
  cuerpo: Child,
) {
  const html = (
    <Layout
      titulo={o.titulo} lugar={o.lugar ?? LUGAR_DE_SECCION[o.seccion]} usuario={c.get("usuario")} cab={await d.cabecera()} ruta={rutaActual(c)}
      ok={c.req.query("ok")} error={c.req.query("error")} scripts={o.scripts} importmap={o.importmap} sinNavInferior={o.sinNavInferior}
    >
      {cuerpo}
    </Layout>
  );
  return c.html("<!doctype html>" + html.toString());
}
```

- [ ] **Step 7: Raise every inline font size to 12 px**

Run: `grep -rlE "font-size:1[01]px" apps/web/src | xargs sed -i -E 's/font-size:1[01]px/font-size:12px/g' && grep -rcE "font-size:1[01]px" apps/web/src | grep -v ":0" ; echo fin`
Expected: only `fin` printed (no file still has 10/11 px inline).

- [ ] **Step 8: Add the responsive shell to `apps/web/public/app.css`**

In `:root` nothing changes. Change these existing rules (same selectors, new values):

```css
body { margin: 0; font-family: var(--f-body); background: var(--bg); color: var(--text); font-size: 14px; line-height: 1.45; }
.lbl { font-size: 12px; letter-spacing: .08em; color: var(--muted); text-transform: uppercase; }
.lbl-12 { font-size: 12px; letter-spacing: .06em; color: var(--muted); text-transform: uppercase; }
.chip { display: inline-block; font-size: 12px; font-weight: 600; letter-spacing: .04em; padding: 2px 6px; border-radius: 3px; white-space: nowrap; }
table.t { width: 100%; border-collapse: collapse; font-size: 13px; }
table.t th { background: var(--panel-alt); text-align: left; font-size: 12px; letter-spacing: .06em; color: var(--muted); font-weight: 600; padding: 8px; border-bottom: 1px solid var(--divider); white-space: nowrap; text-transform: uppercase; }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 44px; padding: 0 14px; border-radius: 4px; border: 1px solid var(--text); background: var(--white); color: var(--text); font: 600 13px var(--f-body); letter-spacing: .02em; text-decoration: none; cursor: pointer; white-space: nowrap; }
.btn.chico { min-height: 44px; padding: 0 12px; font-size: 12px; }
.campo > span { font-size: 12px; letter-spacing: .06em; color: var(--muted); text-transform: uppercase; }
input, select, textarea { font: 16px var(--f-body); color: var(--text); background: var(--white); border: 1px solid var(--border); border-radius: 4px; min-height: 44px; padding: 6px 10px; width: 100%; }
.radios label { display: inline-flex; align-items: center; min-height: 44px; padding: 0 12px; border: 1px solid var(--border); border-radius: 4px; background: var(--white); cursor: pointer; font-size: 13px; font-weight: 600; letter-spacing: .02em; }
.kpi .sub { font-size: 12px; color: var(--muted); }
.aviso { padding: 10px 12px; border-radius: 4px; font-size: 13px; border: 1px solid; }
.vacio { padding: 18px; text-align: center; color: var(--muted); font-size: 13px; }
.leyenda { display: flex; gap: 12px; flex-wrap: wrap; font-size: 12px; color: var(--muted); align-items: center; }
.fila-parte .rest { grid-column: 1 / -1; font-size: 12px; color: var(--muted); }
.visor .pie { position: absolute; bottom: 10px; left: 12px; right: 12px; display: flex; gap: 14px; font-size: 12px; color: var(--dark-muted); pointer-events: none; flex-wrap: wrap; }
.visor .etiqueta { position: absolute; pointer-events: none; background: rgba(18, 23, 25, .92); border: 1px dashed var(--amber-dark); border-radius: 4px; padding: 6px 8px; color: var(--dark-text); font-size: 12px; transform: translate(18px, -120%); white-space: normal; max-width: 260px; }
.feed .ev .h { color: var(--dark-muted); font-size: 12px; }
.vivo { color: var(--accent-on-dark-2); font-size: 12px; font-weight: 600; letter-spacing: .08em; }
.burbuja { max-width: 86%; padding: 8px 10px; border-radius: 10px; font-size: 13px; white-space: pre-wrap; }
.teclado span { background: #2A3747; border-radius: 6px; padding: 8px 4px; text-align: center; font-size: 12px; }
```

Append at the end of the file (before the `.sin-gap` block):

```css
/* ── Rediseño: marco con menú lateral (PC ≥ 900 px) y barra inferior (celular) ── */
.marco { display: block; }
.contenido { max-width: 1180px; margin: 0 auto; padding: 16px 16px 100px; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
body.sin-inferior .contenido { padding-bottom: 24px; }
.lateral { display: none; }
.inferior { position: fixed; left: 0; right: 0; bottom: 0; z-index: 20; display: grid; grid-template-columns: repeat(var(--n, 5), minmax(0, 1fr)); align-items: center; background: var(--panel); border-top: 1px solid var(--border); padding: 6px 4px calc(10px + env(safe-area-inset-bottom)); }
.inferior a { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-height: 48px; font-size: 12px; color: var(--muted); text-decoration: none; }
.inferior a.activo { color: var(--accent); font-weight: 600; }
.cab-pagina { display: flex; align-items: center; gap: 12px; min-height: 48px; }
.cab-pagina h1 { font-family: var(--f-title); font-size: 20px; line-height: 1.2; overflow-wrap: anywhere; }
.cab-pagina .cab-textos { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.cab-pagina .der { margin-left: auto; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
.btn-icono { width: 44px; height: 44px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--border); border-radius: 6px; background: var(--panel); color: var(--text); text-decoration: none; font-size: 20px; }
.btn-icono:hover { border-color: var(--accent); color: var(--accent); }
@media (max-width: 899.98px) {
  .solo-pc { display: none !important; }
  .tabla-wrap { -webkit-overflow-scrolling: touch; }
}
@media (min-width: 900px) {
  .solo-movil { display: none !important; }
  .marco { display: grid; grid-template-columns: 220px minmax(0, 1fr); min-height: 100vh; }
  .lateral { display: flex; flex-direction: column; gap: 4px; position: sticky; top: 0; height: 100vh; padding: 18px 12px; background: var(--panel); border-right: 1px solid var(--border); }
  .lateral .marca { display: flex; gap: 10px; align-items: center; padding: 0 6px 16px; text-decoration: none; color: var(--text); }
  .lateral .marca b { font-family: var(--f-title); font-size: 15px; display: block; }
  .lateral .marca .s { font-size: 12px; color: var(--muted); }
  .lateral > a:not(.marca):not(.btn), .lateral .abajo > a { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 12px; border-radius: 6px; color: var(--text); text-decoration: none; font-size: 14px; }
  .lateral > a:not(.marca):not(.btn):hover, .lateral .abajo > a:hover { background: var(--accent-softer); color: var(--text); }
  .lateral a.activo { background: var(--dark); color: var(--dark-text); }
  .lateral .abajo { margin-top: auto; display: flex; flex-direction: column; gap: 6px; }
  .lateral .quien { font-size: 12px; color: var(--muted); padding: 0 12px; }
  .inferior { display: none; }
  .contenido { padding: 24px 28px 32px; }
  .btn.chico { min-height: 36px; }
  input, select, textarea { font-size: 14px; }
}
```

- [ ] **Step 9: Run the tests**

Run: `pnpm test apps/web/test/web.test.ts`
Expected: PASS (all cases, including the 3 new ones; the old pages render inside the new layout).

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src apps/web/public/app.css apps/web/test/web.test.ts
git commit -m "feat(web): menú lateral en PC y barra inferior en el celular, lugares por rol y redirecciones" -m "Claude-Session: https://claude.ai/code/session_012rqk28jac1iV7v2GAJjggW"
```

(Screenshots start in Task 2, once the capture script exists; Task 2 photographs this shell.)

---

### Task 2: Capture script (Playwright) with automatic phone checks

**Files:**
- Create: `apps/web/scripts/capturas.ts`, `apps/web/scripts/lugares-captura.ts`
- Modify: `apps/web/package.json` (devDependency), `package.json` (script `capturas`), `apps/web/tsconfig.json` (include `scripts`), `.gitignore` (`capturas/`)

**Interfaces:**
- Consumes: `apps/web/src/main.ts` (started as a child process with `DATA_DIR`, `STORAGE_DIR`, `WEB_PUERTO`, `WEB_HOST`, `ENTRADA_DIRECTA=0`), demo data from `pnpm demo:flota` (user `demo@flota.pe` / `demo1234`), Chromium from `%LOCALAPPDATA%\ms-playwright\chromium-*\chrome-win64\chrome.exe`.
- Produces: `pnpm capturas [nombre …]` → `capturas/<CAPTURAS_ETIQUETA|ultima>/<nombre>-390.png`, `<nombre>-1440.png`, `revision.json`; `export interface LugarCaptura`, `export const LUGARES` (each later task edits this list).

- [ ] **Step 1: Add the dependency, script, tsconfig include and ignore**

Run: `pnpm --filter @sunatapp/web add -D playwright-core@^1.63.0`
Expected: `apps/web/package.json` devDependencies now list `"playwright-core"`; `pnpm-lock.yaml` updated; no browser download (playwright-core never downloads).

In root `package.json` `scripts`, add after `"web"`:

```json
    "capturas": "tsx apps/web/scripts/capturas.ts",
```

In `apps/web/tsconfig.json` change `"include"` to:

```json
  "include": ["src", "test", "scripts", "../../packages/core/test/helpers.ts"]
```

Append to `.gitignore`:

```
# Capturas del rediseño (pnpm capturas)
capturas/
```

- [ ] **Step 2: Create `apps/web/scripts/lugares-captura.ts`**

```ts
/** Lugares que fotografía `pnpm capturas`. Cada tarea del rediseño actualiza esta lista. */
export interface LugarCaptura {
  nombre: string;
  ruta: string;
  /** Sigue el primer enlace que coincida (para abrir, por ejemplo, el primer viaje). */
  seguir?: string;
  /** Hace clic aquí antes de la foto (por ejemplo, abrir el panel de Anotar). */
  clic?: string;
  /** Espera a que aparezca este selector después del clic. */
  esperar?: string;
  /** Milisegundos extra antes de la foto (el 3D necesita ~1.5 s). */
  espera?: number;
  /** Solo en un tamaño. */
  solo?: "pc" | "movil";
}

export const LUGARES: LugarCaptura[] = [
  { nombre: "inicio", ruta: "/" },
  { nombre: "viajes", ruta: "/viajes" },
  { nombre: "camiones", ruta: "/trailer", espera: 1500 },
  { nombre: "numeros", ruta: "/finanzas" },
  { nombre: "ajustes", ruta: "/ajustes" },
];
```

- [ ] **Step 3: Create `apps/web/scripts/capturas.ts`**

```ts
/**
 * Capturas del rediseño: levanta la web sobre los datos demo, entra como demo@flota.pe y
 * fotografía cada lugar a 390×844 (celular) y 1440×900 (PC).
 *
 *   pnpm demo:flota                  # una sola vez: crea ./data-demo
 *   pnpm capturas                    # todos los lugares → capturas/ultima/
 *   pnpm capturas inicio anotar      # solo esos
 *   CAPTURAS_ETIQUETA=tarea-3 pnpm capturas
 *
 * En el celular revisa además: desborde horizontal, botones de menos de 44 px, texto de menos de
 * 12 px y contraste menor a 4.5:1 → capturas/<etiqueta>/revision.json.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright-core";
import { LUGARES, type LugarCaptura } from "./lugares-captura";

const RAIZ = resolve(import.meta.dirname, "../../..");
const DATOS = resolve(RAIZ, process.env.CAPTURAS_DATOS ?? "data-demo");
const SALIDA = join(RAIZ, "capturas", process.env.CAPTURAS_ETIQUETA ?? "ultima");
const PUERTO = Number(process.env.CAPTURAS_PUERTO ?? 3939);
const BASE = `http://127.0.0.1:${PUERTO}`;
const TAMANOS = [{ nombre: "390", width: 390, height: 844 }, { nombre: "1440", width: 1440, height: 900 }] as const;

/**
 * Se evalúa en la página como texto (no como función: tsx agrega ayudantes `__name` que no existen
 * dentro del navegador).
 */
const REVISION = `(() => {
  const visible = (e) => { const b = e.getBoundingClientRect(); const s = getComputedStyle(e); return b.width > 0 && b.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const desc = (e) => e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (typeof e.className === "string" && e.className.trim() ? "." + e.className.trim().split(/\\s+/).join(".") : "") + " «" + (e.textContent || "").trim().slice(0, 30) + "»";
  const lum = (c) => { const m = c.match(/[\\d.]+/g); if (!m) return 1; const v = m.slice(0, 3).map((x) => { const n = Number(x) / 255; return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const fondo = (e) => { for (let x = e; x; x = x.parentElement) { const b = getComputedStyle(x).backgroundColor; const a = b.match(/[\\d.]+/g); if (a && (a.length < 4 || Number(a[3]) > 0.5)) return b; } return "rgb(239, 233, 220)"; };
  const botones = [...document.querySelectorAll("button, .btn, input:not([type=hidden]):not([type=radio]):not([type=checkbox]):not([type=file]), select, textarea, nav a, summary")]
    .filter((e) => visible(e) && e.getBoundingClientRect().height < 44).map(desc);
  const conTexto = [...document.querySelectorAll("body *")].filter((e) => visible(e) && [...e.childNodes].some((n) => n.nodeType === 3 && (n.textContent || "").trim()));
  const letraChica = conTexto.filter((e) => parseFloat(getComputedStyle(e).fontSize) < 12).map(desc);
  const contrasteBajo = conTexto.filter((e) => { const a = lum(getComputedStyle(e).color), b = lum(fondo(e)); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) < 4.5; }).map(desc);
  return { anchoPagina: document.documentElement.scrollWidth, botonesChicos: botones.slice(0, 15), letraChica: letraChica.slice(0, 15), contrasteBajo: contrasteBajo.slice(0, 15) };
})()`;

interface Revision { anchoPagina: number; botonesChicos: string[]; letraChica: string[]; contrasteBajo: string[] }

function buscarChromium(): string | undefined {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const base = join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
  if (!existsSync(base)) return undefined;
  const dirs = readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)));
  for (const d of dirs) {
    for (const sub of ["chrome-win64", "chrome-win"]) {
      const exe = join(base, d, sub, "chrome.exe");
      if (existsSync(exe)) return exe;
    }
  }
  return undefined;
}

function levantarWeb(): ChildProcess {
  const tsx = join(RAIZ, "node_modules", "tsx", "dist", "cli.mjs");
  return spawn(process.execPath, [tsx, "apps/web/src/main.ts"], {
    cwd: RAIZ,
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, DATA_DIR: DATOS, STORAGE_DIR: join(DATOS, "storage"), WEB_PUERTO: String(PUERTO), WEB_HOST: "127.0.0.1", ENTRADA_DIRECTA: "0" },
  });
}

async function esperarServidor(): Promise<void> {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${BASE}/salud`)).ok) return;
    } catch { /* todavía arranca */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("La web no respondió en 60 s");
}

async function entrar(page: Page): Promise<void> {
  await page.goto(`${BASE}/entrar`);
  await page.fill("input[name=email]", "demo@flota.pe");
  await page.fill("input[name=clave]", "demo1234");
  await Promise.all([page.waitForURL(`${BASE}/`), page.click("button[type=submit]")]);
}

/** Devuelve false si el lugar no se pudo abrir con estos datos (por ejemplo, no hay ningún viaje). */
async function capturar(page: Page, l: LugarCaptura, tamano: string): Promise<boolean> {
  await page.goto(`${BASE}${l.ruta}`, { waitUntil: "networkidle" });
  if (l.seguir) {
    const href = (await page.locator(l.seguir).count()) ? await page.locator(l.seguir).first().getAttribute("href") : null;
    if (!href) {
      console.warn(`⚠ ${l.nombre}: no hay ningún ${l.seguir} (saltado)`);
      return false;
    }
    await page.goto(new URL(href, BASE).href, { waitUntil: "networkidle" });
  }
  if (l.clic) {
    await page.click(l.clic);
    if (l.esperar) await page.waitForSelector(l.esperar);
  }
  await page.waitForTimeout(l.espera ?? 300);
  await page.screenshot({ path: join(SALIDA, `${l.nombre}-${tamano}.png`), fullPage: true });
  return true;
}

const filtro = process.argv.slice(2);
const lista = LUGARES.filter((l) => filtro.length === 0 || filtro.includes(l.nombre));
if (!existsSync(join(DATOS, "pglite"))) {
  console.error(`Faltan los datos demo en ${DATOS}: corre «pnpm demo:flota» primero.`);
  process.exit(1);
}
mkdirSync(SALIDA, { recursive: true });
const web = levantarWeb();
const revision: Record<string, Revision> = {};
try {
  await esperarServidor();
  const navegador = await chromium.launch({ executablePath: buscarChromium() });
  try {
    for (const t of TAMANOS) {
      const contexto = await navegador.newContext({ viewport: { width: t.width, height: t.height }, deviceScaleFactor: 1, locale: "es-PE" });
      const page = await contexto.newPage();
      await entrar(page);
      for (const l of lista) {
        if ((l.solo === "pc" && t.width < 900) || (l.solo === "movil" && t.width >= 900)) continue;
        if (!(await capturar(page, l, t.nombre))) continue;
        if (t.width === 390) revision[l.nombre] = (await page.evaluate(REVISION)) as Revision;
        console.log(`✓ ${l.nombre}-${t.nombre}.png`);
      }
      await contexto.close();
    }
  } finally {
    await navegador.close();
  }
  writeFileSync(join(SALIDA, "revision.json"), JSON.stringify(revision, null, 2));
  const malos = Object.entries(revision).filter(([, r]) => r.anchoPagina > 390 || r.botonesChicos.length || r.letraChica.length || r.contrasteBajo.length);
  console.log(malos.length ? `⚠ Revisar en 390 px: ${malos.map(([n]) => n).join(", ")} (ver revision.json)` : "✓ 390 px: sin desborde, botones chicos, letra chica ni contraste bajo");
} finally {
  web.kill();
}
```

- [ ] **Step 4: Create the demo data in this worktree (once)**

Run: `ls data-demo/pglite >/dev/null 2>&1 || pnpm demo:flota`
Expected: either nothing (already there) or the demo script finishes; `data-demo/` is git-ignored (`git status --short data-demo` prints nothing).

- [ ] **Step 5: Typecheck and run the capture**

Run: `pnpm typecheck`
Expected: no errors.

Run: `CAPTURAS_ETIQUETA=tarea-1-2 pnpm capturas`
Expected: 10 lines `✓ inicio-390.png` … `✓ ajustes-1440.png`, then a `⚠ Revisar en 390 px: …` or `✓ 390 px: …` line. Files: `capturas/tarea-1-2/{inicio,viajes,camiones,numeros,ajustes}-{390,1440}.png` and `revision.json`. Open `inicio-390.png` and `inicio-1440.png`: the phone shows the bottom bar (Inicio · Viajes · Camiones · Números) and no old header; the PC shows the 220 px side menu. Old pages still look dense (expected until their tasks). `git status --short` shows no file under `capturas/`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/scripts apps/web/package.json apps/web/tsconfig.json package.json pnpm-lock.yaml .gitignore
git commit -m "chore(web): capturas con Playwright a 390 y 1440 px con revisión automática" -m "Claude-Session: https://claude.ai/code/session_012rqk28jac1iV7v2GAJjggW"
```

---

### Task 3: Inicio + read-only core helpers

**Files:**
- Create: `packages/core/src/consultas/inicio.ts`, `packages/core/test/inicio.test.ts`
- Modify: `packages/core/src/index.ts` (append export), `apps/web/src/paginas/dashboard.tsx` (rewrite `vista`), `apps/web/src/ui.tsx` (add `Cifra`, `TarjetaEnRuta`, `ListaViajes`, `mesLargo`, `diasEntre`), `apps/web/public/app.css`, `apps/web/test/web.test.ts`

**Interfaces:**
- Consumes: `liquidacionViaje`, `resumenFinanciero`, `listarCobrosPendientes`, `rangoMes`, `mesAnterior`, `sumarDias`, `hoy`, tables `viaje`, `conductor`, `gasto`, `categoriaGasto` (core); `listarPorRevisar`, `saludFlota`, `viajesPorRevisar`, `listarViajesFlota`, `puedeVer` (web).
- Produces (core): `interface ResumenInicio`, `resumenInicio(ctx)`, `interface ViajeEnRuta`, `viajesEnRuta(ctx)`, `choferDeViaje(ctx, viajeId): Promise<string>`, `primerNombre(nombres): string`, `categoriasMasUsadas(ctx, n?, dias?): Promise<string[]>`.
- Produces (web): `Cifra`, `TarjetaEnRuta`, `ListaViajes`, `mesLargo(mes)`, `diasEntre(a, b)` in ui.tsx; `interface Atencion`, `atenciones(ctx, rol, cab)`, `ListaAtencion` exported from dashboard.tsx.

- [ ] **Step 1: Write the failing core test `packages/core/test/inicio.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  categoriasMasUsadas, choferDeViaje, primerNombre, registrarEntrega, registrarGasto, registrarIngreso, registrarViajeFlota, resumenInicio, viajesEnRuta,
  type Contexto,
} from "../src";
import { crearContextoPrueba } from "./helpers";

let ctx: Contexto;
let cerrar: () => Promise<void>;
beforeEach(async () => ({ ctx, cerrar } = await crearContextoPrueba()));
afterEach(async () => cerrar());

describe("consultas de Inicio", () => {
  it("viajes en ruta: chofer, día, lo entregado y lo gastado", async () => {
    const v = await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Yura", destinoLugar: "Puno", estado: "en_curso", fecha: "2026-09-12", origen: "web" });
    await registrarEntrega(ctx, { viajeId: v.id, monto: 120000, medio: "yape" });
    await registrarGasto(ctx, { viajeId: v.id, categoria: "combustible", monto: 64000, origen: "web" });
    const [r] = await viajesEnRuta(ctx);
    expect(r).toMatchObject({ viajeId: v.id, codigo: v.codigo, ruta: "Yura → Puno", chofer: "Jhon", dia: 2, entregado: 120000, gastado: 64000, saldo: 56000, deja: null });
    expect(await choferDeViaje(ctx, v.id)).toBe("Jhon");
  });

  it("resumen del mes: entró, salió, ganancia y te deben", async () => {
    await registrarIngreso(ctx, { concepto: "Alquiler de carreta", monto: 50000, origen: "web" });
    await registrarGasto(ctx, { categoria: "peaje", monto: 2000, origen: "web" });
    const r = await resumenInicio(ctx);
    expect(r).toMatchObject({ mes: "2026-09", mesAnterior: "2026-08", entro: 50000, teDeben: 0, facturasPorCobrar: 0 });
    expect(r.salio).toBeGreaterThanOrEqual(2000);
    expect(r.ganancia).toBe(r.entro - r.salio);
  });

  it("categorías más usadas (solo variables) y primer nombre", async () => {
    for (const m of [1000, 2000]) await registrarGasto(ctx, { categoria: "peaje", monto: m, origen: "web" });
    await registrarGasto(ctx, { categoria: "combustible", monto: 9000, origen: "web" });
    await registrarGasto(ctx, { categoria: "soat", monto: 9000, origen: "web" });
    expect(await categoriasMasUsadas(ctx, 3)).toEqual(["peaje", "combustible"]);
    expect(primerNombre("JHON LARRY")).toBe("Jhon");
    expect(primerNombre("  ")).toBe("el chofer");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm test packages/core/test/inicio.test.ts`
Expected: FAIL — `viajesEnRuta is not a function` / `does not provide an export named 'resumenInicio'`.

- [ ] **Step 3: Create `packages/core/src/consultas/inicio.ts`**

```ts
import { and, categoriaGasto, conductor, eq, gasto, sql, viaje } from "@sunatapp/db";
import { listarCobrosPendientes } from "../cobros/cobros";
import { mesAnterior, rangoMes, sumarDias } from "../dominio/fechas";
import { resumenFinanciero } from "../finanzas/finanzas";
import { hoy } from "../flota/unidades";
import type { Contexto } from "../infra/contexto";
import { liquidacionViaje } from "../viajes/liquidacion";

/** Solo lectura: lo que muestra la pantalla de Inicio del rediseño. */

export interface ResumenInicio {
  /** AAAA-MM del mes actual (hora de Lima). */
  mes: string;
  mesAnterior: string;
  ganancia: number;
  gananciaAnterior: number;
  entro: number;
  salio: number;
  viajes: number;
  /** Saldo de las facturas por cobrar. */
  teDeben: number;
  facturasPorCobrar: number;
  vencido: number;
}

export async function resumenInicio(ctx: Contexto): Promise<ResumenInicio> {
  const { desde, hasta, mes } = rangoMes(hoy(ctx));
  const anterior = mesAnterior(mes);
  const previo = rangoMes(`${anterior}-01`);
  const [fin, antes, cobros] = await Promise.all([
    resumenFinanciero(ctx, desde, hasta), resumenFinanciero(ctx, previo.desde, previo.hasta), listarCobrosPendientes(ctx),
  ]);
  return {
    mes, mesAnterior: anterior, ganancia: fin.ganancia, gananciaAnterior: antes.ganancia, entro: fin.ingresos, salio: fin.gastos, viajes: fin.viajes,
    teDeben: cobros.totalPendiente, facturasPorCobrar: cobros.filas.length, vencido: cobros.totalVencido,
  };
}

/** «JHON LARRY» → «Jhon» (como se le dice en la calle). */
export function primerNombre(nombres: string): string {
  const p = nombres.trim().split(/\s+/)[0] ?? "";
  return p ? p[0]!.toUpperCase() + p.slice(1).toLowerCase() : "el chofer";
}

export async function choferDeViaje(ctx: Contexto, viajeId: number): Promise<string> {
  const [f] = await ctx.db.select({ nombres: conductor.nombres }).from(viaje)
    .innerJoin(conductor, eq(conductor.id, viaje.conductorId)).where(eq(viaje.id, viajeId));
  return primerNombre(f?.nombres ?? "");
}

export interface ViajeEnRuta {
  viajeId: number;
  codigo: string;
  vehiculoId: number;
  unidad: string;
  ruta: string;
  chofer: string;
  /** Día del viaje: 1 el día que salió. */
  dia: number;
  entregado: number;
  gastado: number;
  /** entregado − gastado (lo que le queda al chofer; negativo = se le debe). */
  saldo: number;
  flete: number;
  /** flete − gastado; null si todavía no tiene flete. */
  deja: number | null;
}

const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export async function viajesEnRuta(ctx: Contexto): Promise<ViajeEnRuta[]> {
  const filas = await ctx.db.select({ id: viaje.id, salida: viaje.fechaSalida, nombres: conductor.nombres }).from(viaje)
    .innerJoin(conductor, eq(conductor.id, viaje.conductorId))
    .where(eq(viaje.estado, "en_curso")).orderBy(viaje.fechaSalida, viaje.id);
  const h = hoy(ctx);
  const r: ViajeEnRuta[] = [];
  for (const f of filas) {
    const l = await liquidacionViaje(ctx, f.id);
    r.push({
      viajeId: f.id, codigo: l.viaje.codigo, vehiculoId: l.viaje.vehiculoId, unidad: l.viaje.unidad, ruta: l.viaje.ruta,
      chofer: primerNombre(f.nombres), dia: Math.max(1, diasEntre(f.salida, h) + 1), entregado: l.entregado, gastado: l.gastado, saldo: l.saldo,
      flete: l.flete, deja: l.flete > 0 ? l.flete - l.gastado : null,
    });
  }
  return r;
}

/** Las categorías variables con más gastos en los últimos `dias` días (para los botones de «¿En qué?»). */
export async function categoriasMasUsadas(ctx: Contexto, n = 3, dias = 90): Promise<string[]> {
  const desde = sumarDias(hoy(ctx), -dias);
  const filas = await ctx.db.select({ categoria: gasto.categoria, total: sql<string>`count(*)` }).from(gasto)
    .innerJoin(categoriaGasto, eq(categoriaGasto.clave, gasto.categoria))
    .where(and(sql`${gasto.fecha} >= ${desde}`, eq(categoriaGasto.tipo, "variable"), eq(categoriaGasto.activa, true)))
    .groupBy(gasto.categoria).orderBy(sql`count(*) desc`, gasto.categoria).limit(n);
  return filas.map((f) => f.categoria);
}
```

Append to `packages/core/src/index.ts` (last line, additive):

```ts
export * from "./consultas/inicio";
```

- [ ] **Step 4: Run the core test**

Run: `pnpm test packages/core/test/inicio.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing web tests**

In `apps/web/test/web.test.ts`, inside `describe("con el dueño configurado", …)` add:

```ts
    it("inicio: ganaste, entró/salió/te deben, en ruta y lo que necesita atención", async () => {
      const cookie = await entrar();
      const v = await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Yura", destinoLugar: "Puno", estado: "en_curso", origen: "web" });
      const html = await (await app.request("/", { headers: { cookie } })).text();
      for (const t of ["Ganaste este mes", "Entró", "Salió", "Te deben", "Necesita tu atención", "En ruta ahora", "Yura → Puno", "SUNAT en modo simulado"]) {
        expect(html, t).toContain(t);
      }
      expect(html).toContain(`href="/viajes/${v.id}"`);
      expect(html).not.toContain("TELEGRAM · ENTRADAS DEL BOT");
      expect(html).not.toContain("GASTOS · POR CATEGORÍA");
    });

    it("inicio del taller: sin plata", async () => {
      await guardarUsuario(ctx, { nombre: "Taller", email: "taller@demo.pe", rol: "taller", clave: "clave-segura" });
      const html = await (await app.request("/", { headers: { cookie: await entrar("taller@demo.pe") } })).text();
      expect(html).toContain("Necesita tu atención");
      expect(html).not.toContain("Ganaste este mes");
      expect(html).not.toContain("En ruta ahora");
    });
```

In the existing test `"por revisar: guardar desde la web un mensaje que no se pudo leer"` change the line

```ts
      expect(await (await app.request("/", { headers: { cookie } })).text()).toContain("1 por revisar");
```

to

```ts
      expect(await (await app.request("/", { headers: { cookie } })).text()).toContain("por confirmar");
```

- [ ] **Step 6: Run them to see them fail**

Run: `pnpm test apps/web/test/web.test.ts -t "inicio|por revisar"`
Expected: FAIL — `expected '<!doctype html>…' to contain 'Ganaste este mes'` and `… to contain 'por confirmar'`.

- [ ] **Step 7: Add the shared pieces to `apps/web/src/ui.tsx`**

Add `FilaViajeFlota` and `ViajeEnRuta` to the type import from `@sunatapp/core`:

```tsx
import type { EstadoDesgaste, FilaViajeFlota, UsuarioWeb, ViajeEnRuta } from "@sunatapp/core";
```

Below `nombreMes` add:

```tsx
const MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
/** "2026-10" → "octubre". */
export const mesLargo = (mes: string) => MESES_LARGOS[Number(mes.slice(5, 7)) - 1] ?? mes;
/** Días entre dos fechas AAAA-MM-DD (b − a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
```

At the end of the `// ── Piezas ──` section add:

```tsx
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
      <span class="muted">Gastó {soles(v.gastado)} de {soles(v.entregado)} que le diste a {v.chofer}{v.deja !== null ? ` · deja ${soles(v.deja)}` : ""}</span>
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
```

- [ ] **Step 8: Rewrite the Inicio view in `apps/web/src/paginas/dashboard.tsx`**

Replace the imports and the `vista` function (keep `horaLima`, `FeedTelegram`, `htmlFeed` and `rutasDashboard` unchanged) with:

```tsx
/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import type { FC } from "hono/jsx";
import {
  hoy, listarCobrosPendientes, listarEventos, listarPorRevisar, listarViajesFlota, primerNombre, puedeVer, resumenInicio, saludFlota,
  viajesEnRuta, viajesPorRevisar, type Contexto, type RolUsuario,
} from "@sunatapp/core";
import { pagina, type App, type C, type Deps } from "../base";
import { RUTA } from "../lugares";
import { Cabecera, Cifra, diasEntre, Icono, ListaViajes, mesLargo, soles, TarjetaEnRuta, Vacio, type DatosCabecera } from "../ui";
```

```tsx
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
        der={<a class="btn-icono solo-movil" href="/ajustes" aria-label="Ajustes"><Icono n="ajustes" t={20} /></a>}
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
```

(`gastosPorCategoria`, `deudaPrestamos`, `listarRepuestos`, `resumirInventario`, `sumarDias`, `estadoBot`, `rangoMes`, `resumenFinanciero`, `contarPorRevisar`, `Kpi`, `Panel`, `Barra`, `CHIP_UNIDAD`, `ESTADO_UNIDAD` are no longer imported here; `listarEventos` stays for `htmlFeed`.)

- [ ] **Step 9: Add the Inicio styles to `apps/web/public/app.css`**

Append before the `.sin-gap` block:

```css
/* ── Inicio ── */
.tarjeta-oscura { background: var(--dark); color: var(--dark-text); border-radius: 8px; padding: 18px; display: flex; flex-direction: column; gap: 6px; }
.tarjeta-oscura .lbl, .tarjeta-oscura .sub { color: var(--dark-muted); }
.tarjeta-oscura .sub { font-size: 13px; }
.cifra-grande { font-family: var(--f-title); font-size: 36px; line-height: 1.1; color: var(--accent-on-dark); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.cifra-grande.neg { color: var(--amber-dark); }
.tres-cifras { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.dos-cifras { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.cifra { background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: 10px; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.cifra b { font-family: var(--f-title); font-size: 16px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.cifra .sub { font-size: 12px; color: var(--muted); }
.titulo-seccion { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); font-weight: 600; margin: 6px 0 0; }
.lista-filas { background: var(--panel); border: 1px solid var(--border); border-radius: 6px; display: flex; flex-direction: column; overflow: hidden; }
.fila-aviso { display: flex; gap: 12px; align-items: center; padding: 12px 14px; min-height: 48px; border-bottom: 1px solid var(--divider); color: var(--text); text-decoration: none; }
.fila-aviso:last-child { border-bottom: 0; }
.fila-aviso:hover { background: var(--accent-softer); color: var(--text); }
.fila-aviso .punto { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.fila-aviso .txt { flex: 1; min-width: 0; }
.fila-aviso .flecha { color: var(--muted); font-size: 18px; }
.tarjeta-ruta { background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: 14px; display: flex; flex-direction: column; gap: 8px; color: var(--text); text-decoration: none; }
.tarjeta-ruta:hover { border-color: var(--accent); color: var(--text); }
.fila-sep { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.ver-mas { display: inline-flex; align-items: center; min-height: 44px; font-weight: 600; }
.inicio-cifras, .inicio-cols, .col { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.col { gap: 8px; }
.lista-viajes { display: flex; flex-direction: column; background: var(--panel); border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.fila-viaje { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 10px; padding: 12px 14px; min-height: 48px; border-bottom: 1px solid var(--divider); color: var(--text); text-decoration: none; align-items: center; }
.fila-viaje:last-child { border-bottom: 0; }
.fila-viaje:hover { background: var(--accent-softer); color: var(--text); }
.fila-viaje .ruta { grid-column: 1 / -1; }
.fila-viaje .num { text-align: left; }
.fila-viaje > :nth-child(4)::before { content: "Flete "; color: var(--muted); }
.fila-viaje > :nth-child(5)::before { content: "Gastos "; color: var(--muted); }
.fila-viaje > :nth-child(6)::before { content: "Dejó "; color: var(--muted); font-weight: 400; }
.fila-viaje.cab { display: none; }
@media (min-width: 900px) {
  .inicio-cifras { display: grid; grid-template-columns: 1.4fr repeat(3, minmax(0, 1fr)); gap: 12px; }
  .inicio-cifras .tres-cifras { display: contents; }
  .inicio-cols { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; }
  .cifra { padding: 14px; }
  .cifra b { font-size: 22px; }
  .fila-viaje { grid-template-columns: minmax(0, 2fr) 90px 120px repeat(3, minmax(0, 1fr)); }
  .fila-viaje .ruta { grid-column: auto; }
  .fila-viaje .num { text-align: right; }
  .fila-viaje > :nth-child(n)::before { content: none; }
  .fila-viaje.cab { display: grid; background: var(--panel-alt); font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; min-height: 40px; }
}
```

- [ ] **Step 10: Run the tests**

Run: `pnpm test apps/web/test/web.test.ts packages/core/test/inicio.test.ts`
Expected: PASS.

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 11: Screenshots**

Run: `CAPTURAS_ETIQUETA=tarea-3 pnpm capturas inicio`
Expected: `capturas/tarea-3/inicio-390.png` and `inicio-1440.png`. Compare with the Inicio and Escritorio artboards: dark "Ganaste este mes" card, 3 figures, "Necesita tu atención" (max 5 rows with colored dots), "En ruta ahora" cards; the PC adds "Últimos viajes". `revision.json` → `inicio` has `anchoPagina` ≤ 390 and empty lists (fix CSS until it does).

- [ ] **Step 12: Commit**

```bash
git add packages/core/src/consultas/inicio.ts packages/core/src/index.ts packages/core/test/inicio.test.ts apps/web/src apps/web/public/app.css apps/web/test/web.test.ts
git commit -m "feat(web): Inicio con lo que ganaste, te deben, avisos y viajes en ruta" -m "Claude-Session: https://claude.ai/code/session_012rqk28jac1iV7v2GAJjggW"
```

---

### Task 4: Anotar — one form for Gasté, Plata al chofer, Me pagaron

**Files:**
- Create: `apps/web/src/acciones.ts`, `apps/web/src/paginas/anotar.tsx`
- Modify: `apps/web/src/base.tsx` (`volverA`), `apps/web/src/app.tsx` (register `rutasAnotar`), `apps/web/src/ui.tsx` (Anotar button in both menus), `apps/web/src/lugares.ts` (`RUTA.cobrar`), `apps/web/src/paginas/finanzas.tsx` (POST `/finanzas/gasto`, `/finanzas/ingreso` use the handlers), `apps/web/src/paginas/liquidacion.tsx` (POST `/viajes/:id/entrega`), `apps/web/src/paginas/viajes.tsx` (POST `/cobros/:id`), `apps/web/public/app.css`, `apps/web/scripts/lugares-captura.ts`, `apps/web/test/web.test.ts`

**Interfaces:**
- Consumes: `registrarGasto`, `registrarEntrega`, `registrarCobro`, `registrarIngreso`, `capturarContexto`, `describirContexto`, `categoriasMasUsadas`, `viajesEnRuta`, `listarCobrosPendientes`, `listarCategorias`, `listarUnidades`, `listarViajesFlota`, `ultimaUnidadDeUsuario`, `MEDIOS_ENTREGA`, `NOMBRE_MEDIO_PAGO`, `nombreCategoria`, `fechaHoraLima`, `hoy`, `parsearMonto`, `puedeEditar` (core); `formularioMultiparte`, `formulario`, `accion`, `pagina` (base); `TIPOS_ANOTAR`, `tiposAnotar` (lugares); `Cabecera`, `Icono`, `diasEntre`, `fechaCorta`, `soles2`, `Vacio` (ui).
- Produces: `acciones.ts` → `type Campos`, `montoObligatorio(v, nombre?)`, `guardarFoto(d, foto?)`, `guardarGasto(d, usuarioId, f, foto?)`, `guardarEntrega(d, usuarioId, viajeId, f)`, `guardarCobro(d, usuarioId, facturaId, f)`, `guardarIngreso(d, usuarioId, f)`; `base.tsx` → `volverA(v, porDefecto)`; `anotar.tsx` → `rutasAnotar(app, d)`, `urlAnotar(q)`, `type Q`, `interface PartesForm`; routes `GET /anotar` (query `tipo, modo, volver, viajeId, vehiculoId, facturaId, prestamoId, pieza, parteId, repuestoId, parcial`), `POST /anotar` (fields `tipo, modo, volver` + per-type fields below).

POST `/anotar` fields per type: **gaste** `monto, categoria ("otro" → categoriaOtra), foto?, viajeId?, vehiculoId?, fecha?, km?, medioPago?, nota?`; **chofer** `monto, viajeId, medio, fecha?, nota?`; **cobro** `facturaId, monto, medio` or (`modo=otro`) `concepto, monto, vehiculoId?, fecha?`.

- [ ] **Step 1: Write the failing tests**

In `apps/web/test/web.test.ts` add `liquidacionViaje` to the `@sunatapp/core` import, and add this block inside `describe("con el dueño configurado", …)`:

```ts
    describe("anotar", () => {
      const enviar = (cookie: string, datos: Record<string, string>) => {
        const fd = new FormData();
        for (const [k, v] of Object.entries(datos)) fd.set(k, v);
        return app.request("/anotar", { method: "POST", headers: { cookie, origin: ORIGEN }, body: fd });
      };

      it("Gasté: se pide monto y en qué; viaje, camión y fecha se ponen solos; vuelve a donde estaba", async () => {
        const cookie = await entrar();
        const v = await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Yura", destinoLugar: "Puno", estado: "en_curso", origen: "web" });
        const html = await (await app.request("/anotar?volver=/viajes", { headers: { cookie } })).text();
        for (const t of ["¿Qué pasó?", "Gasté", "Plata al chofer", "Me pagaron", "¿Cuánto?", "¿En qué?", "Se pone solo", v.codigo]) expect(html, t).toContain(t);
        expect(html).toMatch(new RegExp(`<option value="${v.id}" selected[^>]*>${v.codigo} · `));
        expect(html).not.toContain('<nav class="inferior"');
        const r = await enviar(cookie, { tipo: "gaste", volver: "/viajes", monto: "350", categoria: "combustible", viajeId: String(v.id), vehiculoId: "1" });
        expect(r.status).toBe(303);
        expect(r.headers.get("location")).toMatch(/^\/viajes\?ok=Gasto\+guardado\+en\+VJ-/);
        const [g] = await ctx.db.select().from(gasto);
        expect(g).toMatchObject({ categoria: "combustible", monto: 35000, viajeId: v.id, vehiculoId: 1 });
      });

      it("Gasté con «Otro» usa la categoría elegida en la lista", async () => {
        const cookie = await entrar();
        await enviar(cookie, { tipo: "gaste", volver: "/", monto: "12", categoria: "otro", categoriaOtra: "balanza", vehiculoId: "1" });
        const [g] = await ctx.db.select().from(gasto);
        expect(g).toMatchObject({ categoria: "balanza", monto: 1200 });
      });

      it("Plata al chofer entra al viaje", async () => {
        const cookie = await entrar();
        const v = await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Yura", destinoLugar: "Puno", estado: "en_curso", origen: "web" });
        const html = await (await app.request("/anotar?tipo=chofer", { headers: { cookie } })).text();
        expect(html).toContain("¿Cómo se la diste?");
        const r = await enviar(cookie, { tipo: "chofer", volver: `/viajes/${v.id}`, monto: "500", medio: "yape", viajeId: String(v.id) });
        expect(aviso(r)).toContain("ok=Entrega de S/ 500.00 anotada");
        expect((await liquidacionViaje(ctx, v.id)).entregado).toBe(50000);
      });

      it("Me pagaron: sin facturas lo dice; otro ingreso se guarda; un error vuelve al formulario", async () => {
        const cookie = await entrar();
        expect(await (await app.request("/anotar?tipo=cobro", { headers: { cookie } })).text()).toContain("Nadie te debe facturas");
        let r = await enviar(cookie, { tipo: "cobro", modo: "otro", volver: "/", concepto: "Alquiler de carreta", monto: "300" });
        expect(aviso(r)).toContain("ok=Ingreso guardado");
        r = await enviar(cookie, { tipo: "cobro", volver: "/", facturaId: "999", monto: "10", medio: "efectivo" });
        expect(r.headers.get("location")).toMatch(/^\/anotar\?tipo=cobro/);
        expect(aviso(r)).toContain("error=");
      });

      it("cada rol ve y guarda solo lo suyo", async () => {
        await guardarUsuario(ctx, { nombre: "Taller", email: "taller@demo.pe", rol: "taller", clave: "clave-segura" });
        const taller = await entrar("taller@demo.pe");
        expect((await enviar(taller, { tipo: "gaste", volver: "/", monto: "10", categoria: "peaje" })).status).toBe(403);
        await guardarUsuario(ctx, { nombre: "Conta", email: "conta@demo.pe", rol: "contador", clave: "clave-segura" });
        const conta = await entrar("conta@demo.pe");
        const html = await (await app.request("/anotar", { headers: { cookie: conta } })).text();
        expect(html).toContain("Gasté");
        expect(html).not.toContain("Reparé / repuesto");
        expect((await enviar(conta, { tipo: "gaste", volver: "/", monto: "10", categoria: "peaje", vehiculoId: "1" })).status).toBe(303);
      });
    });
```

Change the existing test `"gasto mínimo: solo monto y categoría; el resto se completa solo"`: replace

```ts
      const html = await (await app.request("/finanzas", { headers: { cookie } })).text();
      expect(html).toContain("Se guarda con");
```

with

```ts
      const html = await (await app.request("/anotar", { headers: { cookie } })).text();
      expect(html).toContain("Se pone solo");
```

(the rest of that test keeps posting to `/finanzas/gasto`, proving the old POST still works).

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm test apps/web/test/web.test.ts -t "anotar|gasto mínimo"`
Expected: FAIL — `GET /anotar` answers 404 (`expected '404 Not Found' to contain '¿Qué pasó?'`).

- [ ] **Step 3: Add `volverA` to `apps/web/src/base.tsx`** (below `volver`)

```tsx
/** Destino seguro para volver después de guardar: solo rutas propias («/…», nunca «//…»). */
export function volverA(v: string | undefined, porDefecto: string): string {
  return v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : porDefecto;
}
```

- [ ] **Step 4: Create `apps/web/src/acciones.ts`**

```ts
import {
  ErrorNegocio, hoy, MEDIOS_ENTREGA, parsearMonto, registrarCobro, registrarEntrega, registrarGasto, registrarIngreso, type MedioPago,
} from "@sunatapp/core";
import type { Deps } from "./base";
import { enteroONull } from "./paginas/flota";
import { soles2 } from "./ui";

/**
 * Manejadores compartidos: los usan `POST /anotar` y las rutas POST de siempre, así los dos caminos
 * llaman exactamente a la misma lógica de `packages/core`.
 */
export type Campos = Record<string, string>;

export function montoObligatorio(v: string | undefined, nombre = "Monto"): number {
  const m = parsearMonto(v ?? "");
  if (m === null) throw new ErrorNegocio(`${nombre} no válido`);
  return m;
}

export const idONull = (v: string | undefined): number | null => (v && /^\d+$/.test(v) ? Number(v) : null);

export async function guardarFoto(d: Deps, foto: File | undefined): Promise<string | null> {
  if (!foto) return null;
  if (foto.size > 8 * 1024 * 1024) throw new ErrorNegocio("La foto pesa más de 8 MB");
  const ext = (foto.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  return d.ctx.almacen.guardar(`vouchers/${Date.now()}-web.${ext}`, Buffer.from(await foto.arrayBuffer()));
}

/** Gasto del viaje o de la empresa (antes: POST /finanzas/gasto). */
export async function guardarGasto(d: Deps, usuarioId: number, f: Campos, foto?: File): Promise<string> {
  const rutaFoto = await guardarFoto(d, foto);
  const r = await registrarGasto(d.ctx, {
    categoria: f.categoria ?? "", monto: montoObligatorio(f.monto), vehiculoId: idONull(f.vehiculoId), viajeId: idONull(f.viajeId),
    fecha: f.fecha || undefined, nota: f.nota || null, rutaFoto, origen: "web", usuarioId,
    medioPago: (f.medioPago || undefined) as MedioPago | undefined, kmVehiculo: f.km ? enteroONull(f.km) : null,
  });
  const donde = r.viajeCodigo ? ` en ${r.viajeCodigo}` : "";
  return r.avisoKm ? `Gasto guardado${donde}. ${r.avisoKm}` : `Gasto guardado${donde}`;
}

/** Plata entregada al chofer (antes: POST /viajes/:id/entrega). */
export async function guardarEntrega(d: Deps, usuarioId: number, viajeId: number, f: Campos): Promise<string> {
  const monto = montoObligatorio(f.monto);
  const medio = (f.medio && f.medio in MEDIOS_ENTREGA ? f.medio : "efectivo") as keyof typeof MEDIOS_ENTREGA;
  await registrarEntrega(d.ctx, { viajeId, monto, medio, fecha: f.fecha || undefined, nota: f.nota || null, usuarioId });
  return `Entrega de ${soles2(monto)} anotada`;
}

/** Cobro de una factura (antes: POST /cobros/:id). */
export async function guardarCobro(d: Deps, usuarioId: number, facturaId: number, f: Campos): Promise<string> {
  const monto = montoObligatorio(f.monto);
  const medio = f.medio === "efectivo" || f.medio === "otro" ? f.medio : "transferencia";
  const r = await registrarCobro(d.ctx, { facturaId, montoCentimos: monto, fecha: hoy(d.ctx), medio, usuarioId });
  return r.estadoCobro === "pagada" ? "Factura pagada por completo" : `Cobro registrado · saldo ${soles2(r.saldo)}`;
}

/** Otro ingreso (antes: POST /finanzas/ingreso). */
export async function guardarIngreso(d: Deps, usuarioId: number, f: Campos): Promise<string> {
  await registrarIngreso(d.ctx, { concepto: f.concepto ?? "", monto: montoObligatorio(f.monto), vehiculoId: idONull(f.vehiculoId), fecha: f.fecha || undefined, origen: "web", usuarioId });
  return "Ingreso guardado";
}
```

- [ ] **Step 5: Make the old POST routes use the handlers**

`apps/web/src/paginas/finanzas.tsx`: delete the local `function montoObligatorio …`, add `import { guardarGasto, guardarIngreso, montoObligatorio } from "../acciones";`, and replace the two handlers:

```tsx
  app.post("/finanzas/gasto", async (c) => {
    const { campos: f, archivos } = await formularioMultiparte(c);
    return accion(c, "/finanzas", () => guardarGasto(d, c.get("usuario").id, f, archivos.foto));
  });
```

```tsx
  app.post("/finanzas/ingreso", async (c) => {
    const f = await formulario(c);
    return accion(c, "/finanzas", () => guardarIngreso(d, c.get("usuario").id, f));
  });
```

`apps/web/src/paginas/liquidacion.tsx`: add `import { guardarEntrega } from "../acciones";` and replace the body of `POST /viajes/:id{[0-9]+}/entrega` with:

```tsx
  app.post("/viajes/:id{[0-9]+}/entrega", async (c) => {
    const id = Number(c.req.param("id"));
    const f = await formulario(c);
    return accion(c, `/viajes/${id}`, () => guardarEntrega(d, c.get("usuario").id, id, f));
  });
```

`apps/web/src/paginas/viajes.tsx`: add `import { guardarCobro } from "../acciones";` and `volverA` to the `../base` import, and replace `POST /cobros/:id` with:

```tsx
  app.post("/cobros/:id", async (c) => {
    const f = await formulario(c);
    return accion(c, volverA(f.volver, "/viajes"), () => guardarCobro(d, c.get("usuario").id, Number(c.req.param("id")), f));
  });
```

- [ ] **Step 6: Create `apps/web/src/paginas/anotar.tsx`**

```tsx
/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import type { Child, FC, PropsWithChildren } from "hono/jsx";
import {
  capturarContexto, categoriasMasUsadas, describirContexto, ErrorNegocio, fechaHoraLima, hoy, listarCategorias, listarCobrosPendientes,
  listarUnidades, listarViajesFlota, MEDIOS_ENTREGA, NOMBRE_MEDIO_PAGO, nombreCategoria, puedeEditar, ultimaUnidadDeUsuario, viajesEnRuta,
  type UsuarioWeb, type ViajeEnRuta,
} from "@sunatapp/core";
import { accion, formularioMultiparte, pagina, volverA, type App, type C, type Deps } from "../base";
import { guardarCobro, guardarEntrega, guardarGasto, guardarIngreso, type Campos } from "../acciones";
import { TIPOS_ANOTAR, tiposAnotar, type TipoAnotar } from "../lugares";
import { Cabecera, diasEntre, fechaCorta, Icono, soles2, Vacio, type NombreIcono } from "../ui";

/** Tipos que ya tienen formulario. La tarea 5 completa los demás y borra esta lista. */
const LISTOS: TipoAnotar[] = ["gaste", "chofer", "cobro"];

const CLAVES_Q = ["tipo", "modo", "volver", "viajeId", "vehiculoId", "facturaId", "prestamoId", "pieza", "parteId", "repuestoId"] as const;
type ClaveQ = (typeof CLAVES_Q)[number];
/** Lo que llega en la URL de /anotar (todo texto; "" = no vino). */
export type Q = Record<ClaveQ, string> & { parcial: boolean };

const num = (v: string | undefined): number | null => (v && /^\d+$/.test(v) ? Number(v) : null);

function leerQ(c: C, permitidos: TipoAnotar[]): Q {
  const q = Object.fromEntries(CLAVES_Q.map((k) => [k, (c.req.query(k) ?? "").trim()])) as Record<ClaveQ, string>;
  const tipo = permitidos.includes(q.tipo as TipoAnotar) ? q.tipo : permitidos[0]!;
  return { ...q, tipo, volver: volverA(q.volver, "/"), parcial: c.req.query("parcial") === "1" };
}

/** Enlace a Anotar con estos datos (los vacíos no se ponen). */
export function urlAnotar(q: Partial<Record<ClaveQ, string | number | null>>): string {
  const p = new URLSearchParams();
  for (const k of CLAVES_Q) {
    const v = q[k];
    if (v !== null && v !== undefined && v !== "") p.set(k, String(v));
  }
  return `/anotar?${p.toString()}`;
}
const otroTipo = (q: Q, tipo: TipoAnotar) => urlAnotar({ tipo, volver: q.volver, viajeId: q.viajeId, vehiculoId: q.vehiculoId });

/** Lo que cada tipo pone en el formulario. */
export interface PartesForm {
  campos: Child;
  /** Bloque azul «Se pone solo» con su «cambiar» plegado. */
  solo?: { texto: string; cambiar?: Child };
  /** Sub-opciones del tipo (por ejemplo «Una factura» / «Otro ingreso»). */
  modos?: Array<{ modo: string; etiqueta: string }>;
  /** En vez del formulario, solo este mensaje (por ejemplo: nadie te debe). */
  soloMensaje?: Child;
  accion?: string;
  tipoOculto?: string;
  arriba?: Child;
  abajo?: Child;
  boton?: string;
}

// ── Piezas del formulario ────────────────────────────────────────────────────

const CampoMonto: FC<{ valor?: string; etiqueta?: string }> = (p) => (
  <label class="campo campo-monto">
    <span>{p.etiqueta ?? "¿Cuánto?"}</span>
    <span class="monto-caja"><span aria-hidden="true">S/</span><input name="monto" inputmode="decimal" required autocomplete="off" placeholder="0.00" value={p.valor ?? ""} /></span>
  </label>
);

const OpcionIcono: FC<{ nombre: string; valor: string; icono: NombreIcono; texto: string; marcado?: boolean }> = (p) => (
  <label class="opcion"><input type="radio" name={p.nombre} value={p.valor} checked={p.marcado} required /><Icono n={p.icono} t={22} /><span>{p.texto}</span></label>
);

const OpcionTexto: FC<{ nombre: string; valor: string; texto: string; marcado?: boolean }> = (p) => (
  <label class="opcion"><input type="radio" name={p.nombre} value={p.valor} checked={p.marcado} /><span>{p.texto}</span></label>
);

const FotoOpcional: FC = () => (
  <label class="foto-opcional"><Icono n="camara" t={20} /><span>Foto del voucher (opcional)</span><input type="file" name="foto" accept="image/*,application/pdf" /></label>
);

const SePoneSolo: FC<PropsWithChildren<{ texto: string }>> = (p) => (
  <div class="se-pone-solo">
    <b class="lbl">Se pone solo</b>
    <span>{p.texto}</span>
    {p.children ? <details><summary>cambiar</summary><div class="filas">{p.children}</div></details> : null}
  </div>
);

const SelectUnidad: FC<{ unidades: Array<{ id: number; codigo: string; placa: string }>; elegido: number | null; vacio?: string }> = (p) => (
  <label class="campo"><span>Camión</span>
    <select name="vehiculoId">{p.vacio ? <option value="">{p.vacio}</option> : null}{p.unidades.map((u) => <option value={u.id} selected={u.id === p.elegido}>{u.codigo} · {u.placa}</option>)}</select>
  </label>
);

type OpcionViaje = { id: number; texto: string };
const SelectViaje: FC<{ opciones: OpcionViaje[]; elegido: number | null; requerido?: boolean }> = (p) => (
  <label class="campo"><span>Viaje</span>
    <select name="viajeId" required={p.requerido}>
      {p.requerido ? null : <option value="">— sin viaje —</option>}
      {p.opciones.map((o) => <option value={o.id} selected={o.id === p.elegido}>{o.texto}</option>)}
    </select>
  </label>
);

/** «Si hay varios, se elige con un toque.» */
const ViajesRadios: FC<{ viajes: ViajeEnRuta[] }> = (p) => (
  <fieldset class="grupo"><legend class="lbl">¿De qué viaje?</legend>
    <div class="opciones-lista">
      {p.viajes.map((v, i) => (
        <label class="opcion-fila"><input type="radio" name="viajeId" value={v.viajeId} checked={i === 0} required /><span><b>{v.unidad}</b> · {v.ruta} <span class="muted">· {v.chofer}</span></span></label>
      ))}
    </div>
  </fieldset>
);

const CampoFecha: FC<{ d: Deps }> = (p) => <label class="campo"><span>Fecha</span><input type="date" name="fecha" value={hoy(p.d.ctx)} /></label>;
const ahora = (d: Deps) => fechaHoraLima(d.ctx.reloj()).hora.slice(0, 5);
const iconoCategoria = (k: string): NombreIcono => (({ combustible: "combustible", peaje: "peaje", viaticos: "comida" }) as Record<string, NombreIcono>)[k] ?? "otro";

function opcionesDeViaje(enRuta: ViajeEnRuta[], actual: { viajeId: number | null; viajeCodigo: string | null }): OpcionViaje[] {
  const r = enRuta.map((v) => ({ id: v.viajeId, texto: `${v.codigo} · ${v.unidad} · ${v.ruta}` }));
  if (actual.viajeId !== null && !r.some((o) => o.id === actual.viajeId)) r.unshift({ id: actual.viajeId, texto: actual.viajeCodigo ?? `Viaje ${actual.viajeId}` });
  return r;
}

// ── Cada tipo ────────────────────────────────────────────────────────────────

async function parteGaste(c: C, d: Deps, q: Q): Promise<PartesForm> {
  const ctx = d.ctx;
  const [categorias, masUsadas, unidades, enRuta] = await Promise.all([
    listarCategorias(ctx, { tipo: "variable", soloActivas: true }), categoriasMasUsadas(ctx, 3), listarUnidades(ctx), viajesEnRuta(ctx),
  ]);
  const botones = [...new Set([...masUsadas, "combustible", "peaje", "viaticos"])].filter((k) => categorias.some((x) => x.clave === k)).slice(0, 3);
  const viajeId = num(q.viajeId) ?? (enRuta.length === 1 ? enRuta[0]!.viajeId : null);
  const elegirViaje = viajeId === null && enRuta.length > 1;
  const vehiculoId = num(q.vehiculoId) ?? (await ultimaUnidadDeUsuario(ctx, c.get("usuario").id)) ?? unidades[0]?.id ?? null;
  const g = await capturarContexto(ctx, { viajeId, vehiculoId, sinViaje: elegirViaje });
  return {
    campos: (
      <>
        <CampoMonto />
        <fieldset class="grupo">
          <legend class="lbl">¿En qué?</legend>
          <div class="opciones-icono">
            {botones.map((k, i) => <OpcionIcono nombre="categoria" valor={k} icono={iconoCategoria(k)} texto={nombreCategoria(k, categorias)} marcado={i === 0} />)}
            <OpcionIcono nombre="categoria" valor="otro" icono="otro" texto="Otro" />
          </div>
          <label class="campo otro-cual"><span>¿Cuál?</span><select name="categoriaOtra">{categorias.map((k) => <option value={k.clave}>{k.nombre}</option>)}</select></label>
        </fieldset>
        {elegirViaje ? <ViajesRadios viajes={enRuta} /> : null}
        <FotoOpcional />
      </>
    ),
    solo: {
      texto: `${describirContexto(g)} · hoy ${ahora(d)}`,
      cambiar: (
        <>
          <SelectUnidad unidades={unidades} elegido={g.vehiculoId} vacio="— de la empresa —" />
          {elegirViaje ? null : <SelectViaje opciones={opcionesDeViaje(enRuta, g)} elegido={g.viajeId} />}
          <CampoFecha d={d} />
          <label class="campo"><span>Km del tablero</span><input name="km" inputmode="numeric" placeholder={g.km !== null ? String(g.km) : ""} /></label>
          <label class="campo"><span>¿Cómo se pagó?</span>
            <select name="medioPago"><option value="">Automático ({NOMBRE_MEDIO_PAGO[g.medioPago]})</option>{Object.entries(NOMBRE_MEDIO_PAGO).map(([k, n]) => <option value={k}>{n}</option>)}</select>
          </label>
          <label class="campo"><span>Detalle</span><input name="nota" maxlength={200} /></label>
        </>
      ),
    },
  };
}

async function parteChofer(_c: C, d: Deps, q: Q): Promise<PartesForm> {
  const ctx = d.ctx;
  const enRuta = await viajesEnRuta(ctx);
  const viajeId = num(q.viajeId) ?? (enRuta.length === 1 ? enRuta[0]!.viajeId : null);
  const recientes = viajeId === null && enRuta.length === 0 ? await listarViajesFlota(ctx, { limite: 10 }) : [];
  const g = viajeId !== null ? await capturarContexto(ctx, { viajeId }) : null;
  const elegido = enRuta.find((v) => v.viajeId === viajeId);
  return {
    campos: (
      <>
        <CampoMonto />
        <fieldset class="grupo"><legend class="lbl">¿Cómo se la diste?</legend>
          <div class="opciones-texto">{Object.entries(MEDIOS_ENTREGA).map(([k, n], i) => <OpcionTexto nombre="medio" valor={k} texto={n} marcado={i === 0} />)}</div>
        </fieldset>
        {viajeId === null && enRuta.length > 1 ? <ViajesRadios viajes={enRuta} /> : null}
        {viajeId === null && enRuta.length === 0 ? (
          recientes.length
            ? <SelectViaje requerido opciones={recientes.map((v) => ({ id: v.id, texto: `${v.codigo} · ${v.unidad} · ${v.ruta}` }))} elegido={null} />
            : <Vacio>Todavía no hay viajes. Crea uno en Viajes.</Vacio>
        ) : null}
      </>
    ),
    solo: g ? {
      texto: `${elegido ? `${elegido.unidad} · ${elegido.ruta} · ${elegido.chofer}` : g.viajeCodigo ?? ""} · hoy ${ahora(d)}`,
      cambiar: (
        <>
          <SelectViaje requerido opciones={opcionesDeViaje(enRuta, g)} elegido={viajeId} />
          <CampoFecha d={d} />
          <label class="campo"><span>Nota</span><input name="nota" placeholder="Adelanto de salida" /></label>
        </>
      ),
    } : undefined,
  };
}

async function parteCobro(c: C, d: Deps, q: Q): Promise<PartesForm> {
  const modos = puedeEditar(c.get("usuario").rol, "finanzas") ? [{ modo: "", etiqueta: "Una factura" }, { modo: "otro", etiqueta: "Otro ingreso" }] : undefined;
  if (q.modo === "otro") {
    const unidades = await listarUnidades(d.ctx);
    return {
      modos,
      campos: (
        <>
          <CampoMonto />
          <label class="campo"><span>¿De qué?</span><input name="concepto" required placeholder="Alquiler de la carreta, venta de chatarra…" /></label>
        </>
      ),
      solo: { texto: `Entra hoy ${ahora(d)} · a la empresa`, cambiar: <><SelectUnidad unidades={unidades} elegido={null} vacio="— de la empresa —" /><CampoFecha d={d} /></> },
    };
  }
  const { filas } = await listarCobrosPendientes(d.ctx);
  const ordenadas = [...filas].sort((a, b) => a.fechaVencimiento.localeCompare(b.fechaVencimiento));
  const sel = ordenadas.find((f) => f.facturaId === num(q.facturaId)) ?? ordenadas[0];
  if (!sel) return { modos, campos: null, soloMensaje: <div class="lista-filas"><Vacio>Nadie te debe facturas. 👌</Vacio></div> };
  const h = hoy(d.ctx);
  return {
    modos,
    campos: (
      <>
        <fieldset class="grupo"><legend class="lbl">¿Quién te pagó?</legend>
          <div class="lista-filas">
            {ordenadas.map((f) => (
              <a class={`fila-aviso${f.facturaId === sel.facturaId ? " sel" : ""}`} href={urlAnotar({ ...q, facturaId: f.facturaId })} data-panel-link="" aria-current={f.facturaId === sel.facturaId ? "true" : undefined}>
                <span class="punto" style={`background:var(${f.estado === "vencida" ? "--accent" : "--amber-bar"})`}></span>
                <span class="txt"><b>{f.cliente}</b> · {f.serieNumero}<br /><span class="muted">{f.estado === "vencida" ? `vencida hace ${diasEntre(f.fechaVencimiento, h)} días` : `vence ${fechaCorta(f.fechaVencimiento)}`}</span></span>
                <b>{soles2(f.saldo)}</b>
              </a>
            ))}
          </div>
        </fieldset>
        <input type="hidden" name="facturaId" value={sel.facturaId} />
        <CampoMonto valor={(sel.saldo / 100).toFixed(2)} etiqueta="¿Cuánto te pagaron?" />
        <fieldset class="grupo"><legend class="lbl">¿Cómo?</legend>
          <div class="opciones-texto">{[["transferencia", "Transferencia"], ["efectivo", "Efectivo"], ["otro", "Otro"]].map(([k, n], i) => <OpcionTexto nombre="medio" valor={k!} texto={n!} marcado={i === 0} />)}</div>
        </fieldset>
      </>
    ),
    solo: { texto: `Hoy ${ahora(d)} · se descuenta de lo que te deben` },
  };
}

const PARTES: Partial<Record<TipoAnotar, (c: C, d: Deps, q: Q) => Promise<PartesForm>>> = { gaste: parteGaste, chofer: parteChofer, cobro: parteCobro };

// ── Formulario ───────────────────────────────────────────────────────────────

const FormAnotar: FC<{ q: Q; permitidos: TipoAnotar[]; p: PartesForm }> = ({ q, permitidos, p }) => (
  <div class="anotar">
    <Cabecera titulo="¿Qué pasó?" volver={q.volver} />
    <nav class="tipos-anotar" aria-label="¿Qué pasó?">
      {permitidos.map((t) => (
        <a href={otroTipo(q, t)} data-panel-link="" class={t === q.tipo ? "activo" : undefined} aria-current={t === q.tipo ? "true" : undefined}>
          <Icono n={t} t={24} /><span>{TIPOS_ANOTAR[t].corta}</span>
        </a>
      ))}
    </nav>
    {p.modos ? (
      <nav class="segmentos" aria-label="Opciones">
        {p.modos.map((m) => (
          <a href={urlAnotar({ ...q, modo: m.modo, facturaId: "", prestamoId: "" })} data-panel-link="" class={m.modo === q.modo ? "activo" : undefined} aria-current={m.modo === q.modo ? "true" : undefined}>{m.etiqueta}</a>
        ))}
      </nav>
    ) : null}
    {p.arriba ?? null}
    {p.soloMensaje ?? (
      <form method="post" action={p.accion ?? "/anotar"} enctype="multipart/form-data" class="form-anotar" data-asi-queda={q.tipo === "gaste" || q.tipo === "chofer" ? "" : undefined}>
        <input type="hidden" name="tipo" value={p.tipoOculto ?? q.tipo} />
        {q.modo ? <input type="hidden" name="modo" value={q.modo} /> : null}
        <input type="hidden" name="volver" value={q.volver} />
        {p.campos}
        {p.solo ? <SePoneSolo texto={p.solo.texto}>{p.solo.cambiar}</SePoneSolo> : null}
        {p.abajo ?? null}
        <button class="btn primario guardar" type="submit">{p.boton ?? "GUARDAR"}</button>
      </form>
    )}
  </div>
);

async function vista(c: C, d: Deps) {
  const permitidos = tiposAnotar(c.get("usuario").rol).filter((t) => LISTOS.includes(t));
  if (!permitidos.length) return c.redirect("/?error=" + encodeURIComponent("Tu rol no anota movimientos"));
  const q = leerQ(c, permitidos);
  const p = await PARTES[q.tipo as TipoAnotar]!(c, d, q);
  const cuerpo = <FormAnotar q={q} permitidos={permitidos} p={p} />;
  if (q.parcial) return c.html(cuerpo.toString());
  return pagina(c, d, { titulo: "Anotar", seccion: "dashboard", lugar: "anotar", sinNavInferior: true }, cuerpo);
}

/** Guarda lo anotado con el mismo manejador que usan las rutas de siempre. */
async function guardarAnotacion(d: Deps, u: UsuarioWeb, tipo: TipoAnotar, f: Campos, archivos: Record<string, File>): Promise<string> {
  switch (tipo) {
    case "gaste": {
      const categoria = f.categoria === "otro" ? (f.categoriaOtra ?? "") : (f.categoria ?? "");
      if (!categoria) throw new ErrorNegocio("Elige en qué se gastó");
      return guardarGasto(d, u.id, { ...f, categoria }, archivos.foto);
    }
    case "chofer": {
      const viajeId = num(f.viajeId);
      if (viajeId === null) throw new ErrorNegocio("Elige el viaje");
      return guardarEntrega(d, u.id, viajeId, f);
    }
    case "cobro": {
      if (f.modo === "otro") {
        if (!puedeEditar(u.rol, "finanzas")) throw new ErrorNegocio("Tu rol no puede anotar otros ingresos");
        return guardarIngreso(d, u.id, f);
      }
      const facturaId = num(f.facturaId);
      if (facturaId === null) throw new ErrorNegocio("Elige la factura que te pagaron");
      return guardarCobro(d, u.id, facturaId, f);
    }
    default:
      throw new ErrorNegocio("Ese tipo todavía no se puede anotar aquí");
  }
}

export function rutasAnotar(app: App, d: Deps): void {
  app.get("/anotar", (c) => vista(c as C, d));
  app.post("/anotar", async (c) => {
    const { campos: f, archivos } = await formularioMultiparte(c as C);
    const u = c.get("usuario");
    const tipo = f.tipo as TipoAnotar;
    if (!(tipo in TIPOS_ANOTAR) || !tiposAnotar(u.rol).includes(tipo)) return c.text("Tu rol no puede anotar eso", 403);
    const destino = volverA(f.volver, "/");
    return accion(c as C, urlAnotar({ ...f, volver: destino }), async () => ({ ok: await guardarAnotacion(d, u, tipo, f, archivos), ruta: destino }));
  });
}
```

- [ ] **Step 7: Register the routes and add the Anotar buttons**

`apps/web/src/app.tsx`: `import { rutasAnotar } from "./paginas/anotar";` and put `rutasAnotar` first in the `for (const m of [...])` list. (`seccionDeRuta("/anotar")` returns `null`: the page checks the role itself, GET with `tiposAnotar`, POST per type.)

`apps/web/src/lugares.ts`: change `cobrar` in `RUTA` to

```ts
  cobrar: (facturaId: number) => `/anotar?tipo=cobro&facturaId=${facturaId}&volver=%2F`,
```

`apps/web/src/ui.tsx`: import `tiposAnotar` from `./lugares` and, inside `Layout`, after `const menu = …` add

```tsx
  const anota = tiposAnotar(p.usuario.rol).length > 0;
  const urlAnotar = `/anotar?volver=${encodeURIComponent(p.lugar === "anotar" ? "/" : p.ruta)}`;
```

In the side menu, right after `{menu.map(enlace)}`:

```tsx
            {anota ? <a class="btn primario anotar-lateral" href={urlAnotar} data-abrir-panel=""><Icono n="mas" t={18} />Anotar</a> : null}
```

Replace the bottom bar line with:

```tsx
        {p.sinNavInferior ? null : (
          <nav class="inferior" aria-label="Lugares" style={`--n:${menu.length + (anota ? 1 : 0)}`}>
            {menu.slice(0, 2).map(enlace)}
            {anota ? <a class="mas" href={urlAnotar} aria-label="Anotar"><span><Icono n="mas" t={26} /></span></a> : null}
            {menu.slice(2).map(enlace)}
          </nav>
        )}
```

- [ ] **Step 8: Add the Anotar styles to `apps/web/public/app.css`** (before the `.sin-gap` block)

```css
/* ── Anotar ── */
.anotar { display: flex; flex-direction: column; gap: 12px; max-width: 560px; width: 100%; margin: 0 auto; }
.tipos-anotar { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.tipos-anotar a { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; min-height: 76px; padding: 10px 6px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel); color: var(--text); text-decoration: none; font-size: 12px; font-weight: 600; text-align: center; }
.tipos-anotar a:hover { border-color: var(--accent); color: var(--text); }
.tipos-anotar a.activo { background: var(--accent); border-color: var(--accent); color: var(--white); }
.segmentos { display: flex; gap: 6px; flex-wrap: wrap; }
.segmentos a { display: inline-flex; align-items: center; min-height: 44px; padding: 0 14px; border: 1px solid var(--border); border-radius: 22px; background: var(--panel); color: var(--text); text-decoration: none; font-size: 13px; }
.segmentos a.activo { background: var(--dark); border-color: var(--dark); color: var(--dark-text); }
.form-anotar { display: flex; flex-direction: column; gap: 12px; }
.grupo { border: 0; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.campo-monto .monto-caja { display: flex; align-items: center; gap: 8px; border: 2px solid var(--text); border-radius: 8px; background: var(--white); padding: 0 14px; }
.campo-monto .monto-caja > span { font-family: var(--f-title); font-size: 24px; color: var(--muted); }
.campo-monto input { border: 0; font-family: var(--f-title); font-size: 32px; min-height: 64px; padding: 0; background: transparent; }
.opciones-icono { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.opcion { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; min-height: 64px; padding: 8px 4px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel); font-size: 12px; text-align: center; cursor: pointer; }
.opcion input { position: absolute; opacity: 0; width: 1px; height: 1px; min-height: 0; }
.opcion:has(input:checked) { background: var(--dark); border-color: var(--dark); color: var(--accent-on-dark); font-weight: 600; }
.opcion:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 1px; }
.opciones-texto { display: flex; gap: 8px; flex-wrap: wrap; }
.opciones-texto .opcion { min-height: 44px; flex-direction: row; padding: 0 14px; }
.opciones-lista { display: flex; flex-direction: column; gap: 6px; }
.opcion-fila { display: flex; gap: 10px; align-items: center; min-height: 48px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--panel); cursor: pointer; }
.opcion-fila:has(input:checked) { border-color: var(--accent); background: var(--accent-softer); }
.opcion-fila input { width: 20px; height: 20px; min-height: 20px; accent-color: var(--accent); flex-shrink: 0; }
.otro-cual { display: none; }
.grupo:has(input[value="otro"]:checked) .otro-cual { display: flex; }
.foto-opcional { position: relative; display: flex; align-items: center; justify-content: center; gap: 10px; min-height: 48px; padding: 10px; border: 1px dashed var(--muted); border-radius: 8px; background: var(--panel); cursor: pointer; font-size: 13px; }
.foto-opcional input { position: absolute; opacity: 0; width: 1px; height: 1px; min-height: 0; }
.foto-opcional:has(input:focus-visible) { outline: 2px solid var(--accent); }
.se-pone-solo { background: var(--ok-bg); color: #1F4468; border-radius: 6px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.se-pone-solo .lbl { color: #1F4468; }
.se-pone-solo summary { display: inline-flex; align-items: center; min-height: 44px; text-decoration: underline; cursor: pointer; color: #1F4468; }
.se-pone-solo .filas { margin-top: 6px; color: var(--text); }
.btn.guardar { min-height: 56px; width: 100%; font-family: var(--f-title); font-size: 18px; }
.fila-aviso.sel { background: var(--accent-softer); box-shadow: inset 3px 0 0 var(--accent); }
.lateral .anotar-lateral { justify-content: flex-start; margin: 10px 0; }
.inferior .mas { display: flex; align-items: center; justify-content: center; }
.inferior .mas span { width: 58px; height: 58px; border-radius: 50%; background: var(--accent); color: var(--white); display: flex; align-items: center; justify-content: center; margin-top: -26px; border: 4px solid var(--bg); }
```

- [ ] **Step 9: Run the tests**

Run: `pnpm test apps/web/test/web.test.ts`
Expected: PASS (the new `anotar` cases and every old case, including `liquidación del viaje` and `gasto mínimo`).

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 10: Screenshots**

In `apps/web/scripts/lugares-captura.ts` add after the `inicio` entry:

```ts
  { nombre: "anotar", ruta: "/anotar" },
  { nombre: "anotar-chofer", ruta: "/anotar?tipo=chofer" },
  { nombre: "anotar-cobro", ruta: "/anotar?tipo=cobro" },
```

Run: `CAPTURAS_ETIQUETA=tarea-4 pnpm capturas inicio anotar anotar-chofer anotar-cobro`
Expected: `capturas/tarea-4/{inicio,anotar,anotar-chofer,anotar-cobro}-{390,1440}.png`. `anotar-390.png` matches the Anotar artboard: back button + "¿Qué pasó?", 3 type buttons (6 after Task 5), big "¿Cuánto?", 4 "¿En qué?" buttons, dashed photo button, blue "Se pone solo", magenta GUARDAR, no bottom bar. `inicio-390.png` now shows the magenta [+] in the middle of the bottom bar. `revision.json` has no problems for these four.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src apps/web/public/app.css apps/web/scripts/lugares-captura.ts apps/web/test/web.test.ts
git commit -m "feat(web): Anotar con Gasté, Plata al chofer y Me pagaron, y botón + en el menú" -m "Claude-Session: https://claude.ai/code/session_012rqk28jac1iV7v2GAJjggW"
```

---

### Task 5: Anotar — Reparé / repuesto, Gasto de la empresa, Préstamo o cuota

**Files:**
- Modify: `apps/web/src/acciones.ts` (new handlers), `apps/web/src/paginas/anotar.tsx` (3 new parts, remove `LISTOS`), `apps/web/src/paginas/reparaciones.tsx` (POST `/reparaciones`), `apps/web/src/paginas/trailer.tsx` (POST `/trailer/:id/pieza`), `apps/web/src/paginas/inventario.tsx` (POST `/inventario/compra`), `apps/web/src/paginas/finanzas.tsx` (POST `/finanzas/reinversion`, `/finanzas/prestamo`, `/finanzas/prestamo/:id/pagar`), `apps/web/src/lugares.ts` (nothing else), `apps/web/scripts/lugares-captura.ts`, `apps/web/test/web.test.ts`

**Interfaces:**
- Consumes: `registrarCambio`, `TIPOS_REPARACION`, `type TipoReparacion`, `pieza`, `piezasDeSemirremolque`, `GRUPOS_PIEZA`, `type GrupoPieza`, `partesDeUnidad`, `listarRepuestos`, `registrarCompra`, `crearCostoFijo`, `crearPrestamo`, `pagarCuota`, `registrarReinversion`, `listarPrestamos`, `listarCategorias` (core); `miles` (ui).
- Produces: `guardarCambio(d, usuarioId, f, tipoTexto?) → { ok, vehiculoId, pieza }`, `guardarCompra(d, usuarioId, f)`, `guardarGastoEmpresa(d, usuarioId, f, foto?)`, `guardarPrestamo(d, usuarioId, f)`, `pagarCuotaDe(d, usuarioId, prestamoId)`, `guardarReinversion(d, usuarioId, f)` (acciones.ts); parts `parteRepare`, `parteEmpresa`, `parteAnotarPrestamo` (anotar.tsx).

POST `/anotar` fields: **repare** (cambio) `vehiculoId, componente?, trabajo, manoObra?, parteId?, tipoReparacion?, repuestoId?, cantidad?, taller?, fecha?, odometro?`; **repare** `modo=compra` `repuestoId, cantidad, costo, proveedor?, fecha?`; **empresa** `monto, categoria (fija), mensual? ("1"), foto?, concepto?, vehiculoId?, fecha?, medioPago?, nota?`; **prestamo** `prestamoId` (pagar cuota) or `modo=nuevo` `entidad, monto, tasa, cuotas, fecha?, vehiculoId?` or `modo=reinversion` `concepto, monto, vehiculoId?, fecha?`.

- [ ] **Step 1: Write the failing tests** (inside the `describe("anotar", …)` block of Task 4)

Add `crearRepuesto`, `listarCostosFijos`, `listarPrestamos`, `listarReparaciones`, `listarRepuestos` to the `@sunatapp/core` import.

```ts
      it("Reparé: un cambio en una pieza del 3D reinicia la parte y avisa", async () => {
        const cookie = await entrar();
        const t01 = (await buscarUnidad(ctx, "T-01"))!;
        const aceite = (await listarTiposParte(ctx)).find((t) => t.codigo === "aceite")!;
        await instalarParte(ctx, { vehiculoId: t01.id, tipoParteId: aceite.id });
        const [p] = await partesDeUnidad(ctx, t01.id);
        const html = await (await app.request(`/anotar?tipo=repare&vehiculoId=${t01.id}&pieza=retrovisor-izq&parteId=${p!.id}`, { headers: { cookie } })).text();
        expect(html).toMatch(/<option value="retrovisor-izq" selected/);
        const r = await enviar(cookie, { tipo: "repare", volver: `/`, vehiculoId: String(t01.id), componente: "retrovisor-izq", trabajo: "Se abrió el retrovisor", manoObra: "80", parteId: String(p!.id) });
        expect(aviso(r)).toContain("ok=Guardado en Retrovisor");
        const [rep] = await listarReparaciones(ctx, { vehiculoId: t01.id });
        expect(rep).toMatchObject({ componente: "retrovisor-izq", trabajo: "Se abrió el retrovisor" });
        expect(avisos).toHaveLength(1);
        expect(aviso(await enviar(cookie, { tipo: "repare", volver: "/", vehiculoId: String(t01.id) }))).toContain("error=");
      });

      it("Reparé: compra para stock sube el stock", async () => {
        const cookie = await entrar();
        const id = await crearRepuesto(ctx, { nombre: "Filtro de aire", categoria: "Filtros" });
        const r = await enviar(cookie, { tipo: "repare", modo: "compra", volver: "/", repuestoId: String(id), cantidad: "2", costo: "50" });
        expect(aviso(r)).toContain("ok=Compra registrada: +2 en stock");
        expect((await listarRepuestos(ctx)).find((x) => x.id === id)!.stock).toBe(2);
      });

      it("Gasto de la empresa: mensual crea el costo fijo; si no, un gasto sin viaje", async () => {
        const cookie = await entrar();
        let r = await enviar(cookie, { tipo: "empresa", volver: "/", monto: "2500", categoria: "sueldo_chofer", mensual: "1" });
        expect(aviso(r)).toContain("ok=Sueldo del chofer: queda como gasto de cada mes");
        expect(await listarCostosFijos(ctx)).toEqual([expect.objectContaining({ concepto: "Sueldo del chofer", monto: 250000, periodicidad: "mensual" })]);
        r = await enviar(cookie, { tipo: "empresa", volver: "/", monto: "120", categoria: "telefonia" });
        expect(aviso(r)).toContain("ok=Gasto guardado");
        const g = (await ctx.db.select().from(gasto)).find((x) => x.categoria === "telefonia");
        expect(g).toMatchObject({ monto: 12000, viajeId: null });
      });

      it("Préstamo: uno nuevo, pagar su cuota y una reinversión", async () => {
        const cookie = await entrar();
        expect(aviso(await enviar(cookie, { tipo: "prestamo", modo: "nuevo", volver: "/", entidad: "Caja Arequipa", monto: "12000", tasa: "18", cuotas: "12" }))).toContain("ok=Préstamo creado");
        const [p] = await listarPrestamos(ctx);
        const html = await (await app.request("/anotar?tipo=prestamo", { headers: { cookie } })).text();
        expect(html).toContain("Caja Arequipa");
        expect(aviso(await enviar(cookie, { tipo: "prestamo", volver: "/", prestamoId: String(p!.id) }))).toContain("ok=Cuota 1 pagada");
        expect(aviso(await enviar(cookie, { tipo: "prestamo", modo: "reinversion", volver: "/", concepto: "GPS", monto: "900" }))).toContain("ok=Reinversión guardada");
      });

      it("el taller solo ve Reparé / repuesto", async () => {
        await guardarUsuario(ctx, { nombre: "Taller", email: "taller@demo.pe", rol: "taller", clave: "clave-segura" });
        const taller = await entrar("taller@demo.pe");
        const html = await (await app.request("/anotar", { headers: { cookie: taller } })).text();
        expect(html).toContain("Reparé / repuesto");
        expect(html).not.toContain("Me pagaron");
        expect((await enviar(taller, { tipo: "prestamo", modo: "reinversion", volver: "/", concepto: "X", monto: "1" })).status).toBe(403);
      });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm test apps/web/test/web.test.ts -t "Reparé|empresa|Préstamo|taller solo"`
Expected: FAIL — `POST /anotar` with `tipo=repare` returns `error=Ese tipo todavía no se puede anotar aquí`; the taller's `/anotar` redirects to `/?error=`.

- [ ] **Step 3: Add the handlers to `apps/web/src/acciones.ts`**

Extend the `@sunatapp/core` import with `crearCostoFijo, crearPrestamo, listarCategorias, pagarCuota, pieza, registrarCambio, registrarCompra, registrarReinversion, TIPOS_REPARACION, type TipoReparacion`, then append:

```ts
/**
 * Cambio o reparación (antes: POST /reparaciones y POST /trailer/:id/pieza). Reinicia el contador de
 * la parte si viene `parteId`, saca del stock los repuestos usados, registra el gasto y avisa al grupo.
 */
export async function guardarCambio(
  d: Deps, usuarioId: number, f: Campos, tipoTexto?: string,
): Promise<{ ok: string; vehiculoId: number; pieza: string | null }> {
  const vehiculoId = idONull(f.vehiculoId);
  if (vehiculoId === null) throw new ErrorNegocio("Elige el camión");
  const p = f.componente ? pieza(f.componente) : null;
  if (f.componente && !p) throw new ErrorNegocio("Elige una pieza del modelo");
  if (p && !f.trabajo?.trim()) throw new ErrorNegocio("Escribe qué pasó o qué se hizo");
  if (!p && !f.parteId && !f.trabajo?.trim()) throw new ErrorNegocio("Elige la pieza o escribe qué se hizo");
  const tipo = (tipoTexto || (p ? "correctivo" : "preventivo")) as TipoReparacion;
  if (!(tipo in TIPOS_REPARACION)) throw new ErrorNegocio("Tipo no válido");
  const manoObra = f.manoObra ? parsearMonto(f.manoObra) : 0;
  if (manoObra === null) throw new ErrorNegocio("Mano de obra no válida");
  const ids = (f.repuestoId ?? "").split("\u0001");
  const cants = (f.cantidad ?? "").split("\u0001");
  const usados = new Map<number, number>();
  ids.forEach((id, k) => {
    if (!id) return;
    usados.set(Number(id), (usados.get(Number(id)) ?? 0) + (enteroONull(cants[k]) ?? 1));
  });
  const r = await registrarCambio(d.ctx, {
    vehiculoId, parteInstaladaId: idONull(f.parteId), tipo, odometro: enteroONull(f.odometro) ?? undefined, fecha: f.fecha || undefined,
    repuestos: [...usados].map(([repuestoId, cantidad]) => ({ repuestoId, cantidad })), manoObra, taller: f.taller || null,
    trabajo: f.trabajo?.trim() || null, componente: p?.id ?? null, origen: "web", usuarioId,
  });
  let texto = r.resumen;
  if (r.stockBajo.length) texto += `\n⚠️ Stock bajo: ${r.stockBajo.map((s) => `${s.codigo} (${s.stock})`).join(", ")}`;
  await d.avisar(texto).catch(() => {});
  const ok = p
    ? `Guardado en ${p.nombre}${r.costoTotal ? ` · ${soles2(r.costoTotal)}` : ""}`
    : `Cambio guardado · ${r.trabajo} · ${soles2(r.costoTotal)}${r.desgastePct !== null ? ` · ${r.desgastePct}% ${r.etiqueta}` : ""}`;
  return { ok, vehiculoId, pieza: p?.id ?? null };
}

/** Compra de repuestos para el stock (antes: POST /inventario/compra). */
export async function guardarCompra(d: Deps, usuarioId: number, f: Campos): Promise<string> {
  const costo = parsearMonto(f.costo ?? "");
  if (costo === null) throw new ErrorNegocio("Costo unitario no válido");
  const cantidad = enteroONull(f.cantidad);
  if (cantidad === null) throw new ErrorNegocio("Indica la cantidad");
  const repuestoId = idONull(f.repuestoId);
  if (repuestoId === null) throw new ErrorNegocio("Elige el repuesto");
  await registrarCompra(d.ctx, { repuestoId, cantidad, costoUnitario: costo, fecha: f.fecha || undefined, proveedor: f.proveedor || null, origen: "web", usuarioId });
  return `Compra registrada: +${cantidad} en stock`;
}

/** Gasto de la empresa: si «es mensual», crea el costo fijo (se carga solo cada mes); si no, un gasto sin viaje. */
export async function guardarGastoEmpresa(d: Deps, usuarioId: number, f: Campos, foto?: File): Promise<string> {
  if (f.mensual === "1") {
    const fijas = await listarCategorias(d.ctx, { tipo: "fijo", soloActivas: true });
    const nombre = fijas.find((k) => k.clave === f.categoria)?.nombre ?? "Gasto fijo";
    await crearCostoFijo(d.ctx, {
      concepto: f.concepto?.trim() || nombre, categoria: f.categoria ?? "", monto: montoObligatorio(f.monto), periodicidad: "mensual",
      vehiculoId: idONull(f.vehiculoId), usuarioId,
    });
    return `${nombre}: queda como gasto de cada mes (se carga solo)`;
  }
  return guardarGasto(d, usuarioId, { ...f, viajeId: "" }, foto);
}

/** Préstamo nuevo con su cronograma (antes: POST /finanzas/prestamo). */
export async function guardarPrestamo(d: Deps, usuarioId: number, f: Campos): Promise<string> {
  const tasa = Number((f.tasa ?? "").replace(",", "."));
  if (!Number.isFinite(tasa)) throw new ErrorNegocio("Tasa no válida");
  await crearPrestamo(d.ctx, {
    entidad: f.entidad ?? "", monto: montoObligatorio(f.monto), tasaAnual: tasa, cuotas: enteroONull(f.cuotas) ?? 0,
    fechaInicio: f.fecha || undefined, vehiculoId: idONull(f.vehiculoId), usuarioId,
  });
  return "Préstamo creado con su cronograma de cuotas";
}

/** Paga la próxima cuota (antes: POST /finanzas/prestamo/:id/pagar). */
export async function pagarCuotaDe(d: Deps, usuarioId: number, prestamoId: number): Promise<string> {
  const r = await pagarCuota(d.ctx, prestamoId, undefined, usuarioId);
  return `Cuota ${r.numero} pagada (${soles2(r.monto)})`;
}

/** Reinversión (antes: POST /finanzas/reinversion). */
export async function guardarReinversion(d: Deps, usuarioId: number, f: Campos): Promise<string> {
  await registrarReinversion(d.ctx, { concepto: f.concepto ?? "", monto: montoObligatorio(f.monto), vehiculoId: idONull(f.vehiculoId), fecha: f.fecha || undefined, origen: "web", usuarioId });
  return "Reinversión guardada";
}
```

- [ ] **Step 4: Make the old POST routes use them**

`apps/web/src/paginas/reparaciones.tsx` — `import { guardarCambio } from "../acciones";` and replace the `POST /reparaciones` handler with:

```tsx
  app.post("/reparaciones", async (c) => {
    const f = await formulario(c);
    return accion(c, `/reparaciones?unidad=${Number(f.vehiculoId)}`, async () => (await guardarCambio(d, c.get("usuario").id, f, f.tipo)).ok);
  });
```

`apps/web/src/paginas/trailer.tsx` — `import { guardarCambio } from "../acciones";` and replace `POST /trailer/:id/pieza` with:

```tsx
  app.post("/trailer/:id/pieza", async (c) => {
    const id = Number(c.req.param("id"));
    const f = await formulario(c);
    const p = pieza(f.componente);
    return accion(c, p ? `/trailer/${id}?pieza=${p.id}` : `/trailer/${id}`, async () => {
      if (!puedeEditar(c.get("usuario").rol, "reparaciones")) throw new ErrorNegocio("Tu rol no puede registrar reparaciones");
      if (!p) throw new ErrorNegocio("Elige una pieza del modelo");
      return (await guardarCambio(d, c.get("usuario").id, { ...f, vehiculoId: String(id) }, f.tipo || "correctivo")).ok;
    });
  });
```

`apps/web/src/paginas/inventario.tsx` — `import { guardarCompra } from "../acciones";` and:

```tsx
  app.post("/inventario/compra", async (c) => {
    const f = await formulario(c);
    return accion(c, "/inventario", () => guardarCompra(d, c.get("usuario").id, f));
  });
```

`apps/web/src/paginas/finanzas.tsx` — extend the `../acciones` import with `guardarPrestamo, guardarReinversion, pagarCuotaDe` and replace the three handlers:

```tsx
  app.post("/finanzas/reinversion", async (c) => {
    const f = await formulario(c);
    return accion(c, "/finanzas", () => guardarReinversion(d, c.get("usuario").id, f));
  });
  app.post("/finanzas/prestamo", async (c) => {
    const f = await formulario(c);
    return accion(c, "/finanzas", () => guardarPrestamo(d, c.get("usuario").id, f));
  });
  app.post("/finanzas/prestamo/:id/pagar", async (c) => accion(c, "/finanzas", () => pagarCuotaDe(d, c.get("usuario").id, Number(c.req.param("id")))));
```

Remove imports that became unused in those four files (`registrarCambio`, `TIPOS_REPARACION`, `registrarCompra`, `crearPrestamo`, `pagarCuota`, `registrarReinversion`, `parsearMonto` where no longer referenced) — `pnpm typecheck` in Step 8 confirms.

- [ ] **Step 5: Add the three parts to `apps/web/src/paginas/anotar.tsx`**

Extend the `@sunatapp/core` import with `GRUPOS_PIEZA, listarPrestamos, listarRepuestos, partesDeUnidad, piezasDeSemirremolque, TIPOS_REPARACION, type GrupoPieza, type TipoReparacion`; the `../acciones` import with `guardarCambio, guardarCompra, guardarGastoEmpresa, guardarPrestamo, guardarReinversion, pagarCuotaDe`; the `../ui` import with `miles`. Delete the `LISTOS` constant and change the first line of `vista` to:

```tsx
  const permitidos = tiposAnotar(c.get("usuario").rol);
```

Add before `const PARTES`:

```tsx
async function parteRepare(c: C, d: Deps, q: Q): Promise<PartesForm> {
  const ctx = d.ctx;
  const rol = c.get("usuario").rol;
  const modos = puedeEditar(rol, "inventario") && puedeEditar(rol, "reparaciones")
    ? [{ modo: "", etiqueta: "Cambio o arreglo" }, { modo: "compra", etiqueta: "Compra para stock" }] : undefined;
  const [unidades, repuestos] = await Promise.all([listarUnidades(ctx), listarRepuestos(ctx)]);
  if (q.modo === "compra") {
    const elegido = num(q.repuestoId);
    return {
      modos,
      campos: (
        <>
          <label class="campo"><span>¿Qué repuesto?</span>
            <select name="repuestoId" required>{repuestos.map((r) => <option value={r.id} selected={r.id === elegido}>{r.codigo} · {r.nombre} (hay {r.stock})</option>)}</select>
          </label>
          <label class="campo"><span>¿Cuántos?</span><input name="cantidad" inputmode="numeric" required value="1" /></label>
          <CampoPlata nombre="costo" etiqueta="¿Cuánto costó cada uno?" requerido />
          <label class="campo"><span>¿Dónde lo compraste? (opcional)</span><input name="proveedor" /></label>
        </>
      ),
      solo: { texto: `Entra al stock hoy ${ahora(d)} · el repuesto nuevo se crea en Camiones › Repuestos`, cambiar: <CampoFecha d={d} /> },
    };
  }
  const unidad = unidades.find((u) => u.id === num(q.vehiculoId)) ?? unidades[0];
  if (!unidad) return { modos, campos: null, soloMensaje: <div class="lista-filas"><Vacio>Primero agrega un camión.</Vacio></div> };
  const partes = await partesDeUnidad(ctx, unidad.id);
  const piezas = piezasDeSemirremolque(unidad.semirremolque);
  const parteSel = num(q.parteId);
  // Sin campo «monto»: el costo es la mano de obra más los repuestos que salen del stock.
  return {
    modos,
    campos: (
      <>
        <fieldset class="grupo"><legend class="lbl">¿Qué camión?</legend>
          <div class="segmentos">
            {unidades.map((u) => (
              <a href={urlAnotar({ ...q, vehiculoId: u.id, parteId: "", pieza: "" })} data-panel-link="" class={u.id === unidad.id ? "activo" : undefined} aria-current={u.id === unidad.id ? "true" : undefined}>{u.codigo}</a>
            ))}
          </div>
        </fieldset>
        <input type="hidden" name="vehiculoId" value={unidad.id} />
        <label class="campo"><span>¿Qué pieza? (o tócala en el 3D de Camiones)</span>
          <select name="componente">
            <option value="">— general, sin pieza —</option>
            {(Object.keys(GRUPOS_PIEZA) as GrupoPieza[]).map((g) => (
              <optgroup label={GRUPOS_PIEZA[g]}>{piezas.filter((p) => p.grupo === g).map((p) => <option value={p.id} selected={p.id === q.pieza}>{p.nombre}</option>)}</optgroup>
            ))}
          </select>
        </label>
        <label class="campo"><span>¿Qué se hizo?</span><input name="trabajo" maxlength={200} placeholder="Cambio de llanta, parchado, se ajustó…" /></label>
        <CampoPlata nombre="manoObra" etiqueta="Mano de obra (si hubo)" />
      </>
    ),
    solo: {
      texto: `${unidad.codigo} · hoy ${ahora(d)} · ${miles(unidad.odometroKm)} km`,
      cambiar: (
        <>
          <label class="campo"><span>¿Reinicia el contador de una parte?</span>
            <select name="parteId"><option value="">— no —</option>{partes.map((p) => <option value={p.id} selected={p.id === parteSel}>{p.nombre} · {p.pct}% (vuelve a 0)</option>)}</select>
          </label>
          <label class="campo"><span>Repuesto del stock</span>
            <select name="repuestoId"><option value="">— ninguno —</option>{repuestos.filter((r) => r.stock > 0).map((r) => <option value={r.id}>{r.codigo} · {r.nombre} (hay {r.stock})</option>)}</select>
          </label>
          <label class="campo"><span>Cantidad</span><input name="cantidad" inputmode="numeric" value="1" /></label>
          <label class="campo"><span>Tipo</span>
            <select name="tipoReparacion">{(Object.keys(TIPOS_REPARACION) as TipoReparacion[]).map((t) => <option value={t} selected={t === (q.pieza ? "correctivo" : "preventivo")}>{TIPOS_REPARACION[t]}</option>)}</select>
          </label>
          <label class="campo"><span>Taller o mecánico</span><input name="taller" /></label>
          <CampoFecha d={d} />
          <label class="campo"><span>Odómetro (km)</span><input name="odometro" inputmode="numeric" placeholder={String(unidad.odometroKm)} /></label>
        </>
      ),
    },
  };
}

async function parteEmpresa(_c: C, d: Deps, _q: Q): Promise<PartesForm> {
  const [fijas, unidades] = await Promise.all([listarCategorias(d.ctx, { tipo: "fijo", soloActivas: true }), listarUnidades(d.ctx)]);
  return {
    campos: (
      <>
        <CampoMonto />
        <label class="campo"><span>¿En qué?</span><select name="categoria" required>{fijas.map((k) => <option value={k.clave}>{k.nombre}</option>)}</select></label>
        <label class="opcion-fila"><input type="checkbox" name="mensual" value="1" /><span>Se repite cada mes (sueldo, alquiler, GPS…): anótalo una vez y se carga solo</span></label>
        <FotoOpcional />
      </>
    ),
    solo: {
      texto: `Hoy ${ahora(d)} · de la empresa, sin camión ni viaje`,
      cambiar: (
        <>
          <SelectUnidad unidades={unidades} elegido={null} vacio="— de la empresa —" />
          <CampoFecha d={d} />
          <label class="campo"><span>Nombre (si se repite cada mes)</span><input name="concepto" placeholder="Sueldo de Mario" /></label>
          <label class="campo"><span>¿Cómo se pagó?</span><select name="medioPago"><option value="">Automático</option>{Object.entries(NOMBRE_MEDIO_PAGO).map(([k, n]) => <option value={k}>{n}</option>)}</select></label>
          <label class="campo"><span>Detalle</span><input name="nota" maxlength={200} /></label>
        </>
      ),
    },
  };
}

async function parteAnotarPrestamo(_c: C, d: Deps, q: Q): Promise<PartesForm> {
  const modos = [{ modo: "", etiqueta: "Pagar una cuota" }, { modo: "nuevo", etiqueta: "Préstamo nuevo" }, { modo: "reinversion", etiqueta: "Reinversión" }];
  const unidades = await listarUnidades(d.ctx);
  if (q.modo === "nuevo") {
    return {
      modos,
      campos: (
        <>
          <label class="campo"><span>¿Quién te prestó?</span><input name="entidad" required placeholder="Banco, caja, financiera" /></label>
          <CampoMonto etiqueta="¿Cuánto te prestaron?" />
          <label class="campo"><span>Tasa anual (TEA %)</span><input name="tasa" inputmode="decimal" required /></label>
          <label class="campo"><span>¿En cuántas cuotas?</span><input name="cuotas" inputmode="numeric" required /></label>
        </>
      ),
      solo: { texto: `Desembolso hoy · de la empresa`, cambiar: <><label class="campo"><span>Desembolso</span><input type="date" name="fecha" value={hoy(d.ctx)} /></label><SelectUnidad unidades={unidades} elegido={null} vacio="— de la empresa —" /></> },
    };
  }
  if (q.modo === "reinversion") {
    return {
      modos,
      campos: (
        <>
          <label class="campo"><span>¿En qué invertiste?</span><input name="concepto" required placeholder="Carreta nueva, GPS, motor…" /></label>
          <CampoMonto />
        </>
      ),
      solo: { texto: `Hoy ${ahora(d)} · de la empresa`, cambiar: <><SelectUnidad unidades={unidades} elegido={null} vacio="— de la empresa —" /><CampoFecha d={d} /></> },
    };
  }
  const conCuota = (await listarPrestamos(d.ctx)).filter((p) => p.proxima);
  if (!conCuota.length) return { modos, campos: null, soloMensaje: <div class="lista-filas"><Vacio>No tienes cuotas pendientes. 👌</Vacio></div> };
  const sel = conCuota.find((p) => p.id === num(q.prestamoId)) ?? conCuota[0]!;
  return {
    modos,
    campos: (
      <>
        <fieldset class="grupo"><legend class="lbl">¿Qué cuota pagaste?</legend>
          <div class="lista-filas">
            {conCuota.map((p) => (
              <a class={`fila-aviso${p.id === sel.id ? " sel" : ""}`} href={urlAnotar({ ...q, prestamoId: p.id })} data-panel-link="" aria-current={p.id === sel.id ? "true" : undefined}>
                <span class="txt"><b>{p.entidad}</b> · cuota {p.pagadas + 1} de {p.total}<br /><span class="muted">vence {fechaCorta(p.proxima!.vencimiento)}</span></span>
                <b>{soles2(p.proxima!.monto)}</b>
              </a>
            ))}
          </div>
        </fieldset>
        <input type="hidden" name="prestamoId" value={sel.id} />
      </>
    ),
    solo: { texto: `Se paga hoy la cuota de ${soles2(sel.proxima!.monto)} de ${sel.entidad}` },
    boton: "PAGAR CUOTA",
  };
}
```

Change `PARTES` to:

```tsx
const PARTES: Record<TipoAnotar, (c: C, d: Deps, q: Q) => Promise<PartesForm>> = {
  gaste: parteGaste, chofer: parteChofer, cobro: parteCobro, repare: parteRepare, empresa: parteEmpresa, prestamo: parteAnotarPrestamo,
};
```

and in `vista` use `const p = await PARTES[q.tipo as TipoAnotar](c, d, q);`. In `guardarAnotacion` replace the `default:` branch with:

```tsx
    case "repare": {
      if (f.modo === "compra") {
        if (!puedeEditar(u.rol, "inventario")) throw new ErrorNegocio("Tu rol no puede registrar compras");
        return guardarCompra(d, u.id, f);
      }
      return (await guardarCambio(d, u.id, f, f.tipoReparacion)).ok;
    }
    case "empresa":
      return guardarGastoEmpresa(d, u.id, f, archivos.foto);
    case "prestamo": {
      if (f.modo === "nuevo") return guardarPrestamo(d, u.id, f);
      if (f.modo === "reinversion") return guardarReinversion(d, u.id, f);
      const prestamoId = num(f.prestamoId);
      if (prestamoId === null) throw new ErrorNegocio("Elige la cuota que pagaste");
      return pagarCuotaDe(d, u.id, prestamoId);
    }
```

Add this field component next to `CampoMonto` (same look, other field name; Reparé posts `manoObra`, the purchase posts `costo`):

```tsx
const CampoPlata: FC<{ nombre: string; etiqueta: string; requerido?: boolean }> = (p) => (
  <label class="campo campo-monto"><span>{p.etiqueta}</span>
    <span class="monto-caja"><span aria-hidden="true">S/</span><input name={p.nombre} inputmode="decimal" required={p.requerido} autocomplete="off" placeholder="0.00" /></span>
  </label>
);
```

- [ ] **Step 6: Run the tests**

Run: `pnpm test apps/web/test/web.test.ts`
Expected: PASS — the 5 new cases plus the old `cada pieza del modelo 3D …`, `registrar un cambio avisa al grupo de Telegram`, `cada repuesto dice en qué piezas va …`.

- [ ] **Step 7: Screenshots**

In `apps/web/scripts/lugares-captura.ts` add after `anotar-cobro`:

```ts
  { nombre: "anotar-repare", ruta: "/anotar?tipo=repare" },
  { nombre: "anotar-compra", ruta: "/anotar?tipo=repare&modo=compra" },
  { nombre: "anotar-empresa", ruta: "/anotar?tipo=empresa" },
  { nombre: "anotar-prestamo", ruta: "/anotar?tipo=prestamo" },
```

Run: `CAPTURAS_ETIQUETA=tarea-5 pnpm capturas anotar anotar-repare anotar-compra anotar-empresa anotar-prestamo`
Expected: 10 PNGs in `capturas/tarea-5/`. Each form shows the 6 type buttons (2 rows of 3) and at most 4 fields before "Se pone solo › cambiar". `revision.json` clean for the five.

- [ ] **Step 8: Typecheck and commit**

Run: `pnpm typecheck`
Expected: no errors.

```bash
git add apps/web/src apps/web/scripts/lugares-captura.ts apps/web/test/web.test.ts
git commit -m "feat(web): Anotar reparaciones, compras, gastos de la empresa y préstamos con la misma lógica de siempre" -m "Claude-Session: https://claude.ai/code/session_012rqk28jac1iV7v2GAJjggW"
```

---

### Task 6: PC side panel for Anotar + "Así queda después de guardar"

**Files:**
- Create: `packages/core/src/consultas/asi-queda.ts`, `apps/web/public/anotar.js`
- Modify: `packages/core/src/index.ts` (append export), `packages/core/test/inicio.test.ts`, `apps/web/src/paginas/anotar.tsx` (`AsiQuedaBloque`, `GET /anotar/asi-queda`, initial block in Gasté/Plata al chofer), `apps/web/src/ui.tsx` (panel `<aside>` + script), `apps/web/public/app.css`, `apps/web/scripts/lugares-captura.ts`, `apps/web/test/web.test.ts`

**Interfaces:**
- Consumes: `liquidacionViaje`, `listarCategorias`, `nombreCategoria`, `choferDeViaje` (core); `parsearMonto` (core) in the web route.
- Produces: core `interface AsiQueda { chofer, viaje, categoria }`, `asiQueda(ctx, { tipo: "gasto" | "entrega"; monto; viajeId; categoria? })`; web `AsiQuedaBloque`, route `GET /anotar/asi-queda?tipo=gaste|chofer&monto=&viajeId=&categoria=` (HTML fragment), `GET /anotar?parcial=1` (fragment without layout, already from Task 4); client: links/buttons with `data-abrir-panel`, links inside the panel with `data-panel-link`, GET forms with `data-panel-form` open in `<aside id="panel-anotar">` on screens ≥ 900 px.

- [ ] **Step 1: Write the failing core test** (append to `packages/core/test/inicio.test.ts`; add `actualizarPresupuestoViaje` and `asiQueda` to its import)

```ts
  it("así queda: saldo del chofer, lo que deja el viaje y el presupuesto de la categoría", async () => {
    const v = await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Yura", destinoLugar: "Puno", estado: "en_curso", flete: 350000, origen: "web" });
    await registrarEntrega(ctx, { viajeId: v.id, monto: 120000, medio: "efectivo" });
    await registrarGasto(ctx, { viajeId: v.id, categoria: "combustible", monto: 42000, origen: "web" });
    await actualizarPresupuestoViaje(ctx, v.id, [{ categoria: "combustible", monto: 80000 }]);
    const r = await asiQueda(ctx, { tipo: "gasto", monto: 35000, viajeId: v.id, categoria: "combustible" });
    expect(r.chofer).toEqual({ nombre: "Jhon", entregado: 120000, quedaAntes: 78000, quedaDespues: 43000 });
    expect(r.viaje).toEqual({ codigo: v.codigo, dejaAntes: 308000, dejaDespues: 273000 });
    expect(r.categoria).toEqual({ nombre: "Combustible", realDespues: 77000, presupuesto: 80000 });
    const e = await asiQueda(ctx, { tipo: "entrega", monto: 10000, viajeId: v.id });
    expect(e.chofer).toMatchObject({ entregado: 130000, quedaDespues: 88000 });
    expect(e.viaje).toBeNull();
    expect(e.categoria).toBeNull();
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm test packages/core/test/inicio.test.ts -t "así queda"`
Expected: FAIL — `asiQueda is not a function`.

- [ ] **Step 3: Create `packages/core/src/consultas/asi-queda.ts`**

```ts
import { listarCategorias, nombreCategoria } from "../finanzas/categorias";
import type { Contexto } from "../infra/contexto";
import { liquidacionViaje } from "../viajes/liquidacion";
import { choferDeViaje } from "./inicio";

/** Cómo quedan las cuentas del viaje si se guarda este gasto o esta entrega. Solo lectura: no guarda nada. */
export interface AsiQueda {
  chofer: { nombre: string; entregado: number; quedaAntes: number; quedaDespues: number } | null;
  /** Solo para gastos de un viaje con flete. */
  viaje: { codigo: string; dejaAntes: number; dejaDespues: number } | null;
  /** Solo para gastos con categoría. */
  categoria: { nombre: string; realDespues: number; presupuesto: number } | null;
}

export async function asiQueda(
  ctx: Contexto, e: { tipo: "gasto" | "entrega"; monto: number; viajeId: number; categoria?: string | null },
): Promise<AsiQueda> {
  const l = await liquidacionViaje(ctx, e.viajeId);
  const gasto = e.tipo === "gasto" ? e.monto : 0;
  const entrega = e.tipo === "entrega" ? e.monto : 0;
  const chofer = { nombre: await choferDeViaje(ctx, e.viajeId), entregado: l.entregado + entrega, quedaAntes: l.saldo, quedaDespues: l.saldo + entrega - gasto };
  const viaje = e.tipo === "gasto" && l.flete > 0
    ? { codigo: l.viaje.codigo, dejaAntes: l.flete - l.gastado, dejaDespues: l.flete - l.gastado - gasto } : null;
  let categoria: AsiQueda["categoria"] = null;
  if (e.tipo === "gasto" && e.categoria) {
    const linea = l.lineas.find((x) => x.categoria === e.categoria);
    categoria = {
      nombre: linea?.nombre ?? nombreCategoria(e.categoria, await listarCategorias(ctx)),
      realDespues: (linea?.real ?? 0) + gasto, presupuesto: linea?.presupuesto ?? 0,
    };
  }
  return { chofer, viaje, categoria };
}
```

Append to `packages/core/src/index.ts`:

```ts
export * from "./consultas/asi-queda";
```

Run: `pnpm test packages/core/test/inicio.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 4: Write the failing web tests** (inside `describe("anotar", …)`)

```ts
      it("PC: Anotar se abre como panel (fragmento) y muestra cómo queda", async () => {
        const cookie = await entrar();
        const v = await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Yura", destinoLugar: "Puno", estado: "en_curso", flete: 350000, origen: "web" });
        const pag = await (await app.request("/viajes", { headers: { cookie } })).text();
        expect(pag).toContain('<aside class="panel-anotar" id="panel-anotar" hidden');
        expect(pag).toContain("data-abrir-panel");
        expect(pag).toContain("/static/anotar.js");
        const frag = await (await app.request(`/anotar?parcial=1&viajeId=${v.id}`, { headers: { cookie } })).text();
        expect(frag).not.toContain("<html");
        expect(frag).toContain('id="asi-queda"');
        const q = await (await app.request(`/anotar/asi-queda?tipo=gaste&monto=350&viajeId=${v.id}&categoria=combustible`, { headers: { cookie } })).text();
        expect(q).toContain("Así queda después de guardar");
        expect(q).toContain("El viaje deja S/ 3,150");
        expect(q).toContain("Combustible del viaje: S/ 350");
      });
```

Run: `pnpm test apps/web/test/web.test.ts -t "PC: Anotar"`
Expected: FAIL — `expected … to contain '<aside class="panel-anotar"'`.

- [ ] **Step 5: Add the block and route to `apps/web/src/paginas/anotar.tsx`**

Extend the core import with `asiQueda, parsearMonto, type AsiQueda` and the ui import with `soles`. Add:

```tsx
/** «Así queda después de guardar» (solo en la PC: en el celular satura). */
export const AsiQuedaBloque: FC<{ r: AsiQueda | null }> = ({ r }) => (
  <div class="asi-queda solo-pc" id="asi-queda" aria-live="polite">
    <b class="lbl">Así queda después de guardar</b>
    {!r ? <span class="muted">Escribe el monto y verás cómo quedan las cuentas del viaje.</span> : (
      <ul>
        {r.chofer ? (
          <li>{r.chofer.quedaDespues >= 0
            ? `A ${r.chofer.nombre} le quedan ${soles(r.chofer.quedaDespues)} de ${soles(r.chofer.entregado)}`
            : `Le debes ${soles(-r.chofer.quedaDespues)} a ${r.chofer.nombre}`}</li>
        ) : null}
        {r.viaje ? <li>El viaje deja {soles(r.viaje.dejaDespues)} <span class="muted">(antes {soles(r.viaje.dejaAntes)})</span></li> : null}
        {r.categoria ? (
          <li class={r.categoria.presupuesto > 0 && r.categoria.realDespues > r.categoria.presupuesto ? "t-cambiar" : undefined}>
            {r.categoria.nombre} del viaje: {soles(r.categoria.realDespues)}{r.categoria.presupuesto > 0 ? ` · presupuesto ${soles(r.categoria.presupuesto)}` : " · sin presupuesto"}
          </li>
        ) : null}
      </ul>
    )}
  </div>
);

async function calcularAsiQueda(d: Deps, tipo: string, monto: string, viajeId: string, categoria: string): Promise<AsiQueda | null> {
  const m = parsearMonto(monto);
  const v = num(viajeId);
  if (!m || v === null || (tipo !== "gaste" && tipo !== "chofer")) return null;
  return asiQueda(d.ctx, { tipo: tipo === "gaste" ? "gasto" : "entrega", monto: m, viajeId: v, categoria: categoria || null }).catch(() => null);
}
```

In `parteGaste`, add to the returned object (after `solo`):

```tsx
    abajo: <AsiQuedaBloque r={null} />,
```

In `parteChofer`, add the same line `abajo: <AsiQuedaBloque r={null} />,`. In `rutasAnotar`, before `app.post("/anotar", …)` add:

```tsx
  app.get("/anotar/asi-queda", async (c) => {
    if (!tiposAnotar(c.get("usuario").rol).some((t) => t === "gaste" || t === "chofer")) return c.text("Tu rol no anota plata", 403);
    const r = await calcularAsiQueda(d, c.req.query("tipo") ?? "", c.req.query("monto") ?? "", c.req.query("viajeId") ?? "", c.req.query("categoria") ?? "");
    return c.html((<AsiQuedaBloque r={r} />).toString());
  });
```

- [ ] **Step 6: Add the panel to the layout (`apps/web/src/ui.tsx`)**

Right after the closing `</div>` of `<div class="marco">` add:

```tsx
        {anota ? <aside class="panel-anotar" id="panel-anotar" hidden aria-label="Anotar"></aside> : null}
```

and after the `app.js` script tag:

```tsx
        {anota ? <script src={`/static/anotar.js?v=${V}`} defer></script> : null}
```

- [ ] **Step 7: Create `apps/web/public/anotar.js`**

```js
// Anotar en la PC: se abre como panel lateral sobre cualquier página, y «Así queda» se recalcula
// mientras se escribe. En el celular los enlaces abren la página /anotar normal.
(() => {
  const panel = document.getElementById("panel-anotar");
  const ancho = window.matchMedia("(min-width: 900px)");

  function enlazarAsiQueda(raiz) {
    const form = raiz.querySelector("form[data-asi-queda]");
    if (!form) return;
    let espera = null;
    const refrescar = async () => {
      const f = new FormData(form);
      const cat = f.get("categoria") === "otro" ? f.get("categoriaOtra") : f.get("categoria");
      const q = new URLSearchParams({ tipo: f.get("tipo") || "", monto: f.get("monto") || "", viajeId: f.get("viajeId") || "", categoria: cat || "" });
      try {
        const r = await fetch(`/anotar/asi-queda?${q}`, { credentials: "same-origin" });
        const caja = form.querySelector("#asi-queda");
        if (r.ok && caja) caja.outerHTML = await r.text();
      } catch (e) { /* sin red: se queda lo de antes */ }
    };
    form.addEventListener("input", () => { clearTimeout(espera); espera = setTimeout(refrescar, 300); });
    form.addEventListener("change", () => { clearTimeout(espera); espera = setTimeout(refrescar, 50); });
  }

  async function abrir(url) {
    const u = new URL(url, location.href);
    u.searchParams.set("parcial", "1");
    if (!u.searchParams.get("volver")) u.searchParams.set("volver", location.pathname + location.search);
    try {
      const r = await fetch(u, { credentials: "same-origin" });
      if (!r.ok) { location.href = url; return; }
      panel.innerHTML = await r.text();
      panel.hidden = false;
      document.body.classList.add("con-panel");
      enlazarAsiQueda(panel);
      const monto = panel.querySelector("input[name=monto], input[name=manoObra]");
      if (monto) monto.focus();
    } catch (e) {
      location.href = url;
    }
  }

  function cerrar() {
    panel.hidden = true;
    panel.innerHTML = "";
    document.body.classList.remove("con-panel");
  }

  if (panel) {
    document.addEventListener("click", (e) => {
      if (!ancho.matches) return;
      const a = e.target.closest("a");
      if (!a) return;
      if (a.matches("[data-abrir-panel]") || (panel.contains(a) && a.matches("[data-panel-link]"))) {
        e.preventDefault();
        abrir(a.href);
      } else if (panel.contains(a) && a.matches(".cab-pagina a[aria-label=Volver]")) {
        e.preventDefault();
        cerrar();
      }
    });
    document.addEventListener("submit", (e) => {
      const f = e.target;
      if (!ancho.matches || !f.matches || !f.matches("form[data-panel-form]")) return;
      e.preventDefault();
      const q = new URLSearchParams(new FormData(f));
      abrir(`${f.getAttribute("action")}?${q}`);
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) cerrar(); });
  }
  enlazarAsiQueda(document);
})();
```

- [ ] **Step 8: Panel and preview styles in `apps/web/public/app.css`** (before the `.sin-gap` block)

```css
/* ── Panel lateral de Anotar (PC) y «Así queda» ── */
.panel-anotar { display: none; }
.asi-queda { background: var(--panel); border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: 6px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
.asi-queda ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
@media (min-width: 900px) {
  .panel-anotar:not([hidden]) { display: block; position: fixed; top: 0; right: 0; bottom: 0; width: 400px; z-index: 30; overflow-y: auto; background: var(--bg); border-left: 1px solid var(--border); box-shadow: -8px 0 24px rgba(18, 23, 25, .12); padding: 18px; }
  body.con-panel .marco { margin-right: 400px; }
  .panel-anotar .anotar { max-width: none; }
  .panel-anotar .tipos-anotar a { min-height: 64px; }
}
```

- [ ] **Step 9: Run the tests**

Run: `pnpm test apps/web/test/web.test.ts packages/core/test/inicio.test.ts`
Expected: PASS.

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 10: Screenshots**

In `apps/web/scripts/lugares-captura.ts` add:

```ts
  { nombre: "inicio-con-panel", ruta: "/", clic: "[data-abrir-panel]", esperar: "#panel-anotar form", espera: 600, solo: "pc" },
```

Run: `CAPTURAS_ETIQUETA=tarea-6 pnpm capturas inicio-con-panel anotar`
Expected: `capturas/tarea-6/inicio-con-panel-1440.png` matches the Escritorio artboard: 220 px menu, Inicio content, 400 px Anotar panel on the right with the 6 types, "¿Cuánto?", "¿En qué?", "Así queda después de guardar" and GUARDAR. `anotar-390.png` does not show "Así queda" (PC only).

- [ ] **Step 11: Commit**

```bash
git add packages/core/src/consultas/asi-queda.ts packages/core/src/index.ts packages/core/test/inicio.test.ts apps/web/src apps/web/public apps/web/scripts/lugares-captura.ts apps/web/test/web.test.ts
git commit -m "feat(web): Anotar como panel lateral en la PC con «Así queda después de guardar»" -m "Claude-Session: https://claude.ai/code/session_012rqk28jac1iV7v2GAJjggW"
```

---

### Task 7: Viajes — list and one detail page with everything of the trip

**Files:**
- Modify: `apps/web/src/paginas/viajes.tsx` (rewrite `vista`, export `FormFacturar`, POST redirects with `volver`), `apps/web/src/paginas/liquidacion.tsx` (rewrite `vista`), `apps/web/src/ui.tsx` (move `CHIP_FACTURA`, `ESTADO_GUIA` here), `apps/web/public/app.js` (open `<details>` from hash), `apps/web/public/app.css`, `apps/web/scripts/lugares-captura.ts`, `apps/web/test/web.test.ts`

**Interfaces:**
- Consumes: `viajesEnRuta`, `choferDeViaje`, `listarViajesFlota`, `listarGuias`, `listarGuiasSinViaje`, `listarCobrosPendientes`, `liquidacionViaje`, `rentabilidadDeViaje`, `listarCategorias`, `MEDIOS_ENTREGA`, `nombreCategoria`, `listarUnidades`, `rangoMes`, `sumarDias`, `hoy`, `puedeEditar` (core); `TarjetaEnRuta`, `ListaViajes`, `Cifra`, `Cabecera`, `mesLargo`, `diasEntre` (ui); `CamposPlantilla`, `categoriasDeViaje` (rutas.tsx).
- Produces: `FormFacturar({ guiaId, etiqueta, volver })` exported from viajes.tsx; `CHIP_FACTURA`, `ESTADO_GUIA` exported from ui.tsx; POSTs `/guias/:id/facturar`, `/guias/:id/enlazar`, `/viajes/flete` accept an optional `volver` field.

- [ ] **Step 1: Update and add the tests**

In `apps/web/test/web.test.ts`:
- test `"rentabilidad: conmutador por viaje y por mes, y el Excel"`: change `expect(html).toContain("FIJO ASIGNADO");` to `expect(html).toContain("Fijo asignado");`.
- test `"rutas: plantilla, usar el promedio …"`: change `expect(html).toContain("PRESUPUESTO DEL VIAJE");` to `expect(html).toContain("Presupuesto del viaje");`.
- test `"detalle del viaje: corregir y borrar gastos, cerrar y reabrir"`: change `"REABRIR VIAJE"` to `"Reabrir viaje"` and `"CERRAR ESTE VIAJE"` to `"Cerrar viaje"`.

Add inside `describe("con el dueño configurado", …)`:

```ts
    it("viajes: en ruta arriba, lista del mes y el detalle con todo del viaje", async () => {
      const cookie = await entrar();
      const cerrado = await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Arequipa", destinoLugar: "Juliaca", estado: "cerrado", km: 300, flete: 320000, origen: "web" });
      await registrarGasto(ctx, { viajeId: cerrado.id, categoria: "combustible", monto: 106000, origen: "web" });
      const enRuta = await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Yura", destinoLugar: "Puno", estado: "en_curso", flete: 350000, origen: "web" });
      const lista = await (await app.request("/viajes", { headers: { cookie } })).text();
      for (const t of ["En ruta", "Yura → Puno", "Arequipa → Juliaca", "S/ 2,140", "+ Nuevo viaje"]) expect(lista, t).toContain(t);
      const det = await (await app.request(`/viajes/${enRuta.id}`, { headers: { cookie } })).text();
      for (const t of ["Este viaje te deja", "S/ 3,500", "Le diste a Jhon", "Le queda", "Gastos del viaje", "Papeles y cobro", "+ Anotar", "Cerrar viaje", "Ver más"]) expect(det, t).toContain(t);
      expect(det).toContain(`/anotar?tipo=gaste&amp;viajeId=${enRuta.id}`);
      // El cierre pide solo lo que falta: este viaje ya tiene flete pero no km.
      const cierre = det.slice(det.indexOf(`action="/viajes/${enRuta.id}/cerrar"`), det.indexOf("Cerrar el viaje"));
      expect(cierre).toContain('name="km"');
      expect(cierre).not.toContain('name="flete"');
    });
```

Run: `pnpm test apps/web/test/web.test.ts -t "viajes:|detalle del viaje|rutas:|rentabilidad:"`
Expected: FAIL — `expected … to contain 'Este viaje te deja'` (and the old pages still say `FIJO ASIGNADO`, `REABRIR VIAJE`).

- [ ] **Step 2: Move the chip maps to `apps/web/src/ui.tsx`**

Add at the end of the `// ── Formato ──` section (and delete both consts from `viajes.tsx`):

```tsx
export const CHIP_FACTURA: Record<string, string> = { PAGADA: "ok", PENDIENTE: "proximo", VENCIDA: "cambiar", "SIN FACTURA": "neutro" };
export const ESTADO_GUIA: Record<string, string> = { borrador: "neutro", pendiente_envio: "proximo", enviada: "proximo", aceptada: "ok", rechazada: "cambiar" };
```

- [ ] **Step 3: Rewrite the list view in `apps/web/src/paginas/viajes.tsx`**

Imports:

```tsx
/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import type { FC } from "hono/jsx";
import {
  editarViajeFlota, emitirFactura, enlazarGuia, ErrorNegocio, finalizarViajeFlota, hoy, listarCobrosPendientes, listarGuias, listarGuiasSinViaje,
  listarUnidades, listarViajesFlota, parsearMonto, prepararFactura, puedeEditar, rangoMes, registrarViajeFlota, sumarDias, formatearSoles,
  archivosDocumento, viajesEnRuta,
} from "@sunatapp/core";
import { accion, formulario, pagina, servirDeAlmacen, volverA, type App, type C, type Deps } from "../base";
import { guardarCobro } from "../acciones";
import { enteroONull } from "./flota";
import { Cabecera, diasEntre, ESTADO_GUIA, fechaCorta, ListaViajes, mesLargo, TarjetaEnRuta, Vacio } from "../ui";
```

(delete the local `diasEntre`; `/cobros/recordar` uses the one from ui.) Replace `async function vista …` with:

```tsx
/** Formulario de «Facturar» de una guía aceptada (también lo usa el detalle del viaje). */
export const FormFacturar: FC<{ guiaId: number; etiqueta: string; volver: string }> = (p) => (
  <details class="plegable">
    <summary class="btn chico primario">{p.etiqueta}</summary>
    <form method="post" action={`/guias/${p.guiaId}/facturar`} class="filas sub-form">
      <input type="hidden" name="volver" value={p.volver} />
      <label class="campo"><span>Monto S/</span><input name="monto" inputmode="decimal" required /></label>
      <label class="campo"><span>El monto…</span><select name="igv"><option value="sin">no incluye IGV</option><option value="con">ya incluye IGV</option></select></label>
      <label class="campo"><span>Pago</span><select name="pago"><option value="contado">Contado</option><option value="credito">Crédito</option></select></label>
      <label class="campo"><span>Días de crédito</span><input name="dias" inputmode="numeric" placeholder="30" /></label>
      <button class="btn primario" type="submit">Emitir factura</button>
    </form>
  </details>
);

async function vista(c: C, d: Deps) {
  const ctx = d.ctx;
  const h = hoy(ctx);
  const q = c.req.query("mes") ?? "";
  const mes = /^\d{4}-\d{2}$/.test(q) ? q : h.slice(0, 7);
  const { desde, hasta } = rangoMes(`${mes}-01`);
  const unidadId = c.req.query("unidad") ? Number(c.req.query("unidad")) : undefined;
  const edita = puedeEditar(c.get("usuario").rol, "viajes");
  const [unidades, viajes, enRuta, guias, sinViaje, recientes, cobros] = await Promise.all([
    listarUnidades(ctx), listarViajesFlota(ctx, { desde, hasta, vehiculoId: unidadId }), viajesEnRuta(ctx), listarGuias(ctx, 15),
    listarGuiasSinViaje(ctx), listarViajesFlota(ctx, { desde: sumarDias(h, -60), hasta: h }), listarCobrosPendientes(ctx),
  ]);
  const delMes = viajes.filter((v) => v.estado !== "en_curso");
  return pagina(c, d, { titulo: "Viajes", seccion: "viajes" }, (
    <>
      <Cabecera titulo="Viajes" der={edita ? <a class="btn primario" href="#nuevo-viaje">+ Nuevo viaje</a> : null} />
      {enRuta.length ? (
        <section class="col">
          <h2 class="titulo-seccion">En ruta</h2>
          <div class="grid-tarjetas">{enRuta.map((v) => <TarjetaEnRuta v={v} />)}</div>
        </section>
      ) : null}
      <section class="col">
        <div class="fila-sep">
          <h2 class="titulo-seccion">{mesLargo(mes)} · {delMes.length} {delMes.length === 1 ? "viaje" : "viajes"}</h2>
          <form method="get" action="/viajes" class="linea filtro">
            <input type="month" name="mes" value={mes} aria-label="Mes" />
            <select name="unidad" aria-label="Camión"><option value="">Todos</option>{unidades.map((u) => <option value={u.id} selected={u.id === unidadId}>{u.codigo}</option>)}</select>
            <button class="btn chico" type="submit">Ver</button>
          </form>
        </div>
        {delMes.length === 0 ? <div class="lista-filas"><Vacio>Sin viajes cerrados en {mesLargo(mes)}.</Vacio></div> : <ListaViajes viajes={delMes} />}
      </section>
      {edita ? (
        <details class="plegable panel" id="nuevo-viaje">
          <summary class="ver-mas">+ Nuevo viaje <span class="muted">(también nacen solos de la guía que le mandas al bot)</span></summary>
          <form method="post" action="/viajes" class="filas">
            <div class="form-grid">
              <label class="campo"><span>Camión</span><select name="vehiculoId">{unidades.map((u) => <option value={u.id}>{u.codigo} · {u.placa}</option>)}</select></label>
              <label class="campo"><span>Origen *</span><input name="origen" required placeholder="Juliaca" /></label>
              <label class="campo"><span>Destino *</span><input name="destino" required placeholder="Arequipa" /></label>
              <label class="campo"><span>Flete S/ (sin IGV)</span><input name="flete" inputmode="decimal" /></label>
            </div>
            <fieldset class="grupo"><legend class="lbl">¿Ya se hizo o sale ahora?</legend>
              <div class="radios">
                <label><input type="radio" name="estado" value="en_curso" checked /><span>Sale ahora</span></label>
                <label><input type="radio" name="estado" value="cerrado" /><span>Ya se hizo (suma los km)</span></label>
              </div>
            </fieldset>
            <details class="plegable"><summary class="ver-mas">Más datos</summary>
              <div class="form-grid">
                <label class="campo"><span>Fecha</span><input type="date" name="fecha" value={h} /></label>
                <label class="campo"><span>Km</span><input name="km" inputmode="numeric" placeholder="1290" /></label>
                <label class="campo"><span>Toneladas</span><input name="toneladas" inputmode="decimal" /></label>
                <label class="campo"><span>Guía</span><input name="guia" placeholder="T001-0214" /></label>
              </div>
            </details>
            <button class="btn primario" type="submit">Guardar viaje</button>
          </form>
        </details>
      ) : null}
      <details class="plegable panel">
        <summary class="ver-mas">Ver más · guías, cobros y rutas</summary>
        <div class="filas">
          <h3 class="titulo-seccion">Guías de remisión (SUNAT)</h3>
          {guias.length === 0 ? <Vacio>Sin guías todavía: se emiten desde el bot mandándole el PDF del remitente.</Vacio> : (
            <div class="tabla-wrap"><table class="t">
              <thead><tr><th>Guía</th><th>Traslado</th><th>Destinatario</th><th>Estado</th><th>Archivos</th>{edita ? <th></th> : null}</tr></thead>
              <tbody>{guias.map((g) => (
                <tr>
                  <td class="nowrap"><b>{g.serieNumero}</b></td><td>{fechaCorta(g.fechaTraslado)}</td><td>{g.destinatario}</td>
                  <td><span class={`chip ${ESTADO_GUIA[g.estado]}`}>{g.estado.toUpperCase().replace("_", " ")}</span>{g.facturada ? <span class="chip ok" style="margin-left:4px">FACTURADA</span> : null}</td>
                  <td class="nowrap"><a href={`/guias/${g.id}/pdf`}>PDF</a> · <a href={`/guias/${g.id}/xml`}>XML</a> · <a href={`/guias/${g.id}/cdr`}>CDR</a></td>
                  {edita ? <td>{g.estado === "aceptada" && !g.facturada ? <FormFacturar guiaId={g.id} etiqueta="Facturar" volver="/viajes" /> : null}</td> : null}
                </tr>
              ))}</tbody>
            </table></div>
          )}
          {edita && sinViaje.length ? (
            <>
              <h3 class="titulo-seccion">Guías sin viaje</h3>
              {sinViaje.map((g) => (
                <form method="post" action={`/guias/${g.id}/enlazar`} class="linea">
                  <input type="hidden" name="volver" value="/viajes" />
                  <span><b>{g.serieNumero}</b> · {fechaCorta(g.fechaTraslado)}</span>
                  <select name="viajeId" aria-label="Viaje">{recientes.map((v) => <option value={v.id}>{v.codigo} · {v.unidad} · {v.ruta}</option>)}</select>
                  <select name="tramo" aria-label="Tramo"><option value="ida">ida</option><option value="retorno">retorno</option></select>
                  <button class="btn chico" type="submit">Enlazar</button>
                </form>
              ))}
            </>
          ) : null}
          {edita && cobros.filas.length ? (
            <form method="post" action="/cobros/recordar"><button class="btn" type="submit">Recordar los cobros por Telegram ({cobros.filas.length})</button></form>
          ) : null}
          <a class="ver-mas" href="/rutas">Rutas y presupuestos →</a>
        </div>
      </details>
    </>
  ));
}
```

In the POST handlers change the redirect targets so they return where they came from:
- `/viajes/flete`: `return accion(c, volverA(f.volver, "/viajes"), async () => { … })` (body unchanged).
- `/guias/:id/facturar`: `return accion(c, volverA(f.volver, "/viajes"), async () => { … })`.
- `/guias/:id/enlazar`: `return accion(c, volverA(f.volver, "/viajes"), async () => { … })`.

- [ ] **Step 4: Rewrite the detail in `apps/web/src/paginas/liquidacion.tsx`**

Imports:

```tsx
/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import type { FC } from "hono/jsx";
import {
  actualizarPresupuestoViaje, borrarEntrega, borrarGasto, choferDeViaje, desenlazarGuia, editarGasto, enlazarGuia, ErrorNegocio, finalizarViajeFlota,
  hoy, listarCategorias, listarCobrosPendientes, listarGuiasSinViaje, listarViajesFlota, liquidacionViaje, MEDIOS_ENTREGA, nombreCategoria, parsearMonto,
  puedeEditar, reabrirViaje, rentabilidadDeViaje, type Categoria, type LiquidacionViaje, type Semaforo,
} from "@sunatapp/core";
import { accion, formulario, pagina, type App, type C, type Deps } from "../base";
import { guardarEntrega } from "../acciones";
import { Barra, Cabecera, CHIP_FACTURA, Cifra, diasEntre, ESTADO_GUIA, fechaCorta, soles, soles2, Vacio } from "../ui";
import { enteroONull } from "./flota";
import { CamposPlantilla, categoriasDeViaje } from "./rutas";
import { FormFacturar } from "./viajes";
```

Keep `ESTADO_SEMAFORO`, `textoSaldo` and `rutasLiquidacion` (with `plantillaDeFormulario` still imported from `./rutas`). Delete `TEXTO_SEMAFORO` and replace `async function vista …` with:

```tsx
const TablaGastos: FC<{ l: LiquidacionViaje; categorias: Categoria[]; edita: boolean }> = ({ l, categorias, edita }) => (
  <div class="tabla-wrap"><table class="t">
    <thead><tr><th>Fecha</th><th>En qué</th><th>Detalle</th><th class="num">Monto</th><th></th>{edita ? <th></th> : null}</tr></thead>
    <tbody>{l.gastos.map((g) => (
      <tr>
        <td class="nowrap">{fechaCorta(g.fecha)}</td><td>{nombreCategoria(g.categoria, categorias)}</td><td>{g.detalle ?? "—"}</td>
        <td class="num">{soles2(g.monto)}</td><td>{g.conFoto ? <a href={`/archivo/gasto/${g.id}`} title="Ver la boleta">📷</a> : null}</td>
        {edita ? (
          <td>
            <details class="plegable"><summary class="btn chico">Corregir</summary>
              <form method="post" action={`/viajes/${l.viaje.id}/gasto/${g.id}`} class="filas sub-form">
                <label class="campo"><span>En qué</span><select name="categoria">{categorias.map((k) => <option value={k.clave} selected={k.clave === g.categoria}>{k.nombre}</option>)}</select></label>
                <label class="campo"><span>Monto S/</span><input name="monto" inputmode="decimal" value={(g.monto / 100).toFixed(2)} /></label>
                <label class="campo"><span>Fecha</span><input name="fecha" type="date" value={g.fecha} /></label>
                <button class="btn primario chico" type="submit">Guardar</button>
              </form>
              <form method="post" action={`/viajes/${l.viaje.id}/gasto/${g.id}/borrar`} data-confirmar="¿Borrar este gasto?"><button class="btn chico fantasma" type="submit">Borrar</button></form>
            </details>
          </td>
        ) : null}
      </tr>
    ))}</tbody>
  </table></div>
);

async function vista(c: C, d: Deps) {
  const ctx = d.ctx;
  const id = Number(c.req.param("id"));
  const l = await liquidacionViaje(ctx, id);
  const [categorias, variables, sinViaje, rent, chofer, cobros, propios] = await Promise.all([
    listarCategorias(ctx, { soloActivas: true }), categoriasDeViaje(d), listarGuiasSinViaje(ctx), rentabilidadDeViaje(ctx, id), choferDeViaje(ctx, id),
    listarCobrosPendientes(ctx), listarViajesFlota(ctx, { vehiculoId: l.viaje.vehiculoId, limite: 500 }),
  ]);
  const fila = propios.find((v) => v.id === id);
  const edita = puedeEditar(c.get("usuario").rol, "viajes");
  const enCurso = l.viaje.estado === "en_curso";
  const aqui = `/viajes/${id}`;
  const deja = rent ? rent.ganancia : l.ganancia;
  const margen = rent ? rent.margenPct : l.margenPct;
  const porCobrar = cobros.filas.filter((f) => fila?.facturas.includes(f.serieNumero));
  const top = [...l.lineas].sort((a, b) => b.real - a.real).slice(0, 3);
  const maxLinea = Math.max(1, ...top.map((x) => Math.max(x.real, x.presupuesto)));
  const origen = l.presupuestoOrigen.tipo === "viaje" ? "presupuesto del viaje"
    : l.presupuestoOrigen.tipo === "promedio" ? `promedio de los últimos ${l.presupuestoOrigen.viajes} viajes de esta ruta` : "sin presupuesto";
  return pagina(c, d, { titulo: `Viaje ${l.viaje.codigo}`, seccion: "viajes" }, (
    <>
      <Cabecera volver="/viajes" titulo={l.viaje.ruta}
        sub={`${l.viaje.unidad} · ${chofer} · ${enCurso ? `en ruta, día ${diasEntre(l.viaje.fechaSalida, hoy(ctx)) + 1}` : `cerrado el ${fechaCorta(l.viaje.fechaRegreso)}`} · ${l.viaje.codigo}`} />
      <div class="viaje-cols">
        <div class="col">
          <section class="tarjeta-oscura">
            <span class="lbl">Este viaje te deja{enCurso ? " (por ahora)" : ""}</span>
            <b class={`cifra-grande${deja !== null && deja < 0 ? " neg" : ""}`}>{deja === null ? "Falta el flete" : soles(deja)}</b>
            <span class="sub">Flete {soles(l.flete)} − gastos {soles(l.gastado)}{rent ? ` − fijos ${soles(rent.fijoAsignado)}` : ""}{margen !== null ? ` · margen ${margen}%` : ""}</span>
          </section>
          <div class="dos-cifras">
            <Cifra etiqueta={`Le diste a ${chofer}`} valor={soles(l.entregado)} />
            <Cifra etiqueta={l.saldo >= 0 ? "Le queda" : "Le debes"} valor={soles(Math.abs(l.saldo))} tono={l.saldo < 0 ? "cambiar" : "ok"} />
          </div>
          <p class="muted">{textoSaldo(l)}.</p>
          <section class="col">
            <h2 class="titulo-seccion">Gastos del viaje · {soles2(l.gastado)}{l.presupuestoTotal ? ` de ${soles2(l.presupuestoTotal)} previstos` : ""}</h2>
            <div class="lista-filas barras-gasto">
              {top.length === 0 ? <Vacio>Todavía no hay gastos. El chofer los manda por Telegram (foto de la boleta o «grifo 350»).</Vacio> : top.map((x) => (
                <div class="fila-barra">
                  <div class="fila-sep"><span>{x.nombre}</span><b>{soles(x.real)}{x.presupuesto ? <span class="muted"> / {soles(x.presupuesto)}</span> : null}</b></div>
                  <Barra pct={(x.real / maxLinea) * 100} estado={ESTADO_SEMAFORO[x.semaforo]} linea100={x.presupuesto ? (x.presupuesto / maxLinea) * 100 : undefined} />
                </div>
              ))}
            </div>
            {l.gastos.length ? (
              <details class="plegable"><summary class="ver-mas">Ver los {l.gastos.length} gastos</summary><TablaGastos l={l} categorias={categorias} edita={edita} /></details>
            ) : null}
          </section>
        </div>
        <div class="col">
          <section class="col">
            <h2 class="titulo-seccion">Papeles y cobro</h2>
            <div class="lista-filas">
              {l.guias.length === 0 ? (
                <div class="fila-papel"><span class="chip proximo">FALTA</span><span>Guía de remisión <span class="muted">· la emite el bot con el PDF del remitente</span></span></div>
              ) : l.guias.map((g) => (
                <div class="fila-papel">
                  <span class={`chip ${ESTADO_GUIA[g.estado] ?? "neutro"}`}>{g.estado === "aceptada" ? "SUNAT OK" : g.estado.toUpperCase().replace("_", " ")}</span>
                  <span>Guía {g.serieNumero}{g.tramo ? ` · ${g.tramo}` : ""}</span>
                  <a class="btn chico" href={`/guias/${g.id}/pdf`}>PDF</a>
                </div>
              ))}
              <div class="fila-papel">
                {fila?.facturas.length ? <span class={`chip ${CHIP_FACTURA[fila.factura]}`}>{fila.factura}</span> : <span class="chip proximo">FALTA</span>}
                <span>Factura{fila?.facturas.length ? ` ${fila.facturas.join(", ")}` : ""}</span>
                {edita ? l.guias.filter((g) => g.estado === "aceptada" && g.flete === null).map((g) => <FormFacturar guiaId={g.id} etiqueta="Facturar" volver={aqui} />) : null}
              </div>
              {porCobrar.map((f) => (
                <div class="fila-papel">
                  <span class={`chip ${f.estado === "vencida" ? "cambiar" : "proximo"}`}>{f.estado === "vencida" ? "VENCIDA" : "DESPUÉS"}</span>
                  <span>Cobro a {f.cliente} · {soles2(f.saldo)}</span>
                  {edita ? <a class="btn chico" href={`/anotar?tipo=cobro&facturaId=${f.facturaId}&volver=${encodeURIComponent(aqui)}`} data-abrir-panel="">Me pagaron</a> : null}
                </div>
              ))}
            </div>
          </section>
          {edita ? (
            <div class="acciones-viaje">
              <a class="btn grande" href={`/anotar?tipo=gaste&viajeId=${id}&volver=${encodeURIComponent(aqui)}`} data-abrir-panel="">+ Anotar</a>
              {enCurso ? (
                <details class="plegable" id="cerrar">
                  <summary class="btn primario grande">Cerrar viaje</summary>
                  <form method="post" action={`${aqui}/cerrar`} class="filas sub-form">
                    {fila?.km ? null : <label class="campo"><span>Km recorridos</span><input name="km" inputmode="numeric" placeholder="380" /></label>}
                    {l.flete > 0 ? null : <label class="campo"><span>Flete S/ (sin IGV)</span><input name="flete" inputmode="decimal" /></label>}
                    {fila?.km && l.flete > 0 ? <p class="muted">Ya tiene km y flete: solo confirma.</p> : null}
                    {fila?.km ? null : (
                      <details class="plegable"><summary class="ver-mas">¿Tienes el odómetro al llegar?</summary>
                        <label class="campo"><span>Odómetro final (km)</span><input name="odometro" inputmode="numeric" /></label>
                      </details>
                    )}
                    <button class="btn primario" type="submit">Cerrar el viaje</button>
                  </form>
                </details>
              ) : null}
            </div>
          ) : null}
          <details class="plegable panel">
            <summary class="ver-mas">Ver más</summary>
            <div class="filas">
              {rent ? (
                <div class="tres-cifras">
                  <Cifra etiqueta="Flete − del viaje" valor={soles2(rent.contribucion)} />
                  <Cifra etiqueta="Fijo asignado" valor={soles2(rent.fijoAsignado)} sub={rent.provisional ? "cambia hasta fin de mes" : "del mes de cierre"} />
                  <Cifra etiqueta="Ganancia" valor={soles2(rent.ganancia)} tono={rent.ganancia < 0 ? "cambiar" : undefined} />
                </div>
              ) : null}
              <h3 class="titulo-seccion">Plata que le diste a {chofer}</h3>
              {l.entregas.length === 0 ? <Vacio>Sin entregas. También puede avisar por Telegram («me yapearon 500»).</Vacio> : (
                <div class="tabla-wrap"><table class="t"><tbody>{l.entregas.map((e) => (
                  <tr>
                    <td class="nowrap">{fechaCorta(e.fecha)}</td><td>{MEDIOS_ENTREGA[e.medio]}{e.nota ? <div class="muted">{e.nota}</div> : null}</td>
                    <td class="num">{soles2(e.monto)}</td>
                    <td>{edita ? <form method="post" action={`${aqui}/entrega/${e.id}/borrar`}><button class="btn chico fantasma" type="submit" aria-label="Borrar entrega">×</button></form> : null}</td>
                  </tr>
                ))}</tbody></table></div>
              )}
              {edita ? (
                <>
                  <details class="plegable"><summary class="ver-mas">Presupuesto del viaje <span class="muted">({origen})</span></summary>
                    <form method="post" action={`${aqui}/presupuesto`} class="filas sub-form">
                      <CamposPlantilla categorias={variables} valores={new Map(l.lineas.filter((x) => l.presupuestoOrigen.tipo === "viaje" && x.presupuesto > 0).map((x) => [x.categoria, x.presupuesto]))}
                        promedio={new Map(l.lineas.filter(() => l.presupuestoOrigen.tipo === "promedio").map((x) => [x.categoria, x.presupuesto]))} />
                      <button class="btn primario chico" type="submit">Guardar presupuesto</button>
                    </form>
                  </details>
                  {sinViaje.length ? (
                    <form method="post" action={`${aqui}/guia`} class="linea">
                      <select name="guiaId" aria-label="Guía">{sinViaje.map((g) => <option value={g.id}>{g.serieNumero} · {fechaCorta(g.fechaTraslado)}</option>)}</select>
                      <select name="tramo" aria-label="Tramo"><option value="ida">Ida</option><option value="retorno">Retorno</option></select>
                      <button class="btn chico" type="submit">Enlazar guía</button>
                    </form>
                  ) : null}
                  {l.guias.map((g) => (
                    <form method="post" action={`${aqui}/guia/${g.id}/quitar`} class="linea"><span>Guía {g.serieNumero}</span><button class="btn chico fantasma" type="submit">Quitar del viaje</button></form>
                  ))}
                  <form method="post" action="/viajes/flete" class="linea">
                    <input type="hidden" name="viajeId" value={id} /><input type="hidden" name="volver" value={aqui} />
                    <input name="flete" inputmode="decimal" placeholder={l.flete ? (l.flete / 100).toFixed(2) : "S/"} aria-label="Flete" />
                    <button class="btn chico" type="submit">Corregir flete</button>
                  </form>
                  {enCurso ? null : <form method="post" action={`${aqui}/reabrir`}><button class="btn" type="submit">Reabrir viaje</button></form>}
                </>
              ) : null}
            </div>
          </details>
        </div>
      </div>
    </>
  ));
}
```

- [ ] **Step 5: `app.js` — open a `<details>` named in the hash** (append inside the first IIFE, before the closing `})();`)

```js
  // «+ Nuevo viaje» (#nuevo-viaje) y similares: abre el plegable con ese id.
  const abrirDelHash = () => {
    const el = location.hash ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
    if (el && el.tagName === "DETAILS") { el.open = true; el.scrollIntoView({ block: "start" }); }
  };
  window.addEventListener("hashchange", abrirDelHash);
  abrirDelHash();
```

- [ ] **Step 6: Viajes styles in `apps/web/public/app.css`** (before the `.sin-gap` block)

```css
/* ── Viajes ── */
.grid-tarjetas { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; }
.filtro { gap: 6px; }
.filtro input, .filtro select { width: auto; }
.viaje-cols { display: flex; flex-direction: column; gap: 12px; }
.fila-barra { padding: 10px 14px; border-bottom: 1px solid var(--divider); display: flex; flex-direction: column; gap: 6px; }
.fila-barra:last-child { border-bottom: 0; }
.fila-papel { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 10px 14px; min-height: 48px; border-bottom: 1px solid var(--divider); }
.fila-papel:last-child { border-bottom: 0; }
.fila-papel > span:nth-child(2) { flex: 1; min-width: 140px; }
.acciones-viaje { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; align-items: start; }
.acciones-viaje > details > summary { width: 100%; }
.btn.grande { min-height: 52px; font-size: 15px; width: 100%; }
.sub-form { margin-top: 8px; min-width: 220px; }
summary.ver-mas { cursor: pointer; }
details.panel > summary { list-style: none; }
@media (min-width: 900px) {
  .grid-tarjetas { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .viaje-cols { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; }
}
```

- [ ] **Step 7: Run the tests**

Run: `pnpm test apps/web/test/web.test.ts`
Expected: PASS — including `liquidación del viaje` (`El chofer tiene S/ 150.00 por rendir o devolver`, `Combustible`, `Adelanto`, `href="/viajes/<id>"`), `rutas:` (`S/ 800.00`, `S/ 1,050.00 previstos`), `detalle del viaje` and the new `viajes:` case.

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 8: Screenshots**

In `apps/web/scripts/lugares-captura.ts` add after `viajes`:

```ts
  { nombre: "viaje", ruta: "/viajes", seguir: ".tarjeta-ruta, .fila-viaje:not(.cab)" },
```

Run: `CAPTURAS_ETIQUETA=tarea-7 pnpm capturas viajes viaje`
Expected: `capturas/tarea-7/{viajes,viaje}-{390,1440}.png`. `viaje-390.png` matches the Viaje artboard: title = route, sub "camión · chofer · en ruta, día N", dark "Este viaje te deja", Le diste / Le queda, Gastos del viaje bars, Papeles y cobro, "+ Anotar" and "Cerrar viaje". `revision.json` clean for both.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src apps/web/public apps/web/scripts/lugares-captura.ts apps/web/test/web.test.ts
git commit -m "feat(web): Viajes con lista por mes y un detalle que junta liquidación, guías, factura y cobro" -m "Claude-Session: https://claude.ai/code/session_012rqk28jac1iV7v2GAJjggW"
```

---

### Task 8: Camiones — 3D in the center, tabs Lo que toca / Historial / Repuestos / Datos

**Files:**
- Create: `apps/web/src/paginas/camiones.tsx`, `packages/core/src/consultas/vehiculo.ts`
- Modify: `packages/core/src/index.ts` (append export), `packages/core/test/inicio.test.ts`, `apps/web/src/app.tsx` (`seccionDeRuta`: `camiones → trailer`; register `rutasCamiones`), `apps/web/src/lugares.ts` (`RUTA.camiones`, `RUTA.camion`, `RUTA.repuestos`), `apps/web/src/paginas/trailer.tsx` (remove view; GETs redirect; POST targets), `apps/web/src/paginas/flota.tsx` (remove view; GET redirect; POST targets), `apps/web/src/paginas/inventario.tsx` (remove view; export `SelectPiezas`, `textoPiezas`; GET redirect; POST targets), `apps/web/src/paginas/reparaciones.tsx` (remove view; GET redirect; POST target), `apps/web/public/app.css`, `apps/web/scripts/lugares-captura.ts`, `apps/web/test/web.test.ts`
- Delete: `apps/web/public/reparaciones.js`

**Interfaces:**
- Consumes: `listarUnidades`, `partesDeUnidad`, `listarReparaciones`, `listarRepuestos`, `listarCompras`, `listarTiposParte`, `piezasDeSemirremolque`, `partesDePieza`, `repuestosDePieza`, `GRUPOS_PIEZA`, `ZONAS`, `TIPOS_REPARACION`, `TIPOS_SEMIRREMOLQUE`, `CATEGORIAS_REPUESTO`, `puedeEditar` (core); `redirigir`, `conParametros` (redirecciones); `Datos`, `Barra`, `Cabecera`, `ChipEstado`, `ETIQUETA_ESTADO`, `CHIP_UNIDAD`, `ESTADO_UNIDAD`, `fechaMedia`, `miles`, `soles`, `soles2`, `Vacio` (ui); `public/trailer3d.js` expects ids `visor`, `datos-visor`, `btn-izq`, `btn-der`, `btn-girar`, `btn-aislar`, `btn-despiece`, `btn-todo`, `angulo`, `sel-pieza`, `pieza-detalle`, `pieza-nombre`, `pieza-zona`, `pieza-partes`, `pieza-historial`, `pieza-repuestos`, `pieza-id`, `pieza-parte`.
- Produces: core `datosSunatVehiculo(ctx, vehiculoId): Promise<{ configuracionVehicular: string | null; cargaUtilTm: number | null }>`; routes `GET /camiones` (302 to the first truck, keeps `tab, pieza, parte, repuesto, q`), `GET /camiones/:id{[0-9]+}?tab=toca|historial|repuestos|datos&pieza=&parte=&repuesto=&q=`, `GET /camiones/nuevo`; redirects `/trailer`, `/trailer/:id`, `/flota`, `/inventario`, `/reparaciones`.

- [ ] **Step 1: Write the failing tests**

Core (append to `packages/core/test/inicio.test.ts`, add `datosSunatVehiculo` to the import):

```ts
  it("datos SUNAT del vehículo (solo lectura)", async () => {
    expect(await datosSunatVehiculo(ctx, 1)).toEqual({ configuracionVehicular: null, cargaUtilTm: null });
  });
```

Web — in `apps/web/test/web.test.ts`:
- test `"todas las pantallas cargan"`: replace `"/trailer", "/flota", "/inventario", "/reparaciones"` with `"/camiones/1", "/camiones/1?tab=historial", "/camiones/1?tab=repuestos", "/camiones/1?tab=datos", "/camiones/nuevo"`.
- test `"cada pieza del modelo 3D guarda su historial y se ve resaltada"`: change `"/trailer/1?pieza=retrovisor-izq"` (location) to `"/camiones/1?pieza=retrovisor-izq"`, the GET `"/trailer/1?pieza=llanta-sr2-der-ext"` to `"/camiones/1?pieza=llanta-sr2-der-ext"`, the GET `"/reparaciones"` to `"/camiones/1?tab=historial"`, and `expect(rep).toContain("/trailer/1?pieza=llanta-sr2-der-ext")` to `expect(rep).toContain("/camiones/1?pieza=llanta-sr2-der-ext")`.
- test `"cada repuesto dice en qué piezas va y se ve en el 3D"`: change the GET `"/inventario"` to `"/camiones/1?tab=repuestos"`, the two regexes `/href="\/trailer\?repuesto=\d+"/` and `/\/trailer\?repuesto=(\d+)/` to `/href="\/camiones\/1\?repuesto=\d+"/` and `/\/camiones\/1\?repuesto=(\d+)/`, and the GET `` `/trailer/1?repuesto=${id}` `` to `` `/camiones/1?repuesto=${id}` ``.

Add inside `describe("con el dueño configurado", …)`:

```ts
    it("camiones: chips, 3D, pestañas y las rutas viejas redirigen", async () => {
      const cookie = await entrar();
      const r = await app.request("/camiones?tab=datos", { headers: { cookie } });
      expect(r.status).toBe(302);
      expect(r.headers.get("location")).toBe("/camiones/1?tab=datos");
      const html = await (await app.request("/camiones/1", { headers: { cookie } })).text();
      for (const t of ["Mis camiones", "Lo que toca", "Historial", "Repuestos", "Datos", 'id="visor"', 'id="datos-visor"', "+ Nuevo", "bien", "pronto", "cambiar ya"]) expect(html, t).toContain(t);
      const datos = await (await app.request("/camiones/1?tab=datos", { headers: { cookie } })).text();
      for (const t of ["Placa", "ABC-123", "Odómetro", "Configuración vehicular", "Carga útil"]) expect(datos, t).toContain(t);
      const viejas: Record<string, string> = {
        "/trailer": "/camiones", "/trailer/1?pieza=faro-der&ok=x": "/camiones/1?pieza=faro-der", "/flota": "/camiones",
        "/inventario?q=filtro": "/camiones?tab=repuestos&q=filtro", "/reparaciones?unidad=1": "/camiones/1?tab=historial",
      };
      for (const [de, a] of Object.entries(viejas)) {
        const x = await app.request(de, { headers: { cookie } });
        expect(x.status, de).toBe(302);
        expect(x.headers.get("location"), de).toBe(a);
      }
    });

    it("el contador no entra a Camiones", async () => {
      await guardarUsuario(ctx, { nombre: "Conta", email: "conta@demo.pe", rol: "contador", clave: "clave-segura" });
      const conta = await entrar("conta@demo.pe");
      expect((await app.request("/camiones/1", { headers: { cookie: conta } })).headers.get("location")).toContain("/?error=");
    });
```

Run: `pnpm test apps/web/test/web.test.ts packages/core/test/inicio.test.ts -t "camiones|contador no entra|todas las pantallas|pieza del modelo|repuesto dice|datos SUNAT"`
Expected: FAIL — `/camiones/1` answers 404 and `datosSunatVehiculo is not a function`.

- [ ] **Step 2: Create `packages/core/src/consultas/vehiculo.ts`**

```ts
import { eq, vehiculo } from "@sunatapp/db";
import type { Contexto } from "../infra/contexto";

/** Configuración vehicular y carga útil (las carga el plan SUNAT); aquí solo se muestran. */
export async function datosSunatVehiculo(ctx: Contexto, vehiculoId: number): Promise<{ configuracionVehicular: string | null; cargaUtilTm: number | null }> {
  const [f] = await ctx.db.select({ configuracion: vehiculo.configuracionVehicular, carga: vehiculo.cargaUtilTm }).from(vehiculo).where(eq(vehiculo.id, vehiculoId));
  return { configuracionVehicular: f?.configuracion ?? null, cargaUtilTm: f?.carga === null || f?.carga === undefined ? null : Number(f.carga) };
}
```

Append to `packages/core/src/index.ts`:

```ts
export * from "./consultas/vehiculo";
```

- [ ] **Step 3: Create `apps/web/src/paginas/camiones.tsx`**

```tsx
/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import type { FC } from "hono/jsx";
import { raw } from "hono/html";
import {
  CATEGORIAS_REPUESTO, datosSunatVehiculo, GRUPOS_PIEZA, listarCompras, listarReparaciones, listarRepuestos, listarTiposParte, listarUnidades,
  partesDePieza, partesDeUnidad, piezasDeSemirremolque, puedeEditar, repuestosDePieza, TIPOS_REPARACION, TIPOS_SEMIRREMOLQUE, ZONAS,
  type EstadoUnidad, type GrupoPieza, type ParteConDesgaste, type TipoSemirremolque, type Unidad,
} from "@sunatapp/core";
import { pagina, type App, type C, type Deps } from "../base";
import { RUTA } from "../lugares";
import { conParametros } from "../redirecciones";
import {
  Barra, Cabecera, CHIP_UNIDAD, ChipEstado, Datos, ESTADO_UNIDAD, ETIQUETA_ESTADO, fechaCorta, fechaMedia, miles, soles, soles2, Vacio,
} from "../ui";
import { SelectPiezas, textoPiezas } from "./inventario";

const TABS = { toca: "Lo que toca", historial: "Historial", repuestos: "Repuestos", datos: "Datos" } as const;
type Tab = keyof typeof TABS;
const CHIP_REPUESTO: Record<string, string> = { "EN STOCK": "ok", BAJO: "proximo", INSTALADO: "oscuro", AGOTADO: "cambiar" };

function Contador(p: { etiqueta: string; uso: number; vida: number | null; unidad: string; manda: boolean }) {
  if (p.vida === null) return null;
  const r = Math.round((p.uso / p.vida) * 100);
  return (
    <div class={`contador${p.manda ? " manda" : ""}`}>
      <div class="fila-sep"><span class="lbl">{p.etiqueta}{p.manda ? <b class="t-cambiar"> · manda</b> : null}</span><span><b>{miles(p.uso)}</b> / {miles(p.vida)} {p.unidad}</span></div>
      <Barra pct={r} estado={r >= 90 ? "cambiar" : r >= 70 ? "proximo" : "ok"} />
    </div>
  );
}

/** El visor 3D de siempre (mismos ids que espera public/trailer3d.js). */
const Visor: FC<{ unidad: Unidad; piezas: number; sel: ParteConDesgaste | null }> = ({ unidad, piezas, sel }) => (
  <div class="visor" id="visor">
    <canvas role="img" aria-label={`Modelo 3D de ${unidad.codigo}: cada pieza va por separado y su color es el desgaste. Arrastra para girar, pellizca para acercar, toca una pieza para ver su historial.`}></canvas>
    <div class="cab">
      <span class="lbl" style="color:var(--dark-text)"><b>{unidad.codigo} · {TIPOS_SEMIRREMOLQUE[unidad.semirremolque]} · {piezas} piezas</b></span>
      <div class="der">
        <button class="btn chico solo-pc" id="btn-izq" type="button" aria-label="Girar a la izquierda">&lt;</button>
        <button class="btn chico solo-pc" id="btn-der" type="button" aria-label="Girar a la derecha">&gt;</button>
        <button class="btn chico" id="btn-girar" type="button" aria-pressed="false">Girar</button>
        <button class="btn chico" id="btn-aislar" type="button" aria-pressed="false" disabled title="Elige una pieza y mírala sola">Solo esta</button>
        <button class="btn chico solo-pc" id="btn-despiece" type="button" aria-pressed="false">Despiece</button>
        <button class="btn chico" id="btn-todo" type="button">Ver todo</button>
        <span class="lbl solo-pc" style="color:var(--dark-muted)">Ángulo <span id="angulo">0</span>°</span>
      </div>
    </div>
    <div class="etiqueta" hidden>{sel ? <>{sel.nombreCorto} · desgaste <b>{sel.pct}%</b></> : null}</div>
    <div class="pie"><span><i class="d-ok"></i>bien</span><span><i class="d-proximo"></i>pronto</span><span><i class="d-cambiar"></i>cambiar ya</span><span><i style="background:#E9E3D6;opacity:.5"></i>sin control</span></div>
    {raw(`<script>setTimeout(function(){if(!window.__visor3d){var e=document.querySelector("#visor .sin-webgl");if(e)e.hidden=false;}},6000)</script>`)}
    <div class="sin-webgl" hidden>Este navegador no puede mostrar el modelo 3D (actualiza «Android System WebView» o Chrome). Las pestañas de abajo funcionan igual.</div>
  </div>
);

async function vista(c: C, d: Deps) {
  const ctx = d.ctx;
  const u = c.get("usuario");
  const unidades = await listarUnidades(ctx);
  const unidad = unidades.find((x) => x.id === Number(c.req.param("id")));
  if (!unidad) return c.redirect(unidades[0] ? `/camiones/${unidades[0].id}` : "/camiones/nuevo");
  const pedida = c.req.query("tab") ?? "";
  const tab: Tab = pedida in TABS ? (pedida as Tab) : "toca";
  const editaTaller = puedeEditar(u.rol, "reparaciones");
  const editaFlota = puedeEditar(u.rol, "flota");
  const editaInv = puedeEditar(u.rol, "inventario");
  const aqui = `/camiones/${unidad.id}`;
  const [partes, historial, repuestos, tipos, sunat, compras] = await Promise.all([
    partesDeUnidad(ctx, unidad.id), listarReparaciones(ctx, { vehiculoId: unidad.id, limite: 400 }), listarRepuestos(ctx), listarTiposParte(ctx),
    datosSunatVehiculo(ctx, unidad.id), listarCompras(ctx, { limite: 8 }),
  ]);
  const PIEZAS = piezasDeSemirremolque(unidad.semirremolque);
  const piezaSel = PIEZAS.find((p) => p.id === c.req.query("pieza")) ?? null;
  const parteSel = partes.find((p) => p.id === Number(c.req.query("parte"))) ?? null;
  const porPieza: Record<string, Array<{ fecha: string; trabajo: string; tipo: string; km: string; costo: string | null; taller: string | null }>> = {};
  for (const h of historial.filter((x) => x.componente)) {
    (porPieza[h.componente!] ??= []).push({ fecha: fechaMedia(h.fecha), trabajo: h.trabajo, tipo: TIPOS_REPARACION[h.tipo], km: miles(h.odometro), costo: h.costoTotal ? soles2(h.costoTotal) : null, taller: h.taller });
  }
  const partesPieza: Record<string, Array<{ id: number; nombre: string; pct: number; estado: string; url: string }>> = {};
  for (const pz of PIEZAS) {
    const suyas = partesDePieza(pz, partes).sort((a, b) => b.pct - a.pct);
    if (suyas.length) partesPieza[pz.id] = suyas.map((p) => ({ id: p.id, nombre: p.nombre, pct: p.pct, estado: p.estado, url: `${aqui}?parte=${p.id}` }));
  }
  const repuestoVer = repuestos.find((r) => r.id === Number(c.req.query("repuesto"))) ?? null;
  const datosVisor = {
    parteSeleccionada: piezaSel ? null : parteSel?.id ?? partes[0]?.id ?? null,
    piezaSeleccionada: piezaSel?.id ?? null,
    autogiro: false,
    nombresZona: ZONAS,
    piezas: PIEZAS,
    historial: porPieza,
    partesPieza,
    repuestosPieza: Object.fromEntries(PIEZAS.map((pz) => [pz.id, repuestosDePieza(repuestos, pz.id).map((r) => ({ id: r.id, codigo: r.codigo, nombre: r.nombre, stock: r.stock }))]).filter(([, rs]) => rs!.length)),
    resaltar: repuestoVer ? { titulo: `${repuestoVer.codigo} · ${repuestoVer.nombre}`, piezas: repuestoVer.piezas } : null,
  };
  const conHistorial = new Set(Object.keys(porPieza));
  const faltantes = tipos.filter((t) => !partes.some((p) => p.tipoParteId === t.id));
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const filas = q ? repuestos.filter((r) => `${r.codigo} ${r.nombre} ${r.categoria}`.toLowerCase().includes(q)) : repuestos;
  const anotarCambio = (extra: string) => `/anotar?tipo=repare&vehiculoId=${unidad.id}${extra}&volver=${encodeURIComponent(aqui)}`;

  const tabToca = (
    <div class="col">
      {partes.length === 0 ? <div class="lista-filas"><Vacio>Este camión no tiene partes controladas todavía.</Vacio></div> : (
        <div class="lista-filas">
          {partes.map((p) => (
            <div class={`fila-toca${p.id === parteSel?.id ? " sel" : ""}`}>
              <a class="fila-sep" href={`${aqui}?parte=${p.id}`}><span>{p.nombre}</span><b class={`t-${p.estado} mono-t`}>{p.pct}%</b></a>
              <Barra pct={p.pct} estado={p.estado} />
              <div class="fila-sep">
                <span class="muted">{p.viajesRestantes === null ? `Cambiar en ~${p.restanteTexto.toLowerCase()}` : `Quedan ≈ ${p.restanteTexto.toLowerCase()}`}</span>
                {editaTaller ? <a class="btn chico" href={anotarCambio(`&parteId=${p.id}`)} data-abrir-panel="">Registrar un cambio</a> : null}
              </div>
            </div>
          ))}
        </div>
      )}
      {parteSel ? (
        <section class="panel">
          <div class="fila-sep"><b>{parteSel.nombre}</b><ChipEstado estado={parteSel.estado} /></div>
          <span class="muted">Instalada {fechaMedia(parteSel.fechaInstalacion)} · repuesto {parteSel.repuesto?.codigo ?? "—"} · costo {parteSel.costo ? soles2(parteSel.costo) : "—"}</span>
          <Contador etiqueta="Kilómetros" uso={parteSel.uso.km} vida={parteSel.vida.km} unidad="km" manda={parteSel.manda === "km"} />
          <Contador etiqueta="Viajes" uso={parteSel.uso.viajes} vida={parteSel.vida.viajes} unidad="viajes" manda={parteSel.manda === "viajes"} />
          <Contador etiqueta="Días" uso={parteSel.uso.dias} vida={parteSel.vida.dias} unidad="días" manda={parteSel.manda === "dias"} />
          <div class="caja-oscura"><span class="lbl">Cambiar antes de</span><b>{parteSel.restanteTexto}</b><span class="muted">Manda el contador que se cumpla primero · {ETIQUETA_ESTADO[parteSel.estado]}</span></div>
          {editaTaller ? (
            <details class="plegable"><summary class="ver-mas">Ajustar la vida útil de esta parte</summary>
              <form method="post" action={`/parte/${parteSel.id}/vida?volver=${encodeURIComponent(`${aqui}?parte=${parteSel.id}`)}`} class="form-grid sub-form">
                <label class="campo"><span>Km</span><input name="vidaKm" inputmode="numeric" value={parteSel.vida.km ?? ""} /></label>
                <label class="campo"><span>Viajes</span><input name="vidaViajes" inputmode="numeric" value={parteSel.vida.viajes ?? ""} /></label>
                <label class="campo"><span>Días</span><input name="vidaDias" inputmode="numeric" value={parteSel.vida.dias ?? ""} /></label>
                <button class="btn" type="submit">Guardar vida útil</button>
              </form>
            </details>
          ) : null}
        </section>
      ) : null}
      {editaTaller && faltantes.length ? (
        <details class="plegable panel"><summary class="ver-mas">+ Controlar otra parte</summary>
          <form method="post" action={`/trailer/${unidad.id}/instalar`} class="filas">
            <label class="campo"><span>Parte</span><select name="tipoParteId">{faltantes.map((t) => <option value={t.id}>{t.nombre}</option>)}<option value="todas">— Todas las que faltan —</option></select></label>
            <label class="campo"><span>Instalada el</span><input type="date" name="fecha" /></label>
            <label class="campo"><span>Odómetro al instalar (km)</span><input name="km" inputmode="numeric" placeholder={String(unidad.odometroKm)} /></label>
            <label class="campo"><span>Viajes hechos desde entonces</span><input name="viajesDesde" inputmode="numeric" placeholder="0" /></label>
            <button class="btn primario" type="submit">Guardar</button>
          </form>
        </details>
      ) : null}
    </div>
  );

  const tabHistorial = (
    <div class="col">
      <div class="lista-filas">
        {historial.length === 0 ? <Vacio>Todavía no hay reparaciones de este camión.</Vacio> : historial.slice(0, 60).map((h) => (
          <div class="fila-historial">
            <div class="fila-sep"><b>{fechaMedia(h.fecha)}</b><span>{h.costoTotal ? soles2(h.costoTotal) : "sin costo"}</span></div>
            <span>{h.trabajo}</span>
            <span class="muted">{[TIPOS_REPARACION[h.tipo], h.pieza, h.parte, h.taller, h.odometro ? `${miles(h.odometro)} km` : null].filter(Boolean).join(" · ")}</span>
            {h.componente ? <a href={`${aqui}?pieza=${h.componente}`}>Ver en el 3D</a> : null}
          </div>
        ))}
      </div>
      <span class="muted">Total en reparaciones: {soles(historial.reduce((s, h) => s + h.costoTotal, 0))}</span>
    </div>
  );

  const tabRepuestos = (
    <div class="col">
      <form method="get" action={aqui} class="linea filtro">
        <input type="hidden" name="tab" value="repuestos" />
        <input name="q" value={c.req.query("q") ?? ""} placeholder="Buscar repuesto" aria-label="Buscar repuesto" />
        <button class="btn chico" type="submit">Buscar</button>
      </form>
      <div class="lista-filas">
        {filas.length === 0 ? <Vacio>No hay repuestos{q ? " con esa búsqueda" : ""}.</Vacio> : filas.map((r) => (
          <div class="fila-historial">
            <div class="fila-sep"><b>{r.codigo} · {r.nombre}</b><span class={`chip ${CHIP_REPUESTO[r.estado]}`}>{r.estado}</span></div>
            <span class="muted">Hay {r.stock} · costo {soles2(r.costoUnitario)} · {textoPiezas(r.piezas)}</span>
            <div class="acciones">
              <a class="btn chico" href={`${aqui}?repuesto=${r.id}`}>Ver en el 3D</a>
              {editaInv ? <a class="btn chico" href={`/anotar?tipo=repare&modo=compra&repuestoId=${r.id}&volver=${encodeURIComponent(`${aqui}?tab=repuestos`)}`} data-abrir-panel="">Compré más</a> : null}
              {editaInv ? (
                <details class="plegable"><summary class="btn chico fantasma">Editar</summary>
                  <form method="post" action={`/inventario/repuesto/${r.id}`} class="linea sub-form">
                    <input type="hidden" name="volver" value={`${aqui}?tab=repuestos`} />
                    <label class="campo"><span>Avisar si quedan menos de</span><input name="stockMinimo" inputmode="numeric" value={r.stockMinimo} /></label>
                    <button class="btn chico" type="submit">Guardar</button>
                  </form>
                  <form method="post" action={`/inventario/repuesto/${r.id}/piezas`} class="filas sub-form">
                    <input type="hidden" name="volver" value={`${aqui}?tab=repuestos`} />
                    <SelectPiezas elegidas={r.piezasElegidas ? r.piezas : []} />
                    <button class="btn chico" type="submit">Guardar piezas</button>
                  </form>
                </details>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      {compras.length ? (
        <>
          <h3 class="titulo-seccion">Últimas compras</h3>
          <div class="lista-filas">{compras.map((x) => <div class="fila-papel"><span>{fechaCorta(x.fecha)}</span><span>{x.codigo} · {x.nombre} · +{x.cantidad}</span><b>{soles2(x.total)}</b></div>)}</div>
        </>
      ) : null}
      {editaInv ? (
        <details class="plegable panel" id="nuevo-repuesto"><summary class="ver-mas">Ver más · repuesto nuevo</summary>
          <form method="post" action="/inventario/repuesto" class="filas">
            <input type="hidden" name="volver" value={`${aqui}?tab=repuestos`} />
            <label class="campo"><span>Nombre *</span><input name="nombre" required placeholder="Pastillas de freno" /></label>
            <label class="campo"><span>Categoría</span><select name="categoria">{CATEGORIAS_REPUESTO.map((k) => <option value={k}>{k}</option>)}</select></label>
            <label class="campo"><span>Avisar si quedan menos de</span><input name="stockMinimo" inputmode="numeric" placeholder="0" /></label>
            <label class="campo"><span>¿En qué piezas va?</span><SelectPiezas /></label>
            <button class="btn primario" type="submit">Crear repuesto</button>
          </form>
        </details>
      ) : null}
    </div>
  );

  const tabDatos = (
    <div class="col">
      <dl class="datos-camion">
        <div><dt>Placa</dt><dd>{unidad.placa}</dd></div>
        <div><dt>Carreta</dt><dd>{unidad.carreta?.placa ?? "—"}</dd></div>
        <div><dt>Marca y modelo</dt><dd>{[unidad.marca, unidad.modelo, unidad.anio].filter(Boolean).join(" ") || "—"}</dd></div>
        <div><dt>Estado</dt><dd><span class={`chip ${CHIP_UNIDAD[unidad.estado]}`}>{ESTADO_UNIDAD[unidad.estado]}</span></dd></div>
        <div><dt>Odómetro</dt><dd>{miles(unidad.odometroKm)} km</dd></div>
        <div><dt>Viajes hechos</dt><dd>{miles(unidad.viajesTotales)}</dd></div>
        <div><dt>Configuración vehicular</dt><dd>{sunat.configuracionVehicular ?? "—"}</dd></div>
        <div><dt>Carga útil</dt><dd>{sunat.cargaUtilTm !== null ? `${sunat.cargaUtilTm} t` : "—"}</dd></div>
        <div><dt>Rendimiento</dt><dd>{unidad.rendimientoKmGal ? `${unidad.rendimientoKmGal} km/gal` : "—"}</dd></div>
        <div><dt>Semirremolque</dt><dd>{TIPOS_SEMIRREMOLQUE[unidad.semirremolque]}</dd></div>
      </dl>
      {editaFlota ? (
        <form method="post" action={`/flota/${unidad.id}/odometro`} class="linea">
          <label class="campo" style="flex:1"><span>¿Cuánto marca el odómetro hoy?</span><input name="km" inputmode="numeric" required placeholder={String(unidad.odometroKm)} /></label>
          <button class="btn" type="submit">Guardar km</button>
        </form>
      ) : null}
      {editaFlota ? (
        <details class="plegable panel"><summary class="ver-mas">Editar datos del camión</summary>
          <form method="post" action={`/flota/${unidad.id}`} class="form-grid">
            <label class="campo"><span>Estado</span><select name="estado">{(["en_base", "en_ruta", "en_taller", "inactivo"] as EstadoUnidad[]).map((e) => <option value={e} selected={e === unidad.estado}>{ESTADO_UNIDAD[e]}</option>)}</select></label>
            <label class="campo"><span>Marca</span><input name="marca" value={unidad.marca ?? ""} /></label>
            <label class="campo"><span>Modelo</span><input name="modelo" value={unidad.modelo ?? ""} /></label>
            <label class="campo"><span>Año</span><input name="anio" inputmode="numeric" value={unidad.anio ?? ""} /></label>
            <label class="campo"><span>Placa de la carreta</span><input name="placaCarreta" value={unidad.carreta?.placa ?? ""} /></label>
            <label class="campo"><span>Semirremolque</span><select name="semirremolque">{(Object.keys(TIPOS_SEMIRREMOLQUE) as TipoSemirremolque[]).map((t) => <option value={t} selected={t === unidad.semirremolque}>{TIPOS_SEMIRREMOLQUE[t]}</option>)}</select></label>
            <label class="campo"><span>Rendimiento km/gal</span><input name="rendimiento" inputmode="decimal" value={unidad.rendimientoKmGal ?? ""} /></label>
            <button class="btn" type="submit">Guardar</button>
          </form>
        </details>
      ) : null}
      <a class="ver-mas" href={RUTA.catalogoPartes}>Vida útil por defecto de cada parte (Ajustes) →</a>
    </div>
  );

  return pagina(c, d, { titulo: `Camión ${unidad.codigo}`, seccion: "trailer", scripts: ["/static/trailer3d.js"], importmap: true }, (
    <>
      <Datos id="datos-visor" valor={datosVisor} />
      <Cabecera titulo="Mis camiones" sub={`${unidad.placa}${unidad.carreta ? ` + ${unidad.carreta.placa}` : ""} · ${[unidad.marca, unidad.modelo].filter(Boolean).join(" ") || "—"}`} />
      <nav class="segmentos" aria-label="Elige el camión">
        {unidades.map((x) => <a href={`/camiones/${x.id}`} class={x.id === unidad.id ? "activo" : undefined} aria-current={x.id === unidad.id ? "page" : undefined}>{x.codigo}</a>)}
        {editaFlota ? <a href="/camiones/nuevo">+ Nuevo</a> : null}
      </nav>
      <div class="camion-cols">
        <div class="col">
          <Visor unidad={unidad} piezas={PIEZAS.length} sel={parteSel} />
          <section class="panel" id="panel-pieza">
            <label class="campo"><span>Pieza (tócala en el 3D o elígela aquí)</span>
              <select id="sel-pieza">
                <option value="">— elige una pieza —</option>
                {(Object.keys(GRUPOS_PIEZA) as GrupoPieza[]).map((g) => (
                  <optgroup label={GRUPOS_PIEZA[g]}>{PIEZAS.filter((p) => p.grupo === g).map((p) => <option value={p.id} selected={p.id === piezaSel?.id}>{p.nombre}{conHistorial.has(p.id) ? " •" : ""}</option>)}</optgroup>
                ))}
              </select>
            </label>
            <div id="pieza-detalle" class="filas" hidden={!piezaSel}>
              <div><b id="pieza-nombre" class="mono-t">{piezaSel?.nombre ?? ""}</b><br /><span id="pieza-zona" class="muted"></span></div>
              <div id="pieza-partes" class="filas"></div>
              <div id="pieza-repuestos" class="filas"></div>
              <span class="lbl">Historial de esta pieza</span>
              <div id="pieza-historial" class="filas"></div>
              {editaTaller ? (
                <form method="get" action="/anotar" class="filas" data-panel-form="">
                  <input type="hidden" name="tipo" value="repare" />
                  <input type="hidden" name="vehiculoId" value={unidad.id} />
                  <input type="hidden" name="pieza" id="pieza-id" value={piezaSel?.id ?? ""} />
                  <input type="hidden" name="volver" value={aqui} />
                  <label class="campo"><span>¿Reinicia el contador de una parte?</span><select name="parteId" id="pieza-parte"><option value="">— no —</option></select></label>
                  <button class="btn primario" type="submit">Registrar un cambio</button>
                </form>
              ) : null}
            </div>
          </section>
        </div>
        <div class="col">
          <nav class="pestanas" aria-label="Secciones del camión">
            {(Object.keys(TABS) as Tab[]).map((t) => <a href={`${aqui}?tab=${t}`} class={t === tab ? "activo" : undefined} aria-current={t === tab ? "page" : undefined}>{TABS[t]}</a>)}
          </nav>
          {tab === "toca" ? tabToca : tab === "historial" ? tabHistorial : tab === "repuestos" ? tabRepuestos : tabDatos}
        </div>
      </div>
    </>
  ));
}

async function nuevo(c: C, d: Deps) {
  if (!puedeEditar(c.get("usuario").rol, "flota")) return c.redirect("/camiones?error=" + encodeURIComponent("Tu rol no agrega camiones"));
  return pagina(c, d, { titulo: "Nuevo camión", seccion: "trailer" }, (
    <>
      <Cabecera titulo="Nuevo camión" volver="/camiones" />
      <form method="post" action="/flota" class="panel filas">
        <label class="campo"><span>Placa del tracto *</span><input name="placa" required placeholder="ABC-123" /></label>
        <label class="campo"><span>Placa de la carreta</span><input name="placaCarreta" placeholder="XYZ-987" /></label>
        <label class="campo"><span>Semirremolque</span><select name="semirremolque">{(Object.keys(TIPOS_SEMIRREMOLQUE) as TipoSemirremolque[]).map((t) => <option value={t}>{TIPOS_SEMIRREMOLQUE[t]}</option>)}</select></label>
        <label class="campo"><span>Odómetro actual (km)</span><input name="odometro" inputmode="numeric" placeholder="0" /></label>
        <details class="plegable"><summary class="ver-mas">Más datos</summary>
          <div class="form-grid">
            <label class="campo"><span>Marca</span><input name="marca" placeholder="Volvo" /></label>
            <label class="campo"><span>Modelo</span><input name="modelo" placeholder="FH 540" /></label>
            <label class="campo"><span>Año</span><input name="anio" inputmode="numeric" /></label>
            <label class="campo"><span>Viajes ya hechos</span><input name="viajesBase" inputmode="numeric" placeholder="0" /></label>
          </div>
        </details>
        <label class="opcion-fila"><input type="checkbox" name="catalogo" value="1" checked /><span>Controlar todas las partes del catálogo desde hoy</span></label>
        <button class="btn primario guardar" type="submit">AGREGAR CAMIÓN</button>
      </form>
    </>
  ));
}

export function rutasCamiones(app: App, d: Deps): void {
  app.get("/camiones", async (c) => {
    const [primera] = await listarUnidades(d.ctx);
    if (!primera) return c.redirect("/camiones/nuevo");
    return c.redirect(conParametros(`/camiones/${primera.id}`, c.req.query(), ["tab", "pieza", "parte", "repuesto", "q"]), 302);
  });
  app.get("/camiones/nuevo", (c) => nuevo(c as C, d));
  app.get("/camiones/:id{[0-9]+}", (c) => vista(c as C, d));
}
```

- [ ] **Step 4: Trim the old pages and redirect**

`apps/web/src/paginas/trailer.tsx`: delete `Contador` and `vista` (keep `const entero = …`, still used by the `instalar` and `vida` handlers); keep `POST /trailer/:id/instalar`, `POST /trailer/:id/pieza`, `POST /parte/:id/vida`. Replace the two GETs with:

```tsx
  redirigir(app, "/trailer", () => "/camiones", ["pieza", "parte", "repuesto"]);
  redirigir(app, "/trailer/:id{[0-9]+}", (c) => `/camiones/${c.req.param("id")}`, ["pieza", "parte", "repuesto"]);
```

and change the redirect targets: `instalar` → `` `/camiones/${id}?tab=toca` ``; `pieza` → `` p ? `/camiones/${id}?pieza=${p.id}` : `/camiones/${id}` ``; `vida` default → `"/camiones"`. Import `redirigir` from `../redirecciones`.

`apps/web/src/paginas/flota.tsx`: delete `vista` (keep `enteroONull` export). Replace `app.get("/flota", …)` with `redirigir(app, "/flota", () => "/camiones");`. Targets: `POST /flota` → keeps `{ ok, ruta: \`/camiones/${u.id}\` }` and its error route `"/camiones/nuevo"`; `POST /flota/:id` and `/flota/:id/odometro` → `` `/camiones/${c.req.param("id")}?tab=datos` ``.

`apps/web/src/paginas/inventario.tsx`: delete `vidaTexto`, `CHIP_ESTADO`, `vista`; export the helpers (`export function SelectPiezas`, `export function textoPiezas`). Replace `app.get("/inventario", …)` with `redirigir(app, "/inventario", () => "/camiones?tab=repuestos", ["q"]);`. In the four POSTs use `volverA(f.volver, "/camiones?tab=repuestos")` as the route (import `volverA` from `../base`).

`apps/web/src/paginas/reparaciones.tsx`: delete `vista`. Replace the GET with

```tsx
  redirigir(app, "/reparaciones", (c) => (Number(c.req.query("unidad")) ? `/camiones/${Number(c.req.query("unidad"))}?tab=historial` : "/camiones?tab=historial"), ["parte", "pieza"]);
```

and the POST target with `` `/camiones/${Number(f.vehiculoId)}?tab=historial` ``. Delete `apps/web/public/reparaciones.js`.

`apps/web/src/app.tsx`: add `camiones: "trailer"` to the `seccionDeRuta` map, `import { rutasCamiones } from "./paginas/camiones";` and add `rutasCamiones` to the routes list.

`apps/web/src/lugares.ts`: in `RUTA` set

```ts
  camiones: "/camiones",
  camion: (id: number, q = "") => `/camiones/${id}${q}`,
```

- [ ] **Step 5: Camiones styles in `apps/web/public/app.css`** (before the `.sin-gap` block)

```css
/* ── Camiones ── */
.camion-cols { display: flex; flex-direction: column; gap: 12px; }
.pestanas { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border: 1px solid var(--border); border-radius: 6px; overflow: hidden; background: var(--panel); }
.pestanas a { display: flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 4px; font-size: 13px; color: var(--text); text-decoration: none; text-align: center; border-right: 1px solid var(--divider); }
.pestanas a:last-child { border-right: 0; }
.pestanas a.activo { background: var(--dark); color: var(--dark-text); font-weight: 600; }
.fila-toca, .fila-historial { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; border-bottom: 1px solid var(--divider); }
.fila-toca:last-child, .fila-historial:last-child { border-bottom: 0; }
.fila-toca > a.fila-sep { color: var(--text); text-decoration: none; min-height: 32px; align-items: center; }
.fila-toca.sel { background: var(--accent-softer); box-shadow: inset 3px 0 0 var(--accent); }
.datos-camion { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0; margin: 0; background: var(--panel); border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.datos-camion > div { padding: 10px 12px; border-bottom: 1px solid var(--divider); display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.datos-camion dt { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
.datos-camion dd { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
#pieza-detalle .muted, #pieza-detalle span, .hist-pieza { font-size: 12px !important; }
@media (max-width: 899.98px) {
  .visor, .visor canvas { min-height: 300px; height: 300px; }
}
@media (min-width: 900px) {
  .camion-cols { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); gap: 16px; align-items: start; }
}
```

- [ ] **Step 6: Run the tests**

Run: `pnpm test apps/web/test/web.test.ts packages/core/test/inicio.test.ts`
Expected: PASS (new `camiones:` and `contador no entra` cases, the updated 3D/repuesto/pantallas cases, `un error de negocio vuelve con el mensaje`, `el contador no ve la flota ni edita inventario`).

Run: `pnpm typecheck`
Expected: no errors (unused imports in the trimmed files removed).

- [ ] **Step 7: Screenshots**

In `apps/web/scripts/lugares-captura.ts` replace the `camiones` entry with:

```ts
  { nombre: "camion", ruta: "/camiones", espera: 2000 },
  { nombre: "camion-historial", ruta: "/camiones?tab=historial", espera: 2000 },
  { nombre: "camion-repuestos", ruta: "/camiones?tab=repuestos", espera: 2000 },
  { nombre: "camion-datos", ruta: "/camiones?tab=datos", espera: 2000 },
```

Run: `CAPTURAS_ETIQUETA=tarea-8 pnpm capturas camion camion-historial camion-repuestos camion-datos`
Expected: 8 PNGs. `camion-390.png` matches the Camion artboard: "Mis camiones", truck chips + "+ Nuevo", the 3D model with the bien/pronto/cambiar ya legend, 4 tabs, "Lo que toca" rows with % bars and "Registrar un cambio". On 1440 the 3D sits left and the tabs right. `revision.json` clean (the 3D overlay buttons are 44 px tall on the phone).

- [ ] **Step 8: Commit**

```bash
git add -A apps/web/src apps/web/public apps/web/scripts/lugares-captura.ts apps/web/test/web.test.ts packages/core/src/consultas/vehiculo.ts packages/core/src/index.ts packages/core/test/inicio.test.ts
git commit -m "feat(web): Camiones con el 3D al centro y pestañas; flota, inventario y reparaciones redirigen" -m "Claude-Session: https://claude.ai/code/session_012rqk28jac1iV7v2GAJjggW"
```

---

### Task 9: Números + "Ver más" subpages (caja, préstamos, cotizar, rentabilidad, gráficos)

**Files:**
- Create: `apps/web/src/paginas/numeros.tsx`
- Modify: `apps/web/src/paginas/finanzas.tsx` (`vistaCaja`, `vistaPrestamos`, redirect, POST targets), `apps/web/src/paginas/rentabilidad.tsx` (`vista(c, d, parte)`, routes, redirect, POST targets), `apps/web/src/paginas/estadisticas.tsx` (route, form action, header), `apps/web/src/app.tsx` (`seccionDeRuta`: `numeros → finanzas`; register `rutasNumeros`), `apps/web/src/lugares.ts` (`RUTA.numeros`), `apps/web/public/app.css`, `apps/web/scripts/lugares-captura.ts`, `apps/web/test/web.test.ts`

**Interfaces:**
- Consumes: `listarViajesFlota`, `gastosPorCategoria`, `rangoMes`, `mesAnterior`, `hoy`, `resumenFinanciero`, `flujoCaja`, `listarMovimientos`, `deudaPrestamos`, `listarPrestamos`, `reinvertidoEnAnio`, `listarReinversiones`, `puedeEditar` (core); `redirigir`; `Cabecera`, `Cifra`, `Barra`, `Panel`, `mesLargo`, `fechaCorta`, `fechaMedia`, `soles`, `soles2`, `Vacio`, `Origen` (ui).
- Produces: routes `GET /numeros?periodo=mes|pasado|anio`, `GET /numeros/caja?mes=`, `GET /numeros/prestamos`, `GET /numeros/cotizar?pdf=`, `GET /numeros/rentabilidad?vista=&unidad=&desde=&hasta=`, `GET /numeros/graficos?desde=&hasta=`; redirects `/finanzas → /numeros/caja` (keeps `mes`), `/rentabilidad → /numeros/rentabilidad` or `/numeros/cotizar` when `pdf` (keeps `vista, unidad, desde, hasta, pdf`), `/estadisticas → /numeros/graficos` (keeps `desde, hasta`). `/estadisticas.xlsx` and `/cotizacion/:archivo` unchanged.

- [ ] **Step 1: Update and add the tests**

In `apps/web/test/web.test.ts`:
- `"las categorías propias aparecen …"`: change the list to `["/anotar?tipo=gaste", "/rutas", "/numeros/rentabilidad"]`.
- `"rentabilidad: conmutador …"`: change `"/rentabilidad?vista=viaje"` → `"/numeros/rentabilidad?vista=viaje"` and `"/rentabilidad?vista=mes"` → `"/numeros/rentabilidad?vista=mes"`.
- `"estadísticas y Excel con montos numéricos"`: change `"/estadisticas?desde=2026-08-01&hasta=2026-09-30"` → `"/numeros/graficos?desde=2026-08-01&hasta=2026-09-30"`.
- `"el contador no ve la flota ni edita inventario"`: change `expect((await app.request("/finanzas", …)).status).toBe(200)` to use `"/numeros"`.
- `"todas las pantallas cargan"`: replace `"/finanzas", "/rentabilidad"` with `"/numeros", "/numeros?periodo=anio", "/numeros/caja", "/numeros/prestamos", "/numeros/cotizar", "/numeros/rentabilidad", "/numeros/graficos"`.

Add inside `describe("con el dueño configurado", …)`:

```ts
    it("números: qué viaje dejó más, en qué se va la plata y ver más; rutas viejas redirigen", async () => {
      const cookie = await entrar();
      const v = await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Yura", destinoLugar: "Puno", estado: "cerrado", km: 300, flete: 350000, origen: "web" });
      await registrarGasto(ctx, { viajeId: v.id, categoria: "combustible", monto: 64000, origen: "web" });
      const html = await (await app.request("/numeros", { headers: { cookie } })).text();
      for (const t of ["Este mes", "Mes pasado", "Año", "¿Qué viaje dejó más?", "Yura → Puno", "S/ 2,860", "¿En qué se va la plata?", "Combustible", "Caja (entradas y salidas)", "Préstamos y cuotas", "Cotizar un viaje", "Gráficos y Excel para el contador"]) {
        expect(html, t).toContain(t);
      }
      const viejas: Record<string, string> = {
        "/finanzas?mes=2026-08": "/numeros/caja?mes=2026-08", "/rentabilidad?vista=mes": "/numeros/rentabilidad?vista=mes",
        "/rentabilidad?pdf=3": "/numeros/cotizar?pdf=3", "/estadisticas?desde=2026-08-01&hasta=2026-09-30": "/numeros/graficos?desde=2026-08-01&hasta=2026-09-30",
      };
      for (const [de, a] of Object.entries(viejas)) {
        const x = await app.request(de, { headers: { cookie } });
        expect(x.status, de).toBe(302);
        expect(x.headers.get("location"), de).toBe(a);
      }
    });

    it("el taller no entra a Números", async () => {
      await guardarUsuario(ctx, { nombre: "Taller", email: "taller@demo.pe", rol: "taller", clave: "clave-segura" });
      const taller = await entrar("taller@demo.pe");
      expect((await app.request("/numeros", { headers: { cookie: taller } })).headers.get("location")).toContain("/?error=");
    });
```

Run: `pnpm test apps/web/test/web.test.ts -t "números|Números|rentabilidad:|estadísticas|categorías propias|contador no ve|todas las pantallas"`
Expected: FAIL — `/numeros` answers 404.

- [ ] **Step 2: Create `apps/web/src/paginas/numeros.tsx`**

```tsx
/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import { gastosPorCategoria, hoy, listarViajesFlota, mesAnterior, rangoMes } from "@sunatapp/core";
import { pagina, type App, type C, type Deps } from "../base";
import { Barra, Cabecera, fechaCorta, soles, Vacio } from "../ui";

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
                <span class="txt">{v.ruta} <span class="muted">· {fechaCorta(v.fecha)} · {v.unidad}</span></span>
                <b class={v.dejo < 0 ? "t-cambiar" : "t-ok"}>{soles(v.dejo)}</b>
              </a>
            ))}
          </div>
          {ranking.length > 6 ? <a class="ver-mas" href="/numeros/rentabilidad">Ver los {ranking.length} viajes</a> : null}
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
```

- [ ] **Step 3: Caja and Préstamos in `apps/web/src/paginas/finanzas.tsx`**

Imports: add `redirigir` from `../redirecciones`; from `../ui` import `Cabecera, Cifra, fechaCorta, fechaMedia, mesLargo, Origen, Panel, soles, soles2, Vacio`; drop `capturarContexto, describirContexto, listarCategorias, listarUnidades, NOMBRE_MEDIO_PAGO, ultimaUnidadDeUsuario, Kpi, enteroONull` if no longer used. Keep `GraficoFlujo` and `CHIP_MOV`. Replace `vista` with these two views:

```tsx
async function vistaCaja(c: C, d: Deps) {
  const ctx = d.ctx;
  const h = hoy(ctx);
  const pedido = c.req.query("mes") ?? "";
  const mes = /^\d{4}-\d{2}$/.test(pedido) ? pedido : h.slice(0, 7);
  const { desde, hasta } = rangoMes(`${mes}-01`);
  const [fin, flujo, movs] = await Promise.all([resumenFinanciero(ctx, desde, hasta), flujoCaja(ctx, 12), listarMovimientos(ctx, desde, hasta, 200)]);
  const edita = puedeEditar(c.get("usuario").rol, "finanzas");
  return pagina(c, d, { titulo: "Caja", seccion: "finanzas" }, (
    <>
      <Cabecera volver="/numeros" titulo="Caja" sub={`Entradas y salidas de ${mesLargo(mes)}`} der={
        <form method="get" action="/numeros/caja" class="linea filtro"><input type="month" name="mes" value={mes} aria-label="Mes" /><button class="btn chico" type="submit">Ver</button></form>
      } />
      <div class="tres-cifras">
        <Cifra etiqueta="Entró" valor={soles(fin.ingresos)} tono="ok" />
        <Cifra etiqueta="Salió" valor={soles(fin.gastos)} sub={`del viaje ${soles(fin.gastosVariables)} · del mes ${soles(fin.gastosFijos)}`} />
        <Cifra etiqueta="Te quedó" valor={soles(fin.ganancia)} tono={fin.ganancia < 0 ? "cambiar" : undefined} sub={fin.margenPct !== null ? `margen ${fin.margenPct}%` : undefined} />
      </div>
      <Panel titulo="Flujo de caja · 12 semanas" der={<span class="leyenda"><span><i style="background:#2D5B7A"></i>arriba entra</span><span><i style="background:#B8236E"></i>abajo sale</span></span>}>
        <GraficoFlujo semanas={flujo} />
      </Panel>
      <Panel titulo={`Movimientos · ${movs.length}`}>
        <div class="tabla-wrap">
          <table class="t">
            <thead><tr><th>Fecha</th><th>Qué</th><th>Detalle</th><th>Camión</th><th class="num">Monto</th><th>De</th>{edita ? <th></th> : null}</tr></thead>
            <tbody>
              {movs.length === 0 ? <tr><td colspan={7}><Vacio>Sin movimientos en {mesLargo(mes)}.</Vacio></td></tr> : movs.map((m) => (
                <tr>
                  <td class="nowrap">{fechaCorta(m.fecha)}</td>
                  <td><span class={`chip ${CHIP_MOV[m.tipo]}`}>{m.tipo}</span></td>
                  <td>{m.detalle}</td><td>{m.unidad}</td>
                  <td class={`num ${m.monto < 0 ? "t-cambiar" : "t-ok"}`}>{m.monto < 0 ? "−" : "+"}{soles2(Math.abs(m.monto))}</td>
                  <td><Origen origen={m.origen} /></td>
                  {edita ? (
                    <td class="nowrap">
                      {m.ref.entidad === "gasto" ? <a href={`/archivo/gasto/${m.ref.id}`} title="Ver el voucher">📷</a> : null}
                      {m.ref.entidad === "gasto" ? (
                        <form method="post" action={`/finanzas/gasto/${m.ref.id}/borrar`} style="display:inline" data-confirmar="¿Borrar este gasto?">
                          <button class="btn chico" type="submit" aria-label="Borrar gasto">×</button>
                        </form>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  ));
}

async function vistaPrestamos(c: C, d: Deps) {
  const ctx = d.ctx;
  const anio = hoy(ctx).slice(0, 4);
  const [deuda, prestamos, reinv, reinversiones] = await Promise.all([deudaPrestamos(ctx), listarPrestamos(ctx), reinvertidoEnAnio(ctx, anio), listarReinversiones(ctx, anio)]);
  const edita = puedeEditar(c.get("usuario").rol, "finanzas");
  return pagina(c, d, { titulo: "Préstamos y cuotas", seccion: "finanzas" }, (
    <>
      <Cabecera volver="/numeros" titulo="Préstamos y cuotas" der={edita ? <a class="btn primario chico" href="/anotar?tipo=prestamo&modo=nuevo&volver=%2Fnumeros%2Fprestamos" data-abrir-panel="">+ Préstamo nuevo</a> : null} />
      <div class="dos-cifras">
        <Cifra etiqueta="Debes en préstamos" valor={soles(deuda)} tono={deuda > 0 ? "cambiar" : undefined} />
        <Cifra etiqueta={`Reinvertido en ${anio}`} valor={soles(reinv)} />
      </div>
      <Panel titulo="Préstamos">
        {prestamos.length === 0 ? <Vacio>Sin préstamos activos.</Vacio> : prestamos.map((p) => (
          <div class="filas" style="border-bottom:1px solid var(--divider);padding-bottom:10px">
            <div class="fila-sep"><b>{p.entidad}</b><span class="muted">TEA {p.tasaAnual}%</span></div>
            <div><b class="mono-t" style="font-size:18px">{soles(p.saldo)}</b> <span class="lbl">por pagar</span></div>
            <div class="tira" aria-label={`${p.pagadas} de ${p.total} cuotas pagadas`}>{p.cuotas.map((q) => <i style={`width:8px;height:14px;background:${q.pagada ? "var(--accent)" : "var(--divider)"}`} title={`Cuota ${q.numero} · ${q.vencimiento} · ${soles2(q.monto)}`}></i>)}</div>
            <div class="fila-sep"><span>{p.pagadas} de {p.total} cuotas</span><span>Próxima {p.proxima ? `${fechaMedia(p.proxima.vencimiento)} · ${soles2(p.proxima.monto)}` : "—"}</span></div>
            {edita && p.proxima ? (
              <form method="post" action={`/finanzas/prestamo/${p.id}/pagar`} data-confirmar={`¿Registrar el pago de la cuota de ${soles2(p.proxima.monto)}?`}>
                <button class="btn chico" type="submit">Pagar cuota</button>
              </form>
            ) : null}
          </div>
        ))}
      </Panel>
      <Panel titulo={`Reinversiones ${anio}`}>
        {reinversiones.length === 0 ? <Vacio>Sin reinversiones este año.</Vacio> : (
          <div class="filas">{reinversiones.map((r) => <div class="fila-sep"><span>{r.r.concepto}{r.codigo ? <span class="muted"> · {r.codigo}</span> : null}</span><b>{soles(r.r.monto)}</b></div>)}</div>
        )}
      </Panel>
    </>
  ));
}
```

In `rutasFinanzas` replace `app.get("/finanzas", …)` with:

```tsx
  app.get("/numeros/caja", (c) => vistaCaja(c as C, d));
  app.get("/numeros/prestamos", (c) => vistaPrestamos(c as C, d));
  redirigir(app, "/finanzas", () => "/numeros/caja", ["mes"]);
```

Redirect targets: `/finanzas/gasto`, `/finanzas/gasto/:id/borrar`, `/finanzas/ingreso` → `"/numeros/caja"`; `/finanzas/reinversion`, `/finanzas/prestamo`, `/finanzas/prestamo/:id/pagar` → `"/numeros/prestamos"`.

- [ ] **Step 4: Rentabilidad and Cotizar in `apps/web/src/paginas/rentabilidad.tsx`**

Change the signature to `async function vista(c: C, d: Deps, parte: "rentabilidad" | "cotizar")`, the `enlace` helper to build `` `/numeros/rentabilidad?vista=${v}&desde=${desdeMes}&hasta=${hastaMes}${unidadSel ? `&unidad=${unidadSel}` : ""}` `` and the panel's `<form method="get" action="/rentabilidad"` to `action="/numeros/rentabilidad"`. Then split the current JSX of the `return pagina(…)` call (lines 60–207 of today's file) into two constants by **cutting these exact line ranges, unchanged**:

| Constant | Lines (current file) | What they are |
|---|---|---|
| `bloqueRentabilidad` | 62–102 | `<Panel titulo="RENTABILIDAD" …>` (por viaje / por mes) |
| `bloqueRentabilidad` | 152–163 | `<Panel titulo="RENTABILIDAD · POR TRAILER, ESTE MES">` |
| `bloqueRentabilidad` | 164–182 | `<div class="grid g-2">` with PROYECCIÓN and PRESUPUESTO VS REAL |
| `bloqueRentabilidad` | 195–202 | `<Panel titulo="PRESUPUESTO MENSUAL POR CATEGORÍA" id="presupuesto">`, wrapped in `{edita ? ( … ) : null}` |
| `bloqueCotizar` | 103–106 | `<Datos id="datos-coti" …/>` and the «Presupuesto listo» aviso |
| `bloqueCotizar` | 108–149 | `<Panel titulo="COTIZADOR DE FLETE · PRESUPUESTO AL INSTANTE" …>` |
| `bloqueCotizar` | 185–194 | `<Panel titulo="PARÁMETROS DEL COTIZADOR">`, wrapped in `{edita ? ( … ) : null}` |

Lines 107, 150–151, 183–184 and 203–206 (the old wrappers `grid g-coti`, `filas`, the second `grid g-2` and their closings) are deleted. The result is:

```tsx
  const bloqueRentabilidad = (
    <>
      {/* líneas 62–102, 152–163, 164–182 y {edita ? (líneas 195–202) : null}, en ese orden */}
    </>
  );
  const bloqueCotizar = (
    <>
      {/* líneas 103–106, 108–149 y {edita ? (líneas 185–194) : null}, en ese orden */}
    </>
  );
  return pagina(c, d, {
    titulo: parte === "cotizar" ? "Cotizar un viaje" : "Rentabilidad detallada", seccion: "rentabilidad",
    scripts: parte === "cotizar" ? ["/static/cotizador.js"] : undefined,
  }, (
    <>
      <Cabecera volver="/numeros" titulo={parte === "cotizar" ? "Cotizar un viaje" : "Rentabilidad detallada"} />
      <div class="filas">{parte === "cotizar" ? bloqueCotizar : bloqueRentabilidad}</div>
    </>
  ));
```

(the two comment lines mark where the cut lines go; after pasting, no comment remains). Import `Cabecera` from `../ui` and `redirigir` from `../redirecciones`. Replace `app.get("/rentabilidad", …)` with:

```tsx
  app.get("/numeros/rentabilidad", (c) => vista(c as C, d, "rentabilidad"));
  app.get("/numeros/cotizar", (c) => vista(c as C, d, "cotizar"));
  redirigir(app, "/rentabilidad", (c) => (c.req.query("pdf") ? "/numeros/cotizar" : "/numeros/rentabilidad"), ["vista", "unidad", "desde", "hasta", "pdf"]);
```

POST targets: `/rentabilidad/cotizacion` → `accion(c, "/numeros/cotizar", …)` and `ruta: \`/numeros/cotizar?pdf=${id}\``; `/rentabilidad/parametros` → `"/numeros/cotizar"`; `/rentabilidad/presupuesto` → `"/numeros/rentabilidad"`.

- [ ] **Step 5: Gráficos in `apps/web/src/paginas/estadisticas.tsx`**

In `rutasEstadisticas` change `app.get("/estadisticas", …)` to `app.get("/numeros/graficos", …)` and add `redirigir(app, "/estadisticas", () => "/numeros/graficos", ["desde", "hasta"]);` (import from `../redirecciones`). In `vista`, replace the first `<section class="panel" …>…</section>` with:

```tsx
      <Cabecera volver="/numeros" titulo="Gráficos y Excel" sub="Para el contador" der={
        <form method="get" action="/numeros/graficos" class="linea filtro">
          <input type="date" name="desde" value={desde} aria-label="Desde" />
          <input type="date" name="hasta" value={hasta} aria-label="Hasta" />
          <button class="btn chico" type="submit">Ver</button>
          <a class="btn primario chico" href={`/estadisticas.xlsx?desde=${desde}&hasta=${hasta}`}>⬇ Excel</a>
        </form>
      } />
```

(import `Cabecera` from `../ui`).

- [ ] **Step 6: Wire up**

`apps/web/src/app.tsx`: add `numeros: "finanzas"` to the `seccionDeRuta` map; import and register `rutasNumeros`. `apps/web/src/lugares.ts`: `numeros: "/numeros",` in `RUTA`.

Append to `apps/web/public/app.css` (before `.sin-gap`):

```css
/* ── Números ── */
.numeros-cols { display: flex; flex-direction: column; gap: 12px; }
@media (min-width: 900px) {
  .numeros-cols { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; }
}
```

- [ ] **Step 7: Run the tests**

Run: `pnpm test apps/web/test/web.test.ts`
Expected: PASS (new cases + `el cotizador genera el PDF del presupuesto`, whose location `/numeros/cotizar?pdf=1&ok=…` still contains `pdf=1`).

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 8: Screenshots**

In `apps/web/scripts/lugares-captura.ts` replace the `numeros` entry with:

```ts
  { nombre: "numeros", ruta: "/numeros" },
  { nombre: "numeros-caja", ruta: "/numeros/caja" },
  { nombre: "numeros-prestamos", ruta: "/numeros/prestamos" },
  { nombre: "numeros-cotizar", ruta: "/numeros/cotizar" },
  { nombre: "numeros-rentabilidad", ruta: "/numeros/rentabilidad" },
  { nombre: "numeros-graficos", ruta: "/numeros/graficos" },
```

Run: `CAPTURAS_ETIQUETA=tarea-9 pnpm capturas numeros numeros-caja numeros-prestamos numeros-cotizar numeros-rentabilidad numeros-graficos`
Expected: 12 PNGs. `numeros-390.png` matches the Numeros artboard (period segments, "¿Qué viaje dejó más?" list, "¿En qué se va la plata?" bars, "Ver más" list). Tables on the subpages scroll inside `.tabla-wrap` (page width stays 390 in `revision.json`).

- [ ] **Step 9: Commit**

```bash
git add apps/web/src apps/web/public/app.css apps/web/scripts/lugares-captura.ts apps/web/test/web.test.ts
git commit -m "feat(web): Números con el viaje que más dejó, en qué se va la plata y Ver más" -m "Claude-Session: https://claude.ai/code/session_012rqk28jac1iV7v2GAJjggW"
```

---

### Task 10: Ajustes hub — big cards that open each settings page (rutas, Telegram, sincronizar, dispositivo included)

**Files:**
- Modify: `apps/web/src/paginas/ajustes.tsx` (hub + 5 subpages, POST targets), `apps/web/src/app.tsx` (`seccionDeRuta("/ajustes")` → `null`), `apps/web/src/lugares.ts` (`veAjustes` → everyone, `RUTA.catalogoPartes`), `apps/web/src/paginas/rutas.tsx`, `telegram.tsx`, `sincronizar.tsx`, `dispositivo.tsx` (header "volver a Ajustes", `lugar: "ajustes"`), `apps/web/public/app.css`, `apps/web/scripts/lugares-captura.ts`, `apps/web/test/web.test.ts`

**Interfaces:**
- Consumes: `listarUsuarios`, `listarTiposParte`, `listarCategorias`, `listarCostosFijos`, `listarUnidades`, `NOMBRE_ROL`, `puedeVer` (core); `empresaActual`, `Deps.servicios.estado()`, `Deps.cabecera()` (base); `Cabecera` (ui).
- Produces: `GET /ajustes` (hub for every logged role, cards filtered with `puedeVer`), `GET /ajustes/:sub{empresa|usuarios|costos-fijos|categorias|partes}` (section `ajustes` = dueño only); POST targets `/ajustes/empresa → /ajustes/empresa`, `/ajustes/usuario* → /ajustes/usuarios`, `/ajustes/parte* → /ajustes/partes`, `/ajustes/categoria* → /ajustes/categorias`, `/ajustes/costo-fijo* → /ajustes/costos-fijos`.

- [ ] **Step 1: Update and add the tests**

In `apps/web/test/web.test.ts`, test `"ajustes: crear categoría y costo fijo; por revisar muestra viajes sin guía"`: replace

```ts
      const html = await (await app.request("/ajustes", { headers: { cookie } })).text();
      expect(html).toContain("Guardianía");
      expect(html).toContain("Sueldo T-01");
```

with

```ts
      expect(await (await app.request("/ajustes/categorias", { headers: { cookie } })).text()).toContain("Guardianía");
      expect(await (await app.request("/ajustes/costos-fijos", { headers: { cookie } })).text()).toContain("Sueldo T-01");
```

and change the two `expect((await post(…)).status).toBe(303)` lines into location checks:

```ts
      expect((await post(cookie, "/ajustes/categoria", { nombre: "Guardianía", tipo: "variable" })).headers.get("location")).toMatch(/^\/ajustes\/categorias\?ok=/);
      expect((await post(cookie, "/ajustes/costo-fijo", { concepto: "Sueldo T-01", categoria: "sueldo_chofer", monto: "2500", periodicidad: "mensual", vehiculoId: "1", desde: "2026-09-01" })).headers.get("location")).toMatch(/^\/ajustes\/costos-fijos\?ok=/);
```

In `"todas las pantallas cargan"` add `"/ajustes/empresa", "/ajustes/usuarios", "/ajustes/costos-fijos", "/ajustes/categorias", "/ajustes/partes", "/rutas", "/sincronizar"`.

Add inside `describe("con el dueño configurado", …)`:

```ts
    it("ajustes: hub con tarjetas según el rol", async () => {
      const cookie = await entrar();
      const html = await (await app.request("/ajustes", { headers: { cookie } })).text();
      for (const t of ["Empresa", "Usuarios", "Costos fijos", "Categorías", "Rutas y presupuestos", "Catálogo de partes", "Telegram", "Sincronizar", "Este dispositivo y SUNAT", "Salir"]) expect(html, t).toContain(t);
      await guardarUsuario(ctx, { nombre: "Conta", email: "conta@demo.pe", rol: "contador", clave: "clave-segura" });
      const conta = await entrar("conta@demo.pe");
      const hub = await (await app.request("/ajustes", { headers: { cookie: conta } })).text();
      expect(hub).toContain("Rutas y presupuestos");
      expect(hub).toContain("Sincronizar");
      expect(hub).not.toContain('href="/ajustes/usuarios"');
      expect((await app.request("/ajustes/usuarios", { headers: { cookie: conta } })).headers.get("location")).toContain("/?error=");
      await guardarUsuario(ctx, { nombre: "Taller", email: "taller@demo.pe", rol: "taller", clave: "clave-segura" });
      const taller = await (await app.request("/ajustes", { headers: { cookie: await entrar("taller@demo.pe") } })).text();
      expect(taller).toContain("Telegram");
      expect(taller).not.toContain("Rutas y presupuestos");
    });
```

Run: `pnpm test apps/web/test/web.test.ts -t "ajustes|todas las pantallas|datos de la empresa"`
Expected: FAIL — `/ajustes/categorias` answers 404 and the contador's `/ajustes` redirects.

- [ ] **Step 2: Split `apps/web/src/paginas/ajustes.tsx`**

Add `import type { Child } from "hono/jsx";`, add `puedeVer` to the core import and `Cabecera` to the ui import. Replace `async function vista …` (lines 12–165 of today's file) with the code below. Today's five `<Panel …>…</Panel>` elements are **cut unchanged** into five functions, each being `return (` + the cut lines + `);` after the destructuring line shown:

| Function | Lines cut from today's `ajustes.tsx` |
|---|---|
| `PanelUsuarios` | 29–66 (`<Panel titulo="USUARIOS Y ROLES">`) |
| `PanelEmpresa` | 67–84 (`<Panel titulo="EMPRESA" id="empresa" …>`) |
| `PanelCostosFijos` | 86–115 (`<Panel titulo="COSTOS FIJOS · …">`) |
| `PanelCategorias` | 116–132 (`<Panel titulo="CATEGORÍAS DE GASTO" …>`) |
| `PanelPartes` | 133–162 (`<Panel titulo="CATÁLOGO DE PARTES · …">`) |

Lines 21–27 (the old «ESTE DISPOSITIVO» link, now a hub card), 28 and 85 (the `grid g-lado` wrapper) are deleted.

```tsx
async function cargar(c: C, d: Deps) {
  const ctx = d.ctx;
  const [usuarios, tipos, emp, categorias, fijos, unidades] = await Promise.all([
    listarUsuarios(ctx), listarTiposParte(ctx, true), empresaActual(ctx), listarCategorias(ctx), listarCostosFijos(ctx, false), listarUnidades(ctx),
  ]);
  return { usuarios, tipos, emp, categorias, fijos, unidades, yo: c.get("usuario"), d };
}
type DatosAjustes = Awaited<ReturnType<typeof cargar>>;

function PanelUsuarios(x: DatosAjustes): Child {
  const { usuarios, yo } = x;
  return (
    // líneas 29–66 de hoy
  );
}
function PanelEmpresa(x: DatosAjustes): Child {
  const { emp, d } = x;
  return (
    // líneas 67–84 de hoy
  );
}
function PanelCostosFijos(x: DatosAjustes): Child {
  const { fijos, categorias, unidades } = x;
  return (
    // líneas 86–115 de hoy
  );
}
function PanelCategorias(x: DatosAjustes): Child {
  const { categorias } = x;
  return (
    // líneas 116–132 de hoy
  );
}
function PanelPartes(x: DatosAjustes): Child {
  const { tipos } = x;
  return (
    // líneas 133–162 de hoy
  );
}
```

(each `// líneas …` line is replaced by those lines; if `pnpm typecheck` reports a name the cut JSX uses that is not in the destructuring line — for example `yo` unused or `ROLES` — add or remove it there; `ROLES`, `ZONAS`, `NOMBRE_ROL`, `nombreCategoria`, `soles2`, `miles` stay module-level imports). Then add:

```tsx
const SUBPAGINAS: Record<string, { titulo: string; panel: (x: DatosAjustes) => Child }> = {
  empresa: { titulo: "Empresa", panel: PanelEmpresa },
  usuarios: { titulo: "Usuarios", panel: PanelUsuarios },
  "costos-fijos": { titulo: "Costos fijos", panel: PanelCostosFijos },
  categorias: { titulo: "Categorías de gasto", panel: PanelCategorias },
  partes: { titulo: "Catálogo de partes", panel: PanelPartes },
};
type Sub = "empresa" | "usuarios" | "costos-fijos" | "categorias" | "partes";

async function subpagina(c: C, d: Deps, sub: Sub) {
  const s = SUBPAGINAS[sub]!;
  return pagina(c, d, { titulo: s.titulo, seccion: "ajustes" }, (
    <>
      <Cabecera titulo={s.titulo} volver="/ajustes" />
      {s.panel(await cargar(c, d))}
    </>
  ));
}

const BOT: Record<string, string> = { sin_token: "apagado", conectando: "conectando", en_linea: "en línea", error: "no conecta", esperando_datos: "esperando datos" };

async function hub(c: C, d: Deps) {
  const u = c.get("usuario");
  const [emp, cab] = await Promise.all([empresaActual(d.ctx), d.cabecera()]);
  const e = d.servicios?.estado();
  const dueno = puedeVer(u.rol, "ajustes");
  const tarjetas = [
    { href: "/ajustes/empresa", titulo: "Empresa", sub: emp?.razonSocial ?? "Falta completar: se pide al emitir guías y facturas", ve: dueno },
    { href: "/ajustes/usuarios", titulo: "Usuarios", sub: "Quién entra y qué puede hacer", ve: dueno },
    { href: "/ajustes/costos-fijos", titulo: "Costos fijos", sub: "Sueldos, SOAT, cuotas: se cargan solos cada mes", ve: dueno },
    { href: "/ajustes/categorias", titulo: "Categorías", sub: "En qué se gasta: del viaje o del mes", ve: dueno },
    { href: "/rutas", titulo: "Rutas y presupuestos", sub: "Cuánto debería costar cada ruta", ve: puedeVer(u.rol, "viajes") },
    { href: "/ajustes/partes", titulo: "Catálogo de partes", sub: "Vida útil de llantas, frenos, aceite…", ve: dueno },
    { href: "/telegram", titulo: "Telegram", sub: cab.botEnLinea ? "El bot está en línea" : "El bot está desconectado", ve: puedeVer(u.rol, "telegram") },
    { href: "/sincronizar", titulo: "Sincronizar", sub: "Otros celulares y PCs con los mismos datos", ve: puedeVer(u.rol, "sincronizar") },
    { href: "/ajustes/dispositivo", titulo: "Este dispositivo y SUNAT", sub: e ? `Bot: ${BOT[e.bot.estado]} · SUNAT: ${e.sunat.modo}${e.sunat.error ? " (con aviso)" : ""}` : "Token del bot, modo SUNAT, clave SOL y certificado", ve: dueno },
  ].filter((t) => t.ve);
  return pagina(c, d, { titulo: "Ajustes", seccion: "ajustes" }, (
    <>
      <Cabecera titulo="Ajustes" volver="/" />
      <div class="hub">
        {tarjetas.map((t) => <a class="tarjeta-hub" href={t.href}><b>{t.titulo}</b><span class="muted">{t.sub}</span><span class="flecha" aria-hidden="true">›</span></a>)}
      </div>
      <section class="panel">
        <div class="fila-sep">
          <span>Entraste como <b>{u.nombre}</b> · {NOMBRE_ROL[u.rol]}</span>
          <div class="acciones">
            <button type="button" class="btn chico primario" id="instalar-app" hidden>Instalar app</button>
            <form method="post" action="/salir"><button class="btn" type="submit">Salir</button></form>
          </div>
        </div>
      </section>
    </>
  ));
}
```

In `rutasAjustes` replace `app.get("/ajustes", …)` with:

```tsx
  app.get("/ajustes", (c) => hub(c as C, d));
  app.get("/ajustes/:sub{empresa|usuarios|costos-fijos|categorias|partes}", (c) => subpagina(c as C, d, c.req.param("sub") as Sub));
```

and change the `accion(c, "/ajustes", …)` targets: `guardar` (usuarios) → `"/ajustes/usuarios"`; `/ajustes/empresa` → `"/ajustes/empresa"`; `guardarParte` → `"/ajustes/partes"`; `/ajustes/categoria` and `/ajustes/categoria/:clave/desactivar` → `"/ajustes/categorias"`; `/ajustes/costo-fijo` and `/ajustes/costo-fijo/:id` → `"/ajustes/costos-fijos"`.

- [ ] **Step 3: Open the hub to every role**

`apps/web/src/app.tsx` — first line of `seccionDeRuta`:

```ts
  if (ruta === "/ajustes" || ruta === "/ajustes/") return null; // el hub lo ven todos; filtra sus tarjetas
```

`apps/web/src/lugares.ts`:

```ts
/** El hub de Ajustes lo ven todos (cada tarjeta se filtra por rol). */
export const veAjustes = (_rol: RolUsuario): boolean => true;
```

and in `RUTA`: `catalogoPartes: "/ajustes/partes",`.

- [ ] **Step 4: "Volver a Ajustes" on the absorbed pages**

- `rutas.tsx`: call `pagina(c, d, { titulo: "Rutas y presupuestos", seccion: "viajes", lugar: "ajustes" }, …)` and replace its first `<section class="panel" …>…</section>` (the «← VIAJES» bar, 5 lines) with
  ```tsx
      <Cabecera titulo="Rutas y presupuestos" volver="/ajustes" sub="Cada viaje nuevo copia la plantilla de su ruta; al lado va el promedio real de los últimos 5 viajes." />
  ```
- `telegram.tsx`: wrap the body: `(` `<>` `<Cabecera titulo="Telegram" volver="/ajustes" />` `<div class="grid g-tg">` … `</div>` `</>` `)` (the opening `<div class="grid g-tg">` is line 29, its closing `</div>` line 69).
- `sincronizar.tsx`: insert `<Cabecera titulo="Sincronizar" volver="/ajustes" />` as the first child of its fragment (after line 27 `<>`).
- `dispositivo.tsx`: insert `<Cabecera titulo="Este dispositivo y SUNAT" volver="/ajustes" />` as the first child of the fragment of the second `pagina` call (after line 52 `<>`), and wrap the first call's `<Panel …>` as `<><Cabecera titulo="Este dispositivo y SUNAT" volver="/ajustes" /><Panel …>…</Panel></>`.

Import `Cabecera` from `../ui` in the four files.

- [ ] **Step 5: Hub styles in `apps/web/public/app.css`** (before `.sin-gap`)

```css
/* ── Ajustes ── */
.hub { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; }
.tarjeta-hub { position: relative; display: flex; flex-direction: column; gap: 4px; min-height: 72px; padding: 14px 36px 14px 16px; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; color: var(--text); text-decoration: none; }
.tarjeta-hub b { font-family: var(--f-title); font-size: 16px; }
.tarjeta-hub .flecha { position: absolute; right: 14px; top: 50%; transform: translateY(-50%); color: var(--muted); font-size: 22px; }
.tarjeta-hub:hover { border-color: var(--accent); color: var(--text); }
@media (min-width: 900px) {
  .hub { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
  .tarjeta-hub { min-height: 110px; }
}
```

- [ ] **Step 6: Run the tests**

Run: `pnpm test apps/web/test/web.test.ts`
Expected: PASS — including `los datos de la empresa se completan y corrigen desde Ajustes` (the hub card shows the razón social `TRANSPORTES NUEVOS SAC`) and `entrada directa … /ajustes` = 200.

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 7: Screenshots**

In `apps/web/scripts/lugares-captura.ts` replace the `ajustes` entry with:

```ts
  { nombre: "ajustes", ruta: "/ajustes" },
  { nombre: "ajustes-empresa", ruta: "/ajustes/empresa" },
  { nombre: "ajustes-usuarios", ruta: "/ajustes/usuarios" },
  { nombre: "ajustes-costos-fijos", ruta: "/ajustes/costos-fijos" },
  { nombre: "rutas", ruta: "/rutas" },
  { nombre: "telegram", ruta: "/telegram" },
  { nombre: "sincronizar", ruta: "/sincronizar" },
  { nombre: "dispositivo", ruta: "/ajustes/dispositivo" },
```

Run: `CAPTURAS_ETIQUETA=tarea-10 pnpm capturas ajustes ajustes-empresa ajustes-usuarios ajustes-costos-fijos rutas telegram sincronizar dispositivo`
Expected: 16 PNGs. `ajustes-390.png`: one column of big cards + "Entraste como … · Salir"; `ajustes-1440.png`: 3 columns. Wide tables (usuarios, costos fijos, catálogo) scroll inside `.tabla-wrap`; `revision.json` → `anchoPagina` ≤ 390 on all (fix any inline `min-width` that overflows by moving it into the scroll box).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src apps/web/public/app.css apps/web/scripts/lugares-captura.ts apps/web/test/web.test.ts
git commit -m "feat(web): Ajustes como hub de tarjetas con rutas, Telegram, sincronizar y este dispositivo" -m "Claude-Session: https://claude.ai/code/session_012rqk28jac1iV7v2GAJjggW"
```

---

### Task 11: /revisar → Inicio "Necesita tu atención" + Anotar precargado con lo que llegó por Telegram

**Files:**
- Modify: `apps/web/src/paginas/revisar.tsx` (remove view, GET redirect, export `valoresLectura`, POST targets and `categoriaOtra`), `apps/web/src/paginas/dashboard.tsx` (`/?ver=atencion` full list with "gastos sin viaje"), `apps/web/src/paginas/anotar.tsx` (document mode `?documento=`), `apps/web/src/lugares.ts` (`RUTA.revisar`), `apps/web/scripts/lugares-captura.ts`, `apps/web/test/web.test.ts`

**Interfaces:**
- Consumes: `listarPorRevisar`, `gastosSinViaje`, `viajesPorRevisar`, `listarViajesFlota`, `listarCategorias`, `nombreCategoria`, `fijarLectura`, `confirmarLectura`, `descartarLectura`, `asignarViajeGasto`, `type Lectura`, `type ItemPorRevisar` (core); `PartesForm`, `urlAnotar` (anotar.tsx).
- Produces: `valoresLectura(l)` exported from revisar.tsx; `GET /revisar` → 302 `/?ver=atencion`; `GET /?ver=atencion` (full list: mensajes, viajes y guías, gastos sin viaje with inline «Asignar»); `GET /anotar?documento=<id>[&tipo=gaste|chofer]` (form posting to the existing `POST /revisar/:id` with `tipo=gasto|entrega`, `categoria`/`categoriaOtra`, `monto`, `medio`, `vehiculoId`, `nota`, `volver`); `POST /revisar/:id`, `/revisar/:id/descartar`, `/revisar/gasto/:id` return to `/?ver=atencion` (or `volver`).

- [ ] **Step 1: Update the tests**

Replace the body of `"por revisar: guardar desde la web un mensaje que no se pudo leer"` with:

```ts
      const cookie = await entrar();
      const { recibirMensaje, leerDocumento, crearLectorReglas } = await import("./ayuda-revisar");
      ctx.ia = crearLectorReglas();
      const m = await recibirMensaje(ctx, { tipo: "voz", contenido: Buffer.from("ogg"), mime: "audio/ogg", telegramChatId: 5, telegramMessageId: 6 });
      await leerDocumento(ctx, m.id);
      const viejo = await app.request("/revisar", { headers: { cookie } });
      expect(viejo.status).toBe(302);
      expect(viejo.headers.get("location")).toBe("/?ver=atencion");
      expect(await (await app.request("/", { headers: { cookie } })).text()).toContain(`/anotar?documento=${m.id}`);
      let html = await (await app.request(`/anotar?documento=${m.id}`, { headers: { cookie } })).text();
      expect(html).toContain("No se pudo leer");
      expect(html).toMatch(new RegExp(`<audio controls[^>]*src="/archivo/documento/${m.id}"`));
      expect(html).toContain(`action="/revisar/${m.id}"`);
      const r = await post(cookie, `/revisar/${m.id}`, { tipo: "gasto", categoria: "peaje", monto: "28.50", vehiculoId: "1" });
      expect(aviso(r)).toContain("ok=Gasto guardado");
      expect(r.headers.get("location")).toMatch(/^\/\?ver=atencion/);
      html = await (await app.request("/?ver=atencion", { headers: { cookie } })).text();
      expect(html).toContain("Gastos sin viaje · 1");
      expect((await app.request(`/archivo/documento/${m.id}`, { headers: { cookie } })).status).toBe(200);
      expect((await app.request(`/archivo/documento/${m.id}`)).status).toBe(302);
```

In `"ajustes: crear categoría y costo fijo; por revisar muestra viajes sin guía"` change the last line to:

```ts
      expect(await (await app.request("/?ver=atencion", { headers: { cookie } })).text()).toContain("SIN GUÍA");
```

Run: `pnpm test apps/web/test/web.test.ts -t "por revisar|ajustes: crear"`
Expected: FAIL — `/revisar` answers 200 instead of 302.

- [ ] **Step 2: Trim `apps/web/src/paginas/revisar.tsx`**

Delete `ICONO_TIPO`, `ESTADO` and `vista`. Rename `valores` to an export:

```tsx
/** Lo que la IA leyó, para precargar el formulario de Anotar. */
export function valoresLectura(l: Lectura | null): { tipo: "gasto" | "entrega"; categoria: string; monto: string; medio: string; nota: string } {
  if (l?.tipo === "gasto") return { tipo: "gasto", categoria: l.categoria, monto: l.monto.toFixed(2), medio: "efectivo", nota: [l.proveedorNombre, l.comprobante, l.nota].filter(Boolean).join(" · ") };
  if (l?.tipo === "entrega") return { tipo: "entrega", categoria: "otros_viaje", monto: l.monto.toFixed(2), medio: l.medio, nota: "" };
  return { tipo: "gasto", categoria: "otros_viaje", monto: "", medio: "efectivo", nota: "" };
}

export const ESTADO_LECTURA: Record<string, string> = { error: "No se pudo leer", por_confirmar: "Sin confirmar hace +24 h", pendiente: "La IA no responde" };
```

Replace the routes with:

```tsx
export function rutasRevisar(app: App, d: Deps): void {
  redirigir(app, "/revisar", () => "/?ver=atencion");
  app.get("/archivo/documento/:id{[0-9]+}", async (c) => {
    const a = await archivoDeDocumento(d.ctx, Number(c.req.param("id")));
    return servirDeAlmacen(c as C, d, a?.ruta ?? null);
  });
  app.post("/revisar/:id{[0-9]+}", async (c) => {
    const id = Number(c.req.param("id"));
    const f = await formulario(c);
    return accion(c, volverA(f.volver, "/?ver=atencion"), async () => {
      const monto = parsearMonto(f.monto ?? "");
      if (monto === null) throw new ErrorNegocio("Monto no válido");
      const soles = monto / 100;
      const categoria = f.categoria === "otro" ? f.categoriaOtra : f.categoria;
      const lectura: Lectura = f.tipo === "entrega"
        ? { tipo: "entrega", monto: soles, medio: (f.medio as "efectivo") ?? "efectivo", fecha: null, dudas: [] }
        : { tipo: "gasto", categoria: categoria || "otros_viaje", monto: soles, fecha: null, proveedorRuc: null, proveedorNombre: null, comprobante: null, nota: f.nota || null, dudas: [], medioPago: null, kmOdometro: null };
      await fijarLectura(d.ctx, id, lectura);
      const r = await confirmarLectura(d.ctx, id, { vehiculoId: Number(f.vehiculoId) || null, usuarioId: c.get("usuario").id });
      if (r.tipo === "ya_confirmado") return "Ya estaba guardado";
      return r.tipo === "gasto" ? `Gasto guardado${r.viajeCodigo ? ` en ${r.viajeCodigo}` : ""}` : `Entrega anotada en ${r.viajeCodigo}`;
    });
  });
  app.post("/revisar/:id{[0-9]+}/descartar", async (c) => accion(c, "/?ver=atencion", async () => {
    await descartarLectura(d.ctx, Number(c.req.param("id")), c.get("usuario").id);
    return "Descartado";
  }));
  app.post("/revisar/gasto/:id{[0-9]+}", async (c) => {
    const f = await formulario(c);
    return accion(c, "/?ver=atencion", async () => `Gasto pasado a ${await asignarViajeGasto(d.ctx, Number(c.req.param("id")), Number(f.viajeId), c.get("usuario").id)}`);
  });
}
```

(imports: add `volverA` from `../base` and `redirigir` from `../redirecciones`; drop the core names only the old view used.)

`apps/web/src/lugares.ts`: `revisar: "/?ver=atencion",` in `RUTA`.

- [ ] **Step 3: Full attention list in `apps/web/src/paginas/dashboard.tsx`**

Add `gastosSinViaje, listarCategorias, nombreCategoria` to the core import and `fechaCorta, soles2` to the ui import, `import { ESTADO_LECTURA } from "./revisar";`. In `atenciones`, change the documents entry so a single message opens Anotar directly, and add the gastos sin viaje line:

```tsx
    const docs = await listarPorRevisar(ctx);
    if (docs.length) {
      r.push({
        color: "proximo", texto: `${docs.length} ${docs.length === 1 ? "foto o mensaje del chofer" : "fotos o mensajes del chofer"} por confirmar`,
        href: docs.length === 1 ? `/anotar?documento=${docs[0]!.documentoId}` : RUTA.revisar,
      });
    }
    const sueltos = await gastosSinViaje(ctx);
    if (sueltos.length) r.push({ color: "proximo", texto: `${sueltos.length} ${sueltos.length === 1 ? "gasto del chofer" : "gastos del chofer"} sin viaje`, href: RUTA.revisar });
```

Add the full view and route it from `vista`:

```tsx
async function vistaAtencion(c: C, d: Deps) {
  const ctx = d.ctx;
  const u = c.get("usuario");
  const veViajes = puedeVer(u.rol, "viajes");
  const h = hoy(ctx);
  const [cab, docs, viajesRev, sueltos, viajes, categorias] = await Promise.all([
    d.cabecera(), veViajes ? listarPorRevisar(ctx) : Promise.resolve([]), veViajes ? viajesPorRevisar(ctx) : Promise.resolve([]),
    veViajes ? gastosSinViaje(ctx) : Promise.resolve([]), listarViajesFlota(ctx, { limite: 60 }), listarCategorias(ctx, { soloActivas: true }),
  ]);
  const otros = (await atenciones(ctx, u.rol, cab)).filter((a) => !a.href.startsWith("/?ver=") && !a.href.startsWith("/anotar?documento="));
  const MOTIVO: Record<string, string> = { sin_guia: "SIN GUÍA", guia_rechazada: "GUÍA RECHAZADA", cierre_automatico: "CERRADO SOLO", guia_sin_viaje: "GUÍA SIN VIAJE" };
  return pagina(c, d, { titulo: "Necesita tu atención", seccion: "dashboard" }, (
    <>
      <Cabecera titulo="Necesita tu atención" volver="/" />
      {docs.length ? (
        <section class="col">
          <h2 class="titulo-seccion">Fotos y mensajes del chofer · {docs.length}</h2>
          <div class="lista-filas">
            {docs.map((x) => (
              <a class="fila-aviso" href={`/anotar?documento=${x.documentoId}&volver=%2F%3Fver%3Datencion`}>
                <span class="punto" style="background:var(--amber-bar)"></span>
                <span class="txt">{x.tipo === "foto" ? "Foto" : x.tipo === "voz" ? "Nota de voz" : "Mensaje"} del {fechaCorta(x.desde.toISOString().slice(0, 10))} · <span class="muted">{ESTADO_LECTURA[x.estado] ?? x.estado}</span>{x.texto ? <><br /><span class="muted">«{x.texto}»</span></> : null}</span>
                <span class="flecha" aria-hidden="true">›</span>
              </a>
            ))}
          </div>
        </section>
      ) : null}
      {viajesRev.length ? (
        <section class="col">
          <h2 class="titulo-seccion">Viajes y guías · {viajesRev.length}</h2>
          <div class="lista-filas">
            {viajesRev.map((x) => (
              <a class="fila-aviso" href={x.viajeId ? `/viajes/${x.viajeId}` : "/viajes"}>
                <span class={`chip ${x.motivo === "guia_rechazada" ? "cambiar" : "proximo"}`}>{MOTIVO[x.motivo]}</span>
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
                <form method="post" action={`/revisar/gasto/${g.id}`} class="fila-papel">
                  <span><b>{fechaCorta(g.fecha)}</b> · {nombreCategoria(g.categoria, categorias)} · <b>{soles2(g.monto)}</b>{g.nota || g.proveedorNombre ? <span class="muted"> · {[g.proveedorNombre, g.nota].filter(Boolean).join(" · ")}</span> : null}</span>
                  <select name="viajeId" aria-label="Viaje">{opciones.map((v) => <option value={v.id}>{v.codigo} · {v.unidad} · {v.ruta}</option>)}</select>
                  <button class="btn chico" type="submit" disabled={opciones.length === 0}>Asignar</button>
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
```

At the top of `vista` add `if (c.req.query("ver") === "atencion") return vistaAtencion(c, d);`.

- [ ] **Step 4: Document mode in `apps/web/src/paginas/anotar.tsx`**

Add `"documento"` to `CLAVES_Q` (so `urlAnotar` keeps it), add `listarPorRevisar` to the core import and `import { ESTADO_LECTURA, valoresLectura } from "./revisar";`. Add:

```tsx
/** Lo que mandó el chofer por Telegram y no se pudo guardar solo: mismo formulario, precargado. */
async function parteDocumento(c: C, d: Deps, q: Q): Promise<PartesForm | null> {
  const id = num(q.documento);
  const item = id === null ? undefined : (await listarPorRevisar(d.ctx)).find((x) => x.documentoId === id);
  if (!item) return null;
  const v = valoresLectura(item.lectura);
  // Sin «tipo» en la URL manda lo que leyó la IA; con «tipo» manda el botón que tocó el usuario.
  const pedido = c.req.query("tipo");
  const tipo = pedido === "chofer" || pedido === "gaste" ? pedido : v.tipo === "entrega" ? "chofer" : "gaste";
  const [categorias, unidades] = await Promise.all([listarCategorias(d.ctx, { soloActivas: true }), listarUnidades(d.ctx)]);
  const arriba = (
    <section class="panel">
      <div class="fila-sep"><b>Llegó por Telegram</b><span class={`chip ${item.estado === "error" ? "cambiar" : "proximo"}`}>{ESTADO_LECTURA[item.estado] ?? item.estado}</span></div>
      {item.texto ? <span>«{item.texto}»</span> : null}
      {item.error ? <span class="muted">⚠️ {item.error}</span> : null}
      {item.rutaArchivo && item.tipo === "foto" ? <a href={`/archivo/documento/${item.documentoId}`} target="_blank"><img src={`/archivo/documento/${item.documentoId}`} alt="Foto que mandó el chofer" style="max-width:100%;max-height:240px;border-radius:4px" /></a> : null}
      {item.rutaArchivo && item.tipo === "voz" ? <audio controls src={`/archivo/documento/${item.documentoId}`} style="width:100%"></audio> : null}
    </section>
  );
  return {
    accion: `/revisar/${item.documentoId}`,
    tipoOculto: tipo === "chofer" ? "entrega" : "gasto",
    arriba,
    campos: (
      <>
        <CampoMonto valor={v.monto} />
        {tipo === "gaste" ? (
          <fieldset class="grupo"><legend class="lbl">¿En qué?</legend>
            <label class="campo"><span>Categoría</span><select name="categoria">{categorias.map((k) => <option value={k.clave} selected={k.clave === v.categoria}>{k.nombre}</option>)}</select></label>
          </fieldset>
        ) : (
          <fieldset class="grupo"><legend class="lbl">¿Cómo se la diste?</legend>
            <div class="opciones-texto">{Object.entries(MEDIOS_ENTREGA).map(([k, n]) => <OpcionTexto nombre="medio" valor={k} texto={n} marcado={k === v.medio} />)}</div>
          </fieldset>
        )}
      </>
    ),
    solo: {
      texto: "Se guarda en el viaje en curso del camión que elijas",
      cambiar: (
        <>
          <SelectUnidad unidades={unidades} elegido={unidades[0]?.id ?? null} />
          <label class="campo"><span>Nota</span><input name="nota" value={v.nota} /></label>
        </>
      ),
    },
    abajo: null,
    boton: "GUARDAR",
  };
}
```

In `vista`, right after `const q = leerQ(c, permitidos);`:

```tsx
  if (q.documento) {
    const p = await parteDocumento(c, d, q);
    if (!p) return c.redirect("/?ver=atencion&error=" + encodeURIComponent("Ese mensaje ya se guardó o se descartó"));
    const soloDos = permitidos.filter((t) => t === "gaste" || t === "chofer");
    if (!soloDos.length) return c.redirect("/?error=" + encodeURIComponent("Tu rol no confirma gastos del chofer"));
    const qDoc = { ...q, tipo: p.tipoOculto === "entrega" ? "chofer" : "gaste", volver: q.volver === "/" ? "/?ver=atencion" : q.volver };
    const cuerpo = (
      <>
        <FormAnotar q={qDoc} permitidos={soloDos} p={p} />
        <form method="post" action={`/revisar/${q.documento}/descartar`} class="anotar" data-confirmar="¿Descartar este mensaje?">
          <button class="btn fantasma" type="submit">No es nada: descartar</button>
        </form>
      </>
    );
    if (q.parcial) return c.html(cuerpo.toString());
    return pagina(c, d, { titulo: "Confirmar lo que llegó", seccion: "dashboard", lugar: "anotar", sinNavInferior: true }, cuerpo);
  }
```

Change `otroTipo` so the Gasté / Plata al chofer buttons keep the message: `const otroTipo = (q: Q, tipo: TipoAnotar) => urlAnotar({ tipo, volver: q.volver, viajeId: q.viajeId, vehiculoId: q.vehiculoId, documento: q.documento });` (mode links already keep it, since `documento` is now in `CLAVES_Q`).

- [ ] **Step 5: Run the tests**

Run: `pnpm test apps/web/test/web.test.ts`
Expected: PASS.

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Screenshots**

In `apps/web/scripts/lugares-captura.ts` add after `inicio`:

```ts
  { nombre: "atencion", ruta: "/?ver=atencion" },
  { nombre: "revisar-mensaje", ruta: "/?ver=atencion", seguir: "a[href^='/anotar?documento=']" },
```

Run: `CAPTURAS_ETIQUETA=tarea-11 pnpm capturas inicio atencion revisar-mensaje`
Expected: `inicio` and `atencion` PNGs at both sizes; `revisar-mensaje` PNGs too when the demo has a Telegram message waiting (otherwise the script prints `⚠ revisar-mensaje: no hay ningún a[href^='/anotar?documento='] (saltado)` and goes on). `atencion-390.png` lists messages, trips without guide and loose expenses with «Asignar»; `revision.json` is clean for them.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src apps/web/scripts/lugares-captura.ts apps/web/test/web.test.ts
git commit -m "feat(web): lo que llega por Telegram se confirma en Anotar y lo pendiente vive en Inicio" -m "Claude-Session: https://claude.ai/code/session_012rqk28jac1iV7v2GAJjggW"
```

---

### Task 12: Cleanup of dead UI, full test run and full screenshot pass

**Files:**
- Modify: `apps/web/public/app.css` (delete unused rules), `apps/web/public/sw.js` (`VERSION`), `apps/web/src/ui.tsx` (delete unused exports), `apps/web/scripts/lugares-captura.ts` (final list), `apps/web/test/web.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: no new names; `sw.js` `VERSION = "flota-v3"` (phones drop pages cached with the old layout).

- [ ] **Step 1: Write the failing test**

Add at the top of `apps/web/test/web.test.ts`: `import { readFileSync } from "node:fs";` and inside `describe("web", …)`:

```ts
  it("no queda la interfaz vieja: sin cabecera ni menú de pestañas en el CSS, caché renovado", async () => {
    const css = readFileSync(new URL("../public/app.css", import.meta.url), "utf8");
    for (const viejo of [".header .datos", ".nav a.activo", ".g-main", ".carril", ".datos-visor", ".usuario-menu", ".bot-estado"]) expect(css, viejo).not.toContain(viejo);
    const sw = await (await app.request("/sw.js")).text();
    expect(sw).toContain('const VERSION = "flota-v3"');
    expect((await app.request("/static/reparaciones.js")).status).toBe(404);
  });
```

Run: `pnpm test apps/web/test/web.test.ts -t "interfaz vieja"`
Expected: FAIL — `expected '/* Control Flota … */' not to contain '.header .datos'`.

- [ ] **Step 2: Find the CSS rules nothing uses any more**

Run:

```bash
for k in header datos hora bot-estado usuario-menu nav g-main g-lado g-trailer g-coti g-tg carril pista datos-visor tarjetas tarjeta kpis kpi feed vivo telefono tcab burbuja teclado fila-flota fila-parte hist-pieza barras-v contador caja-oscura; do
  n=$(grep -rhoE "class=[{\"\`][^\"\`}]*\b$k\b|className: \"[^\"]*\b$k\b|[\"' ]$k[\"' ]" apps/web/src apps/web/public/*.js | wc -l); echo "$k $n"; done
```

Expected: a `nombre cantidad` list. Rules whose class prints `0` are dead. With the code of Tasks 1–11 these print 0: `header` (only `PaginaSimple` uses `header` — keep `.header` and `.header .marca*`, delete `.header .datos`, `.header .dato*`, `.header .hora`), `bot-estado`, `usuario-menu`, `nav`, `g-main`, `g-trailer`, `carril`, `pista`, `datos-visor`, `tarjetas`, `tarjeta` (the `.tarjeta`, `.tarjeta .id`, `.tarjeta.nueva`, `.tarjeta .stats*` rules; keep `.tarjeta-oscura`, `.tarjeta-ruta`, `.tarjeta-hub`), `fila-flota`, `barras-v`. Keep every class that prints > 0 (`feed`, `vivo`, `telefono`, `burbuja`, `teclado` are used by Telegram; `fila-parte`, `hist-pieza` by `trailer3d.js`; `contador`, `caja-oscura` by Camiones; `kpis`/`kpi` by Estadísticas; `g-lado`, `g-coti`, `g-tg`, `g-2`, `g-3` by the settings and number subpages).

- [ ] **Step 3: Delete the dead rules and bump the cache**

In `apps/web/public/app.css` delete: `.header .datos`, `.header .dato`, `.header .dato b`, `.header .hora`, `.bot-estado`, `.bot-estado.off`, `.usuario-menu`, the whole `/* Nav */` block (`.nav`, `.nav a`, `.nav a:hover`, `.nav a.activo`, `.nav .fin`), `.g-main`, `.g-trailer`, the `/* Barras verticales … */` block (`.barras-v*`, `.carril*`), the `.datos-visor*` rules, the `/* Tarjetas de flota */` block (`.tarjetas`, `.tarjeta*`), `.fila-flota*`; in the `@media (max-width: 1200px)` block delete the `.g-main` and `.g-trailer` lines (and the block if it becomes empty); in `@media (max-width: 900px)` delete `.g-main, … .g-trailer` from the selector list, the `.g-trailer > :last-child, .g-main > :last-child` line, the two `.datos-visor` lines and `.header .datos …`; in `@media (max-width: 520px)` delete the three `.fila-flota` lines; in `@media print` replace `.nav, .header .datos, .btn` with `.lateral, .inferior, .panel-anotar, .btn`; in the `.sin-gap` block delete `.sin-gap .header > * + *, .sin-gap .header .datos > * + *`, `.sin-gap .nav a + a` and `.sin-gap .usuario-menu > * + *` from the selector list and add `.sin-gap .contenido > * + *, .sin-gap .col > * + *` to the first `.sin-gap` rule.

In `apps/web/public/sw.js` change `const VERSION = "flota-v2";` to `const VERSION = "flota-v3";`.

Run: `grep -rn "Kpi\b" apps/web/src | grep -v "export const Kpi"`
Expected: matches only in `paginas/estadisticas.tsx` → keep `Kpi`. If it prints nothing, delete `export const Kpi …` from `ui.tsx` and the `.kpi*` rules from `app.css`.

- [ ] **Step 4: Final capture list** — replace the `LUGARES` array in `apps/web/scripts/lugares-captura.ts` with:

```ts
export const LUGARES: LugarCaptura[] = [
  { nombre: "inicio", ruta: "/" },
  { nombre: "atencion", ruta: "/?ver=atencion" },
  { nombre: "revisar-mensaje", ruta: "/?ver=atencion", seguir: "a[href^='/anotar?documento=']" },
  { nombre: "anotar", ruta: "/anotar" },
  { nombre: "anotar-chofer", ruta: "/anotar?tipo=chofer" },
  { nombre: "anotar-cobro", ruta: "/anotar?tipo=cobro" },
  { nombre: "anotar-repare", ruta: "/anotar?tipo=repare" },
  { nombre: "anotar-compra", ruta: "/anotar?tipo=repare&modo=compra" },
  { nombre: "anotar-empresa", ruta: "/anotar?tipo=empresa" },
  { nombre: "anotar-prestamo", ruta: "/anotar?tipo=prestamo" },
  { nombre: "inicio-con-panel", ruta: "/", clic: "[data-abrir-panel]", esperar: "#panel-anotar form", espera: 600, solo: "pc" },
  { nombre: "viajes", ruta: "/viajes" },
  { nombre: "viaje", ruta: "/viajes", seguir: ".tarjeta-ruta, .fila-viaje:not(.cab)" },
  { nombre: "camion", ruta: "/camiones", espera: 2000 },
  { nombre: "camion-historial", ruta: "/camiones?tab=historial", espera: 2000 },
  { nombre: "camion-repuestos", ruta: "/camiones?tab=repuestos", espera: 2000 },
  { nombre: "camion-datos", ruta: "/camiones?tab=datos", espera: 2000 },
  { nombre: "numeros", ruta: "/numeros" },
  { nombre: "numeros-caja", ruta: "/numeros/caja" },
  { nombre: "numeros-prestamos", ruta: "/numeros/prestamos" },
  { nombre: "numeros-cotizar", ruta: "/numeros/cotizar" },
  { nombre: "numeros-rentabilidad", ruta: "/numeros/rentabilidad" },
  { nombre: "numeros-graficos", ruta: "/numeros/graficos" },
  { nombre: "ajustes", ruta: "/ajustes" },
  { nombre: "ajustes-empresa", ruta: "/ajustes/empresa" },
  { nombre: "ajustes-usuarios", ruta: "/ajustes/usuarios" },
  { nombre: "ajustes-costos-fijos", ruta: "/ajustes/costos-fijos" },
  { nombre: "ajustes-categorias", ruta: "/ajustes/categorias" },
  { nombre: "ajustes-partes", ruta: "/ajustes/partes" },
  { nombre: "rutas", ruta: "/rutas" },
  { nombre: "telegram", ruta: "/telegram" },
  { nombre: "sincronizar", ruta: "/sincronizar" },
  { nombre: "dispositivo", ruta: "/ajustes/dispositivo" },
];
```

- [ ] **Step 5: Full test and typecheck**

Run: `pnpm test`
Expected: every project passes (core, db, sunat, bot, web; the new web cases from Tasks 1–12 included).

Run: `pnpm typecheck`
Expected: no errors in any package.

- [ ] **Step 6: Full screenshot pass**

Run: `CAPTURAS_ETIQUETA=final pnpm capturas`
Expected: `capturas/final/` holds `<nombre>-390.png` and `<nombre>-1440.png` for the 33 entries (`inicio-con-panel` only at 1440; `revisar-mensaje` only if the demo has a waiting message) and `revision.json`; the last line is `✓ 390 px: sin desborde, botones chicos, letra chica ni contraste bajo`. If it prints `⚠ Revisar en 390 px: …`, open `revision.json`, fix the CSS or markup of each listed element, re-run `pnpm capturas <nombre>` until clean. Then compare by eye with the artboards: `inicio` ↔ Inicio, `anotar` ↔ Anotar, `viaje` ↔ Viaje, `camion` ↔ Camion, `numeros` ↔ Numeros, `inicio-con-panel-1440` ↔ Escritorio; and check: max 4 big figures per view, no form with more than 4 fields before "cambiar" / "Más datos".

- [ ] **Step 7: No-function-lost checklist** (tick each by opening the new place in the running demo or in the screenshots)

| Old screen / action | Where it is now |
|---|---|
| Dashboard KPIs, salud por parte, próximos cambios | Inicio (Ganaste / Entró / Salió / Te deben; "cambiar ya" in Necesita tu atención); Camiones › Lo que toca |
| Feed de Telegram en vivo | Ajustes › Telegram |
| Trailer 3D (+ pieza, instalar parte, vida útil) | Camiones (3D, Lo que toca, Registrar un cambio → Anotar) |
| Flota (agregar, editar, odómetro) | Camiones › + Nuevo, Camiones › Datos |
| Inventario (repuesto nuevo, stock mínimo, piezas, compras) | Camiones › Repuestos (Ver más), Anotar › Reparé › Compra para stock |
| Reparaciones (registrar cambio, historial, ¿a tiempo?) | Anotar › Reparé, Camiones › Historial |
| Viajes (registrar, cerrar, flete, guías, facturar, enlazar, cobros, recordar) | Viajes (+ Nuevo viaje, Ver más), Viaje (Cerrar, Papeles y cobro, Ver más), Anotar › Me pagaron |
| Liquidación (entregas, gastos, semáforo, presupuesto, reabrir) | Viaje (Le diste / Le queda, Gastos del viaje, Ver más), Anotar › Plata al chofer |
| Finanzas (+ gasto, + ingreso, + reinversión, préstamos, movimientos, flujo) | Anotar (Gasté, De la empresa, Me pagaron › Otro ingreso, Préstamo o cuota), Números › Caja, Números › Préstamos |
| Rentabilidad, cotizador, parámetros, presupuesto mensual | Números › Rentabilidad detallada, Números › Cotizar un viaje |
| Estadísticas y Excel | Números › Gráficos y Excel |
| Por revisar | Inicio › Necesita tu atención (`/?ver=atencion`), Anotar con el mensaje precargado |
| Rutas, Telegram, Sincronizar, Este dispositivo, Empresa, Usuarios, Costos fijos, Categorías, Catálogo | Ajustes (tarjetas) |

- [ ] **Step 8: Commit**

```bash
git add -A apps/web packages/core
git commit -m "chore(web): quita la interfaz vieja, renueva la caché y pasa todas las capturas" -m "Claude-Session: https://claude.ai/code/session_012rqk28jac1iV7v2GAJjggW"
```

---

## Spec decisions taken in this plan

- **Denied GET = redirect, not a 403 page.** Spec §6 says "403 al resto"; the app already answers a forbidden GET with `302 /?error=…` (existing test `el contador no ve la flota`), and a forbidden POST with 403. The plan keeps that: tests assert the `/?error=` redirect for GET and 403 for POST.
- **Text ≥ 12 px beats the artboards' 10–11 px labels.** Spec §6 rule wins; labels, chips and bottom-bar captions are 12 px.
- **`/revisar` has no page of its own.** It redirects to `/?ver=atencion` (the full "Necesita tu atención" list, with the "gastos sin viaje → Asignar" rows), and each Telegram message opens Anotar pre-filled (`/anotar?documento=`), posting to the kept `POST /revisar/:id`.
- **Ajustes hub is visible to every role**; each card is filtered with `puedeVer` (Rutas → viajes, Telegram → telegram, Sincronizar → sincronizar, the rest → dueño). This is where the phone gets "Salir" and "Instalar app".
- **"Así queda" only on PC** (≥ 900 px), as the spec says; the phone form stays short.
- **Configuración vehicular y carga útil** are shown read-only in Camiones › Datos (`datosSunatVehiculo`); editing them belongs to the SUNAT plan running in the other worktree.

