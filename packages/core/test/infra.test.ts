import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditoria, empresa, usuario } from "@sunatapp/db";
import { afterEach, describe, expect, it } from "vitest";
import { ErrorNegocio } from "../src/errores";
import { crearAlmacenLocal } from "../src/infra/almacen";
import { registrarAuditoria } from "../src/infra/auditoria";
import { cargarConfig } from "../src/infra/config";
import { crearContexto } from "../src/infra/contexto";
import { sembrarDatosIniciales } from "../src/infra/sembrar";
import { crearContextoPrueba, DATOS_INICIALES } from "./helpers";

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
});
