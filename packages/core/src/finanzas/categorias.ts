import { and, asc, categoriaGasto, eq, type Ejecutor, type TipoCategoria } from "@sunatapp/db";
import { ErrorNegocio } from "../errores";
import { registrarAuditoria } from "../infra/auditoria";
import type { Contexto } from "../infra/contexto";

export interface Categoria { clave: string; nombre: string; tipo: TipoCategoria; sistema: boolean; activa: boolean; orden: number }

/** Las de fábrica (la migración 0012 las siembra con estos mismos datos). */
export const CATEGORIAS_SISTEMA: ReadonlyArray<{ clave: string; nombre: string; tipo: TipoCategoria }> = [
  { clave: "combustible", nombre: "Combustible", tipo: "variable" }, { clave: "peaje", nombre: "Peajes", tipo: "variable" },
  { clave: "viaticos", nombre: "Viáticos del chofer", tipo: "variable" }, { clave: "hospedaje", nombre: "Hospedaje", tipo: "variable" },
  { clave: "estiba", nombre: "Estiba y desestiba", tipo: "variable" }, { clave: "balanza", nombre: "Balanza", tipo: "variable" },
  { clave: "cochera", nombre: "Cochera en ruta", tipo: "variable" }, { clave: "lavado", nombre: "Lavado", tipo: "variable" },
  { clave: "llantas_ruta", nombre: "Llantas en ruta", tipo: "variable" }, { clave: "reparacion_ruta", nombre: "Reparación en ruta", tipo: "variable" },
  { clave: "lubricantes", nombre: "Lubricantes y engrase", tipo: "variable" }, { clave: "resguardo", nombre: "Resguardo o custodia", tipo: "variable" },
  { clave: "multas", nombre: "Multas y papeletas", tipo: "variable" }, { clave: "otros_viaje", nombre: "Otros del viaje", tipo: "variable" },
  { clave: "cuota_prestamo", nombre: "Cuota de leasing o préstamo", tipo: "fijo" }, { clave: "soat", nombre: "SOAT", tipo: "fijo" },
  { clave: "seguro", nombre: "Seguro vehicular", tipo: "fijo" }, { clave: "revision_tecnica", nombre: "Revisión técnica", tipo: "fijo" },
  { clave: "gps", nombre: "GPS y monitoreo", tipo: "fijo" }, { clave: "sueldo_chofer", nombre: "Sueldo del chofer", tipo: "fijo" },
  { clave: "sueldo_admin", nombre: "Sueldos administrativos", tipo: "fijo" }, { clave: "contador", nombre: "Contador", tipo: "fijo" },
  { clave: "local", nombre: "Local, oficina o cochera mensual", tipo: "fijo" }, { clave: "permisos_mtc", nombre: "Permisos MTC", tipo: "fijo" },
  { clave: "telefonia", nombre: "Teléfono e internet", tipo: "fijo" }, { clave: "mantenimiento", nombre: "Mantenimiento preventivo", tipo: "fijo" },
  { clave: "otros_fijos", nombre: "Otros fijos", tipo: "fijo" },
];

export const NOMBRE_CATEGORIA: Record<string, string> = Object.fromEntries(CATEGORIAS_SISTEMA.map((c) => [c.clave, c.nombre]));

const sinTildes = (t: string) => t.normalize("NFD").replace(/\p{Diacritic}/gu, "");

/** Nombre para mostrar; las propias se buscan en `lista` (si no se pasa, se humaniza la clave). */
export function nombreCategoria(clave: string, lista?: Categoria[]): string {
  return lista?.find((c) => c.clave === clave)?.nombre ?? NOMBRE_CATEGORIA[clave] ?? (clave.charAt(0).toUpperCase() + clave.slice(1).replace(/_/g, " "));
}

export async function listarCategorias(ctx: Contexto, o: { tipo?: TipoCategoria; soloActivas?: boolean } = {}): Promise<Categoria[]> {
  const filtros = [];
  if (o.tipo) filtros.push(eq(categoriaGasto.tipo, o.tipo));
  if (o.soloActivas) filtros.push(eq(categoriaGasto.activa, true));
  return ctx.db.select({
    clave: categoriaGasto.clave, nombre: categoriaGasto.nombre, tipo: categoriaGasto.tipo, sistema: categoriaGasto.sistema,
    activa: categoriaGasto.activa, orden: categoriaGasto.orden,
  }).from(categoriaGasto).where(filtros.length ? and(...filtros) : undefined).orderBy(asc(categoriaGasto.orden), asc(categoriaGasto.nombre));
}

/** La categoría existe y está activa (si no, error de negocio). */
export async function categoriaValida(db: Ejecutor, clave: string): Promise<Categoria> {
  const [c] = await db.select().from(categoriaGasto).where(eq(categoriaGasto.clave, clave));
  if (!c) throw new ErrorNegocio("Categoría de gasto no válida");
  if (!c.activa) throw new ErrorNegocio(`La categoría «${c.nombre}» no está activa`);
  return { clave: c.clave, nombre: c.nombre, tipo: c.tipo, sistema: c.sistema, activa: c.activa, orden: c.orden };
}

export async function crearCategoria(ctx: Contexto, e: { nombre: string; tipo: TipoCategoria; usuarioId?: number }): Promise<string> {
  const nombre = e.nombre.trim().replace(/\s+/g, " ");
  if (nombre.length < 3) throw new ErrorNegocio("El nombre de la categoría es muy corto");
  const clave = sinTildes(nombre).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const [existe] = await ctx.db.select({ clave: categoriaGasto.clave }).from(categoriaGasto).where(eq(categoriaGasto.clave, clave));
  if (existe) throw new ErrorNegocio(`La categoría «${nombre}» ya existe`);
  await ctx.db.insert(categoriaGasto).values({ clave, nombre, tipo: e.tipo, sistema: false, activa: true, orden: 100 });
  await registrarAuditoria(ctx.db, { usuarioId: e.usuarioId, accion: "categoria_creada", entidad: "categoria_gasto", entidadId: clave, detalle: e });
  return clave;
}

export async function desactivarCategoria(ctx: Contexto, clave: string, usuarioId?: number): Promise<void> {
  const [f] = await ctx.db.update(categoriaGasto).set({ activa: false }).where(eq(categoriaGasto.clave, clave)).returning({ clave: categoriaGasto.clave });
  if (!f) throw new ErrorNegocio("La categoría no existe");
  await registrarAuditoria(ctx.db, { usuarioId, accion: "categoria_desactivada", entidad: "categoria_gasto", entidadId: clave });
}

const SINONIMOS: Array<[RegExp, string]> = [
  [/^(combustible|petroleo|petróleo|diesel|diésel|gasolina|grifo|gas)/i, "combustible"],
  [/^(peaje|peajes)/i, "peaje"],
  [/^(viatico|viático|viaticos|viáticos|comida|alimentos?|menu|menú)/i, "viaticos"],
  [/^(hospedaje|hotel|alojamiento)/i, "hospedaje"],
  [/^(estiba|descarga|carga)/i, "estiba"],
  [/^(balanza|pesaje)/i, "balanza"],
  [/^(cochera|parqueo|estacionamiento)/i, "cochera"],
  [/^(lavado|lavada)/i, "lavado"],
  [/^(llanta|llantas|parche|vulcaniz)/i, "llantas_ruta"],
  [/^(aceite|engrase|grasa|lubricante)/i, "lubricantes"],
  [/^(custodia|resguardo|guardian)/i, "resguardo"],
  [/^(multa|papeleta)/i, "multas"],
  [/^(reparacion|reparación|repuesto|mecanico|mecánico|taller|auxilio)/i, "reparacion_ruta"],
  [/^(otro|otros|varios)/i, "otros_viaje"],
];

export function categoriaDesdeTexto(texto: string): string | null {
  const t = texto.trim();
  for (const [re, c] of SINONIMOS) if (re.test(t)) return c;
  return null;
}
