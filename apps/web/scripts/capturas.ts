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
  for (let i = 0; i < 360; i++) {
    try {
      if ((await fetch(`${BASE}/salud`)).ok) return;
    } catch { /* todavía arranca */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("La web no respondió en 180 s");
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
