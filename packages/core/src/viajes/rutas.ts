import { eq, ruta, rutaPresupuesto, type CategoriaGasto, type Ejecutor } from "@sunatapp/db";
import { ErrorNegocio } from "../errores";
import { registrarAuditoria } from "../infra/auditoria";
import type { Contexto } from "../infra/contexto";
import { CATEGORIAS_SISTEMA } from "../finanzas/categorias";

export interface LineaPlantilla {
  categoria: CategoriaGasto;
  monto: number; // céntimos
}

export interface Ruta {
  id: number;
  nombre: string;
  activa: boolean;
  plantilla: LineaPlantilla[];
}

const ORDEN_CATEGORIAS: string[] = CATEGORIAS_SISTEMA.map((c) => c.clave);
/** Las propias (fuera de la lista de fábrica) van al final. */
const posicion = (c: string) => { const i = ORDEN_CATEGORIAS.indexOf(c); return i < 0 ? 999 : i; };

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .trim()
    .replace(/\s+/g, " ");
}

function validarPlantilla(plantilla: LineaPlantilla[]): void {
  if (plantilla.some((l) => !Number.isInteger(l.monto) || l.monto < 0)) {
    throw new ErrorNegocio("El monto del presupuesto no puede ser negativo");
  }
}

function codigoError(error: unknown): string | undefined {
  return (error as { cause?: { code?: string }; code?: string }).cause?.code ?? (error as { code?: string }).code;
}

async function plantillaDe(ctx: Contexto, rutaId: number): Promise<LineaPlantilla[]> {
  const filas = await ctx.db
    .select({ categoria: rutaPresupuesto.categoria, monto: rutaPresupuesto.monto })
    .from(rutaPresupuesto)
    .where(eq(rutaPresupuesto.rutaId, rutaId))
    .orderBy(rutaPresupuesto.categoria);
  // El orden de despliegue es el de la enumeración (combustible, peaje, viáticos, ...), no el
  // alfabético que da el ORDER BY de arriba; ese ORDER BY solo hace determinista el resultado
  // de la consulta antes de reordenar en JS.
  return [...filas].sort((a, b) => posicion(a.categoria) - posicion(b.categoria));
}

async function todasLasRutas(ctx: Contexto): Promise<Array<typeof ruta.$inferSelect>> {
  return ctx.db.select().from(ruta).orderBy(ruta.id);
}

async function filaAModelo(ctx: Contexto, f: typeof ruta.$inferSelect): Promise<Ruta> {
  return { id: f.id, nombre: f.nombre, activa: f.activa, plantilla: await plantillaDe(ctx, f.id) };
}

export async function crearRuta(
  ctx: Contexto,
  nombre: string,
  plantilla: LineaPlantilla[],
  usuarioId?: number,
): Promise<number> {
  validarPlantilla(plantilla);
  const nombreNormalizado = normalizar(nombre);
  // Chequeo amistoso primero (evita abrir una transacción para el caso común); la restricción
  // única en `nombreNormalizado` (migración 0006) es el respaldo real contra la carrera entre dos
  // creaciones concurrentes con el mismo nombre normalizado.
  const existentes = await todasLasRutas(ctx);
  if (existentes.some((r) => r.nombreNormalizado === nombreNormalizado)) throw new ErrorNegocio("Ya existe una ruta con ese nombre");
  try {
    return await ctx.db.transaction(async (tx) => {
      const [fila] = await tx.insert(ruta).values({ nombre, nombreNormalizado }).returning({ id: ruta.id });
      const rutaId = fila!.id;
      if (plantilla.length > 0) {
        await tx.insert(rutaPresupuesto).values(plantilla.map((l) => ({ rutaId, categoria: l.categoria, monto: l.monto })));
      }
      await registrarAuditoria(tx, { usuarioId, accion: "ruta_creada", entidad: "ruta", entidadId: rutaId, detalle: { nombre, plantilla } });
      return rutaId;
    });
  } catch (error) {
    if (codigoError(error) === "23505") throw new ErrorNegocio("Ya existe una ruta con ese nombre");
    throw error;
  }
}

export async function listarRutas(ctx: Contexto, incluirInactivas = false): Promise<Ruta[]> {
  const filas = await todasLasRutas(ctx);
  const filtradas = incluirInactivas ? filas : filas.filter((f) => f.activa);
  const resultado: Ruta[] = [];
  for (const f of filtradas) resultado.push(await filaAModelo(ctx, f));
  return resultado;
}

export async function obtenerRuta(ctx: Contexto, rutaId: number): Promise<Ruta> {
  const [f] = await ctx.db.select().from(ruta).where(eq(ruta.id, rutaId));
  if (!f) throw new ErrorNegocio("La ruta no existe");
  return filaAModelo(ctx, f);
}

export async function actualizarPlantilla(
  ctx: Contexto,
  rutaId: number,
  plantilla: LineaPlantilla[],
  usuarioId?: number,
): Promise<void> {
  validarPlantilla(plantilla);
  await ctx.db.transaction(async (tx) => {
    const [f] = await tx.select({ id: ruta.id }).from(ruta).where(eq(ruta.id, rutaId));
    if (!f) throw new ErrorNegocio("La ruta no existe");
    await tx.delete(rutaPresupuesto).where(eq(rutaPresupuesto.rutaId, rutaId));
    if (plantilla.length > 0) {
      await tx.insert(rutaPresupuesto).values(plantilla.map((l) => ({ rutaId, categoria: l.categoria, monto: l.monto })));
    }
    await registrarAuditoria(tx, { usuarioId, accion: "ruta_plantilla_actualizada", entidad: "ruta", entidadId: rutaId, detalle: { plantilla } });
  });
}

export async function desactivarRuta(ctx: Contexto, rutaId: number): Promise<void> {
  const [f] = await ctx.db.update(ruta).set({ activa: false }).where(eq(ruta.id, rutaId)).returning({ id: ruta.id });
  if (!f) throw new ErrorNegocio("La ruta no existe");
}

export async function buscarRuta(ctx: Contexto, texto: string): Promise<Ruta[]> {
  const buscado = normalizar(texto);
  if (!buscado) return [];
  const filas = (await todasLasRutas(ctx)).filter((f) => f.activa && f.nombreNormalizado.includes(buscado));
  const resultado: Ruta[] = [];
  for (const f of filas) resultado.push(await filaAModelo(ctx, f));
  return resultado;
}

/** «Juliaca → Arequipa», «Juliaca ⇄ Arequipa», «Juliaca - Arequipa» → origen y destino (y si es ida y vuelta). */
export function partesDeRuta(nombre: string): { origen: string; destino: string; ambas: boolean } | null {
  const m = /^(.+?)\s*(→|->|⇄|<->|–|—|\s-\s|\sa\s)\s*(.+)$/i.exec(nombre.trim());
  if (!m) return null;
  return { origen: m[1]!.trim(), destino: m[3]!.trim(), ambas: m[2] === "⇄" || m[2] === "<->" };
}

/** La ruta (activa) que corresponde a un viaje de origen a destino, si hay una. */
export async function rutaDeViaje(db: Ejecutor, origen: string, destino: string): Promise<Ruta | null> {
  const o = normalizar(origen), d = normalizar(destino);
  // Las lecturas van por el ejecutor recibido (puede ser una transacción abierta).
  const ctx = { db } as unknown as Contexto;
  for (const f of (await db.select().from(ruta).orderBy(ruta.id)).filter((x) => x.activa)) {
    const p = partesDeRuta(f.nombre);
    if (!p) continue;
    const po = normalizar(p.origen), pd = normalizar(p.destino);
    if ((po === o && pd === d) || (p.ambas && po === d && pd === o)) return filaAModelo(ctx, f);
  }
  return null;
}
