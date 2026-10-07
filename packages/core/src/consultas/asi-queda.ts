import { listarCategorias, nombreCategoria } from "../finanzas/categorias";
import type { Contexto } from "../infra/contexto";
import { liquidacionViaje } from "../viajes/liquidacion";
import { choferDeViaje } from "./inicio";

/** Cómo quedan las cuentas del viaje si se guarda este gasto o esta entrega. Solo lectura: no guarda nada. */
export interface AsiQueda {
  /**
   * Solo si al chofer ya le diste plata en el viaje, o si el gasto sale de su efectivo: un gasto con
   * tarjeta o a crédito en un viaje sin entregas no hace que le debas nada.
   */
  chofer: { nombre: string; entregado: number; quedaAntes: number; quedaDespues: number } | null;
  /** Solo para gastos de un viaje con flete. */
  viaje: { codigo: string; dejaAntes: number; dejaDespues: number } | null;
  /** Solo para gastos con categoría. */
  categoria: { nombre: string; realDespues: number; presupuesto: number } | null;
}

export async function asiQueda(
  ctx: Contexto,
  e: {
    tipo: "gasto" | "entrega"; monto: number; viajeId: number; categoria?: string | null;
    /** Cómo se pagó el gasto; vacío = automático (con viaje: efectivo del chofer, como al guardar). */
    medioPago?: string | null;
  },
): Promise<AsiQueda> {
  const l = await liquidacionViaje(ctx, e.viajeId);
  const gasto = e.tipo === "gasto" ? e.monto : 0;
  const entrega = e.tipo === "entrega" ? e.monto : 0;
  const conSuEfectivo = (e.medioPago || "efectivo_chofer") === "efectivo_chofer";
  const chofer = e.tipo === "entrega" || l.entregado > 0 || conSuEfectivo
    ? { nombre: await choferDeViaje(ctx, e.viajeId), entregado: l.entregado + entrega, quedaAntes: l.saldo, quedaDespues: l.saldo + entrega - gasto }
    : null;
  const viaje = e.tipo === "gasto" && l.flete > 0
    ? { codigo: l.viaje.codigo, dejaAntes: l.flete - l.gastado, dejaDespues: l.flete - l.gastado - gasto } : null;
  let categoria: AsiQueda["categoria"] = null;
  if (e.tipo === "gasto" && e.categoria) {
    const linea = l.lineas.find((x) => x.categoria === e.categoria);
    categoria = {
      nombre: linea?.nombre ?? nombreCategoria(e.categoria, await listarCategorias(ctx)),
      realDespues: (linea?.real ?? 0) + gasto, presupuesto: linea?.presupuesto ?? 0,
    };
  }
  return { chofer, viaje, categoria };
}
