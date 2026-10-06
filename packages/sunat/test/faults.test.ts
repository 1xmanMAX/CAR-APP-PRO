import { describe, expect, it } from "vitest";
import { clasificarFault } from "../src/faults";

describe("clasificarFault", () => {
  it.each([
    ["2800", "rechazo"], ["3999", "rechazo"], ["1034", "rechazo"], ["0151", "rechazo"], ["0161", "rechazo"],
    ["1032", "ya_registrado"], ["1033", "ya_registrado"],
    ["0101", "credenciales"], ["0102", "credenciales"], ["0104", "credenciales"], ["0111", "credenciales"], ["0112", "credenciales"],
    ["0109", "no_disponible"], ["0130", "no_disponible"], ["0200", "no_disponible"], ["0252", "no_disponible"],
    ["4000", "otro"], ["0001", "otro"], ["abc", "otro"],
  ] as const)("%s → %s", (codigo, clase) => {
    expect(clasificarFault(codigo)).toBe(clase);
  });
});
