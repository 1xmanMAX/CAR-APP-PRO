import { describe, expect, it } from "vitest";
import { montoEnLetras } from "../src/letras";

describe("montoEnLetras", () => {
  it.each([
    [118000, "SON: MIL CIENTO OCHENTA CON 00/100 SOLES"],
    [150050, "SON: MIL QUINIENTOS CON 50/100 SOLES"],
    [2100000, "SON: VEINTIUN MIL CON 00/100 SOLES"],
    [100000000, "SON: UN MILLON CON 00/100 SOLES"],
    [10000, "SON: CIEN CON 00/100 SOLES"],
    [10100, "SON: CIENTO UNO CON 00/100 SOLES"],
    [5, "SON: CERO CON 05/100 SOLES"],
    [253045099, "SON: DOS MILLONES QUINIENTOS TREINTA MIL CUATROCIENTOS CINCUENTA CON 99/100 SOLES"],
  ])("%i → %s", (centimos, esperado) => {
    expect(montoEnLetras(centimos)).toBe(esperado);
  });
});
