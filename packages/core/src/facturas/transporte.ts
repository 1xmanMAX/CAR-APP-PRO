import { and, eq, guiaTransportista, inArray, valorReferencialRuta, vehiculo, type Ejecutor } from "@sunatapp/db";
import { calcularValoresReferenciales, toneladas, type TransporteFactura, type ValoresReferenciales } from "@sunatapp/sunat";
import { ErrorNegocio } from "../errores";
import type { Contexto } from "../infra/contexto";

type Falta =
  | { tipo: "vr_ruta"; partidaUbigeo: string; llegadaUbigeo: string; partida: string; llegada: string }
  | { tipo: "carga_util"; vehiculoId: number; placa: string };

/** Falta un dato que se pide una sola vez (VR de la ruta o carga útil del vehículo) para la factura 1004. */
export class FaltaDatoTransporteError extends ErrorNegocio {
  constructor(readonly falta: Falta) {
    super(falta.tipo === "vr_ruta"
      ? `Falta el valor referencial MTC por tonelada de ${falta.partida} → ${falta.llegada}`
      : `Falta la carga útil (toneladas) de la unidad ${falta.placa}`);
    this.name = "FaltaDatoTransporteError";
  }
}

/** Último tramo de la dirección (suele ser el distrito o la referencia), recortado para mensajes. */
const corta = (direccion: string) => direccion.split(",").pop()!.trim().slice(0, 40);

export async function guardarValorReferencial(
  ctx: Contexto,
  e: { partidaUbigeo: string; llegadaUbigeo: string; vrPorTmCentimos: number; fuente?: string },
): Promise<void> {
  if (!/^\d{6}$/.test(e.partidaUbigeo) || !/^\d{6}$/.test(e.llegadaUbigeo)) throw new ErrorNegocio("Los ubigeos deben tener 6 dígitos");
  if (!Number.isInteger(e.vrPorTmCentimos) || e.vrPorTmCentimos <= 0) throw new ErrorNegocio("El valor referencial debe ser mayor que cero");
  const valores = { vrPorTm: e.vrPorTmCentimos, fuente: e.fuente ?? null, actualizadoEn: ctx.reloj() };
  await ctx.db.insert(valorReferencialRuta).values({ partidaUbigeo: e.partidaUbigeo, llegadaUbigeo: e.llegadaUbigeo, ...valores })
    .onConflictDoUpdate({ target: [valorReferencialRuta.partidaUbigeo, valorReferencialRuta.llegadaUbigeo], set: valores });
}

export async function listarValoresReferenciales(
  ctx: Contexto,
): Promise<Array<{ partidaUbigeo: string; llegadaUbigeo: string; vrPorTm: number; fuente: string | null }>> {
  return ctx.db.select({
    partidaUbigeo: valorReferencialRuta.partidaUbigeo, llegadaUbigeo: valorReferencialRuta.llegadaUbigeo,
    vrPorTm: valorReferencialRuta.vrPorTm, fuente: valorReferencialRuta.fuente,
  }).from(valorReferencialRuta).orderBy(valorReferencialRuta.partidaUbigeo, valorReferencialRuta.llegadaUbigeo);
}

export async function borrarValorReferencial(ctx: Contexto, partidaUbigeo: string, llegadaUbigeo: string): Promise<void> {
  await ctx.db.delete(valorReferencialRuta)
    .where(and(eq(valorReferencialRuta.partidaUbigeo, partidaUbigeo), eq(valorReferencialRuta.llegadaUbigeo, llegadaUbigeo)));
}

/**
 * Origen, destino, detalle y valores referenciales de la factura 1004, tomados de la guía.
 * Garantiza carga útil y carga efectiva mayores que cero y un detalle del viaje no vacío;
 * si falta el VR de la ruta o la carga útil del vehículo lanza FaltaDatoTransporteError.
 */
export async function transporteDeGuia(
  ctx: Contexto, guiaId: number, db: Ejecutor = ctx.db,
): Promise<{ transporte: TransporteFactura; vr: ValoresReferenciales }> {
  const [g] = await db.select().from(guiaTransportista).where(eq(guiaTransportista.id, guiaId));
  if (!g) throw new ErrorNegocio(`La guía ${guiaId} no existe`);
  const [v] = await db.select().from(vehiculo).where(eq(vehiculo.id, g.vehiculoId));
  const [vr] = await db.select().from(valorReferencialRuta)
    .where(and(eq(valorReferencialRuta.partidaUbigeo, g.partidaUbigeo), eq(valorReferencialRuta.llegadaUbigeo, g.llegadaUbigeo)));
  if (!vr) {
    throw new FaltaDatoTransporteError({
      tipo: "vr_ruta", partidaUbigeo: g.partidaUbigeo, llegadaUbigeo: g.llegadaUbigeo,
      partida: corta(g.partidaDireccion), llegada: corta(g.llegadaDireccion),
    });
  }
  const cargaUtilTm = v?.cargaUtilTm ? Number(v.cargaUtilTm) : 0;
  if (!v || !(cargaUtilTm > 0)) throw new FaltaDatoTransporteError({ tipo: "carga_util", vehiculoId: g.vehiculoId, placa: v?.placa ?? "?" });
  const cargaEfectivaTm = toneladas(g.pesoBruto, g.unidadPeso);
  if (!(cargaEfectivaTm > 0)) throw new ErrorNegocio(`El peso de la guía ${g.serie}-${g.numero} es demasiado pequeño para calcular el valor referencial`);
  const valores = calcularValoresReferenciales({ vrPorTmCentimos: vr.vrPorTm, cargaEfectivaTm, cargaUtilTm });
  const detalleViaje = `TRASLADO DE ${cargaEfectivaTm.toFixed(3)} TNE SEGUN GRE ${g.serie}-${g.numero}: ${corta(g.partidaDireccion)} - ${corta(g.llegadaDireccion)}`;
  return {
    vr: valores,
    transporte: {
      origen: { ubigeo: g.partidaUbigeo, direccion: g.partidaDireccion },
      destino: { ubigeo: g.llegadaUbigeo, direccion: g.llegadaDireccion },
      detalleViaje,
      vr: valores,
      ...(v.configuracionVehicular ? { vehiculo: { configuracion: v.configuracionVehicular, cargaUtilTm, cargaEfectivaTm } } : {}),
    },
  };
}

/**
 * Art. 4 del D.S. 020-2021-MTC: para ciertos vehículos (cisternas, entre otros) en rutas largas el
 * valor referencial se multiplica por 1.4 (retorno al vacío). La app no lo calcula: solo avisa
 * cuando la unidad de la guía jala una cisterna, el único de esos tipos que el modelo distingue.
 */
export const AVISO_RETORNO_VACIO = "Para cisternas en rutas largas la norma multiplica el valor referencial por 1.4: revisa el monto antes de emitir";

/** Ids de las guías [guiaIds] cuya unidad jala una cisterna. */
export async function guiasConAvisoRetornoVacio(ctx: Contexto, guiaIds: number[]): Promise<Set<number>> {
  if (!guiaIds.length) return new Set();
  const filas = await ctx.db.select({ id: guiaTransportista.id })
    .from(guiaTransportista)
    .innerJoin(vehiculo, eq(vehiculo.id, guiaTransportista.vehiculoId))
    .where(and(inArray(guiaTransportista.id, guiaIds), eq(vehiculo.semirremolque, "cisterna")));
  return new Set(filas.map((f) => f.id));
}

export async function avisoRetornoVacio(ctx: Contexto, guiaId: number): Promise<string | null> {
  return (await guiasConAvisoRetornoVacio(ctx, [guiaId])).has(guiaId) ? AVISO_RETORNO_VACIO : null;
}
