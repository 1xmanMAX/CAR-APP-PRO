import { afterEach, describe, expect, it } from "vitest";
import { listarGuias, registrarVehiculo } from "@sunatapp/core";
import { SunatSimulado } from "../../../packages/core/test/helpers";
import { crearArnes } from "./arnes";
import { lineasFixture, pdfConLineas } from "./pdf-prueba";

const cerrables: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cerrables.length) await cerrables.pop()!();
});

type Opciones = Parameters<typeof crearArnes>[0];

/**
 * El fixture del extractor trae las etiquetas de los puntos al revés (formato a dos columnas), así
 * que el lector deja partida y llegada dudosas a propósito. Para los casos en los que el bot no
 * debe preguntar nada se ponen en el orden natural; el caso del distrito usa el fixture tal cual.
 */
const puntosEnOrden = (l: string[]) =>
  l.map((x) => (x === "PUNTO DE LLEGADA" ? "PUNTO DE PARTIDA :" : x === "PUNTO DE PARTIDA :" ? "PUNTO DE LLEGADA" : x));

async function arnes(lineas: string[] = lineasFixture(puntosEnOrden), o: Opciones = {}) {
  const a = await crearArnes({ ...o, archivos: { pdf1: await pdfConLineas(lineas) } });
  cerrables.push(a.cerrar);
  return a;
}

const sinFecha = () => lineasFixture((l) => puntosEnOrden(l).filter((x) => !x.includes("14/09/2026")));

describe("flujo de guía: camino feliz", () => {
  it("lee el PDF, muestra el resumen y emite la guía", async () => {
    const a = await arnes();
    await registrarVehiculo(a.ctx, "XYZ-987");

    await a.documento("pdf1");
    const resumen = a.ultimoTexto();
    expect(resumen.startsWith("🧾 Guía de transportista (borrador)")).toBe(true);
    expect(resumen).toContain("Remitente: DISTRIBUIDORA SAC (20131312955)");
    expect(resumen).toContain("Destinatario: CHOCANO CARGO SAC (20602712592)");
    expect(resumen).toContain("Partida: AV. 28 DE JULIO 1275 LIMA — LA VICTORIA, LIMA");
    expect(resumen).toContain("Llegada: CARRETERA FEDERICO BASADRE KM 86 PUCALLPA — CALLERIA, CORONEL PORTILLO");
    expect(resumen).toContain("Traslado: 14/09/2026 · Peso: 1500.5 KGM");
    expect(resumen).toContain("Vehículo: ABC-123 / XYZ-987 · Conductor: JHON LARRY VELEZMORO SOZA");
    expect(resumen).toContain("Bienes: 1. CAJAS DE CERAMICA — 120 BX");
    expect(resumen).toContain("GRE remitente: EG07-5531");
    expect(a.botones().map((b) => b.callback_data)).toEqual(["g:emitir", "g:corregir", "g:cancelar"]);

    await a.boton("g:emitir");
    expect(a.ultimoTexto()).toBe("📤 Enviando a SUNAT…");

    await a.esperarTareas();
    const documentos = a.documentosEnviados();
    expect(documentos).toHaveLength(1);
    expect(documentos[0]!.payload.caption).toBe("✅ Guía V001-1 aceptada.");
  });

  it("avisa cuando llega otra vez el mismo PDF", async () => {
    const a = await arnes();
    await registrarVehiculo(a.ctx, "XYZ-987");
    await a.documento("pdf1");
    await a.boton("g:emitir");
    await a.esperarTareas();

    await a.documento("pdf1");
    expect(a.ultimoTexto()).toBe("Esta guía ya la registré como V001-1 (aceptada).");
  });
});

describe("flujo de guía: preguntas", () => {
  it("pregunta el campo que no pudo leer y sigue con el resumen", async () => {
    const a = await arnes(sinFecha());
    await registrarVehiculo(a.ctx, "XYZ-987");
    await a.documento("pdf1");
    expect(a.ultimoTexto()).toBe("¿Cuál es la fecha de inicio de traslado? (dd/mm/aaaa)");

    await a.texto("14/09/2026");
    expect(a.ultimoTexto()).toContain("Traslado: 14/09/2026");
  });

  it("repite la pregunta cuando la respuesta no se entiende", async () => {
    const a = await arnes(sinFecha());
    await registrarVehiculo(a.ctx, "XYZ-987");
    await a.documento("pdf1");

    await a.texto("mañana");
    expect(a.textosEnviados().slice(-2)).toEqual([
      "Escribe la fecha así: 14/09/2026",
      "¿Cuál es la fecha de inicio de traslado? (dd/mm/aaaa)",
    ]);

    await a.texto("14/09/2026");
    expect(a.ultimoTexto()).toContain("Traslado: 14/09/2026");
  });

  it("deja corregir un campo desde el resumen", async () => {
    const a = await arnes();
    await registrarVehiculo(a.ctx, "XYZ-987");
    await a.documento("pdf1");

    await a.boton("g:corregir");
    expect(a.botones().map((b) => b.callback_data)).toContain("g:campo:pesoBruto");
    await a.boton("g:campo:pesoBruto");
    expect(a.ultimoTexto()).toBe("¿Cuál es el peso bruto? (ej. 31.87)");

    await a.texto("2000");
    expect(a.ultimoTexto()).toContain("Peso: 2000 KGM");
  });

  it("pide dirección y distrito cuando no pudo leer los puntos de partida y llegada", async () => {
    const a = await arnes(lineasFixture());
    await registrarVehiculo(a.ctx, "XYZ-987");
    await a.documento("pdf1");
    expect(a.ultimoTexto()).toBe("¿Dirección del punto de partida?");

    await a.texto("AV. 28 DE JULIO 1275 LIMA");
    expect(a.ultimoTexto()).toBe("¿En qué distrito?");
    await a.texto("Zzzzz");
    expect(a.ultimoTexto()).toBe("No encontré ese distrito. Escribe solo el nombre del distrito.");

    await a.texto("LA VICTORIA");
    expect(a.botones().map((b) => b.callback_data)).toContain("g:ubigeo:150115");
    await a.boton("g:ubigeo:150115");
    expect(a.ultimoTexto()).toBe("¿Dirección del punto de llegada?");

    await a.texto("CARRETERA FEDERICO BASADRE KM 86 PUCALLPA");
    await a.texto("CALLERIA");
    await a.boton("g:ubigeo:250101");
    expect(a.ultimoTexto()).toContain("Partida: AV. 28 DE JULIO 1275 LIMA — LA VICTORIA, LIMA");
    expect(a.ultimoTexto()).toContain("Llegada: CARRETERA FEDERICO BASADRE KM 86 PUCALLPA — CALLERIA, CORONEL PORTILLO");
  });

  it("cancela en cualquier momento y vuelve a la ayuda", async () => {
    const a = await arnes(sinFecha());
    await registrarVehiculo(a.ctx, "XYZ-987");
    await a.documento("pdf1");

    await a.texto("/cancelar");
    expect(a.ultimoTexto()).toBe("Cancelado.");
    await a.texto("hola");
    expect(a.ultimoTexto()).toBe("Envíame el PDF de la guía del remitente o escribe /ayuda.");
  });
});

describe("flujo de guía: transporte", () => {
  it("no emite una guía de otro transportista", async () => {
    const a = await arnes(lineasFixture((l) => puntosEnOrden(l).map((x) => x.replace("TRANSPORTES DEMO SAC20606433094", "TRANSPORTES DEMO SAC20131312955"))));
    await a.documento("pdf1");
    expect(a.ultimoTexto()).toBe("⛔ Esta guía indica otro transportista (RUC 20131312955). No la puedo emitir.");
  });

  it("ofrece registrar una placa nueva antes de seguir", async () => {
    const a = await arnes();
    await a.documento("pdf1");
    expect(a.ultimoTexto()).toBe("La placa XYZ-987 no está registrada.");
    // Sin un segundo vehículo activo no hay carreta habitual que ofrecer.
    expect(a.botones()).toEqual([{ text: "Registrar XYZ-987", callback_data: "g:placa:reg:XYZ-987" }]);

    await a.boton("g:placa:reg:XYZ-987");
    expect(a.ultimoTexto()).toContain("Vehículo: ABC-123 / XYZ-987");
  });

  it("ofrece la carreta habitual cuando hay una", async () => {
    const a = await arnes();
    await registrarVehiculo(a.ctx, "QQQ-111");
    await a.documento("pdf1");
    expect(a.botones()).toEqual([
      { text: "Registrar XYZ-987", callback_data: "g:placa:reg:XYZ-987" },
      { text: "Usar la habitual QQQ-111", callback_data: "g:placa:hab:XYZ-987" },
    ]);

    await a.boton("g:placa:hab:XYZ-987");
    expect(a.ultimoTexto()).toContain("Vehículo: ABC-123 / QQQ-111");
  });
});

describe("flujo de guía: envío a SUNAT", () => {
  it("avisa del rechazo y ofrece corregir y reenviar", async () => {
    const a = await arnes(lineasFixture(puntosEnOrden), {
      gateway: new SunatSimulado({ demoraMs: 0, rechazo: { codigo: "2800", mensaje: "dato inválido" } }),
    });
    await registrarVehiculo(a.ctx, "XYZ-987");
    await a.documento("pdf1");
    await a.boton("g:emitir");
    await a.esperarTareas();

    expect(a.ultimoTexto()).toBe("❌ SUNAT rechazó la guía V001-1: dato inválido");
    const botones = a.botones();
    expect(botones[0]!.text).toBe("✏️ Corregir y reenviar");

    await a.boton(botones[0]!.callback_data);
    expect(a.ultimoTexto()).toContain("🧾 Guía de transportista (borrador)");
  });

  it("no emite dos veces con doble clic", async () => {
    const a = await arnes();
    await registrarVehiculo(a.ctx, "XYZ-987");
    await a.documento("pdf1");

    await a.boton("g:emitir");
    await a.boton("g:emitir");
    expect(a.ultimoTexto()).toBe("Ya la estoy enviando.");
    await a.esperarTareas();
    expect(await listarGuias(a.ctx)).toHaveLength(1);
  });
});

describe("flujo de guía: archivos que no sirven", () => {
  it("rechaza una foto", async () => {
    const a = await arnes();
    await a.foto("foto1");
    expect(a.ultimoTexto()).toBe("Por ahora solo leo PDF. Envíame el PDF de la guía.");
  });

  it("rechaza un PDF que pasa de 20 MB", async () => {
    const a = await arnes();
    await a.documento("pdf1", "application/pdf", 111, 21 * 1024 * 1024);
    expect(a.ultimoTexto()).toBe(
      "Ese archivo pasa de 20 MB, el límite de Telegram para bots. Envíame el PDF original de SUNAT.",
    );
  });

  it("rechaza un PDF sin texto", async () => {
    const a = await crearArnes({ archivos: { vacio: Buffer.from("no soy un pdf") } });
    cerrables.push(a.cerrar);
    await a.documento("vacio");
    expect(a.ultimoTexto()).toBe("No pude leer texto en ese PDF. Envíame el PDF original de SUNAT.");
  });
});
