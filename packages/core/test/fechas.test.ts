import { describe, expect, it } from "vitest";
import { fechaHoraLima, sumarDias } from "../src/dominio/fechas";

describe("fechas", () => {
  it("convierte a hora de Lima (UTC-5)", () => {
    expect(fechaHoraLima(new Date("2026-09-14T03:30:15Z"))).toEqual({ fecha: "2026-09-13", hora: "22:30:15" });
  });
  it("suma días cruzando meses y años", () => {
    expect(sumarDias("2026-09-13", 30)).toBe("2026-10-13");
    expect(sumarDias("2026-12-31", 1)).toBe("2027-01-01");
  });
});
