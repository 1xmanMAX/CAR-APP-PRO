import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { crearDb, empresa, type Db } from "@sunatapp/db";
import {
  cargarPfx, generarCertificadoPrueba, SunatMixto, SunatReal, SunatSimulado, type Certificado, type SunatGateway,
} from "@sunatapp/sunat";
import { crearAlmacenLocal, type Almacen } from "./almacen";
import type { Config } from "./config";

export interface Contexto {
  db: Db;
  gateway: SunatGateway;
  certificado: Certificado;
  almacen: Almacen;
  reloj: () => Date;
  dormir: (ms: number) => Promise<void>;
  simulado: boolean;
}

const PFX_PRUEBA = "certificado-prueba.pfx";
const CLAVE_PRUEBA = "prueba";

function esArchivoNoEncontrado(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

async function obtenerCertificado(config: Config, almacen: Almacen, db: Db): Promise<Certificado> {
  if (config.sunatModo === "real") return cargarPfx(await readFile(config.certPath!), config.certPassword!);
  let pfxExistente: Buffer;
  try {
    pfxExistente = await almacen.leer(PFX_PRUEBA);
  } catch (error) {
    if (!esArchivoNoEncontrado(error)) throw error;
    const [emp] = await db.select().from(empresa).limit(1);
    const pfx = generarCertificadoPrueba({ ruc: emp?.ruc ?? "20000000001", razonSocial: emp?.razonSocial ?? "EMPRESA DE PRUEBA", password: CLAVE_PRUEBA });
    await almacen.guardar(PFX_PRUEBA, pfx);
    return cargarPfx(pfx, CLAVE_PRUEBA);
  }
  return cargarPfx(pfxExistente, CLAVE_PRUEBA);
}

async function crearGateway(config: Config, db: Db): Promise<SunatGateway> {
  const simulado = new SunatSimulado(config.simularRechazo ? { rechazo: config.simularRechazo } : {});
  if (config.sunatModo === "simulado") return simulado;
  const [emp] = await db.select().from(empresa).limit(1);
  if (!emp) throw new Error("Carga los datos iniciales (pnpm sembrar) antes de usar SUNAT beta o real");
  if (config.sunatModo === "beta") {
    return new SunatMixto(simulado, new SunatReal({ ruc: emp.ruc, usuarioSol: "MODDATOS", claveSol: "moddatos", ambienteFactura: "beta" }));
  }
  return new SunatReal({
    ruc: emp.ruc,
    usuarioSol: config.solUsuario!,
    claveSol: config.solClave!,
    greClientId: config.greClientId!,
    greClientSecret: config.greClientSecret!,
    ambienteFactura: config.sunatAmbienteFactura,
  });
}

export async function crearContexto(config: Config): Promise<{ ctx: Contexto; cerrar: () => Promise<void> }> {
  let db: Db;
  let cerrar: () => Promise<void>;
  if (config.databaseUrl) {
    ({ db, cerrar } = await crearDb({ tipo: "postgres", url: config.databaseUrl }));
  } else {
    // PGlite no crea el directorio del archivo de datos por sí solo: hay que asegurarlo antes.
    const directorio = join(config.dataDir, "pglite");
    await mkdir(directorio, { recursive: true });
    ({ db, cerrar } = await crearDb({ tipo: "pglite", directorio }));
  }
  const almacen = crearAlmacenLocal(config.storageDir);
  try {
    const ctx: Contexto = {
      db,
      almacen,
      gateway: await crearGateway(config, db),
      certificado: await obtenerCertificado(config, almacen, db),
      reloj: () => new Date(),
      dormir: (ms) => new Promise((r) => setTimeout(r, ms)),
      simulado: config.sunatModo !== "real",
    };
    return { ctx, cerrar };
  } catch (error) {
    // Si falla el gateway o el certificado, no dejar la conexión/handle de PGlite abierto:
    // podría bloquear dataDir en un reintento posterior.
    await cerrar();
    throw error;
  }
}
