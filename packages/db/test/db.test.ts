import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  conductor, crearDb, documentoRecibido, empresa, entrega, gasto, ruta, rutaPresupuesto,
  siguienteCorrelativo, vehiculo, viaje, type Db,
} from "../src/index";

let db: Db;
let cerrar: () => Promise<void>;

beforeEach(async () => {
  ({ db, cerrar } = await crearDb({ tipo: "pglite" }));
});
afterEach(async () => {
  await cerrar();
});

describe("crearDb", () => {
  it("aplica migraciones y permite insertar con valores por defecto", async () => {
    await db.insert(empresa).values({
      ruc: "20606433094", razonSocial: "TRANSPORTES DEMO SAC", direccion: "AV. DEMO 123",
      ubigeo: "150115", registroMtc: "MTC123",
    });
    const [fila] = await db.select().from(empresa);
    expect(fila?.serieGre).toBe("V001");
    expect(fila?.detraccionUmbral).toBe(40000);
  });
});

describe("siguienteCorrelativo", () => {
  it("numera 1, 2, 3 por serie de forma independiente", async () => {
    expect(await siguienteCorrelativo(db, "31", "V001")).toBe(1);
    expect(await siguienteCorrelativo(db, "31", "V001")).toBe(2);
    expect(await siguienteCorrelativo(db, "01", "F001")).toBe(1);
    expect(await siguienteCorrelativo(db, "31", "V001")).toBe(3);
  });

  it("no repite números con llamadas concurrentes", async () => {
    const numeros = await Promise.all(Array.from({ length: 20 }, () => siguienteCorrelativo(db, "31", "V001")));
    expect(new Set(numeros).size).toBe(20);
    expect(Math.max(...numeros)).toBe(20);
  });

  it("funciona dentro de una transacción", async () => {
    const n = await db.transaction((tx) => siguienteCorrelativo(tx, "01", "F001"));
    expect(n).toBe(1);
  });
});

describe("viajes, gastos y lecturas", () => {
  it("modela un viaje en curso con presupuesto, gasto y entrega, y admite dos en curso (los junta la sincronización)", async () => {
    const [r] = await db.insert(ruta).values({ nombre: "Arequipa - Lima", nombreNormalizado: "AREQUIPA - LIMA" }).returning();
    await db.insert(rutaPresupuesto).values({ rutaId: r!.id, categoria: "combustible", monto: 50000 });

    const [v] = await db.insert(vehiculo).values({ placa: "ABC-123" }).returning();
    const [c] = await db.insert(conductor).values({
      numeroDoc: "12345678", nombres: "Juan", apellidos: "Perez", licencia: "Q12345678",
    }).returning();

    const [viajeEnCurso] = await db.insert(viaje).values({
      codigo: "V-0001", rutaId: r!.id, vehiculoId: v!.id, conductorId: c!.id,
      fechaSalida: "2026-09-01", estado: "en_curso",
    }).returning();

    await db.insert(gasto).values({
      viajeId: viajeEnCurso!.id, categoria: "combustible", monto: 15000, fecha: "2026-09-01",
    });
    await db.insert(entrega).values({
      viajeId: viajeEnCurso!.id, fecha: "2026-09-02", monto: 20000, medio: "efectivo",
    });

    // Sin índice único: dos dispositivos sin conexión pueden abrir cada uno un viaje de la misma
    // unidad; la app lo impide en cada dispositivo y la sincronización avisa si pasa.
    await expect(db.insert(viaje).values({
      codigo: "V-0002", rutaId: r!.id, vehiculoId: v!.id, conductorId: c!.id,
      fechaSalida: "2026-09-03", estado: "en_curso",
    })).resolves.toBeDefined();

    const [viajeCerrado] = await db.insert(viaje).values({
      codigo: "V-0003", rutaId: r!.id, vehiculoId: v!.id, conductorId: c!.id,
      fechaSalida: "2026-09-03", estado: "cerrado",
    }).returning();
    expect(viajeCerrado?.estado).toBe("cerrado");

    const [docTexto] = await db.insert(documentoRecibido).values({
      mime: "text/plain", tipo: "texto", texto: "gasto de peaje s/10",
      telegramChatId: 111, telegramMessageId: 222,
    }).returning();
    expect(docTexto?.rutaArchivo).toBeNull();

    await expect(db.insert(documentoRecibido).values({
      mime: "text/plain", tipo: "texto", texto: "otro mensaje",
      telegramChatId: 111, telegramMessageId: 222,
    })).rejects.toThrow();
  });
});

describe("base inicial (CF_BASE_INICIAL)", () => {
  it("una carpeta nueva se crea copiando la base ya migrada, y luego se reabre tal cual", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "base-inicial-"));
    // La plantilla: la misma base en memoria de la prueba, migrada y con una marca.
    await db.insert(empresa).values({ ruc: "20606433094", razonSocial: "PLANTILLA", direccion: "X", ubigeo: "150101", registroMtc: "M" });
    const pg = (db as unknown as { $client: InstanceType<typeof PGlite> }).$client;
    writeFileSync(join(dir, "base.tgz"), Buffer.from(await (await pg.dumpDataDir("gzip")).arrayBuffer()));
    const antes = process.env.CF_BASE_INICIAL;
    process.env.CF_BASE_INICIAL = join(dir, "base.tgz");
    try {
      const a = await crearDb({ tipo: "pglite", directorio: join(dir, "datos") });
      expect((await a.db.select().from(empresa)).map((e) => e.razonSocial)).toEqual(["PLANTILLA"]);
      await a.db.update(empresa).set({ razonSocial: "PROPIA" });
      await a.cerrar();
      // Ya existe: no se vuelve a copiar la plantilla encima.
      const b = await crearDb({ tipo: "pglite", directorio: join(dir, "datos") });
      expect((await b.db.select().from(empresa)).map((e) => e.razonSocial)).toEqual(["PROPIA"]);
      await b.cerrar();
    } finally {
      if (antes === undefined) delete process.env.CF_BASE_INICIAL;
      else process.env.CF_BASE_INICIAL = antes;
    }
  });
});
