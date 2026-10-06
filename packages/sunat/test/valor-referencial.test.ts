import { describe, expect, it } from "vitest";
import { baseDetraccion, calcularValoresReferenciales, toneladas } from "../src/valor-referencial";

describe("toneladas", () => {
  it("convierte KGM y respeta TNE", () => {
    expect(toneladas("31870", "KGM")).toBe(31.87);
    expect(toneladas("31.87", "TNE")).toBe(31.87);
  });
  it("rechaza unidades desconocidas", () => {
    expect(() => toneladas("10", "LBR")).toThrow("unidad de peso");
  });
});

describe("calcularValoresReferenciales", () => {
  it("carga efectiva mayor que el mínimo: VR01 = VR02", () => {
    const vr = calcularValoresReferenciales({ vrPorTmCentimos: 8550, cargaEfectivaTm: 31.87, cargaUtilTm: 30 });
    expect(vr).toEqual({ vrCargaEfectiva: 272489, vrCargaUtil: 256500, vrServicio: 272489 });
  });
  it("carga efectiva baja: VR01 = 70 % de la carga útil", () => {
    const vr = calcularValoresReferenciales({ vrPorTmCentimos: 8550, cargaEfectivaTm: 10, cargaUtilTm: 30 });
    expect(vr).toEqual({ vrCargaEfectiva: 85500, vrCargaUtil: 256500, vrServicio: 179550 });
  });
  it("piso exacto: VR01 = 70 % de la carga útil sin error de redondeo", () => {
    const vr = calcularValoresReferenciales({ vrPorTmCentimos: 8550, cargaEfectivaTm: 1, cargaUtilTm: 30 });
    expect(vr.vrServicio).toBe(179550);
  });
  it("rechaza valores no positivos", () => {
    expect(() => calcularValoresReferenciales({ vrPorTmCentimos: 0, cargaEfectivaTm: 1, cargaUtilTm: 1 })).toThrow();
  });
});

describe("baseDetraccion", () => {
  it("usa el mayor entre total y VR01", () => {
    const vr = { vrServicio: 272489, vrCargaEfectiva: 272489, vrCargaUtil: 256500 };
    expect(baseDetraccion(250000, vr)).toBe(272489);
    expect(baseDetraccion(300000, vr)).toBe(300000);
    expect(baseDetraccion(300000, null)).toBe(300000);
  });
});
