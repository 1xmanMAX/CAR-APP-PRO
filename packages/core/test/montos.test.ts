import { describe, expect, it } from "vitest";
import { calcularMontosFactura, formatearSoles, parsearMonto } from "../src/dominio/montos";

const detraccion = { porcentaje: 4, umbralCentimos: 40000 };

describe("calcularMontosFactura", () => {
  it("monto sin IGV: agrega 18 % y aplica detracción redondeada a soles", () => {
    expect(calcularMontosFactura({ montoCentimos: 100000, incluyeIgv: false, detraccion })).toEqual({
      subtotal: 100000,
      igv: 18000,
      total: 118000,
      detraccionPorcentaje: 4,
      detraccionMonto: 4700, // 4 % de 1180.00 = 47.20 → 47
      cobrable: 113300,
    });
  });

  it("monto con IGV: separa subtotal e IGV", () => {
    const m = calcularMontosFactura({ montoCentimos: 118000, incluyeIgv: true, detraccion });
    expect(m.subtotal).toBe(100000);
    expect(m.igv).toBe(18000);
    expect(m.total).toBe(118000);
  });

  it("monto chico con IGV redondea al céntimo y no aplica detracción", () => {
    expect(calcularMontosFactura({ montoCentimos: 10000, incluyeIgv: true, detraccion })).toEqual({
      subtotal: 8475,
      igv: 1525,
      total: 10000,
      detraccionPorcentaje: null,
      detraccionMonto: 0,
      cobrable: 10000,
    });
  });

  it("total igual al umbral no aplica detracción; un céntimo más sí", () => {
    expect(calcularMontosFactura({ montoCentimos: 40000, incluyeIgv: true, detraccion }).detraccionMonto).toBe(0);
    expect(calcularMontosFactura({ montoCentimos: 40001, incluyeIgv: true, detraccion }).detraccionMonto).toBe(1600);
  });

  it.each([0, -5, 10.5])("rechaza monto inválido %s", (monto) => {
    expect(() => calcularMontosFactura({ montoCentimos: monto, incluyeIgv: true, detraccion })).toThrow(
      "El monto debe ser un entero positivo en céntimos",
    );
  });
});

describe("parsearMonto", () => {
  it.each([
    ["2500", 250000],
    ["2,500.50", 250050],
    ["2500,5", 250050],
    ["2500.5", 250050],
    ["S/ 1 200", 120000],
    ["s/1,200", 120000],
    ["  2500  ", 250000],
    ["0.05", 5],
    ["1,234,567.89", 123456789],
  ])("lee %s como %i céntimos", (texto, centimos) => {
    expect(parsearMonto(texto)).toBe(centimos);
  });

  it.each(["dos mil", "0", "-5", "", "S/", "2500.567", "12a3", "2.500,00.5"])("rechaza %s", (texto) => {
    expect(parsearMonto(texto)).toBeNull();
  });
});

describe("formatearSoles", () => {
  it("formatea con separador de miles y dos decimales", () => {
    expect(formatearSoles(118000)).toBe("S/ 1,180.00");
    expect(formatearSoles(5)).toBe("S/ 0.05");
    expect(formatearSoles(123456789)).toBe("S/ 1,234,567.89");
  });
});
