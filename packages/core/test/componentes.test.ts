import { describe, expect, it } from "vitest";
import {
  CONJUNTOS_PIEZAS, conjuntosDe, esConjunto, listaDePiezas, nombrePieza, partesDePieza, pieza, PIEZAS, piezasDeSemirremolque, piezasDeTipo, TIPOS_SEMIRREMOLQUE, TRACCIONES, type Forma, type TipoSemirremolque, type Traccion,
} from "../src/flota/componentes";

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

  const COMBINACIONES = (Object.keys(TRACCIONES) as Traccion[]).flatMap((tr) => (Object.keys(TIPOS_SEMIRREMOLQUE) as TipoSemirremolque[]).map((t) => [tr, t] as const));
  it.each(COMBINACIONES)("tracto %s con semirremolque %s: todas las piezas quedan unidas, un solo vehículo, sin piezas flotando", (traccion, tipo) => {
    const PIEZAS = piezasDeSemirremolque(tipo, traccion);
    expect(new Set(PIEZAS.map((p) => p.id)).size).toBe(PIEZAS.length);
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
    expect(delante).toEqual(["espejo-frontal", "parachoques-del", "retrovisor-der", "retrovisor-izq", "visera"]);
  });

  it("6x2 como la unidad real: 20 llantas + repuesto (eje de apoyo con simples); 6x4: 22 + repuesto", () => {
    const llantas = (tr: Traccion) => piezasDeSemirremolque("plataforma", tr).filter((p) => p.grupo === "llantas").map((p) => p.id);
    expect(llantas("6x2")).toHaveLength(21);
    expect(llantas("6x2")).toContain("llanta-t2-izq");
    expect(llantas("6x2")).toContain("llanta-t1-der-int");
    expect(llantas("6x4")).toHaveLength(23);
    expect(nombrePieza("llanta-t2-der")).toBe("Llanta eje de apoyo (simple 315/70) · derecha");
    // Por defecto: plataforma y 6x2, sin chimenea vertical (escape bajo) ni furgón.
    const ids = piezasDeSemirremolque().map((p) => p.id);
    expect(ids).toContain("mampara-frontal");
    expect(ids).not.toContain("caja-techo");
    expect(pieza("escape")!.formas.every((f) => f.t !== "cil" || f.eje === "x")).toBe(true);
  });

  it("cada eje con sus frenos y suspensión", () => {
    expect(PIEZAS.filter((p) => p.grupo === "llantas").length).toBe(25);
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

  it("un tipo de parte sabe en qué piezas va", () => {
    expect(piezasDeTipo({ zona: "llantas_sr", codigo: "frenos_sr" })).toEqual(["sr1", "sr2", "sr3"].flatMap((e) => [`tambor-${e}-izq`, `tambor-${e}-der`]));
    expect(piezasDeTipo({ zona: "llantas_sr", codigo: "llantas_sr" })).toHaveLength(13); // 12 + la de repuesto
    expect(piezasDeTipo({ zona: "motor", codigo: "aceite" })).toEqual(["motor", "filtro-aceite"]);
    expect(piezasDeTipo({ zona: "chasis", codigo: "amortiguadores" })).toHaveLength(12); // uno por lado en cada uno de los 6 ejes
    expect(piezasDeTipo({ zona: "bateria", codigo: "bateria" })).toEqual(["bateria-1", "bateria-2"]);
  });

  it("piezas pequeñas por separado: bolsas de aire, amortiguadores, pulmones, matracas y mazas de cada rueda", () => {
    const ids = new Set(piezasDeSemirremolque("plataforma", "6x2").map((p) => p.id));
    for (const e of ["sr1", "sr2", "sr3"]) for (const l of ["izq", "der"]) {
      for (const tipo of ["bolsa-aire", "amortiguador", "brazo", "pulmon", "matraca", "maza", "tambor"]) expect(ids.has(`${tipo}-${e}-${l}`), `${tipo}-${e}-${l}`).toBe(true);
    }
    for (const id of ["ballesta-t1-izq", "ballesta-t2-der", "soporte-v", "caja-direccion", "barra-acoplamiento", "turbo", "alternador", "secador-aire", "king-pin", "manguera-emergencia"]) {
      expect(ids.has(id), id).toBe(true);
    }
    expect(ids.has("bolsa-aire-t1-izq")).toBe(false); // el 6x2 va con ballestas
    expect(piezasDeSemirremolque("plataforma", "6x4").some((p) => p.id === "bolsa-aire-t1-izq")).toBe(true);
    expect(ids.size).toBeGreaterThan(190); // antes eran 90
  });

  it("los conjuntos agrupan sus piezas y los códigos antiguos siguen existiendo (historial guardado)", () => {
    const hojas = new Set(PIEZAS.map((p) => p.id));
    for (const c of CONJUNTOS_PIEZAS) expect(hojas.has(c.id), `${c.id} choca con una pieza`).toBe(false);
    for (const id of ["freno-sr1", "suspension-t1", "bateria", "tanques-aire", "mangueras", "plancha-acople", "llanta-repuesto", "estribo-bateria"]) {
      expect(pieza(id), id).not.toBeNull();
    }
    expect(esConjunto("suspension-sr2")).toBe(true);
    expect(esConjunto("bolsa-aire-sr2-izq")).toBe(false);
    const susp = conjuntosDe(piezasDeSemirremolque()).find((c) => c.id === "suspension-sr2")!;
    expect(susp.hijos.sort()).toEqual(["amortiguador-sr2-der", "amortiguador-sr2-izq", "bolsa-aire-sr2-der", "bolsa-aire-sr2-izq", "brazo-sr2-der", "brazo-sr2-izq"]);
    // El conjunto de frenos se pinta con el desgaste de las pastillas; el de suspensión, con los amortiguadores.
    const partes = [{ zona: "llantas_sr" as const, codigoTipo: "frenos_sr" }, { zona: "chasis" as const, codigoTipo: "amortiguadores" }];
    expect(partesDePieza(pieza("freno-sr1")!, partes).map((p) => p.codigoTipo)).toEqual(["frenos_sr"]);
    expect(partesDePieza(pieza("suspension-sr1")!, partes).map((p) => p.codigoTipo)).toEqual(["amortiguadores"]);
  });

  it("la lista para elegir tiene cada pieza una vez, con sus conjuntos", () => {
    const piezas = piezasDeSemirremolque("furgon", "6x4");
    const items = listaDePiezas(piezas).flatMap((g) => g.items);
    const hojas = items.filter((i) => !esConjunto(i.id)).map((i) => i.id);
    expect(hojas.sort()).toEqual(piezas.map((p) => p.id).sort());
    expect(items.find((i) => i.id === "bolsa-aire-sr1-izq")!.nivel).toBe(1);
  });
});
