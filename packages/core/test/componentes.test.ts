import { describe, expect, it } from "vitest";
import { nombrePieza, partesDePieza, pieza, PIEZAS, type Forma } from "../src/flota/componentes";

type Caja = { min: number[]; max: number[] };

function cajaDe(f: Forma): Caja {
  if (f.t === "caja") return { min: f.min, max: f.max };
  if (f.t === "llanta") return { min: [f.c[0] - f.r, f.c[1] - f.r, f.c[2] - f.ancho / 2], max: [f.c[0] + f.r, f.c[1] + f.r, f.c[2] + f.ancho / 2] };
  const ext = (i: number) => (["x", "y", "z"][i] === f.eje ? f.largo / 2 : f.r);
  return { min: f.c.map((v, i) => v - ext(i)), max: f.c.map((v, i) => v + ext(i)) };
}

const TOL = 0.03;
const tocan = (a: Caja, b: Caja) => [0, 1, 2].every((i) => a.min[i]! <= b.max[i]! + TOL && b.min[i]! <= a.max[i]! + TOL);

describe("piezas del modelo 3D (tracto cara plana + furgón)", () => {
  it("cada pieza tiene un código único, nombre y formas válidas", () => {
    expect(new Set(PIEZAS.map((p) => p.id)).size).toBe(PIEZAS.length);
    for (const p of PIEZAS) {
      expect(p.nombre.length, p.id).toBeGreaterThan(3);
      for (const f of p.formas) {
        const c = cajaDe(f);
        for (let i = 0; i < 3; i++) expect(c.max[i]! > c.min[i]!, `${p.id} eje ${i}`).toBe(true);
        expect(c.min[1]! >= 0, `${p.id} bajo el piso`).toBe(true);
      }
    }
  });

  it("todas las piezas quedan unidas: forman un solo vehículo, sin piezas flotando", () => {
    const cajas = PIEZAS.map((p) => p.formas.map(cajaDe));
    const unidas = (i: number, j: number) => cajas[i]!.some((a) => cajas[j]!.some((b) => tocan(a, b)));
    const visto = new Set([0]);
    const cola = [0];
    while (cola.length) {
      const i = cola.pop()!;
      for (let j = 0; j < PIEZAS.length; j++) if (!visto.has(j) && unidas(i, j)) { visto.add(j); cola.push(j); }
    }
    const sueltas = PIEZAS.filter((_, i) => !visto.has(i)).map((p) => p.id);
    expect(sueltas).toEqual([]);
    // Y cada llanta toca su eje (la exterior de las dobles, a través de la interior).
    const toca = (a: string, b: string) => pieza(a)!.formas.map(cajaDe).some((x) => pieza(b)!.formas.map(cajaDe).some((y) => tocan(x, y)));
    for (const p of PIEZAS.filter((x) => x.id.startsWith("llanta-") && x.id !== "llanta-repuesto")) {
      const [, eje, lado, pos] = p.id.split("-");
      const via = pos === "ext" ? `llanta-${eje}-${lado}-int` : p.id;
      expect(toca(via, `eje-${eje}`) && (via === p.id || toca(p.id, via)), p.id).toBe(true);
    }
  });

  it("es cara plana: nada del tracto sobresale delante de la cabina salvo parachoques, espejos, visera y faros", () => {
    const frente = Math.min(...pieza("cabina")!.formas.map((f) => cajaDe(f).min[0]!));
    const delante = PIEZAS.filter((p) => p.formas.some((f) => cajaDe(f).min[0]! < frente - 0.05)).map((p) => p.id).sort();
    expect(delante).toEqual(["parachoques-del", "retrovisor-der", "retrovisor-izq", "visera"]);
  });

  it("22 llantas + repuesto, y cada eje con sus frenos y suspensión", () => {
    expect(PIEZAS.filter((p) => p.grupo === "llantas").length).toBe(23);
    for (const e of ["del", "t1", "t2", "sr1", "sr2", "sr3"]) {
      for (const tipo of ["eje", "freno", "suspension"]) expect(pieza(`${tipo}-${e}`), `${tipo}-${e}`).not.toBeNull();
    }
    expect(nombrePieza("llanta-sr2-der-ext")).toBe("Llanta semirremolque eje 2 · derecha exterior");
  });

  it("el color de cada pieza sale de sus propias partes controladas", () => {
    const partes = [
      { zona: "llantas_sr" as const, codigoTipo: "frenos_sr" }, { zona: "llantas_sr" as const, codigoTipo: "llantas_sr" },
      { zona: "motor" as const, codigoTipo: "aceite" }, { zona: "motor" as const, codigoTipo: "filtro_aire" }, { zona: "chasis" as const, codigoTipo: "amortiguadores" },
    ];
    expect(partesDePieza(pieza("freno-sr1")!, partes).map((p) => p.codigoTipo)).toEqual(["frenos_sr"]);
    expect(partesDePieza(pieza("llanta-sr1-izq-ext")!, partes).map((p) => p.codigoTipo)).toEqual(["llantas_sr"]);
    expect(partesDePieza(pieza("filtro-aire")!, partes).map((p) => p.codigoTipo)).toEqual(["filtro_aire"]);
    expect(partesDePieza(pieza("suspension-t1")!, partes).map((p) => p.codigoTipo)).toEqual(["amortiguadores"]);
    expect(partesDePieza(pieza("chasis-tracto")!, partes)).toEqual([]);
  });
});
