import { chmodSync, existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cargarConfigIa, costoMicroUsd, crearLectorReglas, crearProveedorDeepSeek, crearTranscriptor, EJEMPLO_JSON, ErrorConfigIa, esquemaLectura,
  IaCredencialesError, IaNoDisponibleError, leerPorReglas, montoDe, TranscripcionNoDisponibleError, type ContextoLectura,
} from "../src/index";

const ctx: ContextoLectura = { hoy: "2026-09-18", correcciones: [] };
const CLAVE = "sk-secreta-123";

describe("esquema de la lectura", () => {
  it("acepta el ejemplo del prompt y rechaza lo mal formado", () => {
    expect(esquemaLectura.safeParse(EJEMPLO_JSON).success).toBe(true);
    expect(esquemaLectura.safeParse({ ...EJEMPLO_JSON, monto: 0 }).success).toBe(false);
    expect(esquemaLectura.safeParse({ ...EJEMPLO_JSON, categoria: "golosinas" }).success).toBe(false);
    const { dudas: _, ...sinDudas } = EJEMPLO_JSON;
    expect(esquemaLectura.safeParse(sinDudas).success).toBe(false);
  });
});

describe("lector por reglas", () => {
  const leer = (texto: string) => leerPorReglas({ texto, contexto: ctx });
  it.each([
    ["grifo 350", "combustible", 350], ["peaje 28.50", "peaje", 28.5], ["almuerzo S/ 15", "viaticos", 15], ["hotel 60", "hospedaje", 60],
    ["estiba 120", "estiba", 120], ["balanza 25", "balanza", 25], ["cochera 20", "cochera", 20], ["parchado de llanta 35", "reparacion", 35],
    ["petróleo 1,250.00", "combustible", 1250],
  ])("«%s» → %s %d", (texto, categoria, monto) => {
    expect(leer(texto)).toMatchObject({ tipo: "gasto", categoria, monto });
  });
  it("entregas, dudas y correcciones", () => {
    expect(leer("me yapearon 500")).toMatchObject({ tipo: "entrega", monto: 500, medio: "yape" });
    expect(leer("grifo")).toMatchObject({ tipo: "no_entendi" });
    expect(leer("pagué 40")).toMatchObject({ tipo: "no_entendi" });
    expect(leerPorReglas({ imagenes: [{ contenido: Buffer.from("x"), mime: "image/jpeg" }], contexto: ctx })).toMatchObject({ tipo: "otro" });
    const anterior = leer("grifo 350");
    expect(leerPorReglas({ contexto: { ...ctx, lecturaAnterior: anterior, correcciones: ["eran 305"] } })).toMatchObject({ tipo: "gasto", categoria: "combustible", monto: 305 });
    expect(montoDe("B/. sin monto")).toBeNull();
  });
  it("no cuesta nada", async () => {
    expect((await crearLectorReglas().leer({ texto: "peaje 10", contexto: ctx })).uso.costoMicroUsd).toBe(0);
  });
});

describe("configuración", () => {
  it("sin clave usa reglas; con clave, DeepSeek", () => {
    expect(cargarConfigIa({}).proveedor).toBe("reglas");
    expect(cargarConfigIa({ DEEPSEEK_API_KEY: CLAVE }).proveedor).toBe("deepseek");
    expect(() => cargarConfigIa({ IA_PROVEEDOR: "deepseek" })).toThrow(ErrorConfigIa);
    expect(() => cargarConfigIa({ IA_PROVEEDOR: "chatgpt" })).toThrow(ErrorConfigIa);
  });
});

describe("DeepSeek (sin red)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const config = cargarConfigIa({ DEEPSEEK_API_KEY: CLAVE });
  const responder = (...respuestas: Array<{ status?: number; content?: string | null }>) => {
    const llamadas: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      llamadas.push({ url, init });
      const r = respuestas[Math.min(llamadas.length - 1, respuestas.length - 1)]!;
      return new Response(JSON.stringify({ choices: [{ message: { content: r.content } }], usage: { prompt_cache_miss_tokens: 3000, prompt_cache_hit_tokens: 500, completion_tokens: 300 } }), { status: r.status ?? 200 });
    }));
    return llamadas;
  };

  it("arma la petición con json y la foto en línea, y anota el costo", async () => {
    const llamadas = responder({ content: JSON.stringify(EJEMPLO_JSON) });
    const r = await crearProveedorDeepSeek(config).leer({ texto: "grifo", imagenes: [{ contenido: Buffer.from("foto"), mime: "image/jpeg" }], contexto: ctx });
    expect(r.lectura).toMatchObject({ tipo: "gasto", monto: 350 });
    const cuerpo = JSON.parse(llamadas[0]!.init.body as string);
    expect(llamadas[0]!.url).toBe("https://api.deepseek.com/chat/completions");
    expect(cuerpo.response_format).toEqual({ type: "json_object" });
    expect(cuerpo.messages[0].content).toContain("json");
    expect(cuerpo.messages[1].content[1].image_url.url).toBe(`data:image/jpeg;base64,${Buffer.from("foto").toString("base64")}`);
    expect(r.uso.costoMicroUsd).toBe(costoMicroUsd(config, 3000, 500, 300));
    expect(r.uso.costoMicroUsd).toBe(Math.round(3000 * 0.3 + 500 * 0.006 + 300 * 1.2));
  });

  it("clave rechazada no se reintenta y no se filtra la clave", async () => {
    responder({ status: 401 });
    const e = await crearProveedorDeepSeek(config).leer({ texto: "x", contexto: ctx }).catch((x) => x);
    expect(e).toBeInstanceOf(IaCredencialesError);
    expect(String(e.message)).not.toContain(CLAVE);
  });

  it.each([429, 503])("%d y respuestas vacías se pueden reintentar", async (status) => {
    responder({ status });
    await expect(crearProveedorDeepSeek(config).leer({ texto: "x", contexto: ctx })).rejects.toBeInstanceOf(IaNoDisponibleError);
    responder({ content: "" });
    await expect(crearProveedorDeepSeek(config).leer({ texto: "x", contexto: ctx })).rejects.toBeInstanceOf(IaNoDisponibleError);
  });

  it("un json malo se reintenta una vez; dos veces malo → no_entendi", async () => {
    let llamadas = responder({ content: "{mal" }, { content: JSON.stringify(EJEMPLO_JSON) });
    expect((await crearProveedorDeepSeek(config).leer({ texto: "x", contexto: ctx })).lectura.tipo).toBe("gasto");
    expect(llamadas).toHaveLength(2);
    llamadas = responder({ content: '{"tipo":"gasto"}' });
    expect((await crearProveedorDeepSeek(config).leer({ texto: "x", contexto: ctx })).lectura.tipo).toBe("no_entendi");
    expect(llamadas).toHaveLength(2);
  });
});

describe("notas de voz", () => {
  it("sin whisper no está disponible", async () => {
    const t = crearTranscriptor(cargarConfigIa({}));
    expect(t.disponible).toBe(false);
    await expect(t.transcribir(Buffer.from("x"), "audio/ogg")).rejects.toBeInstanceOf(TranscripcionNoDisponibleError);
  });
  it.skipIf(process.platform === "win32")("convierte con ffmpeg, transcribe y borra los temporales", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bins-"));
    const ffmpeg = join(dir, "ffmpeg"), whisper = join(dir, "whisper");
    // ffmpeg falso: copia la entrada (arg 3) a la salida (último arg). whisper falso: escribe el texto en <-of>.txt.
    writeFileSync(ffmpeg, `#!/usr/bin/env node\nconst fs=require("fs");const a=process.argv.slice(2);fs.copyFileSync(a[2],a[a.length-1]);\n`);
    writeFileSync(whisper, `#!/usr/bin/env node\nconst fs=require("fs");const a=process.argv.slice(2);fs.writeFileSync(a[a.indexOf("-of")+1]+".txt"," grifo 350 \\n");\n`);
    chmodSync(ffmpeg, 0o755); chmodSync(whisper, 0o755);
    const antes = readdirSync(tmpdir()).filter((f) => f.startsWith("voz-")).length;
    const t = crearTranscriptor(cargarConfigIa({ WHISPER_BIN: whisper, WHISPER_MODELO: "modelo.bin", FFMPEG_BIN: ffmpeg }));
    expect(await t.transcribir(Buffer.from("ogg"), "audio/ogg")).toBe("grifo 350");
    expect(readdirSync(tmpdir()).filter((f) => f.startsWith("voz-")).length).toBe(antes);
    expect(existsSync(dir)).toBe(true);
  });
});
