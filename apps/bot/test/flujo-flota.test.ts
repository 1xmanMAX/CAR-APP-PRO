import { afterEach, describe, expect, it } from "vitest";
import {
  buscarUnidad, crearRepuesto, instalarParte, listarEventos, listarReparaciones, listarTiposParte, listarViajesFlota,
  obtenerRepuesto, partesDeUnidad, registrarCompra, registrarLecturaOdometro, resumenFinanciero,
} from "@sunatapp/core";
import { crearArnes } from "./arnes";
import { leerGasto, leerRuta } from "../src/flujo-flota";

const cerrables: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cerrables.length) await cerrables.pop()!();
});

async function arnes(o: Parameters<typeof crearArnes>[0] = {}) {
  const a = await crearArnes(o);
  cerrables.push(a.cerrar);
  return a;
}

describe("lectores de texto", () => {
  it("leerRuta entiende varias formas", () => {
    expect(leerRuta("Juliaca → Arequipa · 30 ton")).toEqual({ origen: "Juliaca", destino: "Arequipa", toneladas: 30 });
    expect(leerRuta("puno a lima 28.5t")).toEqual({ origen: "Puno", destino: "Lima", toneladas: 28.5 });
    expect(leerRuta("Cusco - Lima")).toEqual({ origen: "Cusco", destino: "Lima", toneladas: null });
    expect(leerRuta("Arequipa")).toBeNull();
  });
  it("leerGasto", () => {
    expect(leerGasto("combustible 480")).toEqual({ categoria: "combustible", monto: 48000, nota: null });
    expect(leerGasto("peaje 35.50 Pampa Cuéllar")).toEqual({ categoria: "peaje", monto: 3550, nota: "Pampa Cuéllar" });
    expect(leerGasto("comida 20")).toMatchObject({ categoria: "viaticos" });
    expect(leerGasto("cosa 20")).toBeNull();
  });
});

describe("comandos de flota", () => {
  it("/viaje con botones de unidad y /fin con el odómetro suman viaje y km a las partes", async () => {
    const a = await arnes();
    const t01 = (await buscarUnidad(a.ctx, "T-01"))!;
    await registrarLecturaOdometro(a.ctx, { vehiculoId: t01.id, km: 411090, origen: "web" });
    const frenos = (await listarTiposParte(a.ctx)).find((t) => t.codigo === "frenos_sr")!;
    await instalarParte(a.ctx, { vehiculoId: t01.id, tipoParteId: frenos.id });

    await a.texto("/viaje inicio");
    // Con una sola unidad igual se pregunta: el chofer confirma cuál sale.
    expect(a.botones().map((b) => b.text)).toEqual(["T-01"]);
    await a.boton(a.botones()[0]!.callback_data);
    await a.texto("Juliaca → Arequipa · 30 ton");
    expect(a.ultimoTexto()).toContain("VIAJE REGISTRADO");
    expect((await buscarUnidad(a.ctx, "T-01"))!.estado).toBe("en_ruta");

    await a.texto("/gasto combustible 480");
    expect(a.ultimoTexto()).toContain("GASTO GUARDADO");
    expect(a.ultimoTexto()).toContain("VJ-0001");

    await a.texto("/fin 412380");
    expect(a.ultimoTexto()).toContain("+1,290 km");
    const [p] = await partesDeUnidad(a.ctx, t01.id);
    expect(p!.uso).toMatchObject({ km: 1290, viajes: 1 });
    const [v] = await listarViajesFlota(a.ctx);
    expect(v).toMatchObject({ km: 1290, costo: 48000, estado: "cerrado", origen: "telegram" });
    const eventos = await listarEventos(a.ctx);
    expect(eventos.map((e) => e.comando)).toEqual(["/fin", "/gasto", "/viaje inicio"]);
  });

  it("/gasto con foto del voucher guarda la imagen y aparece en finanzas", async () => {
    const a = await arnes({ archivos: { foto1: Buffer.from("jpeg") } });
    await a.foto("foto1", 111, "/gasto combustible 480");
    expect(a.ultimoTexto()).toContain("voucher guardado");
    const fin = await resumenFinanciero(a.ctx, "2026-09-01", "2026-09-30");
    expect(fin.gastos).toBe(48000);
    const [e] = await listarEventos(a.ctx);
    expect(e!.texto).toContain("con foto del voucher");
  });

  it("/km avisa una sola vez cuando una parte cruza el 90 %", async () => {
    const a = await arnes();
    const t01 = (await buscarUnidad(a.ctx, "T-01"))!;
    const aceite = (await listarTiposParte(a.ctx)).find((t) => t.codigo === "aceite")!;
    await instalarParte(a.ctx, { vehiculoId: t01.id, tipoParteId: aceite.id, km: 0, viajes: 0 });
    await a.texto("/km 13600");
    const textos = a.textosEnviados();
    expect(textos.some((t) => t.includes("ALERTA · T-01") && t.includes("91%"))).toBe(true);
    const antes = a.textosEnviados().length;
    await a.texto("/km 13700");
    expect(a.textosEnviados().slice(antes).some((t) => t.includes("ALERTA"))).toBe(false);
  });

  it("/cambio guiado reinicia la parte, descuenta stock y crea el gasto", async () => {
    const a = await arnes();
    const t01 = (await buscarUnidad(a.ctx, "T-01"))!;
    const frenos = (await listarTiposParte(a.ctx)).find((t) => t.codigo === "frenos_sr")!;
    await instalarParte(a.ctx, { vehiculoId: t01.id, tipoParteId: frenos.id, fecha: "2026-01-01" });
    const rep = await crearRepuesto(a.ctx, { nombre: "Pastillas", categoria: "Frenos", tipoParteId: frenos.id });
    await registrarCompra(a.ctx, { repuestoId: rep, cantidad: 10, costoUnitario: 18000, origen: "web" });

    await a.texto("/cambio T-01");
    await a.boton(a.botones().find((b) => b.text.startsWith("FRENOS"))!.callback_data);
    // Los frenos del semirremolque están en 3 ejes: pregunta cuál, para marcarlo en el modelo 3D.
    expect(a.ultimoTexto()).toMatch(/^¿Cuál exactamente\?/);
    expect(a.botones().map((b) => b.text)).toEqual(["Eje 1", "Eje 2", "Eje 3", "No sé / varias"]);
    await a.boton(a.botones().find((b) => b.text === "Eje 2")!.callback_data);
    await a.boton(a.botones().find((b) => b.text.startsWith("REP-001"))!.callback_data);
    await a.texto("6");
    await a.texto("150 Taller Juliaca");
    expect(a.textosEnviados().some((t) => t.includes("CAMBIO REGISTRADO · T-01"))).toBe(true);
    expect((await obtenerRepuesto(a.ctx, rep)).stock).toBe(4);
    const [r] = await listarReparaciones(a.ctx);
    expect(r).toMatchObject({ costoTotal: 6 * 18000 + 15000, taller: "Taller Juliaca", origen: "telegram", componente: "freno-sr2" });
    expect((await partesDeUnidad(a.ctx, t01.id))[0]!.uso.dias).toBe(0);
  });

  it("/compra sube el stock", async () => {
    const a = await arnes();
    await crearRepuesto(a.ctx, { nombre: "Filtro de aire", categoria: "Filtros" });
    await a.texto("/compra REP-001 3 160 Repuestos Juliaca");
    expect(a.ultimoTexto()).toContain("Stock: 3");
    await a.texto("/compra XYZ 1 1");
    expect(a.ultimoTexto()).toContain("No encontré");
  });

  it("/estado lista las partes más gastadas", async () => {
    const a = await arnes();
    const t01 = (await buscarUnidad(a.ctx, "T-01"))!;
    const bat = (await listarTiposParte(a.ctx)).find((t) => t.codigo === "bateria")!;
    await instalarParte(a.ctx, { vehiculoId: t01.id, tipoParteId: bat.id, fecha: "2025-01-01" });
    await a.texto("/estado T-01");
    expect(a.ultimoTexto()).toContain("BATERÍA");
  });

  it("un desconocido que escribe /start recibe su ID para que el dueño lo registre", async () => {
    const a = await arnes();
    await a.texto("/start", 999);
    expect(a.ultimoTexto()).toContain("999");
  });
});
