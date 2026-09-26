import { sql, type Ejecutor } from "@sunatapp/db";

/**
 * **Qué se sincroniza y cómo.** El orden importa: una fila se aplica después de aquello a lo que
 * apunta (un viaje después de su unidad), igual que PixPin pasa primero los mensajes y luego los
 * archivos.
 *
 * Lo que no está aquí es de cada dispositivo y no viaja: sesiones de la web, la cola del bot, los
 * documentos recibidos por Telegram, la auditoría y los correlativos (que se reajustan al final).
 */
export interface TablaSinc {
  nombre: string;
  /** Códigos autonumerados (T-03, REP-004, VJ-0012): si dos dispositivos crearon el mismo, el que llega se renumera. */
  renombrar?: string[];
  /** Valores que solo crecen: al juntar gana el mayor, no el último (el odómetro no retrocede). */
  maximo?: string[];
  /** Columnas con rutas de archivos del almacén que viajan con la fila. */
  archivos?: string[];
  /** Filtro SQL de las filas que viajan (en `ajuste` solo los parámetros comunes). */
  filtro?: string;
  /** Referencias que la base no declara como clave foránea. */
  referencias?: Record<string, string>;
}

export const TABLAS: TablaSinc[] = [
  { nombre: "empresa" },
  { nombre: "conductor" },
  { nombre: "usuario" },
  { nombre: "vehiculo", renombrar: ["codigo"], maximo: ["odometro_km", "viajes_base"], referencias: { carreta_id: "vehiculo" } },
  { nombre: "contraparte" },
  { nombre: "tipo_parte" },
  { nombre: "repuesto", renombrar: ["codigo"] },
  { nombre: "ruta" },
  { nombre: "ruta_presupuesto" },
  { nombre: "viaje", renombrar: ["codigo"] },
  { nombre: "viaje_presupuesto" },
  { nombre: "entrega" },
  { nombre: "gasto", archivos: ["ruta_foto"] },
  { nombre: "guia_transportista", archivos: ["ruta_xml", "ruta_cdr", "ruta_pdf"] },
  { nombre: "guia_item" },
  { nombre: "factura", archivos: ["ruta_xml", "ruta_cdr", "ruta_pdf"] },
  { nombre: "factura_guia" },
  { nombre: "cobro" },
  { nombre: "lectura_odometro" },
  { nombre: "parte_instalada", maximo: ["alerta_nivel"] },
  { nombre: "compra_repuesto" },
  { nombre: "reparacion" },
  { nombre: "reparacion_repuesto" },
  { nombre: "ingreso" },
  { nombre: "reinversion" },
  { nombre: "prestamo" },
  { nombre: "cuota_prestamo" },
  { nombre: "evento_telegram" },
  { nombre: "cotizacion" },
  { nombre: "ajuste", filtro: `clave in ('parametros_cotizador', 'presupuesto_mensual', 'telegram_chat_alertas')` },
];

export const TABLA = new Map(TABLAS.map((t) => [t.nombre, t]));
export const ORDEN = new Map(TABLAS.map((t, i) => [t.nombre, i]));

/** Columnas de control que no son contenido. */
export const COLUMNAS_SINC = ["sinc_uid", "sinc_disp", "sinc_num", "sinc_creado", "sinc_tocado"];

export interface Catalogo {
  /** Columnas de cada tabla, en orden. */
  columnas: Map<string, string[]>;
  /** Si la tabla tiene `id` serial propio (se deja fuera: cada dispositivo numera el suyo). */
  conId: Set<string>;
  /** Columna → tabla referenciada. */
  referencias: Map<string, Map<string, string>>;
  /** Columnas NOT NULL. */
  obligatorias: Map<string, Set<string>>;
  /** Restricciones de unicidad (sin la clave primaria ni sinc_uid). */
  unicas: Map<string, string[][]>;
}

export function filas<T>(r: unknown): T[] {
  return ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];
}

/** Lee la forma de las tablas de la propia base: así el motor sigue al esquema sin mantenerlo a mano. */
export async function leerCatalogo(db: Ejecutor): Promise<Catalogo> {
  const nombres = TABLAS.map((t) => t.nombre);
  const lista = sql.join(nombres.map((n) => sql`${n}`), sql`, `);
  const cols = filas<{ tabla: string; columna: string; nulo: string }>(await db.execute(sql`
    select table_name as tabla, column_name as columna, is_nullable as nulo from information_schema.columns
    where table_schema = 'public' and table_name in (${lista}) order by table_name, ordinal_position`));
  const columnas = new Map<string, string[]>();
  const obligatorias = new Map<string, Set<string>>();
  for (const c of cols) {
    if (!columnas.has(c.tabla)) columnas.set(c.tabla, []);
    columnas.get(c.tabla)!.push(c.columna);
    if (c.nulo === "NO") {
      if (!obligatorias.has(c.tabla)) obligatorias.set(c.tabla, new Set());
      obligatorias.get(c.tabla)!.add(c.columna);
    }
  }
  const fks = filas<{ tabla: string; columna: string; ref: string }>(await db.execute(sql`
    select cl.relname as tabla, a.attname as columna, rf.relname as ref
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_class rf on rf.oid = c.confrelid
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and array_length(c.conkey, 1) = 1 and cl.relname in (${lista})`));
  const referencias = new Map<string, Map<string, string>>();
  for (const f of fks) {
    if (!referencias.has(f.tabla)) referencias.set(f.tabla, new Map());
    referencias.get(f.tabla)!.set(f.columna, f.ref);
  }
  for (const t of TABLAS) {
    for (const [col, ref] of Object.entries(t.referencias ?? {})) {
      if (!referencias.has(t.nombre)) referencias.set(t.nombre, new Map());
      referencias.get(t.nombre)!.set(col, ref);
    }
  }
  const uniq = filas<{ tabla: string; cols: string[] | string }>(await db.execute(sql`
    select cl.relname as tabla, array(select a.attname from unnest(i.indkey) with ordinality k(n, o)
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.n order by k.o) as cols
    from pg_index i join pg_class cl on cl.oid = i.indrelid
    where i.indisunique and not i.indisprimary and i.indpred is null and cl.relname in (${lista})`));
  const unicas = new Map<string, string[][]>();
  for (const u of uniq) {
    const cs = Array.isArray(u.cols) ? u.cols : String(u.cols).replace(/[{}]/g, "").split(",");
    if (cs.length === 1 && cs[0] === "sinc_uid") continue;
    if (!unicas.has(u.tabla)) unicas.set(u.tabla, []);
    unicas.get(u.tabla)!.push(cs);
  }
  const conId = new Set([...columnas].filter(([, cs]) => cs.includes("id")).map(([t]) => t));
  return { columnas, conId, referencias, obligatorias, unicas };
}
