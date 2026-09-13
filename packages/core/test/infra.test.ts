import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as DbModulo from "@sunatapp/db";
import { auditoria, empresa, usuario } from "@sunatapp/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorNegocio } from "../src/errores";
import { crearAlmacenLocal } from "../src/infra/almacen";
import { registrarAuditoria } from "../src/infra/auditoria";
import { cargarConfig } from "../src/infra/config";
import { crearContexto } from "../src/infra/contexto";
import { sembrarDatosIniciales } from "../src/infra/sembrar";
import { crearContextoPrueba, DATOS_INICIALES } from "./helpers";

// Envuelve crearDb para poder comprobar, en las pruebas, que `cerrar()` fue
// realmente invocado (PGlite no bloquea el directorio si no se cierra, así
// que reabrir el mismo dataDir no basta por sí solo para demostrarlo).
const registrosCierre: { cerrado: boolean }[] = [];
vi.mock("@sunatapp/db", async (importOriginal) => {
  const real = await importOriginal<typeof DbModulo>();
  return {
    ...real,
    crearDb: async (o: Parameters<typeof real.crearDb>[0]) => {
      const r = await real.crearDb(o);
      const registro = { cerrado: false };
      registrosCierre.push(registro);
      return {
        db: r.db,
        cerrar: async () => {
          registro.cerrado = true;
          await r.cerrar();
        },
      };
    },
  };
});

const cerrables: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cerrables.length) await cerrables.pop()!();
});

describe("cargarConfig", () => {
  it("usa valores por defecto en modo simulado", () => {
    const c = cargarConfig({});
    expect(c).toMatchObject({ sunatModo: "simulado", databaseUrl: null, storageDir: "./storage", dataDir: "./data", simularRechazo: null });
  });

  it("interpreta el rechazo simulado", () => {
    expect(cargarConfig({ SUNAT_SIMULAR_RECHAZO: "2556:Placa inválida" }).simularRechazo).toEqual({ codigo: "2556", mensaje: "Placa inválida" });
  });

  it("en modo real exige certificado y credenciales", () => {
    expect(() => cargarConfig({ SUNAT_MODO: "real" })).toThrow(/SUNAT_CERT_PATH/);
  });
});

describe("almacén local", () => {
  it("guarda y lee archivos en subcarpetas", async () => {
    const almacen = crearAlmacenLocal(mkdtempSync(join(tmpdir(), "alm-")));
    const ruta = await almacen.guardar("guias/a.xml", "<a/>");
    expect(ruta).toBe("guias/a.xml");
    expect(await almacen.leerTexto(ruta)).toBe("<a/>");
  });

  it("impide salir de la carpeta base", async () => {
    const almacen = crearAlmacenLocal(mkdtempSync(join(tmpdir(), "alm-")));
    await expect(almacen.guardar("../fuera.txt", "x")).rejects.toThrow("Ruta no permitida");
  });
});

describe("sembrar y auditoría", () => {
  it("siembra una sola vez y registra auditoría", async () => {
    const { ctx, cerrar } = await crearContextoPrueba();
    cerrables.push(cerrar);
    expect(await ctx.db.select().from(empresa)).toHaveLength(1);
    expect((await ctx.db.select().from(usuario))[0]?.telegramId).toBe(111);
    await expect(sembrarDatosIniciales(ctx.db, DATOS_INICIALES)).rejects.toBeInstanceOf(ErrorNegocio);
    await registrarAuditoria(ctx.db, { accion: "prueba", entidad: "empresa", entidadId: 1, detalle: { a: 1 } });
    expect((await ctx.db.select().from(auditoria))[0]).toMatchObject({ accion: "prueba", entidadId: "1" });
  });
});

describe("crearContexto", () => {
  it("en modo simulado crea y reutiliza un certificado de prueba en storage", async () => {
    const base = mkdtempSync(join(tmpdir(), "ctx-"));
    const config = cargarConfig({ STORAGE_DIR: join(base, "storage"), DATA_DIR: join(base, "data") });
    const a = await crearContexto(config);
    cerrables.push(a.cerrar);
    expect(a.ctx.simulado).toBe(true);
    expect(await a.ctx.almacen.leer("certificado-prueba.pfx")).toBeInstanceOf(Buffer);
    const subject = a.ctx.certificado.subject;
    await a.cerrar();
    cerrables.pop();
    const b = await crearContexto(config);
    cerrables.push(b.cerrar);
    expect(b.ctx.certificado.subject).toBe(subject);
  });

  it("cierra la conexión si falla tras conectar, y permite reintentar sobre el mismo dataDir", async () => {
    const base = mkdtempSync(join(tmpdir(), "ctx-fallo-"));
    const dataDir = join(base, "data");
    const storageDir = join(base, "storage");
    const antes = registrosCierre.length;

    // BD sin sembrar: en modo beta, crearGateway falla antes de que se resuelva el certificado.
    const configBeta = cargarConfig({ SUNAT_MODO: "beta", STORAGE_DIR: storageDir, DATA_DIR: dataDir });
    await expect(crearContexto(configBeta)).rejects.toThrow(/Carga los datos iniciales/);

    // Prueba directa: se llamó a cerrar() sobre la conexión abierta antes del fallo.
    expect(registrosCierre).toHaveLength(antes + 1);
    expect(registrosCierre[antes]!.cerrado).toBe(true);

    // Y, en consecuencia, el dataDir sigue disponible para un reintento normal.
    const configSimulado = cargarConfig({ STORAGE_DIR: storageDir, DATA_DIR: dataDir });
    const { ctx, cerrar } = await crearContexto(configSimulado);
    cerrables.push(cerrar);
    expect(ctx.simulado).toBe(true);
  });

  it("no sobrescribe un certificado de prueba corrupto: propaga el error en vez de regenerarlo", async () => {
    const base = mkdtempSync(join(tmpdir(), "ctx-cert-"));
    const storageDir = join(base, "storage");
    const almacenPrevio = crearAlmacenLocal(storageDir);
    const contenidoInvalido = Buffer.from("esto no es un pfx válido");
    await almacenPrevio.guardar("certificado-prueba.pfx", contenidoInvalido);

    const config = cargarConfig({ STORAGE_DIR: storageDir, DATA_DIR: join(base, "data") });
    await expect(crearContexto(config)).rejects.toThrow();

    // El archivo corrupto no debe haber sido reemplazado por uno nuevo.
    expect(await almacenPrevio.leer("certificado-prueba.pfx")).toEqual(contenidoInvalido);
  });
});
