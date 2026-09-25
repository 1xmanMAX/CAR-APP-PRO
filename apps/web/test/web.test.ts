import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buscarUnidad, crearEnlaceWeb, guardarUsuario, listarEventos, listarViajesFlota, partesDeUnidad, instalarParte, listarTiposParte, type Contexto } from "@sunatapp/core";
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
});
