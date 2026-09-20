export const IGV_PORCENTAJE = 18;

export interface ParametrosDetraccion {
  porcentaje: number;
  umbralCentimos: number;
}

export interface MontosFactura {
  subtotal: number;
  igv: number;
  total: number;
  detraccionPorcentaje: number | null;
  detraccionMonto: number;
  cobrable: number;
}

export function calcularMontosFactura(e: {
  montoCentimos: number;
  incluyeIgv: boolean;
  detraccion: ParametrosDetraccion;
}): MontosFactura {
  if (!Number.isInteger(e.montoCentimos) || e.montoCentimos <= 0) {
    throw new Error("El monto debe ser un entero positivo en céntimos");
  }
  let subtotal: number;
  let igv: number;
  let total: number;
  if (e.incluyeIgv) {
    total = e.montoCentimos;
    subtotal = Math.round((total * 100) / (100 + IGV_PORCENTAJE));
    igv = total - subtotal;
  } else {
    subtotal = e.montoCentimos;
    igv = Math.round((subtotal * IGV_PORCENTAJE) / 100);
    total = subtotal + igv;
  }
  const aplica = total > e.detraccion.umbralCentimos;
  const detraccionMonto = aplica ? Math.round((total * e.detraccion.porcentaje) / 100 / 100) * 100 : 0;
  return {
    subtotal,
    igv,
    total,
    detraccionPorcentaje: aplica ? e.detraccion.porcentaje : null,
    detraccionMonto,
    cobrable: total - detraccionMonto,
  };
}

/**
 * Lee un monto escrito a mano ("2500", "2,500.50", "2500,5", "S/ 1 200") y lo devuelve en
 * céntimos enteros; null si no se entiende o no es positivo. Acepta coma o punto como separador
 * decimal —en el chat se escribe de las dos formas— pero exige que los miles vengan agrupados de
 * tres en tres con un único separador, para no adivinar en casos ambiguos como "2.500,00.5".
 */
export function parsearMonto(texto: string): number | null {
  const limpio = texto.replace(/\s| /g, "").replace(/^s\/\.?/i, "");
  if (!/^[\d.,]+$/.test(limpio)) return null;

  const ultimoSeparador = Math.max(limpio.lastIndexOf(","), limpio.lastIndexOf("."));
  const digitosFinales = ultimoSeparador === -1 ? 0 : limpio.length - ultimoSeparador - 1;
  const hayDecimales = digitosFinales === 1 || digitosFinales === 2;
  const entero = hayDecimales ? limpio.slice(0, ultimoSeparador) : limpio;
  const decimales = hayDecimales ? limpio.slice(ultimoSeparador + 1) : "";

  if (entero.includes(",") && entero.includes(".")) return null;
  const separador = entero.includes(",") ? "," : ".";
  if (entero.includes(separador) && !new RegExp(`^\\d{1,3}(\\${separador}\\d{3})+$`).test(entero)) return null;

  const digitos = entero.replace(/[.,]/g, "");
  if (!/^\d+$/.test(digitos)) return null;
  const centimos = Number(digitos) * 100 + Number(decimales.padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(centimos) || centimos <= 0) return null;
  return centimos;
}

export function formatearSoles(centimos: number): string {
  const soles = Math.trunc(centimos / 100);
  const cent = String(Math.abs(centimos % 100)).padStart(2, "0");
  return `S/ ${soles.toLocaleString("en-US")}.${cent}`;
}
