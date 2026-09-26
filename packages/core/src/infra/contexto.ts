import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { crearDb, empresa, type Db } from "@sunatapp/db";
import type { ProveedorIA, Transcriptor } from "@sunatapp/ia";
import {
  cargarPfx, generarCertificadoPrueba, SunatMixto, SunatReal, SunatSimulado, type Certificado, type SunatGateway,
} from "@sunatapp/sunat";
import { crearAlmacenLocal, type Almacen } from "./almacen";
import type { Config } from "./config";

export type NivelLog = "info" | "error";

export interface Contexto {
  db: Db;
  gateway: SunatGateway;
  certificado: Certificado;
  almacen: Almacen;
  reloj: () => Date;
  dormir: (ms: number) => Promise<void>;
  /** Guías: simuladas salvo en modo real (certificado propio, GRE real). */
  simulado: boolean;
  /**
   * Facturas: simuladas cuando van al ambiente beta de SUNAT — modo "simulado", modo "beta"
   * (siempre envía la factura al beta oficial vía MODDATOS) o modo "real" con
   * sunatAmbienteFactura="beta". Solo es false en real + producción. Independiente de
   * `simulado` porque en modo "beta" las guías son simuladas pero las facturas SÍ llegan a un
   * ambiente real de SUNAT (aunque no de producción), y en real+beta las guías son reales pero
   * la factura no: cada documento debe llevar el sello "DOCUMENTO SIMULADO" según corresponda.
   */
  facturaSimulada: boolean;
  /** Lector de boletas (IA o reglas) y transcriptor de notas de voz; sin ellos no se leen mensajes. */
  ia?: ProveedorIA;
  transcriptor?: Transcriptor;
  /** Hook opcional para observabilidad del bot: se invoca en los catches que silencian errores. */
  log?: (nivel: NivelLog, mensaje: string, detalle?: unknown) => void;
}

const PFX_PRUEBA = "certificado-prueba.pfx";
const PFX_PRUEBA_SIN_EMPRESA = "certificado-prueba-sin-empresa.pfx";
const CLAVE_PRUEBA = "prueba";

function esArchivoNoEncontrado(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

/**
 * El certificado con que se firma. El real se valida al configurar; el de prueba se lee o se
 * genera recién al firmar el primer documento: abrirlo (y más aún crearlo, con una clave RSA) es
 * de lo que más demora el arranque en un celular, y la mayoría de veces no se usa.
 */
async function obtenerCertificado(config: Config, almacen: Almacen, db: Db): Promise<() => Certificado> {
  if (config.sunatModo === "real") {
    const real = cargarPfx(await readFile(config.certPath!), config.certPassword!);
    return () => real;
  }
  const [emp] = await db.select().from(empresa).limit(1);
  // Sin empresa todavía (app recién instalada) el de prueba lleva un RUC de relleno: se guarda
  // aparte para no seguir usándolo cuando ya se cargaron los datos de la empresa.
  const archivo = emp ? PFX_PRUEBA : PFX_PRUEBA_SIN_EMPRESA;
  let pfx: Buffer | null = null;
  try {
    pfx = await almacen.leer(archivo);
  } catch (error) {
    if (!esArchivoNoEncontrado(error)) throw error;
  }
  let cargado: Certificado | null = null;
  return () => {
    if (cargado) return cargado;
    if (!pfx) {
      pfx = generarCertificadoPrueba({ ruc: emp?.ruc ?? "20000000001", razonSocial: emp?.razonSocial ?? "EMPRESA DE PRUEBA", password: CLAVE_PRUEBA });
      // Si no se llega a guardar, la próxima vez se genera otro: es solo de prueba.
      void almacen.guardar(archivo, pfx).catch(() => {});
    }
    cargado = cargarPfx(pfx, CLAVE_PRUEBA);
    return cargado;
  };
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

/**
 * Pone en [ctx] la conexión con SUNAT que pide [config] (modo, credenciales, certificado). Se usa
 * al arrancar y al cambiar los ajustes del dispositivo sin reiniciar la app. Si falla, [ctx]
 * queda como estaba.
 */
export async function reconfigurarSunat(ctx: Contexto, config: Config): Promise<void> {
  const gateway = await crearGateway(config, ctx.db);
  const certificado = await obtenerCertificado(config, ctx.almacen, ctx.db);
  ctx.gateway = gateway;
  Object.defineProperty(ctx, "certificado", { get: certificado, configurable: true, enumerable: true });
  ctx.simulado = config.sunatModo !== "real";
  ctx.facturaSimulada = config.sunatModo !== "real" || config.sunatAmbienteFactura === "beta";
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
    const ctx = { db, almacen, reloj: () => new Date(), dormir: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) } as Contexto;
    await reconfigurarSunat(ctx, config);
    return { ctx, cerrar };
  } catch (error) {
    // Si falla el gateway o el certificado, no dejar la conexión/handle de PGlite abierto:
    // podría bloquear dataDir en un reintento posterior.
    await cerrar();
    throw error;
  }
}
