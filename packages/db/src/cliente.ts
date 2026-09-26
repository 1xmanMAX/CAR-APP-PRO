import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migrarPglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migrarPg } from "drizzle-orm/node-postgres/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Ejecutor = Db | Tx;

// En el paquete de la app móvil todo va en un solo archivo: la carpeta se indica por variable.
const carpetaMigraciones = process.env.CF_MIGRACIONES || fileURLToPath(new URL("../drizzle", import.meta.url));

/**
 * `CF_BASE_INICIAL`: base ya creada y migrada que va dentro del paquete móvil. Crear una base
 * PGlite desde cero (initdb) es lo más lento del primer arranque en un celular; copiarla de aquí
 * es varias veces más rápido.
 */
async function abrirPglite(directorio?: string): Promise<PGlite> {
  const plantillaBase = process.env.CF_BASE_INICIAL;
  const nueva = directorio && plantillaBase && existsSync(plantillaBase) && !existsSync(join(directorio, "PG_VERSION"));
  if (!nueva) return PGlite.create(directorio);
  try {
    return await PGlite.create(directorio, { loadDataDir: new Blob([readFileSync(plantillaBase)]) });
  } catch {
    // Si la copia falla, se deja la carpeta vacía y se crea la base como siempre.
    for (const f of readdirSync(directorio)) rmSync(join(directorio, f), { recursive: true, force: true });
    return PGlite.create(directorio);
  }
}

export type OpcionesDb = { tipo: "pglite"; directorio?: string } | { tipo: "postgres"; url: string };

export async function crearDb(o: OpcionesDb): Promise<{ db: Db; cerrar: () => Promise<void> }> {
  if (o.tipo === "pglite") {
    const cliente = await abrirPglite(o.directorio);
    const db = drizzlePglite({ client: cliente, schema });
    await migrarPglite(db, { migrationsFolder: carpetaMigraciones });
    return { db: db as unknown as Db, cerrar: () => cliente.close() };
  }
  const pool = new pg.Pool({ connectionString: o.url });
  const db = drizzlePg({ client: pool, schema });
  await migrarPg(db, { migrationsFolder: carpetaMigraciones });
  return { db: db as unknown as Db, cerrar: () => pool.end() };
}
