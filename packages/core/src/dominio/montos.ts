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

export function formatearSoles(centimos: number): string {
  const soles = Math.trunc(centimos / 100);
  const cent = String(Math.abs(centimos % 100)).padStart(2, "0");
  return `S/ ${soles.toLocaleString("en-US")}.${cent}`;
}
