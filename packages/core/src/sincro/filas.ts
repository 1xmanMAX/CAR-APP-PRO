import { createHash } from "node:crypto";
import { sql, type Ejecutor } from "@sunatapp/db";
import { filas, leerCatalogo, ORDEN, TABLA, TABLAS, type Catalogo } from "./registro";

/**
 * Las filas tal como viajan (la «forma portátil» de PixPin): sin el `id` local —cada dispositivo
 * numera el suyo— y con las referencias cambiadas por el **código único** de lo apuntado. Así un
 * gasto dice «es del viaje 3f9a…», no «del viaje 7», que en el otro celular sería otro viaje.
 */
export interface Fila {
  /** Tabla. */
  t: string;
  /** Código único (sinc_uid). */
  u: string;
  /** Hora del último cambio (ms). */
  k: number;
  /** Contenido portátil, incluidos sinc_disp, sinc_num y sinc_creado. */
  d: Record<string, unknown>;
}

/** Lo que un dispositivo sabe de cada fila: una línea, no la fila (ver PixPin `Diferencia.Apunte`). */
export interface Apunte {
  /** `tabla/uid`. */
  c: string;
  cr: number;
  k: number;
  /** Resumen del contenido: sin él no se sabría si algo cambió de verdad. */
  h: string;
  b?: boolean;
}

export interface Borrado {
  t: string;
  u: string;
  en: number;
}

export const clave = (t: string, u: string) => `${t}/${u}`;
export const partirClave = (c: string) => {
  const i = c.indexOf("/");
  return { t: c.slice(0, i), u: c.slice(i + 1) };
};

/** JSON con las claves ordenadas: el mismo contenido da el mismo texto en cualquier dispositivo. */
export function canonico(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonico).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonico(o[k])}`).join(",")}}`;
}

export const resumir = (d: Record<string, unknown>) => createHash("sha256").update(canonico(d)).digest("hex").slice(0, 32);

const catalogos = new WeakMap<object, Catalogo>();
export async function catalogo(db: Ejecutor): Promise<Catalogo> {
  let c = catalogos.get(db);
  if (!c) {
    c = await leerCatalogo(db);
    catalogos.set(db, c);
  }
  return c;
}

/** Mapas id ↔ uid de una tabla (para traducir referencias). */
class Traductor {
  private idAUid = new Map<string, Map<number, string>>();
  private uidAId = new Map<string, Map<string, number>>();
  constructor(private db: Ejecutor) {}
  private async cargar(t: string) {
    if (this.idAUid.has(t)) return;
    const rs = filas<{ id: number; sinc_uid: string }>(await this.db.execute(sql.raw(`select id, sinc_uid from "${t}"`)));
    this.idAUid.set(t, new Map(rs.map((r) => [Number(r.id), r.sinc_uid])));
    this.uidAId.set(t, new Map(rs.map((r) => [r.sinc_uid, Number(r.id)])));
  }
  async uid(t: string, id: number): Promise<string | null> {
    if (!TABLA.has(t)) return null;
    await this.cargar(t);
    return this.idAUid.get(t)!.get(Number(id)) ?? null;
  }
  async id(t: string, uid: string): Promise<number | null> {
    if (!TABLA.has(t)) return null;
    await this.cargar(t);
    return this.uidAId.get(t)!.get(uid) ?? null;
  }
  apuntar(t: string, id: number, uid: string) {
    this.idAUid.get(t)?.set(id, uid);
    this.uidAId.get(t)?.set(uid, id);
  }
  olvidar(t: string) {
    this.idAUid.delete(t);
    this.uidAId.delete(t);
  }
}

async function portatil(cat: Catalogo, tr: Traductor, t: string, j: Record<string, unknown>): Promise<Record<string, unknown>> {
  const refs = cat.referencias.get(t);
  const d: Record<string, unknown> = {};
  for (const col of cat.columnas.get(t) ?? []) {
    if ((col === "id" && cat.conId.has(t)) || col === "sinc_uid" || col === "sinc_tocado") continue;
    let v = j[col] ?? null;
    const ref = refs?.get(col);
    if (ref && v !== null) v = await tr.uid(ref, Number(v));
    d[col] = v;
  }
  return d;
}

async function leerTabla(db: Ejecutor, t: string, donde = "true"): Promise<Array<{ j: Record<string, unknown> }>> {
  const extra = TABLA.get(t)?.filtro;
  const cond = extra ? `(${donde}) and (${extra})` : donde;
  return filas<{ j: Record<string, unknown> | string }>(await db.execute(sql.raw(`select row_to_json(x) as j from "${t}" x where ${cond}`)))
    .map((r) => ({ j: typeof r.j === "string" ? (JSON.parse(r.j) as Record<string, unknown>) : r.j }));
}

/** Todas las filas sincronizables en forma portátil. */
export async function exportarTodo(db: Ejecutor): Promise<Fila[]> {
  const cat = await catalogo(db);
  const tr = new Traductor(db);
  const out: Fila[] = [];
  for (const { nombre: t } of TABLAS) {
    for (const { j } of await leerTabla(db, t)) {
      if (!j.sinc_uid) continue;
      out.push({ t, u: String(j.sinc_uid), k: Number(j.sinc_tocado ?? 0), d: await portatil(cat, tr, t, j) });
    }
  }
  return out;
}

/** Filas concretas, por clave. */
export async function exportar(db: Ejecutor, claves: string[]): Promise<Fila[]> {
  const cat = await catalogo(db);
  const tr = new Traductor(db);
  const porTabla = new Map<string, string[]>();
  for (const c of claves) {
    const { t, u } = partirClave(c);
    if (!TABLA.has(t)) continue;
    if (!porTabla.has(t)) porTabla.set(t, []);
    porTabla.get(t)!.push(u);
  }
  const out: Fila[] = [];
  for (const [t, uids] of porTabla) {
    const lista = uids.map((u) => `'${u.replace(/'/g, "''")}'`).join(",");
    for (const { j } of await leerTabla(db, t, `sinc_uid in (${lista})`)) {
      out.push({ t, u: String(j.sinc_uid), k: Number(j.sinc_tocado ?? 0), d: await portatil(cat, tr, t, j) });
    }
  }
  return out;
}

/** El inventario: una línea por fila viva y otra por cada marca de borrado. */
export async function inventario(db: Ejecutor): Promise<Apunte[]> {
  const out: Apunte[] = [];
  const vivos = new Set<string>();
  for (const f of await exportarTodo(db)) {
    const c = clave(f.t, f.u);
    vivos.add(c);
    out.push({ c, cr: Number(f.d.sinc_creado ?? 0), k: f.k, h: resumir(f.d) });
  }
  for (const b of filas<{ tabla: string; uid: string; en: string | number }>(await db.execute(sql`select tabla, uid, en from sinc_borrado`))) {
    const c = clave(b.tabla, b.uid);
    if (vivos.has(c) || !TABLA.has(b.tabla)) continue;
    out.push({ c, cr: 0, k: Number(b.en), h: "", b: true });
  }
  return out;
}

export interface ResultadoAplicar {
  aplicadas: number;
  borradas: number;
  /** Cosas que no se pudieron aplicar o que se tocaron para que cupieran (renumerados, choques). */
  avisos: string[];
}

/** Siguiente código libre con el mismo prefijo y ancho: `T-03` → `T-06` si hay hasta `T-05`. */
async function siguienteCodigo(db: Ejecutor, t: string, col: string, valor: string): Promise<string> {
  const m = /^(.*?)(\d+)(\D*)$/.exec(valor);
  const existentes = filas<{ v: string }>(await db.execute(sql.raw(`select "${col}" as v from "${t}" where "${col}" is not null`))).map((r) => r.v);
  if (!m) {
    let n = 2;
    while (existentes.includes(`${valor}-${n}`)) n++;
    return `${valor}-${n}`;
  }
  const [, pre, num, suf] = m;
  const max = existentes.reduce((acc, v) => {
    const x = new RegExp(`^${pre!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+)${suf!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`).exec(v);
    return x ? Math.max(acc, Number(x[1])) : acc;
  }, 0);
  return `${pre}${String(max + 1).padStart(num!.length, "0")}${suf}`;
}

function literal(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

/**
 * Aplica filas y borrados que llegan de otro dispositivo, en una transacción y respetando sus
 * códigos y su hora (los disparadores no las vuelven a marcar). Si una fila choca con otra por un
 * código autonumerado se renumera; si es la misma cosa con otro código (la misma placa), las dos se
 * quedan con el menor de los dos códigos, que es lo que hará también el otro dispositivo.
 */
export async function aplicar(db: Ejecutor, entrantes: Fila[], borrados: Borrado[] = []): Promise<ResultadoAplicar> {
  const cat = await catalogo(db);
  const r: ResultadoAplicar = { aplicadas: 0, borradas: 0, avisos: [] };
  const ordenadas = [...entrantes].sort((a, b) => {
    const o = (ORDEN.get(a.t) ?? 99) - (ORDEN.get(b.t) ?? 99);
    if (o !== 0) return o;
    // Las carretas antes que los tractos que las llevan.
    if (a.t === "vehiculo") return (a.d.tipo === "carreta" ? 0 : 1) - (b.d.tipo === "carreta" ? 0 : 1);
    return 0;
  });
  const ejecutar = async (tx: Ejecutor) => {
    await tx.execute(sql`select set_config('sinc.aplicando', 'si', true)`);
    const tr = new Traductor(tx);
    for (const f of ordenadas) {
      const cols = cat.columnas.get(f.t);
      if (!cols) continue;
      const refs = cat.referencias.get(f.t);
      const obligatorias = cat.obligatorias.get(f.t) ?? new Set();
      const d: Record<string, unknown> = { ...f.d };
      let saltar = false;
      for (const [col, ref] of refs ?? []) {
        const v = d[col];
        if (v === null || v === undefined) continue;
        const id = await tr.id(ref, String(v));
        if (id === null && obligatorias.has(col)) {
          r.avisos.push(`${f.t}: falta ${ref} ${String(v).slice(0, 8)}; se aplicará la próxima vez`);
          saltar = true;
          break;
        }
        d[col] = id;
      }
      if (saltar) continue;
      let uid = f.u;
      let renumerada = false;
      // Choques con otras filas por columnas únicas.
      for (const unica of cat.unicas.get(f.t) ?? []) {
        if (unica.some((c) => d[c] === null || d[c] === undefined)) continue;
        const cond = unica.map((c) => `"${c}" = ${literal(d[c])}`).join(" and ");
        const otro = filas<{ sinc_uid: string; sinc_creado: string | number | null }>(await tx.execute(sql.raw(`select sinc_uid, sinc_creado from "${f.t}" where ${cond} and sinc_uid <> ${literal(uid)}`)))[0];
        if (!otro) continue;
        const renombrables = TABLA.get(f.t)?.renombrar ?? [];
        if (unica.every((c) => renombrables.includes(c))) {
          // **Conserva el código el que nació primero** (y a igual hora, el de menor código único): los
          // dos dispositivos hacen la misma cuenta y quedan igual. El otro pasa al siguiente número, y
          // ese cambio se marca como el más reciente para que viaje.
          const creadoIn = Number(d.sinc_creado ?? 0);
          const creadoEx = Number(otro.sinc_creado ?? 0);
          const ganaEntrante = creadoIn < creadoEx || (creadoIn === creadoEx && uid < otro.sinc_uid);
          for (const c of unica) {
            const nuevo = await siguienteCodigo(tx, f.t, c, String(d[c]));
            if (ganaEntrante) {
              await tx.execute(sql.raw(`update "${f.t}" set "${c}" = ${literal(nuevo)}, sinc_tocado = ${Date.now()} where sinc_uid = ${literal(otro.sinc_uid)}`));
              r.avisos.push(`${f.t}: ${String(d[c])} estaba repetido; el de aquí pasa a ${nuevo}`);
            } else {
              r.avisos.push(`${f.t}: ${String(d[c])} ya existía aquí; el que llegó pasa a ${nuevo}`);
              d[c] = nuevo;
              renumerada = true;
            }
          }
        } else if (f.t === "guia_transportista" || f.t === "factura") {
          r.avisos.push(`${f.t}: la numeración ${unica.map((c) => d[c]).join("-")} ya está usada por otro documento; revisa qué dispositivo emite a SUNAT`);
          saltar = true;
          break;
        } else {
          // La misma cosa con dos códigos: se quedan con el menor, aquí y allá.
          const menor = otro.sinc_uid < uid ? otro.sinc_uid : uid;
          if (menor === otro.sinc_uid) {
            uid = otro.sinc_uid;
          } else {
            await tx.execute(sql.raw(`update "${f.t}" set sinc_uid = ${literal(uid)} where sinc_uid = ${literal(otro.sinc_uid)}`));
            tr.olvidar(f.t);
          }
          // Sin marca de borrado del otro código: el otro dispositivo hará la misma cuenta al recibir el nuestro.
          r.avisos.push(`${f.t}: se juntaron dos registros de lo mismo`);
        }
      }
      if (saltar) continue;
      d.sinc_uid = uid;
      d.sinc_tocado = renumerada ? Math.max(Date.now(), f.k + 1) : f.k;
      const usar = cols.filter((c) => c in d && !(c === "id" && cat.conId.has(f.t)));
      const lista = usar.map((c) => `"${c}"`).join(", ");
      const json = JSON.stringify(Object.fromEntries(usar.map((c) => [c, d[c]])));
      const tieneId = cat.conId.has(f.t);
      const existe = tieneId ? await tr.id(f.t, uid) : null;
      if (existe !== null || (!tieneId && filas(await tx.execute(sql.raw(`select 1 from "${f.t}" where sinc_uid = ${literal(uid)}`))).length)) {
        await tx.execute(sql`${sql.raw(`update "${f.t}" set (${lista}) = (select ${lista} from json_populate_record(null::"${f.t}", `)}${json}${sql.raw(`::json)) where sinc_uid = ${literal(uid)}`)}`);
      } else {
        const ins = filas<{ id?: number }>(await tx.execute(
          sql`${sql.raw(`insert into "${f.t}" (${lista}) select ${lista} from json_populate_record(null::"${f.t}", `)}${json}${sql.raw(`::json) returning ${tieneId ? "id" : "1 as id"}`)}`,
        ));
        if (tieneId && ins[0]?.id !== undefined) tr.apuntar(f.t, Number(ins[0].id), uid);
      }
      await tx.execute(sql`delete from sinc_borrado where tabla = ${f.t} and uid = ${uid}`);
      r.aplicadas++;
    }
    // Borrados: de lo más dependiente a lo menos.
    for (const b of [...borrados].sort((x, y) => (ORDEN.get(y.t) ?? 0) - (ORDEN.get(x.t) ?? 0))) {
      if (!TABLA.has(b.t)) continue;
      await tx.execute(sql`savepoint borrar`);
      try {
        const res = filas(await tx.execute(sql.raw(`delete from "${b.t}" where sinc_uid = ${literal(b.u)} returning 1`)));
        await tx.execute(sql`release savepoint borrar`);
        if (res.length) r.borradas++;
      } catch {
        await tx.execute(sql`rollback to savepoint borrar`);
        r.avisos.push(`${b.t}: no se borró porque otros registros lo usan`);
        continue;
      }
      await tx.execute(sql`insert into sinc_borrado (tabla, uid, en) values (${b.t}, ${b.u}, ${b.en})
        on conflict (tabla, uid) do update set en = greatest(sinc_borrado.en, excluded.en)`);
    }
  };
  if ("transaction" in db && typeof (db as { transaction?: unknown }).transaction === "function") {
    await (db as { transaction: (f: (tx: Ejecutor) => Promise<void>) => Promise<void> }).transaction(ejecutar);
  } else {
    await ejecutar(db);
  }
  return r;
}

/** Rutas de archivos del almacén que usan las filas de este dispositivo. */
export async function rutasDeArchivos(db: Ejecutor): Promise<string[]> {
  const out = new Set<string>();
  for (const t of TABLAS) {
    for (const col of t.archivos ?? []) {
      for (const r of filas<{ v: string | null }>(await db.execute(sql.raw(`select "${col}" as v from "${t.nombre}" where "${col}" is not null`)))) {
        if (r.v) out.add(r.v);
      }
    }
  }
  return [...out].sort();
}
