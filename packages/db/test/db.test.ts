import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { crearDb, empresa, siguienteCorrelativo, type Db } from "../src/index";

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
