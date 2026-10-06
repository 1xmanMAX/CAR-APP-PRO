/**
 * Valores referenciales del SPOT para el transporte de carga (D.S. 020-2021-MTC, art. 3, 70 % de la carga útil nominal).
 * La factura 1004 los exige en cac:Delivery/cac:DeliveryTerms (01 servicio, 02 carga efectiva, 03 carga útil).
 * Ver docs/superpowers/notas/2026-10-05-valor-referencial-mtc.md.
 */
export const FACTOR_CARGA_UTIL_MINIMA = 0.7;
/** La fórmula de VR01 ha sido contrastada con el texto de la norma D.S. 020-2021-MTC art. 3. */
export const FORMULA_VR_VERIFICADA = true;

export interface ValoresReferenciales {
  vrServicio: number;
  vrCargaEfectiva: number;
  vrCargaUtil: number;
}

export function toneladas(peso: string, unidad: string): number {
  const n = Number(peso);
  if (!(n > 0)) throw new Error(`Peso no válido: ${peso}`);
  if (unidad === "TNE") return Math.round(n * 1000) / 1000;
  if (unidad === "KGM") return Math.round(n) / 1000;
  throw new Error(`No se conoce la unidad de peso ${unidad} (se esperaba KGM o TNE)`);
}

export function calcularValoresReferenciales(e: { vrPorTmCentimos: number; cargaEfectivaTm: number; cargaUtilTm: number }): ValoresReferenciales {
  if (!(e.vrPorTmCentimos > 0) || !(e.cargaEfectivaTm > 0) || !(e.cargaUtilTm > 0)) {
    throw new Error("El valor referencial por TM, la carga efectiva y la carga útil deben ser mayores que cero");
  }
  // Usar aritmética entera (kilopondios) para evitar error de redondeo: vrPorTm × kg → ÷1000.
  const toKilograms = (tm: number) => Math.round(tm * 1000);
  const vrCargaEfectiva = Math.round((e.vrPorTmCentimos * toKilograms(e.cargaEfectivaTm)) / 1000);
  const vrCargaUtil = Math.round((e.vrPorTmCentimos * toKilograms(e.cargaUtilTm)) / 1000);
  // Piso: FACTOR_CARGA_UTIL_MINIMA de la carga útil. Usar aritmética entera para evitar error de redondeo.
  // vrServicio = max(vrCargaEfectiva, FACTOR_CARGA_UTIL_MINIMA × vrCargaUtil)
  const vrServicio = Math.max(vrCargaEfectiva, Math.round((vrCargaUtil * Math.round(FACTOR_CARGA_UTIL_MINIMA * 100)) / 100));
  return { vrServicio, vrCargaEfectiva, vrCargaUtil };
}

/** La detracción del transporte de carga se calcula sobre el mayor entre el importe y el VR del servicio. */
export function baseDetraccion(totalCentimos: number, vr: ValoresReferenciales | null): number {
  return vr ? Math.max(totalCentimos, vr.vrServicio) : totalCentimos;
}
