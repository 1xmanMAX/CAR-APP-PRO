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
  AVISO_RETORNO_VACIO, emitirFactura, emitirGuia, leerPausaSunat, MAX_INTENTOS, MENSAJE_VERIFICAR_EN_SOL, pausarSunat, prepararFactura, registrarGuiaBorrador, listarValoresReferenciales,
  buscarUnidad, crearCategoria, crearEnlaceWeb, guardarUsuario, registrarGasto, registrarViajeFlota, listarEventos, listarUsuarios, listarViajesFlota, obtenerEmpresa, partesDeUnidad, crearRepuesto, listarCostosFijos, listarPrestamos, listarReparaciones, listarRepuestos, piezasDeTipo, instalarParte, listarTiposParte, liquidacionViaje,
  type Contexto,
} from "@sunatapp/core";
import { crearDb, eq, factura, gasto, guiaTransportista, vehiculo } from "../../../packages/db/src/index";
import { crearContextoPrueba, entradaGuia, prepararDatosTransporte } from "../../../packages/core/test/helpers";
import { crearWeb } from "../src/app";
import { tiposAnotar } from "../src/lugares";
import { atenciones, elegirAvisos, enOracion, textoGanancia } from "../src/paginas/dashboard";
import { AsiQuedaBloque } from "../src/paginas/anotar";
import { conParametros } from "../src/redirecciones";

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

  it("tipos de Anotar según el rol", () => {
    expect(tiposAnotar("taller")).toEqual(["repare"]);
    expect(tiposAnotar("contador")).toEqual(["gaste", "chofer", "cobro", "empresa", "prestamo"]);
    expect(tiposAnotar("dueno")).toHaveLength(6);
    expect(tiposAnotar("chofer")).toEqual([]);
  });

  it("inicio: la tarjeta dice ganaste o perdiste y compara bien con el mes anterior", () => {
    expect(textoGanancia(845000, 712000, "2026-09")).toEqual({ etiqueta: "Ganaste este mes", monto: "S/\u00a08,450", sub: "Mejor que septiembre (ganaste S/\u00a07,120)", perdida: false });
    expect(textoGanancia(-2825400, 5559900, "2026-09")).toEqual({ etiqueta: "Perdiste este mes", monto: "S/\u00a028,254", sub: "Peor que septiembre (ganaste S/\u00a055,599)", perdida: true });
    expect(textoGanancia(-10000, -50000, "2026-09").sub).toBe("Mejor que septiembre (perdiste S/\u00a0500)");
    expect(textoGanancia(0, 0, "2026-08").sub).toBe("Igual que agosto (S/\u00a00)");
    expect(textoGanancia(30000, 30000, "2026-08").sub).toBe("Igual que agosto (ganaste S/\u00a0300)");
  });

  it("inicio: las fotos por confirmar nunca se quedan fuera; luego lo urgente; todos con ?ver=atencion", () => {
    const urgentes = Array.from({ length: 6 }, (_, i) => ({ color: "cambiar" as const, texto: `urgente ${i}`, href: "/" }));
    const items = [{ color: "proximo" as const, texto: "SUNAT", href: "/" }, ...urgentes, { color: "proximo" as const, texto: "2 fotos por confirmar", href: "/revisar", fijo: true }];
    const cinco = elegirAvisos(items, false);
    expect(cinco.map((a) => a.texto)).toEqual(["2 fotos por confirmar", "urgente 0", "urgente 1", "urgente 2", "urgente 3"]);
    const todos = elegirAvisos(items, true);
    expect(todos).toHaveLength(8);
    expect(todos.at(-1)!.texto).toBe("SUNAT");
    expect(enOracion("FRENOS SEMIRREMOLQUE")).toBe("Frenos semirremolque");
    expect(enOracion("ACEITE + FILTRO")).toBe("Aceite + filtro");
    expect(enOracion("Llanta delantera")).toBe("Llanta delantera");
  });

  it("las redirecciones conservan solo los parámetros útiles", () => {
    expect(conParametros("/camiones/2", { pieza: "faro-der", ok: "x" }, ["pieza"])).toBe("/camiones/2?pieza=faro-der");
    expect(conParametros("/camiones?tab=repuestos", { q: "filtro" }, ["q"])).toBe("/camiones?tab=repuestos&q=filtro");
    expect(conParametros("/numeros/caja", {}, ["mes"])).toBe("/numeros/caja");
  });

  describe("con el dueño configurado", () => {
    beforeEach(async () => {
      await guardarUsuario(ctx, { id: 1, nombre: "Dueño", email: "dueno@demo.pe", rol: "dueno", clave: "clave-segura" });
    });

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

    it("inicio: ganaste, entró/salió/te deben, en ruta y lo que necesita atención", async () => {
      const cookie = await entrar();
      const v = await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Yura", destinoLugar: "Puno", estado: "en_curso", origen: "web" });
      const html = await (await app.request("/", { headers: { cookie } })).text();
      for (const t of ["Ganaste este mes", "Entró", "Salió", "Te deben", "Necesita tu atención", "En ruta ahora", "Yura → Puno", "SUNAT en modo simulado"]) {
        expect(html, t).toContain(t);
      }
      expect(html).toContain(`href="/viajes/${v.id}"`);
      expect(html).toMatch(/<a class="btn-icono solo-movil" href="\/ajustes" aria-label="Ajustes">/);
      expect(html).not.toContain("TELEGRAM · ENTRADAS DEL BOT");
      expect(html).not.toContain("GASTOS · POR CATEGORÍA");
    });

    it("inicio: mes con pérdida, bot apagado en ámbar y la lista completa de avisos", async () => {
      const cookie = await entrar();
      await registrarGasto(ctx, { categoria: "peaje", monto: 500000, origen: "web" });
      const html = await (await app.request("/", { headers: { cookie } })).text();
      expect(html).toContain("Perdiste este mes");
      expect(html).not.toContain("Ganaste este mes");
      expect(html).not.toMatch(/cifra-grande[^>]*>-S\//);
      const lista = await atenciones(ctx, "dueno", { empresa: "X", botEnLinea: false, simulado: true });
      expect(lista.find((a) => a.texto.includes("bot de Telegram"))).toMatchObject({ color: "proximo" });
      const todos = await (await app.request("/?ver=atencion", { headers: { cookie } })).text();
      expect(todos).toContain("Necesita tu atención");
      expect(todos).toContain("SUNAT en modo simulado");
    });

    it("inicio del taller: sin plata", async () => {
      await guardarUsuario(ctx, { nombre: "Taller", email: "taller@demo.pe", rol: "taller", clave: "clave-segura" });
      const html = await (await app.request("/", { headers: { cookie: await entrar("taller@demo.pe") } })).text();
      expect(html).toContain("Necesita tu atención");
      expect(html).not.toContain("Ganaste este mes");
      expect(html).not.toContain("En ruta ahora");
      expect(html).not.toContain('aria-label="Ajustes"');
    });

    describe("anotar", () => {
      const enviar = (cookie: string, datos: Record<string, string>) => {
        const fd = new FormData();
        for (const [k, v] of Object.entries(datos)) fd.set(k, v);
        return app.request("/anotar", { method: "POST", headers: { cookie, origin: ORIGEN }, body: fd });
      };

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
        // Los montos llevan espacio duro después de «S/» (nunca se parten en dos líneas).
        const asi = async (qs: string) => (await (await app.request(`/anotar/asi-queda?${qs}`, { headers: { cookie } })).text());
        const q = await asi(`tipo=gaste&monto=350&viajeId=${v.id}&categoria=combustible`);
        expect(q).toContain("Así queda después de guardar");
        expect(q).toContain("El viaje deja S/\u00a03,150");
        expect(q).toContain("Combustible del viaje: S/\u00a0350");
        expect(q).not.toMatch(/S\/ \d/);
        // Sin plata entregada: con su efectivo (automático) se le debe al chofer; con tarjeta, no hay línea del chofer.
        expect(q).toContain("Le debes S/\u00a0350 a Jhon");
        const tarjeta = await asi(`tipo=gaste&monto=350&viajeId=${v.id}&categoria=combustible&medioPago=tarjeta`);
        expect(tarjeta).not.toContain("Le debes");
        expect(tarjeta).not.toContain("le quedan");
        expect(tarjeta).toContain("El viaje deja");
        // Si el gasto se come todo el flete: «pierde», no «deja -S/».
        const pierde = await asi(`tipo=gaste&monto=3,550&viajeId=${v.id}&categoria=combustible`);
        expect(pierde).toContain("El viaje pierde S/\u00a050 (antes dejaba S/\u00a03,500)");
        // Plata al chofer: solo cuánto le queda; sin monto, solo la explicación.
        const e = await asi(`tipo=chofer&monto=100&viajeId=${v.id}`);
        expect(e).toContain("A Jhon le quedan S/\u00a0100 de S/\u00a0100");
        expect(e).not.toContain("El viaje deja");
        const vacio = await (await app.request(`/anotar/asi-queda?tipo=gaste&monto=&viajeId=${v.id}`, { headers: { cookie } })).text();
        expect(vacio).toContain("Escribe el monto");
      });

      it("Así queda: sin nombre del chofer dice «al chofer», nunca «a el chofer»", async () => {
        const chofer = (quedaDespues: number) => ({ chofer: { nombre: "el chofer", entregado: 10000, quedaAntes: 10000, quedaDespues }, viaje: null, categoria: null });
        const queda = String(await AsiQuedaBloque({ r: chofer(4000) }));
        expect(queda).toContain("Al chofer le quedan S/\u00a040 de S/\u00a0100");
        const debe = String(await AsiQuedaBloque({ r: chofer(-4000) }));
        expect(debe).toContain("Le debes S/\u00a040 al chofer");
        expect(queda + debe).not.toMatch(/a el chofer|A el chofer/);
      });

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
        expect(aviso(r)).toContain("ok=Entrega de S/\u00a0500.00 anotada");
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

      const sePoneSolo = (html: string) => /<b class="lbl">Se pone solo<\/b><span>([^<]*)<\/span>/.exec(html)?.[1] ?? "";

      it("«Se pone solo» en palabras simples: camión, viaje con su ruta, hora y km; sin códigos", async () => {
        const cookie = await entrar();
        let texto = sePoneSolo(await (await app.request("/anotar", { headers: { cookie } })).text());
        expect(texto).toMatch(/^Camión \S+ · sin viaje · hoy \d\d:\d\d/);
        await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Juliaca", destinoLugar: "Arequipa", estado: "en_curso", origen: "web" });
        texto = sePoneSolo(await (await app.request("/anotar", { headers: { cookie } })).text());
        expect(texto).toMatch(/^Camión \S+ · viaje Juliaca → Arequipa · hoy \d\d:\d\d · km [\d,]+$/);
        expect(texto).not.toContain("VJ-");
        expect(texto).not.toContain("?");
        texto = sePoneSolo(await (await app.request("/anotar?tipo=chofer", { headers: { cookie } })).text());
        expect(texto).toMatch(/^Camión \S+ · viaje Juliaca → Arequipa · .+ · hoy \d\d:\d\d$/);
      });

      it("el taller ve el botón Anotar (para Reparé / repuesto)", async () => {
        await guardarUsuario(ctx, { nombre: "Taller", email: "taller@demo.pe", rol: "taller", clave: "clave-segura" });
        const html = await (await app.request("/", { headers: { cookie: await entrar("taller@demo.pe") } })).text();
        expect(html).toContain('aria-label="Anotar"');
        expect(html).toContain("anotar-lateral");
        const dueno = await (await app.request("/", { headers: { cookie: await entrar() } })).text();
        expect(dueno).toContain('aria-label="Anotar"');
      });

      it("si no se pudo guardar, vuelve con el monto y la categoría puestos", async () => {
        const cookie = await entrar();
        const r = await enviar(cookie, { tipo: "gaste", volver: "/viajes", monto: "35", categoria: "peaje", viajeId: "99999", vehiculoId: "1" });
        const destino = r.headers.get("location")!;
        expect(destino).toMatch(/^\/anotar\?/);
        expect(destino).toContain("monto=35");
        expect(destino).toContain("categoria=peaje");
        expect(aviso(r)).toContain("error=");
        const html = await (await app.request(destino, { headers: { cookie } })).text();
        expect(html).toMatch(/name="monto"[^>]*value="35"/);
        expect(html).toMatch(/value="peaje" checked/);
        const otro = await enviar(cookie, { tipo: "gaste", volver: "/", monto: "abc", categoria: "otro", categoriaOtra: "balanza", vehiculoId: "1" });
        const html2 = await (await app.request(otro.headers.get("location")!, { headers: { cookie } })).text();
        expect(html2).toMatch(/value="otro" checked/);
        expect(html2).toMatch(/<option value="balanza" selected/);
      });

      it("una factura que ya no se debe no se cambia sola por otra", async () => {
        const cookie = await entrar();
        const html = await (await app.request("/anotar?tipo=cobro&facturaId=999", { headers: { cookie } })).text();
        expect(html).toContain("Esa factura ya está pagada");
        expect(html).not.toContain('name="facturaId"');
      });

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

      it("Gasto de la empresa no ofrece cuotas de préstamo (se pagan en «Préstamo o cuota») y empieza sin elegir", async () => {
        const cookie = await entrar();
        const html = await (await app.request("/anotar?tipo=empresa", { headers: { cookie } })).text();
        expect(html).not.toContain('value="cuota_prestamo"');
        expect(html).toMatch(/<select name="categoria" required=""><option value="">Elige/);
        const r = await enviar(cookie, { tipo: "empresa", volver: "/", monto: "500", categoria: "cuota_prestamo" });
        expect(aviso(r)).toContain("error=");
        expect(aviso(r)).toContain("Préstamo o cuota");
        expect((await ctx.db.select().from(gasto)).filter((g) => g.categoria === "cuota_prestamo")).toHaveLength(0);
      });

      it("Reparé con pieza y sin tipo elegido se guarda como reparación (gasto variable), sin exigir qué se hizo", async () => {
        const cookie = await entrar();
        const t01 = (await buscarUnidad(ctx, "T-01"))!;
        const html = await (await app.request(`/anotar?tipo=repare&vehiculoId=${t01.id}`, { headers: { cookie } })).text();
        expect(html).toMatch(/<select name="tipoReparacion"><option value="" selected="">Automático/);
        const r = await enviar(cookie, { tipo: "repare", volver: "/", vehiculoId: String(t01.id), componente: "retrovisor-izq", trabajo: "", manoObra: "60", tipoReparacion: "" });
        expect(aviso(r)).toContain("ok=Guardado en Retrovisor");
        const [g] = await ctx.db.select().from(gasto);
        expect(g).toMatchObject({ categoria: "reparacion_ruta", monto: 6000 });
      });

      it("Reparé desde una pieza del 3D deja elegida la parte que va ahí y lo dice", async () => {
        const cookie = await entrar();
        const t01 = (await buscarUnidad(ctx, "T-01"))!;
        const aceite = (await listarTiposParte(ctx)).find((t) => t.codigo === "aceite")!;
        await instalarParte(ctx, { vehiculoId: t01.id, tipoParteId: aceite.id });
        const [p] = await partesDeUnidad(ctx, t01.id);
        const [idPieza] = piezasDeTipo(aceite);
        const html = await (await app.request(`/anotar?tipo=repare&vehiculoId=${t01.id}&pieza=${idPieza}`, { headers: { cookie } })).text();
        expect(html).toMatch(new RegExp(`<option value="${p!.id}" selected`));
        expect(html).toContain(`Se reinicia el contador de ${p!.nombre}`);
      });

      it("una cuota vencida se ve en rojo con los días", async () => {
        const cookie = await entrar();
        await enviar(cookie, { tipo: "prestamo", modo: "nuevo", volver: "/", entidad: "Caja Tacna", monto: "1000", tasa: "10", cuotas: "6", fecha: "2020-01-01" });
        const html = await (await app.request("/anotar?tipo=prestamo", { headers: { cookie } })).text();
        expect(html).toMatch(/class="vencida">vencida hace \d+ días/);
        expect(await (await app.request("/anotar?tipo=prestamo&modo=nuevo", { headers: { cookie } })).text()).toContain("¿Qué interés al año? (%)");
      });
    });

    it("gasto mínimo: solo monto y categoría; el resto se completa solo", async () => {
      const cookie = await entrar();
      await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Juliaca", destinoLugar: "Arequipa", estado: "en_curso", origen: "web" });
      const html = await (await app.request("/anotar", { headers: { cookie } })).text();
      expect(html).toContain("Se pone solo");
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
      expect(html).toContain("Fijo asignado");
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
      for (const ruta of ["/", "/camiones/1", "/camiones/1?tab=historial", "/camiones/1?tab=repuestos", "/camiones/1?tab=datos", "/camiones/nuevo", "/viajes", "/finanzas", "/rentabilidad", "/telegram", "/ajustes", "/api/feed"]) {
        const r = await app.request(ruta, { headers: { cookie } });
        expect(r.status, ruta).toBe(200);
      }
    });

    it("cada pieza del modelo 3D guarda su historial y se ve resaltada", async () => {
      const cookie = await entrar();
      // Un incidente sin costo en una pieza concreta.
      let r = await post(cookie, "/trailer/1/pieza", { componente: "retrovisor-izq", tipo: "falla_en_ruta", trabajo: "Se abrió el retrovisor", fecha: "2026-09-10" });
      expect(r.headers.get("location")).toContain("/camiones/1?pieza=retrovisor-izq");
      expect(aviso(r)).toContain("ok=");
      // Un cambio de llanta con mano de obra.
      r = await post(cookie, "/trailer/1/pieza", { componente: "llanta-sr2-der-ext", tipo: "correctivo", trabajo: "Cambio de llanta", manoObra: "80" });
      expect(aviso(r)).toContain("ok=");
      expect(aviso(await post(cookie, "/trailer/1/pieza", { componente: "no-existe", trabajo: "x" }))).toContain("error=");
      expect(aviso(await post(cookie, "/trailer/1/pieza", { componente: "faro-der", trabajo: "" }))).toContain("error=");

      const pag = await (await app.request("/camiones/1?pieza=llanta-sr2-der-ext", { headers: { cookie } })).text();
      const datos = JSON.parse(pag.match(/<script[^>]*id="datos-visor"[^>]*>([\s\S]*?)<\/script>/)![1]!);
      expect(datos.piezaSeleccionada).toBe("llanta-sr2-der-ext");
      expect(datos.piezas.length).toBeGreaterThan(50);
      expect(datos.historial["retrovisor-izq"][0].trabajo).toBe("Se abrió el retrovisor");
      expect(datos.historial["llanta-sr2-der-ext"][0].costo).toContain("80");
      // En Reparaciones se ve la pieza con el enlace para ubicarla en el modelo.
      const rep = await (await app.request("/camiones/1?tab=historial", { headers: { cookie } })).text();
      expect(rep).toContain("/camiones/1?pieza=llanta-sr2-der-ext");
      expect(rep).toContain("Llanta semirremolque eje 2 · derecha exterior");
    });

    it("cada repuesto dice en qué piezas va y se ve en el 3D", async () => {
      const cookie = await entrar();
      let r = await post(cookie, "/inventario/repuesto", { nombre: "Luna de retrovisor", categoria: "Otros", piezas: "retrovisor-izq" });
      expect(aviso(r)).toContain("ok=");
      const inv = await (await app.request("/camiones/1?tab=repuestos", { headers: { cookie } })).text();
      expect(inv).toContain("1 pieza: Retrovisor · izquierda");
      expect(inv).toMatch(/href="\/camiones\/1\?repuesto=\d+"/);
      const id = Number(/\/camiones\/1\?repuesto=(\d+)/.exec(inv)![1]);
      // Cambiar a los dos retrovisores (varios valores del mismo campo).
      const cuerpo = new URLSearchParams([["piezas", "retrovisor-izq"], ["piezas", "retrovisor-der"]]);
      r = await app.request(`/inventario/repuesto/${id}/piezas`, { method: "POST", headers: { cookie, origin: ORIGEN }, body: cuerpo });
      expect(aviso(r)).toContain("ok=");
      const pag = await (await app.request(`/camiones/1?repuesto=${id}`, { headers: { cookie } })).text();
      const datos = JSON.parse(pag.match(/<script[^>]*id="datos-visor"[^>]*>([\s\S]*?)<\/script>/)![1]!);
      expect(datos.resaltar).toEqual({ titulo: expect.stringContaining("Luna de retrovisor"), piezas: ["retrovisor-izq", "retrovisor-der"] });
      expect(datos.repuestosPieza["retrovisor-der"]).toEqual([expect.objectContaining({ id, stock: 0 })]);
    });

    it("viajes: en ruta arriba, lista del mes y el detalle con todo del viaje", async () => {
      const cookie = await entrar();
      const cerrado = await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Arequipa", destinoLugar: "Juliaca", estado: "cerrado", km: 300, flete: 320000, origen: "web" });
      await registrarGasto(ctx, { viajeId: cerrado.id, categoria: "combustible", monto: 106000, origen: "web" });
      const enRuta = await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Yura", destinoLugar: "Puno", estado: "en_curso", flete: 350000, origen: "web" });
      const lista = await (await app.request("/viajes", { headers: { cookie } })).text();
      for (const t of ["En ruta", "Yura → Puno", "Arequipa → Juliaca", "S/ 2,140", "+ Nuevo viaje"]) expect(lista, t).toContain(t);
      const det = await (await app.request(`/viajes/${enRuta.id}`, { headers: { cookie } })).text();
      for (const t of ["Este viaje te deja", "S/ 3,500", "Le diste a Jhon", "Le queda", "Gastos del viaje", "Papeles y cobro", "+ Anotar", "Cerrar viaje", "Ver más"]) expect(det, t).toContain(t);
      expect(det).toContain(`/anotar?tipo=gaste&amp;viajeId=${enRuta.id}`);
      // El cierre pide solo lo que falta: este viaje ya tiene flete pero no km.
      const cierre = det.slice(det.indexOf(`action="/viajes/${enRuta.id}/cerrar"`), det.indexOf("Cerrar el viaje"));
      expect(cierre).toContain('name="km"');
      expect(cierre).not.toContain('name="flete"');
    });

    it("viaje sin flete ni plata: palabras de la calle, sin códigos ni «?»", async () => {
      const cookie = await entrar();
      await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Arequipa", destinoLugar: "Juliaca", estado: "cerrado", km: 300, flete: 320000, origen: "web" });
      const v = await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Yura", destinoLugar: "Puno", estado: "en_curso", origen: "web" });
      const guiaId = await registrarGuiaBorrador(ctx, entradaGuia());
      const lista = await (await app.request("/viajes", { headers: { cookie } })).text();
      expect(lista).toContain("SIN ENVIAR");
      expect(lista).not.toContain("BORRADOR");
      expect(lista).not.toContain("CERRADO");
      expect(lista).not.toContain("-?");
      // La guía nace enlazada sola al viaje en curso del camión.
      const det = await (await app.request(`/viajes/${v.id}`, { headers: { cookie } })).text();
      for (const t of ["Todavía sin flete", "Ponlo al cerrar el viaje", "Todavía no le diste plata a Jhon", "Guía (todavía sin número)", "SIN ENVIAR"]) expect(det, t).toContain(t);
      expect(det).not.toContain("Falta el flete");
      expect(det).not.toContain(`· ${v.codigo}`);
      expect(det).not.toContain(`/guias/${guiaId}/pdf`);
      expect(det).not.toContain("-?");
    });

    it("liquidación del viaje: entregas, gastos, saldo y semáforo", async () => {
      const cookie = await entrar();
      const v = await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Juliaca", destinoLugar: "Arequipa", estado: "en_curso", origen: "web" });
      await registrarGasto(ctx, { viajeId: v.id, categoria: "combustible", monto: 35000, origen: "telegram" });
      let r = await post(cookie, `/viajes/${v.id}/entrega`, { monto: "500", medio: "yape", nota: "Adelanto" });
      expect(aviso(r)).toContain("ok=");
      expect(aviso(await post(cookie, `/viajes/${v.id}/entrega`, { monto: "abc" }))).toContain("error=");
      const html = await (await app.request(`/viajes/${v.id}`, { headers: { cookie } })).text();
      expect(html).toContain("El chofer tiene S/\u00a0150.00 por rendir o devolver");
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
      expect(await (await app.request("/", { headers: { cookie } })).text()).toContain("por confirmar");
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
      expect(html).toContain("Presupuesto del viaje");
      expect(html).toContain("S/\u00a0800 calculados");
      r = await post(cookie, `/viajes/${v.id}/presupuesto`, { m_combustible: "1000", m_viaticos: "50" });
      expect(aviso(r)).toContain("ok=");
      html = await (await app.request(`/viajes/${v.id}`, { headers: { cookie } })).text();
      expect(html).toContain("S/\u00a01,050 calculados");
    });

    it("detalle del viaje: corregir y borrar gastos, cerrar y reabrir", async () => {
      const cookie = await entrar();
      const v = await registrarViajeFlota(ctx, { vehiculoId: 1, origenLugar: "Juliaca", destinoLugar: "Cusco", estado: "en_curso", origen: "web" });
      const g1 = await registrarGasto(ctx, { viajeId: v.id, categoria: "combustible", monto: 30000, origen: "telegram" });
      const g2 = await registrarGasto(ctx, { viajeId: v.id, categoria: "otros_viaje", monto: 5000, origen: "telegram" });
      expect(aviso(await post(cookie, `/viajes/${v.id}/gasto/${g1.id}`, { categoria: "combustible", monto: "305", fecha: "2026-09-13" }))).toContain("ok=");
      expect(aviso(await post(cookie, `/viajes/${v.id}/gasto/${g2.id}/borrar`, {}))).toContain("ok=");
      let html = await (await app.request(`/viajes/${v.id}`, { headers: { cookie } })).text();
      expect(html).toContain("S/\u00a0305.00");
      expect(html).not.toContain("S/\u00a050.00");
      expect(aviso(await post(cookie, `/viajes/${v.id}/cerrar`, { km: "380", flete: "1200" }))).toContain("ok=");
      html = await (await app.request(`/viajes/${v.id}`, { headers: { cookie } })).text();
      expect(html).toContain("Reabrir viaje");
      expect(html).toContain("margen 75%");
      expect(aviso(await post(cookie, `/viajes/${v.id}/reabrir`, {}))).toContain("ok=");
      expect(await (await app.request(`/viajes/${v.id}`, { headers: { cookie } })).text()).toContain("Cerrar viaje");
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

    it("/reparaciones no exige «trabajo» (es opcional ahí); /trailer/:id/pieza sí", async () => {
      const cookie = await entrar();
      const t01 = (await buscarUnidad(ctx, "T-01"))!;
      let r = await post(cookie, "/reparaciones", { vehiculoId: String(t01.id), componente: "retrovisor-izq", trabajo: "", tipo: "correctivo", manoObra: "40" });
      expect(aviso(r)).toContain("ok=Guardado en Retrovisor");
      r = await post(cookie, "/reparaciones", { vehiculoId: String(t01.id), trabajo: "", tipo: "preventivo", manoObra: "30" });
      expect(aviso(r)).toContain("ok=Cambio guardado · Reparación");
      r = await post(cookie, `/trailer/${t01.id}/pieza`, { componente: "retrovisor-izq", trabajo: "" });
      expect(aviso(r)).toContain("error=Escribe qué pasó");
    });

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
    /** `modoConError`: hay un aviso de SUNAT pero el modo pedido sí está andando. */
    function serviciosEnMemoria(guardado: Record<string, string>, error?: string, modoConError = false) {
      return {
        ...servicios,
        estado: () => ({ ...servicios.estado(), sunat: { modo: (error && !modoConError ? "simulado" : guardado.SUNAT_MODO ?? "simulado") as "simulado" | "beta" | "real", ...(error ? { error } : {}) } }),
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

    it("REINTENTAR AHORA sí reanuda una pausa por claves si el modo pedido está andando", async () => {
      app = crearWeb(ctx, { servicios: serviciosEnMemoria({ SUNAT_MODO: "real" }, "aviso viejo de SUNAT", true) });
      await pausarSunat(ctx, "SUNAT rechazó el usuario o la clave SOL");
      const cookie = await entrar();
      const r = await postForm(cookie, "/ajustes/dispositivo/reanudar", {});
      expect(texto(r)).toContain("SUNAT reanudada");
      expect(await leerPausaSunat(ctx)).toBeNull();
    });

    it("REINTENTAR AHORA no reanuda una pausa por claves si el modo pedido no carga (iría al simulador)", async () => {
      app = crearWeb(ctx, { servicios: serviciosEnMemoria({ SUNAT_MODO: "real" }, "No se pudo usar SUNAT real: certificado") });
      await pausarSunat(ctx, "SUNAT rechazó el usuario o la clave SOL");
      const cookie = await entrar();
      expect(texto(await postForm(cookie, "/ajustes/dispositivo/reanudar", {}))).toContain("Primero corrige los ajustes de SUNAT");
      expect(await leerPausaSunat(ctx)).not.toBeNull();
    });

    describe("documentos atascados que esperan al dueño", () => {
      async function facturaPorVerificar(): Promise<{ guiaId: number; facturaId: number }> {
        await prepararDatosTransporte(ctx);
        const guiaId = await registrarGuiaBorrador(ctx, entradaGuia());
        await emitirGuia(ctx, guiaId);
        const { facturaId } = await prepararFactura(ctx, { guiaId, montoCentimos: 50000, incluyeIgv: true, formaPago: "contado" });
        await emitirFactura(ctx, facturaId);
        await ctx.db.update(factura).set({ estadoSunat: "pendiente_envio", codigoRespuesta: "1033", mensajeRespuesta: MENSAJE_VERIFICAR_EN_SOL, proximoIntentoEn: null, rutaCdr: null })
          .where(eq(factura.id, facturaId));
        return { guiaId, facturaId };
      }
      const estadoFactura = async (id: number) => (await ctx.db.select().from(factura).where(eq(factura.id, id)))[0]!;

      it("factura «verifícala en SOL»: no bloquea el cambio de modo y el dueño la confirma aceptada", async () => {
        const guardado: Record<string, string> = { SUNAT_MODO: "simulado" };
        app = crearWeb(ctx, { servicios: serviciosEnMemoria(guardado) });
        const { facturaId } = await facturaPorVerificar();
        const cookie = await entrar();
        const html = await (await app.request("/viajes", { headers: { cookie } })).text();
        expect(html).toContain("YA LA VERIFIQUÉ EN SOL: ESTÁ ACEPTADA");
        expect(html).toContain("NO ESTÁ EN SOL");
        // Inicio avisa (solo al dueño) y lleva al panel de Viajes.
        expect(await (await app.request("/", { headers: { cookie } })).text()).toContain("/viajes#sunat-atascados");
        expect(texto(await postForm(cookie, "/ajustes/dispositivo", { SUNAT_MODO: "beta" }))).toContain("Ajustes guardados");
        expect(guardado.SUNAT_MODO).toBe("beta");
        const r = await post(cookie, `/facturas/${facturaId}/en-sol`, { enSol: "si" });
        expect(texto(r)).toContain("aceptada");
        expect(await estadoFactura(facturaId)).toMatchObject({ estadoSunat: "aceptada", rutaCdr: null });
      });

      it("«no está en SOL» la rechaza y VOLVER A EMITIR la manda con otro número", async () => {
        const { facturaId } = await facturaPorVerificar();
        const cookie = await entrar();
        await post(cookie, `/facturas/${facturaId}/en-sol`, { enSol: "no" });
        expect(await estadoFactura(facturaId)).toMatchObject({ estadoSunat: "rechazada", codigoRespuesta: "NO_EN_SOL" });
        expect(await (await app.request("/viajes", { headers: { cookie } })).text()).toContain("VOLVER A EMITIR");
        const r = await post(cookie, `/facturas/${facturaId}/reemitir`, {});
        expect(texto(r)).toContain("F001-2");
        expect(await estadoFactura(facturaId)).toMatchObject({ estadoSunat: "aceptada", numero: 2 });
      });

      it("guía sin respuesta: VOLVER A CONSULTAR reinicia los intentos", async () => {
        const guiaId = await registrarGuiaBorrador(ctx, entradaGuia());
        await emitirGuia(ctx, guiaId);
        await ctx.db.update(guiaTransportista).set({ estado: "enviada", ticket: "T-1", intentos: MAX_INTENTOS }).where(eq(guiaTransportista.id, guiaId));
        const cookie = await entrar();
        expect(await (await app.request("/viajes", { headers: { cookie } })).text()).toContain("VOLVER A CONSULTAR");
        expect(texto(await post(cookie, `/guias/${guiaId}/reconsultar`, {}))).toContain("Se volverá a consultar");
        expect((await ctx.db.select().from(guiaTransportista).where(eq(guiaTransportista.id, guiaId)))[0]!.intentos).toBe(0);
      });

      it("solo el dueño: el contador no ve los botones ni puede usarlos", async () => {
        const { facturaId } = await facturaPorVerificar();
        await guardarUsuario(ctx, { nombre: "Conta", email: "conta@demo.pe", rol: "contador", clave: "clave-segura" });
        const cookie = await entrar("conta@demo.pe");
        expect(await (await app.request("/viajes", { headers: { cookie } })).text()).not.toContain("NO ESTÁ EN SOL");
        expect(texto(await post(cookie, `/facturas/${facturaId}/en-sol`, { enSol: "si" }))).toContain("Solo el dueño");
        expect(await estadoFactura(facturaId)).toMatchObject({ estadoSunat: "pendiente_envio" });
      });
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
