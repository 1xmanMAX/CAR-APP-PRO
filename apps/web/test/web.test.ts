import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const prueba = vi.hoisted(() => ({ simularTodoOk: false, llamadasSunat: 0 }));
vi.mock("@sunatapp/core", async (importOriginal) => {
  const real = await importOriginal<typeof import("@sunatapp/core")>();
  return {
    ...real,
    probarConexionSunat: async (ctx: Parameters<typeof real.probarConexionSunat>[0], datos: Parameters<typeof real.probarConexionSunat>[1], o?: Parameters<typeof real.probarConexionSunat>[2]) => {
      // Nunca se llama a SUNAT de verdad: un fetch falso que rechaza la clave (HTTP 401).
      const falso = (async () => { prueba.llamadasSunat++; return new Response("", { status: 401 }); }) as typeof fetch;
      if (!prueba.simularTodoOk) return real.probarConexionSunat(ctx, datos, { ...o, fetch: falso });
      const ok = { ok: true, mensaje: "ok" };
      return { certificado: ok, claveSol: ok, credencialesGre: ok, todoOk: true, huella: real.huellaPrueba(datos) };
    },
  };
});
import {
  AVISO_RETORNO_VACIO, emitirGuia, leerPausaSunat, pausarSunat, registrarGuiaBorrador,
  buscarUnidad, listarValoresReferenciales, crearCategoria, crearEnlaceWeb, guardarUsuario, registrarGasto, registrarViajeFlota, listarEventos, listarUsuarios, listarViajesFlota, obtenerEmpresa, partesDeUnidad, instalarParte, listarTiposParte,
  type Contexto,
} from "@sunatapp/core";
import { crearDb, eq, gasto, guiaTransportista, vehiculo } from "../../../packages/db/src/index";
import { crearContextoPrueba, entradaGuia } from "../../../packages/core/test/helpers";
import { crearWeb } from "../src/app";

let ctx: Contexto;
let cerrar: () => Promise<void>;
let app: ReturnType<typeof crearWeb>;
const avisos: string[] = [];
const ORIGEN = "http://localhost";

beforeEach(async () => {
  ({ ctx, cerrar } = await crearContextoPrueba());
  avisos.length = 0;
  app = crearWeb(ctx, { avisar: async (t) => void avisos.push(t) });
});
afterEach(async () => cerrar());

async function entrar(email = "dueno@demo.pe", clave = "clave-segura"): Promise<string> {
  const r = await app.request("/entrar", { method: "POST", headers: { origin: ORIGEN }, body: new URLSearchParams({ email, clave }) });
  expect(r.status).toBe(303);
  return r.headers.get("set-cookie")!.split(";")[0]!;
}

function aviso(r: Response): string {
  const q = new URL(r.headers.get("location")!, "http://x").searchParams;
  return [...q].map(([k, v]) => `${k}=${v}`).join("&");
}

async function post(cookie: string, ruta: string, datos: Record<string, string>, origen = ORIGEN) {
  return app.request(ruta, { method: "POST", headers: { cookie, origin: origen }, body: new URLSearchParams(datos) });
}

describe("web", () => {
  it("es instalable: manifiesto y service worker públicos", async () => {
    const m = await app.request("/manifest.webmanifest");
    expect(m.headers.get("content-type")).toBe("application/manifest+json");
    expect((await m.json()).display).toBe("standalone");
    const sw = await app.request("/sw.js");
    expect(sw.status).toBe(200);
    expect(sw.headers.get("service-worker-allowed")).toBe("/");
    expect((await app.request("/sin-conexion")).status).toBe(200);
  });

  it("sin sesión manda a configurar la primera vez y luego a entrar", async () => {
    let r = await app.request("/");
    expect(r.headers.get("location")).toBe("/configurar");
    r = await app.request("/configurar", { method: "POST", headers: { origin: ORIGEN }, body: new URLSearchParams({ nombre: "Dueño", email: "dueno@demo.pe", clave: "clave-segura" }) });
    expect(r.status).toBe(303);
    const cookie = r.headers.get("set-cookie")!.split(";")[0]!;
    expect((await app.request("/", { headers: { cookie } })).status).toBe(200);
    expect((await app.request("/")).headers.get("location")).toBe("/entrar");
  });

  describe("con el dueño configurado", () => {
    beforeEach(async () => {
      await guardarUsuario(ctx, { id: 1, nombre: "Dueño", email: "dueno@demo.pe", rol: "dueno", clave: "clave-segura" });
    });

    it("gasto mínimo: solo monto y categoría; el resto se completa solo", async () => {
      const cookie = await entrar();
      await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Juliaca", destinoLugar: "Arequipa", estado: "en_curso", origen: "web" });
      const html = await (await app.request("/finanzas", { headers: { cookie } })).text();
      expect(html).toContain("Se guarda con");
      const fd = new FormData();
      fd.set("categoria", "peaje");
      fd.set("monto", "28.50");
      fd.set("vehiculoId", "1");
      const r = await app.request("/finanzas/gasto", { method: "POST", headers: { cookie, origin: ORIGEN }, body: fd });
      expect(r.status).toBe(303);
      const [g] = await ctx.db.select().from(gasto);
      expect(g).toMatchObject({ categoria: "peaje", monto: 2850, medioPago: "efectivo_chofer" });
      expect(g!.viajeId).not.toBeNull();
    });

    it("las categorías propias aparecen en el formulario de gasto, en rutas y en el presupuesto", async () => {
      const cookie = await entrar();
      await crearCategoria(ctx, { nombre: "Guardianía", tipo: "variable" });
      for (const ruta of ["/finanzas", "/rutas", "/rentabilidad"]) {
        expect(await (await app.request(ruta, { headers: { cookie } })).text(), ruta).toContain("Guardianía");
      }
    });

    it("rentabilidad: conmutador por viaje y por mes, y el Excel", async () => {
      const cookie = await entrar();
      const v = await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Juliaca", destinoLugar: "Arequipa", estado: "cerrado", km: 300, flete: 500000, origen: "web" });
      await registrarGasto(ctx, { viajeId: v.id, categoria: "combustible", monto: 150000, origen: "web" });
      let html = await (await app.request("/rentabilidad?vista=viaje", { headers: { cookie } })).text();
      expect(html).toContain("POR VIAJE");
      expect(html).toContain(v.codigo);
      expect(html).toContain("PROVISIONAL");
      html = await (await app.request("/rentabilidad?vista=mes", { headers: { cookie } })).text();
      expect(html).toContain("GANANCIA NETA");
      html = await (await app.request(`/viajes/${v.id}`, { headers: { cookie } })).text();
      expect(html).toContain("FIJO ASIGNADO");
      const x = await app.request("/estadisticas.xlsx?desde=2026-09-01&hasta=2026-09-30", { headers: { cookie } });
      expect(x.status).toBe(200);
    });

    it("ajustes: crear categoría y costo fijo; por revisar muestra viajes sin guía", async () => {
      const cookie = await entrar();
      expect((await post(cookie, "/ajustes/categoria", { nombre: "Guardianía", tipo: "variable" })).status).toBe(303);
      expect((await post(cookie, "/ajustes/costo-fijo", { concepto: "Sueldo T-01", categoria: "sueldo_chofer", monto: "2500", periodicidad: "mensual", vehiculoId: "1", desde: "2026-09-01" })).status).toBe(303);
      const html = await (await app.request("/ajustes", { headers: { cookie } })).text();
      expect(html).toContain("Guardianía");
      expect(html).toContain("Sueldo T-01");
      await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Juliaca", destinoLugar: "Puno", estado: "en_curso", origen: "web" });
      expect(await (await app.request("/revisar", { headers: { cookie } })).text()).toContain("SIN GUÍA");
    });

    it("todas las pantallas cargan", async () => {
      const cookie = await entrar();
      for (const ruta of ["/", "/trailer", "/flota", "/inventario", "/reparaciones", "/viajes", "/finanzas", "/rentabilidad", "/telegram", "/ajustes", "/api/feed"]) {
        const r = await app.request(ruta, { headers: { cookie } });
        expect(r.status, ruta).toBe(200);
      }
    });

    it("cada pieza del modelo 3D guarda su historial y se ve resaltada", async () => {
      const cookie = await entrar();
      // Un incidente sin costo en una pieza concreta.
      let r = await post(cookie, "/trailer/1/pieza", { componente: "retrovisor-izq", tipo: "falla_en_ruta", trabajo: "Se abrió el retrovisor", fecha: "2026-09-10" });
      expect(r.headers.get("location")).toContain("/trailer/1?pieza=retrovisor-izq");
      expect(aviso(r)).toContain("ok=");
      // Un cambio de llanta con mano de obra.
      r = await post(cookie, "/trailer/1/pieza", { componente: "llanta-sr2-der-ext", tipo: "correctivo", trabajo: "Cambio de llanta", manoObra: "80" });
      expect(aviso(r)).toContain("ok=");
      expect(aviso(await post(cookie, "/trailer/1/pieza", { componente: "no-existe", trabajo: "x" }))).toContain("error=");
      expect(aviso(await post(cookie, "/trailer/1/pieza", { componente: "faro-der", trabajo: "" }))).toContain("error=");

      const pag = await (await app.request("/trailer/1?pieza=llanta-sr2-der-ext", { headers: { cookie } })).text();
      const datos = JSON.parse(pag.match(/<script[^>]*id="datos-visor"[^>]*>([\s\S]*?)<\/script>/)![1]!);
      expect(datos.piezaSeleccionada).toBe("llanta-sr2-der-ext");
      expect(datos.piezas.length).toBeGreaterThan(50);
      expect(datos.historial["retrovisor-izq"][0].trabajo).toBe("Se abrió el retrovisor");
      expect(datos.historial["llanta-sr2-der-ext"][0].costo).toContain("80");
      // En Reparaciones se ve la pieza con el enlace para ubicarla en el modelo.
      const rep = await (await app.request("/reparaciones", { headers: { cookie } })).text();
      expect(rep).toContain("/trailer/1?pieza=llanta-sr2-der-ext");
      expect(rep).toContain("Llanta semirremolque eje 2 · derecha exterior");
    });

    it("cada repuesto dice en qué piezas va y se ve en el 3D", async () => {
      const cookie = await entrar();
      let r = await post(cookie, "/inventario/repuesto", { nombre: "Luna de retrovisor", categoria: "Otros", piezas: "retrovisor-izq" });
      expect(aviso(r)).toContain("ok=");
      const inv = await (await app.request("/inventario", { headers: { cookie } })).text();
      expect(inv).toContain("1 pieza: Retrovisor · izquierda");
      expect(inv).toMatch(/href="\/trailer\?repuesto=\d+"/);
      const id = Number(/\/trailer\?repuesto=(\d+)/.exec(inv)![1]);
      // Cambiar a los dos retrovisores (varios valores del mismo campo).
      const cuerpo = new URLSearchParams([["piezas", "retrovisor-izq"], ["piezas", "retrovisor-der"]]);
      r = await app.request(`/inventario/repuesto/${id}/piezas`, { method: "POST", headers: { cookie, origin: ORIGEN }, body: cuerpo });
      expect(aviso(r)).toContain("ok=");
      const pag = await (await app.request(`/trailer/1?repuesto=${id}`, { headers: { cookie } })).text();
      const datos = JSON.parse(pag.match(/<script[^>]*id="datos-visor"[^>]*>([\s\S]*?)<\/script>/)![1]!);
      expect(datos.resaltar).toEqual({ titulo: expect.stringContaining("Luna de retrovisor"), piezas: ["retrovisor-izq", "retrovisor-der"] });
      expect(datos.repuestosPieza["retrovisor-der"]).toEqual([expect.objectContaining({ id, stock: 0 })]);
    });

    it("liquidación del viaje: entregas, gastos, saldo y semáforo", async () => {
      const cookie = await entrar();
      const v = await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Juliaca", destinoLugar: "Arequipa", estado: "en_curso", origen: "web" });
      await registrarGasto(ctx, { viajeId: v.id, categoria: "combustible", monto: 35000, origen: "telegram" });
      let r = await post(cookie, `/viajes/${v.id}/entrega`, { monto: "500", medio: "yape", nota: "Adelanto" });
      expect(aviso(r)).toContain("ok=");
      expect(aviso(await post(cookie, `/viajes/${v.id}/entrega`, { monto: "abc" }))).toContain("error=");
      const html = await (await app.request(`/viajes/${v.id}`, { headers: { cookie } })).text();
      expect(html).toContain("El chofer tiene S/ 150.00 por rendir o devolver");
      expect(html).toContain("Combustible");
      expect(html).toContain("Adelanto");
      const lista = await (await app.request("/viajes", { headers: { cookie } })).text();
      expect(lista).toContain(`href="/viajes/${v.id}"`);
    });

    it("por revisar: guardar desde la web un mensaje que no se pudo leer", async () => {
      const cookie = await entrar();
      const { recibirMensaje, leerDocumento, crearLectorReglas } = await import("./ayuda-revisar");
      ctx.ia = crearLectorReglas();
      const m = await recibirMensaje(ctx, { tipo: "voz", contenido: Buffer.from("ogg"), mime: "audio/ogg", telegramChatId: 5, telegramMessageId: 6 });
      await leerDocumento(ctx, m.id);
      let html = await (await app.request("/revisar", { headers: { cookie } })).text();
      expect(html).toContain("NO SE PUDO LEER");
      expect(html).toMatch(new RegExp(`<audio controls[^>]*src="/archivo/documento/${m.id}"`));
      expect(await (await app.request("/", { headers: { cookie } })).text()).toContain("1 por revisar");
      const r = await post(cookie, `/revisar/${m.id}`, { tipo: "gasto", categoria: "peaje", monto: "28.50", vehiculoId: "1" });
      expect(aviso(r)).toContain("ok=Gasto guardado");
      html = await (await app.request("/revisar", { headers: { cookie } })).text();
      expect(html).toContain("GASTOS SIN VIAJE · 1");
      expect((await app.request(`/archivo/documento/${m.id}`, { headers: { cookie } })).status).toBe(200);
      expect((await app.request(`/archivo/documento/${m.id}`)).status).toBe(302);
    });

    it("rutas: plantilla, usar el promedio y editar el presupuesto de un viaje", async () => {
      const cookie = await entrar();
      let r = await post(cookie, "/rutas", { origen: "Puno", destino: "Lima", sentido: "→", m_combustible: "900", m_peaje: "120.50" });
      expect(aviso(r)).toContain("ok=");
      let html = await (await app.request("/rutas", { headers: { cookie } })).text();
      expect(html).toContain("Puno → Lima");
      expect(html).toContain('value="120.50"');
      const previo = await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Puno", destinoLugar: "Lima", estado: "cerrado", km: 1300, origen: "web" });
      await registrarGasto(ctx, { viajeId: previo.id, categoria: "combustible", monto: 80000, origen: "web" });
      const id = Number(/action="\/rutas\/(\d+)"/.exec(html)![1]);
      r = await post(cookie, `/rutas/${id}`, { usarPromedio: "1" });
      expect(aviso(r)).toContain("promedio");
      const v = await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Puno", destinoLugar: "Lima", estado: "en_curso", origen: "web" });
      html = await (await app.request(`/viajes/${v.id}`, { headers: { cookie } })).text();
      expect(html).toContain("PRESUPUESTO DEL VIAJE");
      expect(html).toContain("S/ 800.00");
      r = await post(cookie, `/viajes/${v.id}/presupuesto`, { m_combustible: "1000", m_viaticos: "50" });
      expect(aviso(r)).toContain("ok=");
      html = await (await app.request(`/viajes/${v.id}`, { headers: { cookie } })).text();
      expect(html).toContain("S/ 1,050.00 previstos");
    });

    it("detalle del viaje: corregir y borrar gastos, cerrar y reabrir", async () => {
      const cookie = await entrar();
      const v = await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Juliaca", destinoLugar: "Cusco", estado: "en_curso", origen: "web" });
      const g1 = await registrarGasto(ctx, { viajeId: v.id, categoria: "combustible", monto: 30000, origen: "telegram" });
      const g2 = await registrarGasto(ctx, { viajeId: v.id, categoria: "otros_viaje", monto: 5000, origen: "telegram" });
      expect(aviso(await post(cookie, `/viajes/${v.id}/gasto/${g1.id}`, { categoria: "combustible", monto: "305", fecha: "2026-09-13" }))).toContain("ok=");
      expect(aviso(await post(cookie, `/viajes/${v.id}/gasto/${g2.id}/borrar`, {}))).toContain("ok=");
      let html = await (await app.request(`/viajes/${v.id}`, { headers: { cookie } })).text();
      expect(html).toContain("S/ 305.00");
      expect(html).not.toContain("S/ 50.00");
      expect(aviso(await post(cookie, `/viajes/${v.id}/cerrar`, { km: "380", flete: "1200" }))).toContain("ok=");
      html = await (await app.request(`/viajes/${v.id}`, { headers: { cookie } })).text();
      expect(html).toContain("REABRIR VIAJE");
      expect(html).toContain("margen 75%");
      expect(aviso(await post(cookie, `/viajes/${v.id}/reabrir`, {}))).toContain("ok=");
      expect(await (await app.request(`/viajes/${v.id}`, { headers: { cookie } })).text()).toContain("CERRAR ESTE VIAJE");
    });

    it("estadísticas y Excel con montos numéricos", async () => {
      const cookie = await entrar();
      const v = await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Juliaca", destinoLugar: "Arequipa", estado: "cerrado", km: 300, flete: 150000, fecha: "2026-09-10", origen: "web" });
      await registrarGasto(ctx, { viajeId: v.id, categoria: "combustible", monto: 45000, proveedorNombre: "GRIFO PRIMAX", fecha: "2026-09-10", origen: "web" });
      const html = await (await app.request("/estadisticas?desde=2026-08-01&hasta=2026-09-30", { headers: { cookie } })).text();
      expect(html).toContain("GRIFO PRIMAX");
      expect(html).toContain("Juliaca → Arequipa");
      expect(html).toContain("<svg");
      const r = await app.request("/estadisticas.xlsx?desde=2026-08-01&hasta=2026-09-30", { headers: { cookie } });
      expect(r.headers.get("content-type")).toContain("spreadsheetml");
      const ExcelJS = (await import("exceljs")).default;
      const libro = new ExcelJS.Workbook();
      await libro.xlsx.load(await r.arrayBuffer());
      const hoja = libro.getWorksheet("Viajes")!;
      expect(hoja.getRow(1).getCell(7).value).toBe("Flete");
      expect(hoja.getRow(2).getCell(7).value).toBe(1500);
      expect(hoja.getRow(2).getCell(8).value).toBe(450);
      expect(hoja.getRow(2).getCell(7).numFmt).toContain("S/");
    });

    it("contraseña incorrecta no entra", async () => {
      const r = await app.request("/entrar", { method: "POST", headers: { origin: ORIGEN }, body: new URLSearchParams({ email: "dueno@demo.pe", clave: "mala" }) });
      expect(r.status).toBe(401);
    });

    it("rechaza un POST de otro origen", async () => {
      const cookie = await entrar();
      const r = await post(cookie, "/viajes", { vehiculoId: "1", origen: "A", destino: "B" }, "https://malo.example");
      expect(r.status).toBe(403);
    });

    it("registrar un viaje desde la web suma km y viaje a las partes y acepta el enlace del bot", async () => {
      const cookie = await entrar();
      const t01 = (await buscarUnidad(ctx, "T-01"))!;
      const aceite = (await listarTiposParte(ctx)).find((t) => t.codigo === "aceite")!;
      await instalarParte(ctx, { vehiculoId: t01.id, tipoParteId: aceite.id });
      const r = await post(cookie, "/viajes", { vehiculoId: String(t01.id), origen: "Juliaca", destino: "Arequipa", km: "1290", toneladas: "30", flete: "3500", estado: "cerrado" });
      expect(aviso(r)).toContain("ok=Viaje VJ-0001 registrado");
      const [p] = await partesDeUnidad(ctx, t01.id);
      expect(p!.uso).toMatchObject({ km: 1290, viajes: 1 });
      const [v] = await listarViajesFlota(ctx);
      expect(v).toMatchObject({ flete: 350000, origen: "web" });

      const token = await crearEnlaceWeb(ctx, 1);
      const e = await app.request(`/entrar/enlace?t=${token}`);
      expect(e.status).toBe(303);
      expect((await app.request(`/entrar/enlace?t=${token}`)).status).toBe(401);
    });

    it("registrar un cambio avisa al grupo de Telegram", async () => {
      const cookie = await entrar();
      const t01 = (await buscarUnidad(ctx, "T-01"))!;
      const frenos = (await listarTiposParte(ctx)).find((t) => t.codigo === "frenos_sr")!;
      await instalarParte(ctx, { vehiculoId: t01.id, tipoParteId: frenos.id });
      const [p] = await partesDeUnidad(ctx, t01.id);
      const r = await post(cookie, "/reparaciones", { vehiculoId: String(t01.id), parteId: String(p!.id), tipo: "preventivo", manoObra: "150" });
      expect(aviso(r)).toContain("ok=Cambio guardado");
      expect(avisos[0]).toContain("CAMBIO REGISTRADO · T-01");
      expect(await listarEventos(ctx)).toEqual([]);
    });

    it("un error de negocio vuelve con el mensaje", async () => {
      const cookie = await entrar();
      const r = await post(cookie, "/flota/1/odometro", { km: "-5" });
      expect(aviso(r)).toContain("error=");
    });

    it("el contador no ve la flota ni edita inventario", async () => {
      await guardarUsuario(ctx, { nombre: "Conta", email: "conta@demo.pe", rol: "contador", clave: "clave-segura" });
      const cookie = await entrar("conta@demo.pe");
      expect((await app.request("/finanzas", { headers: { cookie } })).status).toBe(200);
      expect((await app.request("/flota", { headers: { cookie } })).headers.get("location")).toContain("/?error=");
      expect((await post(cookie, "/inventario/repuesto", { nombre: "X", categoria: "Frenos" })).status).toBe(403);
    });

    it("el cotizador genera el PDF del presupuesto", async () => {
      const cookie = await entrar();
      const r = await post(cookie, "/rentabilidad/cotizacion", {
        ruta: "Juliaca → Arequipa", km: "1290", toneladas: "30", precioGal: "16.5", rendimiento: "9", peajes: "80", viaticos: "120", desgaste: "0.35", margen: "25", accion: "pdf",
      });
      const destino = r.headers.get("location")!;
      expect(destino).toContain("pdf=1");
      const pdf = await app.request("/cotizacion/1.pdf", { headers: { cookie } });
      expect(pdf.headers.get("content-type")).toBe("application/pdf");
      expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString()).toBe("%PDF");
    });
  });

  describe("entrada directa (en desarrollo)", () => {
    const LOCAL = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
    const desde = (ruta: string, env: object, host = "127.0.0.1:3939", cookie?: string) =>
      app.request(ruta, { headers: { host, ...(cookie ? { cookie } : {}) } }, env);

    beforeEach(() => {
      app = crearWeb(ctx, { avisar: async (t) => void avisos.push(t), entradaDirecta: true });
    });

    it("desde el mismo equipo entra como dueño sin formulario", async () => {
      const r = await desde("/", LOCAL);
      expect(r.status).toBe(200);
      const cookie = r.headers.get("set-cookie")!.split(";")[0]!;
      expect((await desde("/ajustes", LOCAL, undefined, cookie)).status).toBe(200);
      // Ni configurar ni entrar piden datos: llevan directo al inicio.
      for (const ruta of ["/configurar", "/entrar"]) expect((await desde(ruta, LOCAL)).headers.get("location")).toBe("/");
    });

    it("en un dispositivo vacío crea al dueño «Jefe» con el catálogo de partes", async () => {
      const vacio = await crearDb({ tipo: "pglite" });
      const ctxVacio = { ...ctx, db: vacio.db } as Contexto;
      app = crearWeb(ctxVacio, { entradaDirecta: true });
      try {
        expect((await desde("/", LOCAL)).status).toBe(200);
        expect((await desde("/", LOCAL)).status).toBe(200);
        const usuarios = await listarUsuarios(ctxVacio);
        expect(usuarios.map((u) => [u.nombre, u.rol])).toEqual([["Jefe", "dueno"]]);
        expect((await listarTiposParte(ctxVacio)).length).toBeGreaterThan(0);
      } finally {
        await vacio.cerrar();
      }
    });

    it("desde otro equipo, o con un Host de fuera, sigue pidiendo entrar", async () => {
      expect((await desde("/", { incoming: { socket: { remoteAddress: "192.168.1.30" } } }, "192.168.1.10:3939")).headers.get("location")).toBe("/configurar");
      expect((await desde("/", LOCAL, "malo.example.com")).headers.get("location")).toBe("/configurar");
      expect((await app.request("/")).headers.get("location")).toBe("/configurar");
    });

    it("apagada, pide la configuración inicial como siempre", async () => {
      app = crearWeb(ctx, { entradaDirecta: false });
      expect((await desde("/", LOCAL)).headers.get("location")).toBe("/configurar");
    });
  });

  it("los datos de la empresa se completan y corrigen desde Ajustes", async () => {
    await guardarUsuario(ctx, { id: 1, nombre: "Dueño", email: "dueno@demo.pe", rol: "dueno", clave: "clave-segura" });
    const cookie = await entrar();
    let r = await post(cookie, "/ajustes/empresa", { ruc: "123", razonSocial: "X", direccion: "Y", ubigeo: "150101", registroMtc: "M" });
    expect(aviso(r)).toContain("RUC no es válido");
    r = await post(cookie, "/ajustes/empresa", {
      ruc: "20606433094", razonSocial: "TRANSPORTES NUEVOS SAC", direccion: "AV. NUEVA 1", ubigeo: "150101", registroMtc: "MTC-9", cuentaDetraccion: "",
    });
    expect(aviso(r)).toContain("ok=");
    const emp = await obtenerEmpresa(ctx);
    expect([emp?.razonSocial, emp?.registroMtc, emp?.cuentaDetraccionBn]).toEqual(["TRANSPORTES NUEVOS SAC", "MTC-9", null]);
    expect(await (await app.request("/ajustes", { headers: { cookie } })).text()).toContain("TRANSPORTES NUEVOS SAC");
  });

  describe("SUNAT en Este dispositivo y valores referenciales", () => {
    const servicios = {
      estado: () => ({ plataforma: "pc" as const, archivoAjustes: ".env", bot: { estado: "sin_token" as const }, sunat: { modo: "simulado" as const }, ia: { lector: "reglas" as const, voz: false }, codigoRegistro: null }),
      ajustes: () => ({}) as Record<string, string>,
      guardarAjustes: async () => {},
      alConfigurar: async () => {},
    };
    const postForm = (cookie: string, ruta: string, datos: Record<string, string>) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(datos)) fd.set(k, v);
      return app.request(ruta, { method: "POST", headers: { cookie, origin: ORIGEN }, body: fd });
    };
    beforeEach(async () => {
      await guardarUsuario(ctx, { id: 1, nombre: "Dueño", email: "dueno@demo.pe", rol: "dueno", clave: "clave-segura" });
      app = crearWeb(ctx, { servicios });
    });
    const claves = { SUNAT_SOL_USUARIO: "MODDATOS", SUNAT_SOL_CLAVE: "x", SUNAT_GRE_CLIENT_ID: "id", SUNAT_GRE_CLIENT_SECRET: "sec", SUNAT_CERT_PASSWORD: "c" };

    it("probar conexión sin certificado pide subirlo", async () => {
      const cookie = await entrar();
      const r = await postForm(cookie, "/ajustes/dispositivo/probar", { ...claves, SUNAT_MODO: "simulado" });
      expect(r.status).toBe(200);
      expect(await r.text()).toContain("Sube tu certificado digital");
    });

    it("probar guarda lo escrito sin tocar el modo y luego Real se guarda sin repetir secretos", async () => {
      const dir = mkdtempSync(join(tmpdir(), "sunat-"));
      const guardado: Record<string, string> = { SUNAT_MODO: "simulado" };
      const sv = {
        ...servicios,
        estado: () => ({ ...servicios.estado(), sunat: { modo: guardado.SUNAT_MODO as "simulado" | "beta" | "real" } }),
        ajustes: () => ({ ...guardado }),
        guardarAjustes: async (cambios: Record<string, string | null>, cert?: Buffer) => {
          if (cert) { const ruta = join(dir, "c.pfx"); writeFileSync(ruta, cert); cambios = { ...cambios, SUNAT_CERT_PATH: ruta }; }
          for (const [k, v] of Object.entries(cambios)) { if (v === null) delete guardado[k]; else guardado[k] = v; }
        },
      };
      app = crearWeb(ctx, { servicios: sv });
      const cookie = await entrar();
      prueba.simularTodoOk = true;
      try {
        const fd = new FormData();
        for (const [k, v] of Object.entries({ ...claves, SUNAT_MODO: "real" })) fd.set(k, v);
        fd.set("certificado", new File([Buffer.from("pfx-de-prueba")], "c.pfx"));
        const r = await app.request("/ajustes/dispositivo/probar", { method: "POST", headers: { cookie, origin: ORIGEN }, body: fd });
        expect(r.status).toBe(200);
        expect(guardado.SUNAT_MODO).toBe("simulado");
        expect(guardado.SUNAT_SOL_CLAVE).toBe("x");
        const r2 = await postForm(cookie, "/ajustes/dispositivo", { SUNAT_MODO: "real", SUNAT_SOL_USUARIO: "MODDATOS", SUNAT_GRE_CLIENT_ID: "id" });
        expect(decodeURIComponent(aviso(r2).replace(/\+/g, " "))).toContain("Ajustes guardados");
        expect(guardado.SUNAT_MODO).toBe("real");
      } finally {
        prueba.simularTodoOk = false;
      }
    });

    it("el modo Real se bloquea sin una prueba previa con esos datos", async () => {
      const cookie = await entrar();
      const fd = new FormData();
      for (const [k, v] of Object.entries({ ...claves, SUNAT_MODO: "real" })) fd.set(k, v);
      fd.set("certificado", new File([Buffer.from("no-es-pfx")], "c.pfx"));
      const r = await app.request("/ajustes/dispositivo", { method: "POST", headers: { cookie, origin: ORIGEN }, body: fd });
      expect(decodeURIComponent(aviso(r).replace(/\+/g, " "))).toContain("toca PROBAR CONEXIÓN");
    });

    /** Servicios que guardan en memoria, como el `.env` real. */
    function serviciosEnMemoria(guardado: Record<string, string>, error?: string) {
      return {
        ...servicios,
        estado: () => ({ ...servicios.estado(), sunat: { modo: (guardado.SUNAT_MODO ?? "simulado") as "simulado" | "beta" | "real", ...(error ? { error } : {}) } }),
        ajustes: () => ({ ...guardado }),
        guardarAjustes: async (cambios: Record<string, string | null>) => {
          for (const [k, v] of Object.entries(cambios)) { if (v === null) delete guardado[k]; else guardado[k] = v; }
        },
      };
    }
    const texto = (r: Response) => decodeURIComponent(aviso(r).replace(/\+/g, " "));

    it("probar conexión nunca llama a SUNAT de verdad en las pruebas y no repite el login de guías si la clave SOL falla", async () => {
      prueba.llamadasSunat = 0;
      app = crearWeb(ctx, { servicios: serviciosEnMemoria({ SUNAT_MODO: "simulado" }) });
      const cookie = await entrar();
      const r = await postForm(cookie, "/ajustes/dispositivo/probar", { ...claves, SUNAT_MODO: "simulado" });
      expect(await r.text()).toContain("No se probó: primero corrige usuario/clave SOL");
      expect(prueba.llamadasSunat).toBe(1);
    });

    it("probar conexión: como mucho una vez por minuto", async () => {
      const cookie = await entrar();
      expect((await postForm(cookie, "/ajustes/dispositivo/probar", { ...claves })).status).toBe(200);
      const r = await postForm(cookie, "/ajustes/dispositivo/probar", { ...claves });
      expect(r.status).toBe(303);
      expect(texto(r)).toContain("Espera un minuto antes de volver a probar");
    });

    it("en modo Real, probar no guarda lo escrito si la prueba falla; si sale todo bien, sí", async () => {
      const guardado: Record<string, string> = {
        SUNAT_MODO: "real", SUNAT_SOL_USUARIO: "USU1", SUNAT_SOL_CLAVE: "buena", SUNAT_GRE_CLIENT_ID: "id", SUNAT_GRE_CLIENT_SECRET: "sec",
        SUNAT_CERT_PASSWORD: "c", SUNAT_CERT_PATH: "no-existe.pfx",
      };
      app = crearWeb(ctx, { servicios: serviciosEnMemoria(guardado) });
      const cookie = await entrar();
      const r = await postForm(cookie, "/ajustes/dispositivo/probar", { SUNAT_SOL_CLAVE: "mala" });
      expect(r.status).toBe(200);
      expect(await r.text()).toContain("no se guardó");
      expect(guardado.SUNAT_SOL_CLAVE).toBe("buena");

      app = crearWeb(ctx, { servicios: serviciosEnMemoria(guardado) });
      prueba.simularTodoOk = true;
      try {
        expect((await postForm(cookie, "/ajustes/dispositivo/probar", { SUNAT_SOL_CLAVE: "nueva" })).status).toBe(200);
      } finally {
        prueba.simularTodoOk = false;
      }
      expect(guardado.SUNAT_SOL_CLAVE).toBe("nueva");
      expect(guardado.SUNAT_MODO).toBe("real");
    });

    it("no deja cambiar el modo SUNAT con documentos pendientes de envío", async () => {
      const guardado: Record<string, string> = { SUNAT_MODO: "simulado" };
      app = crearWeb(ctx, { servicios: serviciosEnMemoria(guardado) });
      const guiaId = await registrarGuiaBorrador(ctx, entradaGuia());
      await ctx.db.update(guiaTransportista).set({ estado: "pendiente_envio" }).where(eq(guiaTransportista.id, guiaId));
      const cookie = await entrar();
      const r = await postForm(cookie, "/ajustes/dispositivo", { SUNAT_MODO: "beta" });
      expect(texto(r)).toContain("Primero termina de enviar los documentos pendientes (1)");
      expect(guardado.SUNAT_MODO).toBe("simulado");
      // Sin cambiar el modo, el resto de ajustes sí se guarda.
      expect(texto(await postForm(cookie, "/ajustes/dispositivo", { SUNAT_MODO: "simulado", BOT_HORA_AVISO: "07:00" }))).toContain("Ajustes guardados");
      expect(guardado.BOT_HORA_AVISO).toBe("07:00");
    });

    it("REINTENTAR AHORA no reanuda si la configuración de SUNAT no carga", async () => {
      app = crearWeb(ctx, { servicios: serviciosEnMemoria({ SUNAT_MODO: "real" }, "No se pudo usar SUNAT real: certificado") });
      await pausarSunat(ctx, "No se pudo usar SUNAT real: certificado", { porConfig: true });
      const cookie = await entrar();
      const r = await postForm(cookie, "/ajustes/dispositivo/reanudar", {});
      expect(texto(r)).toContain("Primero corrige los ajustes de SUNAT");
      expect(await leerPausaSunat(ctx)).not.toBeNull();
    });

    it("la guía para sacar tus accesos pide también el permiso de consulta del usuario SOL", async () => {
      const cookie = await entrar();
      expect(await (await app.request("/ajustes/dispositivo", { headers: { cookie } })).text()).toContain("consulta de comprobantes");
    });

    it("valor referencial: mismo tope que el bot (más de cero y hasta S/ 1,000 por TM)", async () => {
      const cookie = await entrar();
      const alto = await post(cookie, "/rutas/vr", { partidaUbigeo: "040101", llegadaUbigeo: "210101", vrPorTm: "1000.01" });
      expect(texto(alto)).toContain("Ese valor parece muy alto. Escríbelo por tonelada, p. ej. 85.50");
      // Cero ya no pasa parsearMonto ("no válido"): tampoco se guarda.
      expect(texto(await post(cookie, "/rutas/vr", { partidaUbigeo: "040101", llegadaUbigeo: "210101", vrPorTm: "0" }))).toContain("error=");
      expect(await listarValoresReferenciales(ctx)).toEqual([]);
      expect(texto(await post(cookie, "/rutas/vr", { partidaUbigeo: "040101", llegadaUbigeo: "210101", vrPorTm: "1000" }))).toContain("Valor");
    });

    it("avisa del retorno al vacío al facturar una guía de cisterna", async () => {
      const guiaId = await registrarGuiaBorrador(ctx, entradaGuia());
      await emitirGuia(ctx, guiaId);
      const cookie = await entrar();
      expect(await (await app.request("/viajes", { headers: { cookie } })).text()).not.toContain(AVISO_RETORNO_VACIO);
      await ctx.db.update(vehiculo).set({ semirremolque: "cisterna" });
      expect(await (await app.request("/viajes", { headers: { cookie } })).text()).toContain(AVISO_RETORNO_VACIO);
    });

    it("guarda y borra un valor referencial por ruta", async () => {
      const cookie = await entrar();
      const r = await post(cookie, "/rutas/vr", { partidaUbigeo: "040101", llegadaUbigeo: "210101", vrPorTm: "85.50" });
      expect(r.status).toBe(303);
      expect(aviso(r)).toContain("Valor");
      expect(await listarValoresReferenciales(ctx)).toMatchObject([{ partidaUbigeo: "040101", llegadaUbigeo: "210101", vrPorTm: 8550 }]);
      expect(await (await app.request("/rutas", { headers: { cookie } })).text()).toContain("040101");
      await post(cookie, "/rutas/vr/borrar", { partidaUbigeo: "040101", llegadaUbigeo: "210101" });
      expect(await listarValoresReferenciales(ctx)).toEqual([]);
    });
  });
});
