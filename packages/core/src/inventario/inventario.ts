import {
  and, compraRepuesto, desc, eq, parteInstalada, repuesto, sql, tipoParte, usuario, vehiculo, type Ejecutor, type OrigenRegistro,
} from "@sunatapp/db";
import { ErrorNegocio } from "../errores";
import { registrarAuditoria } from "../infra/auditoria";
import type { Contexto } from "../infra/contexto";
import { hoy } from "../flota/unidades";

export interface Repuesto {
  id: number;
  codigo: string;
  nombre: string;
  categoria: string;
  stock: number;
  stockMinimo: number;
  costoUnitario: number;
  proveedor: string | null;
  tipoParteId: number | null;
  tipoParteNombre: string | null;
  vida: { km: number | null; viajes: number | null; dias: number | null } | null;
  /** Invertido total = lo que hay en almacén + lo instalado (a costo). */
  inversion: number;
  instalado: Array<{ unidad: string; posicion: string; parte: string }>;
  valorInstalado: number;
  estado: "EN STOCK" | "BAJO" | "INSTALADO" | "AGOTADO";
}

export const CATEGORIAS_REPUESTO = ["Frenos", "Llantas", "Lubricantes", "Filtros", "Eléctrico", "Suspensión", "Motor", "Transmisión", "Otros"];

async function siguienteCodigo(db: Ejecutor): Promise<string> {
  const filas = await db.select({ codigo: repuesto.codigo }).from(repuesto);
  const max = filas.reduce((m, f) => Math.max(m, Number(/^REP-(\d+)$/.exec(f.codigo)?.[1] ?? 0)), 0);
  return `REP-${String(max + 1).padStart(3, "0")}`;
}

export async function listarRepuestos(
  ctx: Contexto, o: { buscar?: string; categoria?: string; vehiculoId?: number } = {},
): Promise<Repuesto[]> {
  const filas = await ctx.db.select({ r: repuesto, t: tipoParte }).from(repuesto)
    .leftJoin(tipoParte, eq(tipoParte.id, repuesto.tipoParteId))
    .where(eq(repuesto.activo, true)).orderBy(repuesto.codigo);
  const instaladas = await ctx.db
    .select({ repuestoId: parteInstalada.repuestoId, vehiculoId: parteInstalada.vehiculoId, codigo: vehiculo.codigo, posicion: parteInstalada.posicion, parte: tipoParte.nombreCorto, costo: parteInstalada.costo })
    .from(parteInstalada)
    .innerJoin(vehiculo, eq(vehiculo.id, parteInstalada.vehiculoId))
    .innerJoin(tipoParte, eq(tipoParte.id, parteInstalada.tipoParteId))
    .where(and(eq(parteInstalada.activa, true), sql`${parteInstalada.repuestoId} is not null`));
  const buscado = o.buscar?.trim().toLowerCase();
  const r: Repuesto[] = [];
  for (const { r: f, t } of filas) {
    const inst = instaladas.filter((i) => i.repuestoId === f.id);
    if (o.vehiculoId !== undefined && !inst.some((i) => i.vehiculoId === o.vehiculoId)) continue;
    if (o.categoria && f.categoria !== o.categoria) continue;
    if (buscado && !`${f.codigo} ${f.nombre} ${f.categoria} ${f.proveedor ?? ""}`.toLowerCase().includes(buscado)) continue;
    const valorInstalado = inst.reduce((s, i) => s + i.costo, 0);
    const estado: Repuesto["estado"] = f.stock <= 0 ? (inst.length ? "INSTALADO" : "AGOTADO") : f.stock <= f.stockMinimo ? "BAJO" : "EN STOCK";
    r.push({
      id: f.id, codigo: f.codigo, nombre: f.nombre, categoria: f.categoria, stock: f.stock, stockMinimo: f.stockMinimo,
      costoUnitario: f.costoUnitario, proveedor: f.proveedor, tipoParteId: f.tipoParteId, tipoParteNombre: t?.nombre ?? null,
      vida: t ? { km: t.vidaKm, viajes: t.vidaViajes, dias: t.vidaDias } : null,
      inversion: f.stock * f.costoUnitario + valorInstalado,
      instalado: inst.map((i) => ({ unidad: i.codigo ?? "", posicion: i.posicion, parte: i.parte })),
      valorInstalado, estado,
    });
  }
  return r;
}

export async function obtenerRepuesto(ctx: Contexto, id: number) {
  const [f] = await ctx.db.select().from(repuesto).where(eq(repuesto.id, id));
  if (!f) throw new ErrorNegocio("El repuesto no existe");
  return f;
}

export async function buscarRepuestoPorCodigo(ctx: Contexto, texto: string) {
  const t = texto.trim().toUpperCase();
  const m = /^(?:REP-?)?0*(\d+)$/.exec(t);
  const codigo = m ? `REP-${m[1]!.padStart(3, "0")}` : t;
  const [f] = await ctx.db.select().from(repuesto).where(eq(repuesto.codigo, codigo));
  if (f) return f;
  const filas = await ctx.db.select().from(repuesto).where(sql`lower(${repuesto.nombre}) like ${`%${texto.trim().toLowerCase()}%`}`).limit(2);
  return filas.length === 1 ? filas[0]! : null;
}

export interface EntradaRepuesto {
  codigo?: string;
  nombre: string;
  categoria: string;
  stockMinimo?: number;
  costoUnitario?: number;
  proveedor?: string | null;
  tipoParteId?: number | null;
}

export async function crearRepuesto(ctx: Contexto, e: EntradaRepuesto, usuarioId?: number): Promise<number> {
  if (!e.nombre.trim()) throw new ErrorNegocio("Falta el nombre del repuesto");
  if (!e.categoria.trim()) throw new ErrorNegocio("Falta la categoría");
  return ctx.db.transaction(async (tx) => {
    const codigo = e.codigo?.trim().toUpperCase() || (await siguienteCodigo(tx));
    const [dup] = await tx.select({ id: repuesto.id }).from(repuesto).where(eq(repuesto.codigo, codigo));
    if (dup) throw new ErrorNegocio(`El código ${codigo} ya existe`);
    const [f] = await tx.insert(repuesto).values({
      codigo, nombre: e.nombre.trim(), categoria: e.categoria.trim(), stockMinimo: e.stockMinimo ?? 0,
      costoUnitario: e.costoUnitario ?? 0, proveedor: e.proveedor ?? null, tipoParteId: e.tipoParteId ?? null,
    }).returning({ id: repuesto.id });
    await registrarAuditoria(tx, { usuarioId, accion: "repuesto_creado", entidad: "repuesto", entidadId: f!.id, detalle: { ...e, codigo } });
    return f!.id;
  });
}

export async function editarRepuesto(ctx: Contexto, id: number, e: Partial<EntradaRepuesto>, usuarioId?: number): Promise<void> {
  const cambios: Partial<typeof repuesto.$inferInsert> = {};
  if (e.nombre !== undefined) cambios.nombre = e.nombre.trim();
  if (e.categoria !== undefined) cambios.categoria = e.categoria.trim();
  if (e.stockMinimo !== undefined) cambios.stockMinimo = e.stockMinimo;
  if (e.proveedor !== undefined) cambios.proveedor = e.proveedor;
  if (e.tipoParteId !== undefined) cambios.tipoParteId = e.tipoParteId;
  const [f] = await ctx.db.update(repuesto).set(cambios).where(eq(repuesto.id, id)).returning({ id: repuesto.id });
  if (!f) throw new ErrorNegocio("El repuesto no existe");
  await registrarAuditoria(ctx.db, { usuarioId, accion: "repuesto_editado", entidad: "repuesto", entidadId: id, detalle: e });
}

/**
 * Registra una compra: sube el stock y recalcula el costo unitario promedio ponderado.
 * La compra es inversión en inventario; el gasto del trailer se reconoce al instalarlo.
 */
export async function registrarCompra(
  ctx: Contexto,
  e: { repuestoId: number; cantidad: number; costoUnitario: number; fecha?: string; proveedor?: string | null; origen: OrigenRegistro; usuarioId?: number },
): Promise<number> {
  if (!Number.isInteger(e.cantidad) || e.cantidad <= 0) throw new ErrorNegocio("La cantidad debe ser un entero positivo");
  if (!Number.isInteger(e.costoUnitario) || e.costoUnitario <= 0) throw new ErrorNegocio("El costo unitario debe ser mayor que 0");
  return ctx.db.transaction(async (tx) => {
    const [r] = await tx.select().from(repuesto).where(eq(repuesto.id, e.repuestoId)).for("update");
    if (!r) throw new ErrorNegocio("El repuesto no existe");
    const stockNuevo = r.stock + e.cantidad;
    const costoPromedio = Math.round((Math.max(0, r.stock) * r.costoUnitario + e.cantidad * e.costoUnitario) / stockNuevo);
    await tx.update(repuesto).set({ stock: stockNuevo, costoUnitario: costoPromedio, proveedor: e.proveedor ?? r.proveedor }).where(eq(repuesto.id, r.id));
    const [c] = await tx.insert(compraRepuesto).values({
      repuestoId: r.id, cantidad: e.cantidad, costoUnitario: e.costoUnitario, fecha: e.fecha ?? hoy(ctx),
      proveedor: e.proveedor ?? null, origen: e.origen, usuarioId: e.usuarioId ?? null,
    }).returning({ id: compraRepuesto.id });
    await registrarAuditoria(tx, { usuarioId: e.usuarioId, accion: "compra_repuesto", entidad: "repuesto", entidadId: r.id, detalle: e });
    return c!.id;
  });
}

export async function listarCompras(ctx: Contexto, o: { origen?: OrigenRegistro; limite?: number; desde?: string } = {}) {
  const filtros = [];
  if (o.origen) filtros.push(eq(compraRepuesto.origen, o.origen));
  if (o.desde) filtros.push(sql`${compraRepuesto.fecha} >= ${o.desde}`);
  return ctx.db
    .select({
      id: compraRepuesto.id, fecha: compraRepuesto.fecha, cantidad: compraRepuesto.cantidad, costoUnitario: compraRepuesto.costoUnitario,
      total: sql<number>`${compraRepuesto.cantidad} * ${compraRepuesto.costoUnitario}`.mapWith(Number),
      proveedor: compraRepuesto.proveedor, origen: compraRepuesto.origen, codigo: repuesto.codigo, nombre: repuesto.nombre,
      categoria: repuesto.categoria, quien: usuario.nombre,
    })
    .from(compraRepuesto)
    .innerJoin(repuesto, eq(repuesto.id, compraRepuesto.repuestoId))
    .leftJoin(usuario, eq(usuario.id, compraRepuesto.usuarioId))
    .where(filtros.length ? and(...filtros) : undefined)
    .orderBy(desc(compraRepuesto.fecha), desc(compraRepuesto.id))
    .limit(o.limite ?? 50);
}

export interface ResumenInventario {
  inversionTotal: number;
  enAlmacen: number;
  instalado: number;
  stockBajo: number;
  porCategoria: Array<{ categoria: string; monto: number }>;
}

export function resumirInventario(repuestos: Repuesto[]): ResumenInventario {
  const porCat = new Map<string, number>();
  let enAlmacen = 0;
  let instalado = 0;
  for (const r of repuestos) {
    const almacen = Math.max(0, r.stock) * r.costoUnitario;
    enAlmacen += almacen;
    instalado += r.valorInstalado;
    porCat.set(r.categoria, (porCat.get(r.categoria) ?? 0) + almacen + r.valorInstalado);
  }
  return {
    inversionTotal: enAlmacen + instalado, enAlmacen, instalado,
    stockBajo: repuestos.filter((r) => r.stock <= r.stockMinimo && r.stockMinimo > 0).length,
    porCategoria: [...porCat].map(([categoria, monto]) => ({ categoria, monto })).sort((a, b) => b.monto - a.monto),
  };
}

/** Total comprado en repuestos (lo que sale de caja), en un rango. */
export async function totalCompras(ctx: Contexto, desde: string, hasta: string): Promise<number> {
  const [f] = await ctx.db.select({ t: sql<string>`coalesce(sum(${compraRepuesto.cantidad} * ${compraRepuesto.costoUnitario}), 0)` })
    .from(compraRepuesto).where(and(sql`${compraRepuesto.fecha} >= ${desde}`, sql`${compraRepuesto.fecha} <= ${hasta}`));
  return Number(f?.t ?? 0);
}

export async function repuestosConStockBajo(ctx: Contexto) {
  return ctx.db.select().from(repuesto).where(and(eq(repuesto.activo, true), sql`${repuesto.stockMinimo} > 0`, sql`${repuesto.stock} <= ${repuesto.stockMinimo}`));
}
