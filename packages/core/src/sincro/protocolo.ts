import { createHash } from "node:crypto";
import type { Duplex } from "node:stream";
import { sql, type Ejecutor } from "@sunatapp/db";
import type { Contexto } from "../infra/contexto";
import { Canal, TROZO } from "./canal";
import { recalcularDerivados } from "./derivados";
import { aplicar, exportar, inventario, partirClave, resumir, rutasDeArchivos, type Apunte, type Borrado, type Fila } from "./filas";
import { fusionarFila, type CuentaFusion } from "./fusion";
import { claveGrupo, codigoDispositivo, guardarIdentidad, identidad, juntarMiembros, type Dispositivo } from "./grupo";
import { planificar } from "./plan";
import { filas } from "./registro";

/**
 * **La conversación entre dos dispositivos** (portado de PixPin, `sincro/Protocolo.kt`).
 *
 * Uno **dirige** —el que pulsó «Sincronizar»— y el otro **responde**. El que dirige pide el
 * inventario del otro, decide con [planificar] qué traer, qué mandar y qué juntar, y al final los dos
 * guardan **lo acordado** (la base), que es lo que deja saber la próxima vez quién se movió.
 * **Solo viajan los cambios**: primero una línea por registro, y luego solo los registros distintos.
 */
export const VERSION_PROTOCOLO = 1;

interface Hola {
  yo: Dispositivo;
  codigo: string;
  miembros: Dispositivo[];
  reloj: number;
  version: number;
  puerto?: number;
}

interface Peticion {
  t: "hola" | "inventario" | "dame" | "pon" | "acordar" | "archivos" | "damearchivo" | "ponarchivo" | "adios";
  hola?: Hola;
  claves?: string[];
  filas?: Fila[];
  borrados?: Borrado[];
  acordadas?: Array<[string, string]>;
  ruta?: string;
  bytes?: number;
  h?: string;
}

interface Respuesta {
  error?: string;
  hola?: Hola;
  apuntes?: Apunte[];
  filas?: Fila[];
  avisos?: string[];
  archivos?: Array<{ ruta: string; h: string; bytes: number }>;
  bytes?: number;
  h?: string;
}

export interface ResultadoSinc {
  par: { id: string; nombre: string; codigo: string };
  traidas: number;
  mandadas: number;
  fusionadas: number;
  choques: number;
  borradas: number;
  archivos: number;
  avisos: string[];
  desfaseMs: number;
}

/** Una sincronización a la vez por base: dos a la vez escribirían lo mismo desde dos lados. */
const ocupados = new WeakSet<object>();
export const OCUPADO = "Este dispositivo ya está sincronizando con otro. Prueba otra vez en un momento.";

function ocupar(ctx: Contexto): boolean {
  if (ocupados.has(ctx.db)) return false;
  ocupados.add(ctx.db);
  return true;
}
function soltar(ctx: Contexto) {
  ocupados.delete(ctx.db);
}

async function saludo(ctx: Contexto, puerto?: number): Promise<Hola> {
  const i = await identidad(ctx);
  return { yo: i.yo, codigo: codigoDispositivo(i.yo.id), miembros: i.miembros.map(({ id, nombre }) => ({ id, nombre })), reloj: Date.now(), version: VERSION_PROTOCOLO, puerto };
}

async function recordarPar(ctx: Contexto, h: Hola, direccion?: string): Promise<void> {
  const i = await identidad(ctx);
  i.miembros = juntarMiembros(i.miembros, h.miembros, h.yo).map((m) => (m.id === h.yo.id && direccion ? { ...m, direccion } : m));
  await guardarIdentidad(ctx, i);
}

// ── Lo acordado (la base) ────────────────────────────────────────────────────

async function leerBase(db: Ejecutor, par: string): Promise<Map<string, string>> {
  const rs = filas<{ clave: string; resumen: string }>(await db.execute(sql`select clave, resumen from sinc_base where par = ${par}`));
  return new Map(rs.map((r) => [r.clave, r.resumen]));
}

async function objetoBase(db: Ejecutor, resumen: string): Promise<Fila["d"] | null> {
  const r = filas<{ datos: Fila["d"] | string }>(await db.execute(sql`select datos from sinc_objeto where resumen = ${resumen}`))[0];
  if (!r) return null;
  return typeof r.datos === "string" ? (JSON.parse(r.datos) as Fila["d"]) : r.datos;
}

/**
 * Guarda lo acordado con [par]: las claves en las que los dos quedaron iguales, con su contenido
 * (para poder fusionar a tres bandas la próxima vez). Se reemplaza entera.
 */
async function guardarBase(ctx: Contexto, par: string, acordadas: Array<[string, string]>): Promise<void> {
  const mias = await exportar(ctx.db, acordadas.map(([c]) => c));
  const porClave = new Map(mias.map((f) => [`${f.t}/${f.u}`, f]));
  await ctx.db.transaction(async (tx) => {
    await tx.execute(sql`delete from sinc_base where par = ${par}`);
    for (let i = 0; i < acordadas.length; i += 500) {
      const lote = acordadas.slice(i, i + 500).filter(([c, h]) => {
        const f = porClave.get(c);
        return f && resumir(f.d) === h;
      });
      if (!lote.length) continue;
      await tx.execute(sql`insert into sinc_base (par, clave, resumen) values ${sql.join(lote.map(([c, h]) => sql`(${par}, ${c}, ${h})`), sql`, `)}`);
      await tx.execute(sql`insert into sinc_objeto (resumen, datos) values ${sql.join(lote.map(([c, h]) => sql`(${h}, ${JSON.stringify(porClave.get(c)!.d)}::jsonb)`), sql`, `)} on conflict (resumen) do nothing`);
    }
    // Lo que ya no señala ninguna base no sirve para fusionar: fuera.
    await tx.execute(sql`delete from sinc_objeto o where not exists (select 1 from sinc_base b where b.resumen = o.resumen)`);
  });
}

// ── Archivos (fotos de vouchers, PDF y XML de SUNAT) ─────────────────────────

async function archivosLocales(ctx: Contexto): Promise<Array<{ ruta: string; h: string; bytes: number }>> {
  const out: Array<{ ruta: string; h: string; bytes: number }> = [];
  for (const ruta of await rutasDeArchivos(ctx.db)) {
    try {
      const b = await ctx.almacen.leer(ruta);
      out.push({ ruta, h: createHash("sha256").update(b).digest("hex"), bytes: b.length });
    } catch {
      // Falta aquí: el otro lo mandará si lo tiene.
    }
  }
  return out;
}

const TROZO_BYTES = 512 * 1024;

function mandarArchivo(canal: Canal, contenido: Buffer): void {
  for (let i = 0; i < contenido.length; i += TROZO_BYTES) canal.enviar(TROZO, contenido.subarray(i, i + TROZO_BYTES));
}

async function recibirArchivo(canal: Canal, bytes: number): Promise<Buffer> {
  const partes: Buffer[] = [];
  let n = 0;
  while (n < bytes) {
    const { tipo, datos } = await canal.recibir();
    if (tipo !== TROZO) throw new Error("Se esperaba un trozo de archivo");
    partes.push(Buffer.from(datos));
    n += datos.length;
  }
  return Buffer.concat(partes);
}

// ── El que responde ──────────────────────────────────────────────────────────

/**
 * Atiende una conexión entera. Si el otro tiene otro código de grupo, el primer tramo no se descifra
 * y se corta sin contestarle nada.
 */
export async function responder(ctx: Contexto, stream: Duplex, o: { puerto?: number; direccion?: string; alTerminar?: (r: { par: string; avisos: string[] }) => void } = {}): Promise<void> {
  const i = await identidad(ctx);
  if (!i.grupo) throw new Error("Este dispositivo no está en un grupo");
  const canal = await Canal.abrir(stream, claveGrupo(i.grupo), false);
  const primera = await canal.recibirJson<Peticion>();
  const hola = primera.hola;
  if (primera.t !== "hola" || !hola) throw new Error("Faltó el saludo");
  if (hola.yo.id === i.yo.id) {
    canal.enviarJson({ error: "Los dos dispositivos tienen la misma identidad (se copió la carpeta de datos). En uno de ellos: Sincronizar → Nueva identidad." } satisfies Respuesta);
    return;
  }
  if (hola.version !== VERSION_PROTOCOLO) {
    canal.enviarJson({ error: "El otro dispositivo tiene otra versión de Control Flota: actualiza los dos." } satisfies Respuesta);
    return;
  }
  await recordarPar(ctx, hola, o.direccion);
  if (!ocupar(ctx)) {
    canal.enviarJson({ error: OCUPADO } satisfies Respuesta);
    return;
  }
  const avisos: string[] = [];
  const inicio = new Date();
  try {
    canal.enviarJson({ hola: await saludo(ctx, o.puerto) } satisfies Respuesta);
    for (;;) {
      const p = await canal.recibirJson<Peticion>();
      switch (p.t) {
        case "adios":
          canal.enviarJson({} satisfies Respuesta);
          await ctx.db.execute(sql`insert into sinc_historial (par, par_nombre, inicio, fin, dirigi, resultado) values
            (${hola.yo.id}, ${hola.yo.nombre}, ${inicio}, ${new Date()}, false, ${JSON.stringify({ avisos })}::jsonb)`);
          o.alTerminar?.({ par: hola.yo.nombre, avisos });
          return;
        case "inventario":
          canal.enviarJson({ apuntes: await inventario(ctx.db) } satisfies Respuesta);
          break;
        case "dame":
          canal.enviarJson({ filas: await exportar(ctx.db, p.claves ?? []) } satisfies Respuesta);
          break;
        case "pon": {
          const r = await aplicar(ctx.db, p.filas ?? [], p.borrados ?? []);
          const derivados = await recalcularDerivados(ctx.db);
          avisos.push(...r.avisos, ...derivados);
          canal.enviarJson({ avisos: [...r.avisos, ...derivados] } satisfies Respuesta);
          break;
        }
        case "acordar":
          await guardarBase(ctx, hola.yo.id, p.acordadas ?? []);
          canal.enviarJson({} satisfies Respuesta);
          break;
        case "archivos":
          canal.enviarJson({ archivos: await archivosLocales(ctx) } satisfies Respuesta);
          break;
        case "damearchivo": {
          const b = await ctx.almacen.leer(p.ruta!);
          canal.enviarJson({ bytes: b.length } satisfies Respuesta);
          mandarArchivo(canal, b);
          break;
        }
        case "ponarchivo": {
          const b = await recibirArchivo(canal, p.bytes ?? 0);
          if (createHash("sha256").update(b).digest("hex") === p.h) await ctx.almacen.guardar(p.ruta!, b);
          canal.enviarJson({} satisfies Respuesta);
          break;
        }
        default:
          canal.enviarJson({ error: `Petición desconocida: ${String(p.t)}` } satisfies Respuesta);
      }
    }
  } finally {
    soltar(ctx);
    canal.cerrar();
  }
}

// ── El que dirige ────────────────────────────────────────────────────────────

async function pedir(canal: Canal, p: Peticion): Promise<Respuesta> {
  canal.enviarJson(p);
  const r = await canal.recibirJson<Respuesta>();
  if (r.error) throw new Error(r.error);
  return r;
}

export type Avance = (mensaje: string, fraccion?: number) => void;

/**
 * **Sincroniza con el dispositivo al otro lado de [stream].** Los dos quedan iguales: siempre en los
 * dos sentidos (así lo decidió PixPin y así se hace aquí).
 */
export async function sincronizarCon(ctx: Contexto, stream: Duplex, o: { avance?: Avance; puerto?: number; direccion?: string } = {}): Promise<ResultadoSinc> {
  const avance = o.avance ?? (() => {});
  const i = await identidad(ctx);
  if (!i.grupo) throw new Error("Este dispositivo no está en un grupo: crea uno o únete con un código");
  if (!ocupar(ctx)) throw new Error(OCUPADO);
  const inicio = new Date();
  let par: Dispositivo | null = null;
  try {
    avance("Conectando…", 0.02);
    const canal = await Canal.abrir(stream, claveGrupo(i.grupo), true);
    const antes = Date.now();
    const h = (await pedir(canal, { t: "hola", hola: await saludo(ctx, o.puerto) })).hola!;
    const despues = Date.now();
    if (h.yo.id === i.yo.id) throw new Error("Los dos dispositivos tienen la misma identidad (se copió la carpeta de datos). En uno de ellos: Sincronizar → Nueva identidad.");
    par = h.yo;
    const desfase = h.reloj - Math.round((antes + despues) / 2);
    await recordarPar(ctx, h, o.direccion);

    avance(`Comparando con ${h.yo.nombre}…`, 0.1);
    const mio = await inventario(ctx.db);
    const suyo = (await pedir(canal, { t: "inventario" })).apuntes ?? [];
    const base = await leerBase(ctx.db, h.yo.id);
    const pasos = planificar(mio, suyo, base);
    const suyoPorClave = new Map(suyo.map((a) => [a.c, a]));
    const mioPorClave = new Map(mio.map((a) => [a.c, a]));

    const traer = pasos.filter((p) => p.tipo === "traer").map((p) => p.c);
    const fusionar = pasos.filter((p) => p.tipo === "fusionar").map((p) => p.c);
    const mandar = pasos.filter((p) => p.tipo === "mandar").map((p) => p.c);

    // 1. Lo que me traigo (o su borrado) y lo que hay que juntar.
    avance(`Recibiendo ${traer.length + fusionar.length} cambios…`, 0.25);
    const traerVivos = traer.filter((c) => !suyoPorClave.get(c)?.b);
    const borrarAqui: Borrado[] = traer.filter((c) => suyoPorClave.get(c)?.b).map((c) => ({ ...partirClave(c), en: suyoPorClave.get(c)!.k }));
    const recibidas = [...traerVivos, ...fusionar].length ? (await pedir(canal, { t: "dame", claves: [...traerVivos, ...fusionar] })).filas ?? [] : [];
    const recibidasPorClave = new Map(recibidas.map((f) => [`${f.t}/${f.u}`, f]));
    const mias = fusionar.length ? await exportar(ctx.db, fusionar) : [];
    const miasPorClave = new Map(mias.map((f) => [`${f.t}/${f.u}`, f]));
    const cuenta: CuentaFusion = { choques: 0 };
    const juntadas: Fila[] = [];
    for (const c of fusionar) {
      const m = miasPorClave.get(c);
      const s = recibidasPorClave.get(c);
      if (!m || !s) continue;
      const b = base.get(c);
      juntadas.push(fusionarFila(b ? await objetoBase(ctx.db, b) : null, m, s, desfase, cuenta));
    }
    const paraAqui = [...traerVivos.map((c) => recibidasPorClave.get(c)).filter((f): f is Fila => !!f), ...juntadas];
    avance("Aplicando aquí…", 0.45);
    const aqui = await aplicar(ctx.db, paraAqui, borrarAqui);
    const avisos = [...aqui.avisos, ...(await recalcularDerivados(ctx.db))];

    // 2. Lo que le mando (o mi borrado) y lo juntado.
    avance(`Enviando ${mandar.length + juntadas.length} cambios…`, 0.6);
    const mandarVivos = mandar.filter((c) => !mioPorClave.get(c)?.b);
    const borrarAlla: Borrado[] = mandar.filter((c) => mioPorClave.get(c)?.b).map((c) => ({ ...partirClave(c), en: mioPorClave.get(c)!.k }));
    const salen = [...(mandarVivos.length ? await exportar(ctx.db, mandarVivos) : []), ...juntadas];
    if (salen.length || borrarAlla.length) {
      const r = await pedir(canal, { t: "pon", filas: salen, borrados: borrarAlla });
      avisos.push(...(r.avisos ?? []).map((a) => `${h.yo.nombre}: ${a}`));
    }

    // 3. Archivos: solo los que faltan en un lado.
    avance("Revisando fotos y documentos…", 0.75);
    const misArchivos = await archivosLocales(ctx);
    const susArchivos = (await pedir(canal, { t: "archivos" })).archivos ?? [];
    const tengo = new Set(misArchivos.map((a) => a.ruta));
    const tiene = new Set(susArchivos.map((a) => a.ruta));
    let archivos = 0;
    for (const a of susArchivos.filter((x) => !tengo.has(x.ruta))) {
      canal.enviarJson({ t: "damearchivo", ruta: a.ruta } satisfies Peticion);
      const r = await canal.recibirJson<Respuesta>();
      if (r.error) continue;
      const b = await recibirArchivo(canal, r.bytes ?? 0);
      if (createHash("sha256").update(b).digest("hex") === a.h) {
        await ctx.almacen.guardar(a.ruta, b);
        archivos++;
      }
    }
    for (const a of misArchivos.filter((x) => !tiene.has(x.ruta))) {
      const b = await ctx.almacen.leer(a.ruta);
      canal.enviarJson({ t: "ponarchivo", ruta: a.ruta, bytes: b.length, h: a.h } satisfies Peticion);
      mandarArchivo(canal, b);
      await canal.recibirJson<Respuesta>();
      archivos++;
    }

    // 4. Lo acordado: lo que quedó igual en los dos.
    avance("Guardando lo acordado…", 0.9);
    const mioDespues = await inventario(ctx.db);
    const suyoDespues = new Map(((await pedir(canal, { t: "inventario" })).apuntes ?? []).map((a) => [a.c, a]));
    const acordadas: Array<[string, string]> = mioDespues
      .filter((a) => !a.b && suyoDespues.get(a.c)?.h === a.h)
      .map((a) => [a.c, a.h]);
    await guardarBase(ctx, h.yo.id, acordadas);
    await pedir(canal, { t: "acordar", acordadas });
    await pedir(canal, { t: "adios" });
    canal.cerrar();

    if (Math.abs(desfase) > 2 * 60_000) {
      avisos.push(`El reloj de ${h.yo.nombre} difiere ${Math.round(Math.abs(desfase) / 60_000)} min: pon la hora automática en los dos.`);
    }
    const resultado: ResultadoSinc = {
      par: { id: h.yo.id, nombre: h.yo.nombre, codigo: h.codigo },
      traidas: aqui.aplicadas - juntadas.length, mandadas: mandarVivos.length, fusionadas: juntadas.length, choques: cuenta.choques,
      borradas: aqui.borradas + borrarAlla.length, archivos, avisos, desfaseMs: desfase,
    };
    await ctx.db.execute(sql`insert into sinc_historial (par, par_nombre, inicio, fin, dirigi, resultado) values
      (${h.yo.id}, ${h.yo.nombre}, ${inicio}, ${new Date()}, true, ${JSON.stringify(resultado)}::jsonb)`);
    avance("Listo", 1);
    return resultado;
  } catch (e) {
    await ctx.db.execute(sql`insert into sinc_historial (par, par_nombre, inicio, fin, dirigi, error) values
      (${par?.id ?? "?"}, ${par?.nombre ?? "?"}, ${inicio}, ${new Date()}, true, ${(e as Error).message})`).catch(() => {});
    throw e;
  } finally {
    soltar(ctx);
  }
}

export async function historialSinc(ctx: Contexto, limite = 20) {
  return filas<{ id: number; par_nombre: string; inicio: string; fin: string | null; dirigi: boolean; resultado: unknown; error: string | null }>(
    await ctx.db.execute(sql`select id, par_nombre, inicio, fin, dirigi, resultado, error from sinc_historial order by id desc limit ${limite}`),
  );
}
