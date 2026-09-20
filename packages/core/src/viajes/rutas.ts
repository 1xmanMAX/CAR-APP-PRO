import { eq, ruta, rutaPresupuesto, type CategoriaGasto } from "@sunatapp/db";
import { ErrorNegocio } from "../errores";
import { registrarAuditoria } from "../infra/auditoria";
import type { Contexto } from "../infra/contexto";

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

async function plantillaDe(ctx: Contexto, rutaId: number): Promise<LineaPlantilla[]> {
  const filas = await ctx.db
    .select({ categoria: rutaPresupuesto.categoria, monto: rutaPresupuesto.monto })
    .from(rutaPresupuesto)
    .where(eq(rutaPresupuesto.rutaId, rutaId));
  return filas;
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
  const buscado = normalizar(nombre);
  const existentes = await todasLasRutas(ctx);
  if (existentes.some((r) => normalizar(r.nombre) === buscado)) throw new ErrorNegocio("Ya existe una ruta con ese nombre");
  return ctx.db.transaction(async (tx) => {
    const [fila] = await tx.insert(ruta).values({ nombre }).returning({ id: ruta.id });
    const rutaId = fila!.id;
    if (plantilla.length > 0) {
      await tx.insert(rutaPresupuesto).values(plantilla.map((l) => ({ rutaId, categoria: l.categoria, monto: l.monto })));
    }
    await registrarAuditoria(tx, { usuarioId, accion: "ruta_creada", entidad: "ruta", entidadId: rutaId, detalle: { nombre, plantilla } });
    return rutaId;
  });
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
  const filas = (await todasLasRutas(ctx)).filter((f) => f.activa && normalizar(f.nombre).includes(buscado));
  const resultado: Ruta[] = [];
  for (const f of filas) resultado.push(await filaAModelo(ctx, f));
  return resultado;
}
