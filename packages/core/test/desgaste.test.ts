import { describe, expect, it } from "vitest";
import { calcularDesgaste, diasEntre, estadoDe, etiquetaCambio } from "../src/flota/desgaste";

describe("calcularDesgaste", () => {
  it("criterio de aceptación: 22/24 viajes, 46,800/60,000 km, 140/240 días → 92%, manda viajes, 2 viajes", () => {
    const r = calcularDesgaste({ km: 60000, viajes: 24, dias: 240 }, { km: 46800, viajes: 22, dias: 140 });
    expect(r.pct).toBe(92);
    expect(r.estado).toBe("cambiar");
    expect(r.manda).toBe("viajes");
    expect(r.viajesRestantes).toBe(2);
    expect(r.restanteTexto).toBe("2 VIAJES");
  });

  it("solo vida en días (batería) muestra días", () => {
    const r = calcularDesgaste({ km: null, viajes: null, dias: 730 }, { km: 90000, viajes: 40, dias: 400 });
    expect(r.pct).toBe(55);
    expect(r.manda).toBe("dias");
    expect(r.viajesRestantes).toBeNull();
    expect(r.restanteTexto).toBe("330 DÍAS");
  });

  it("parte nueva usa el promedio del trailer para estimar", () => {
    const r = calcularDesgaste({ km: 15000, viajes: null, dias: null }, { km: 0, viajes: 0, dias: 0 }, { kmPorViaje: 1500 });
    expect(r.pct).toBe(0);
    expect(r.viajesRestantes).toBe(10);
  });

  it("límite por km cuando es el más cercano", () => {
    const r = calcularDesgaste({ km: 15000, viajes: 8, dias: 90 }, { km: 13500, viajes: 6, dias: 40 });
    expect(r.pct).toBe(90);
    expect(r.manda).toBe("km");
    expect(r.viajesRestantes).toBe(0);
  });

  it("estados en los bordes", () => {
    expect(estadoDe(69)).toBe("ok");
    expect(estadoDe(70)).toBe("proximo");
    expect(estadoDe(89)).toBe("proximo");
    expect(estadoDe(90)).toBe("cambiar");
  });

  it("etiquetas de a tiempo", () => {
    expect(etiquetaCambio(79)).toBe("MUY PRONTO");
    expect(etiquetaCambio(92)).toBe("A TIEMPO");
    expect(etiquetaCambio(101)).toBe("TARDE");
  });

  it("diasEntre", () => {
    expect(diasEntre("2026-09-01", "2026-09-25")).toBe(24);
  });
});
