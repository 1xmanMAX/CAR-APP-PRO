import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buscarUnidad, crearEnlaceWeb, guardarUsuario, registrarGasto, registrarViajeFlota, listarEventos, listarUsuarios, listarViajesFlota, obtenerEmpresa, partesDeUnidad, instalarParte, listarTiposParte,
  type Contexto,
} from "@sunatapp/core";
import { crearDb } from "../../../packages/db/src/index";
import { crearContextoPrueba } from "../../../packages/core/test/helpers";
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
});
