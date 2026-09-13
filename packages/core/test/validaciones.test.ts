import { describe, expect, it } from "vitest";
import { tipoDocumentoDe, validarDni, validarRuc } from "../src/dominio/validaciones";
import { buscarUbigeos, existeUbigeo, obtenerUbigeo } from "../src/dominio/ubigeos";
import { parsearSerieNumero } from "../src/dominio/serie-numero";

describe("validarRuc", () => {
  it.each(["20131312955", "20606433094"])("acepta RUC válido %s", (ruc) => {
    expect(validarRuc(ruc)).toBe(true);
  });
  it.each(["20131312956", "2013131295", "30131312955", "2013131295A", ""])("rechaza %s", (ruc) => {
    expect(validarRuc(ruc)).toBe(false);
  });
});

describe("validarDni y tipoDocumentoDe", () => {
  it("valida 8 dígitos", () => {
    expect(validarDni("45288569")).toBe(true);
    expect(validarDni("4528856")).toBe(false);
  });
  it("detecta el tipo de documento", () => {
    expect(tipoDocumentoDe("20131312955")).toBe("6");
    expect(tipoDocumentoDe("45288569")).toBe("1");
    expect(tipoDocumentoDe("123")).toBeNull();
  });
});

describe("ubigeos", () => {
  it("obtiene un distrito por código", () => {
    expect(obtenerUbigeo("150115")).toEqual({
      codigo: "150115",
      departamento: "LIMA",
      provincia: "LIMA",
      distrito: "LA VICTORIA",
    });
    expect(existeUbigeo("250101")).toBe(true);
    expect(existeUbigeo("999999")).toBe(false);
  });
  it("busca sin importar tildes ni mayúsculas", () => {
    expect(buscarUbigeos("la victoria").map((u) => u.codigo)).toContain("150115");
  });
});

describe("parsearSerieNumero", () => {
  it("acepta con y sin ceros", () => {
    expect(parsearSerieNumero("F001-45")).toEqual({ serie: "F001", numero: 45 });
    expect(parsearSerieNumero(" v001-00000001 ")).toEqual({ serie: "V001", numero: 1 });
    expect(parsearSerieNumero("F001")).toBeNull();
  });
});
