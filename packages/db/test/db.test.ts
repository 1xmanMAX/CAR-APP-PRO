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
  it("modela un viaje en curso con presupuesto, gasto y entrega, y protege la unicidad", async () => {
    const [r] = await db.insert(ruta).values({ nombre: "Arequipa - Lima" }).returning();
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

    await expect(db.insert(viaje).values({
      codigo: "V-0002", rutaId: r!.id, vehiculoId: v!.id, conductorId: c!.id,
      fechaSalida: "2026-09-03", estado: "en_curso",
    })).rejects.toThrow();

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
