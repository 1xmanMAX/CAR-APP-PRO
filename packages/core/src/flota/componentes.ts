import type { ZonaModelo } from "@sunatapp/db";

/**
 * **Piezas del modelo 3D**: un tracto **cara plana** 6x4 (cabina frontal plana, sobre el motor,
 * sin capó: tipo Volvo FH, Scania R, FAW, Sitrak) con un **semirremolque furgón de 3 ejes**,
 * la configuración habitual del transporte de carga en el Perú. Cada pieza va por separado
 * (cada llanta, cada retrovisor, cada eje…) y encaja con las de al lado: los ejes atraviesan
 * los tambores de freno hasta las llantas, la suspensión une los ejes con el chasis y la
 * plancha de acople del semirremolque se apoya en la quinta rueda.
 *
 * Una reparación o incidente se guarda con la pieza (`reparacion.componente`) y el visor la
 * resalta para ver dónde está. La forma de cada pieza va aquí; el visor solo la dibuja.
 *
 * Coordenadas en metros: x a lo largo (el frente del tracto hacia -x), y hacia arriba (0 es el
 * piso), z a lo ancho: +z es el lado izquierdo (piloto) y -z el derecho.
 */
export type Forma =
  /** Caja: puntos en sus caras. */
  | { t: "caja"; min: [number, number, number]; max: [number, number, number] }
  /** Cilindro (tanques, ejes, escape, tambores) con su eje en x, y o z. */
  | { t: "cil"; c: [number, number, number]; r: number; largo: number; eje: "x" | "y" | "z" }
  /** Llanta: banda de rodadura, flancos y aro; el eje es z. */
  | { t: "llanta"; c: [number, number, number]; r: number; ancho: number };

export type GrupoPieza = "cabina" | "luces" | "motor" | "chasis" | "ejes" | "frenos" | "llantas" | "semirremolque";

export interface Pieza {
  id: string;
  nombre: string;
  /** Zona de desgaste a la que pertenece. */
  zona: ZonaModelo;
  grupo: GrupoPieza;
  formas: Forma[];
  /** Códigos de tipo de parte que le corresponden (si no, se deducen de su zona y grupo). */
  codigos?: string[];
}

export const GRUPOS_PIEZA: Record<GrupoPieza, string> = {
  cabina: "Cabina", luces: "Luces y espejos", motor: "Motor y transmisión", chasis: "Chasis y tanques",
  ejes: "Ejes y suspensión", frenos: "Frenos", llantas: "Llantas", semirremolque: "Semirremolque (furgón)",
};

type V3 = [number, number, number];
const caja = (min: V3, max: V3): Forma => ({ t: "caja", min, max });
const cil = (c: V3, r: number, largo: number, eje: "x" | "y" | "z"): Forma => ({ t: "cil", c, r, largo, eje });
/** La misma caja en el lado izquierdo (s = 1) o derecho (s = -1): z0..z1 son distancias al centro. */
const cajaLado = (s: 1 | -1, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Forma =>
  caja([x0, y0, s > 0 ? z0 : -z1], [x1, y1, s > 0 ? z1 : -z0]);
const ambosLados = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Forma[] =>
  [cajaLado(1, x0, x1, y0, y1, z0, z1), cajaLado(-1, x0, x1, y0, y1, z0, z1)];

// ——— Medidas (m) ———
const R = 0.52; // llanta 295/80 R22.5
const CAB = { x0: -9.4, x1: -7.1, y0: 1.2, y1: 3.75, z: 1.25 }; // cabina frontal plana, sobre el motor
const RIEL = { y0: 0.78, y1: 1.08, zi: 0.36, ze: 0.46 }; // largueros del tracto
const X = { del: -8.0, t1: -4.5, t2: -3.15, quinta: -3.9, finTracto: -2.35 };
const SR = { x0: -4.9, x1: 8.7, piso: 1.38, techo: 4.1, z: 1.3 }; // furgón de 13.6 m
const VIGA = { y0: 0.98, zi: 0.42, ze: 0.55 }; // vigas del semirremolque
const EJES_SR = [4.78, 6.09, 7.4];
const PATAS_X = -1.6;

const LADOS = [["izq", "izquierda", 1], ["der", "derecha", -1]] as const;
type Eje = { id: string; nombre: string; x: number; zona: ZonaModelo; doble: boolean };
const EJES: Eje[] = [
  { id: "del", nombre: "eje delantero", x: X.del, zona: "llantas_del", doble: false },
  { id: "t1", nombre: "tracción eje 1", x: X.t1, zona: "llantas_trac", doble: true },
  { id: "t2", nombre: "tracción eje 2", x: X.t2, zona: "llantas_trac", doble: true },
  ...EJES_SR.map((x, i) => ({ id: `sr${i + 1}`, nombre: `semirremolque eje ${i + 1}`, x, zona: "llantas_sr" as ZonaModelo, doble: true })),
];

function llantas(): Pieza[] {
  const out: Pieza[] = [];
  for (const e of EJES) {
    for (const [id, nombre, s] of LADOS) {
      if (!e.doble) {
        out.push({ id: `llanta-${e.id}-${id}`, nombre: `Llanta delantera · ${nombre}`, zona: e.zona, grupo: "llantas",
          formas: [{ t: "llanta", c: [e.x, R, s * 1.05], r: R, ancho: 0.3 }] });
        continue;
      }
      for (const [pos, nombrePos, z] of [["ext", "exterior", 1.12], ["int", "interior", 0.85]] as const) {
        out.push({ id: `llanta-${e.id}-${id}-${pos}`, nombre: `Llanta ${e.nombre} · ${nombre} ${nombrePos}`, zona: e.zona, grupo: "llantas",
          formas: [{ t: "llanta", c: [e.x, R, s * z], r: R, ancho: 0.27 }] });
      }
    }
  }
  return out;
}

/** Ejes (atraviesan los tambores hasta el aro), frenos y suspensión de cada eje. */
function tren(): Pieza[] {
  const out: Pieza[] = [];
  for (const e of EJES) {
    const zTambor = e.doble ? 0.6 : 0.78;
    const formasEje: Forma[] = [cil([e.x, R, 0], 0.07, e.doble ? 1.9 : 1.8, "z")];
    if (e.id === "t1" || e.id === "t2") formasEje.push(caja([e.x - 0.22, 0.34, -0.2], [e.x + 0.22, 0.7, 0.2])); // diferencial
    out.push({ id: `eje-${e.id}`, nombre: `Eje · ${e.nombre}`, zona: "chasis", grupo: "ejes", codigos: [], formas: formasEje });
    out.push({ id: `freno-${e.id}`, nombre: `Frenos · ${e.nombre}`, zona: e.zona, grupo: "frenos",
      formas: [cil([e.x, R, zTambor], 0.24, 0.14, "z"), cil([e.x, R, -zTambor], 0.24, 0.14, "z")] });
    let susp: Forma[];
    if (e.id === "del") {
      // Muelles (ballestas) entre el eje y los largueros.
      susp = ambosLados(e.x - 0.65, e.x + 0.65, R + 0.07, RIEL.y0, RIEL.zi, RIEL.ze);
    } else if (e.id === "t1" || e.id === "t2") {
      // Bolsas de aire sobre el eje, bajo los largueros.
      const alto = RIEL.y0 - R - 0.07, y = R + 0.07 + alto / 2;
      susp = [cil([e.x, y, 0.41], 0.13, alto, "y"), cil([e.x, y, -0.41], 0.13, alto, "y")];
    } else {
      // Brazo de arrastre desde el eje y bolsa de aire bajo la viga.
      const xb = e.x + 0.3, alto = VIGA.y0 - 0.6;
      susp = [
        ...ambosLados(e.x, e.x + 0.42, 0.5, 0.6, 0.43, 0.53),
        cil([xb, 0.6 + alto / 2, 0.48], 0.14, alto, "y"), cil([xb, 0.6 + alto / 2, -0.48], 0.14, alto, "y"),
      ];
    }
    out.push({ id: `suspension-${e.id}`, nombre: `Suspensión · ${e.nombre}`, zona: "chasis", grupo: "ejes", codigos: ["amortiguadores"], formas: susp });
  }
  return out;
}

export const PIEZAS: Pieza[] = [
  // ——— Cabina (frontal plana, sobre el motor) ———
  { id: "cabina", nombre: "Cabina (carrocería)", zona: "cabina", grupo: "cabina",
    formas: [caja([CAB.x0, CAB.y0, -CAB.z], [CAB.x1, CAB.y1, CAB.z])] },
  { id: "deflector", nombre: "Deflector de techo", zona: "cabina", grupo: "cabina", formas: [caja([-8.9, CAB.y1, -1.15], [-7.15, 4.25, 1.15])] },
  { id: "visera", nombre: "Visera parasol", zona: "cabina", grupo: "cabina", formas: [caja([-9.6, 3.55, -1.15], [CAB.x0, 3.68, 1.15])] },
  { id: "parabrisas", nombre: "Parabrisas", zona: "cabina", grupo: "cabina", formas: [caja([-9.43, 2.45, -1.12], [CAB.x0, 3.45, 1.12])] },
  { id: "parrilla", nombre: "Parrilla frontal y radiador", zona: "motor", grupo: "cabina", codigos: [], formas: [caja([-9.43, 1.5, -0.85], [CAB.x0, 2.3, 0.85])] },
  ...LADOS.map(([id, nombre, s]): Pieza => ({ id: `puerta-${id}`, nombre: `Puerta · ${nombre} (${s > 0 ? "piloto" : "copiloto"})`, zona: "cabina", grupo: "cabina",
    formas: [cajaLado(s, -9.15, -7.85, 1.35, 3.35, CAB.z, CAB.z + 0.03)] })),
  ...LADOS.map(([id, nombre, s]): Pieza => ({ id: `escalones-${id}`, nombre: `Escalones de acceso · ${nombre}`, zona: "cabina", grupo: "cabina",
    formas: [cajaLado(s, -7.45, -7.15, 0.55, CAB.y0, 1.05, CAB.z)] })),
  { id: "parachoques-del", nombre: "Parachoques delantero", zona: "cabina", grupo: "cabina", formas: [caja([-9.55, 0.55, -CAB.z], [-9.25, CAB.y0, CAB.z])] },
  ...LADOS.map(([id, nombre, s]): Pieza => ({ id: `guardafango-del-${id}`, nombre: `Guardafango delantero · ${nombre}`, zona: "cabina", grupo: "cabina",
    formas: [cajaLado(s, -8.65, -7.35, 1.12, CAB.y0, 0.85, CAB.z)] })),
  // ——— Luces y espejos ———
  ...LADOS.map(([id, nombre, s]): Pieza => ({ id: `retrovisor-${id}`, nombre: `Retrovisor · ${nombre}`, zona: "cabina", grupo: "luces",
    formas: [cajaLado(s, -9.5, -9.3, 3.0, 3.06, CAB.z, 1.42), cajaLado(s, -9.56, -9.44, 2.55, 3.4, 1.42, 1.56)] })),
  ...LADOS.map(([id, nombre, s]): Pieza => ({ id: `faro-${id}`, nombre: `Faro delantero · ${nombre}`, zona: "cabina", grupo: "luces",
    formas: [cajaLado(s, -9.45, CAB.x0, 1.25, 1.45, 0.72, 1.15)] })),
  ...LADOS.map(([id, nombre, s]): Pieza => ({ id: `luz-tras-${id}`, nombre: `Luz trasera · ${nombre}`, zona: "caja", grupo: "luces",
    formas: [cajaLado(s, SR.x1, SR.x1 + 0.05, 1.08, 1.3, 0.8, 1.2)] })),
  // ——— Motor y transmisión (bajo la cabina) ———
  { id: "motor", nombre: "Motor (bajo la cabina)", zona: "motor", grupo: "motor", codigos: ["aceite"], formas: [caja([-9.0, 0.6, -0.34], [-7.4, CAB.y0, 0.34])] },
  { id: "caja-cambios", nombre: "Caja de cambios", zona: "motor", grupo: "motor", codigos: [], formas: [caja([-7.4, 0.68, -0.25], [-6.5, 1.05, 0.25])] },
  { id: "cardan", nombre: "Cardán (árbol de transmisión)", zona: "motor", grupo: "motor", codigos: [], formas: [
    cil([(-6.5 + X.t1 - 0.22) / 2, 0.72, 0], 0.07, X.t1 - 0.22 + 6.5, "x"), // caja de cambios → diferencial del eje 1
    cil([(X.t1 + X.t2) / 2, 0.55, 0], 0.06, X.t2 - X.t1 - 0.44, "x"), // entre los dos diferenciales
  ] },
  { id: "filtro-aire", nombre: "Filtro de aire", zona: "motor", grupo: "motor", codigos: ["filtro_aire"],
    formas: [cil([-6.85, 2.3, 1.0], 0.2, 1.8, "y"), caja([CAB.x1, 2.2, 0.9], [-6.65, 2.3, 1.1])] },
  { id: "escape", nombre: "Tubo de escape (chimenea)", zona: "motor", grupo: "motor", codigos: [], formas: [cil([-6.25, 2.6, -1.0], 0.09, 3.1, "y")] },
  { id: "silenciador", nombre: "Silenciador / filtro de partículas", zona: "motor", grupo: "motor", codigos: [],
    formas: [cajaLado(-1, -6.4, -5.3, 0.5, 1.05, 0.75, 1.25), cajaLado(-1, -6.0, -5.7, 0.9, 1.0, RIEL.ze, 0.75)] },
  // ——— Chasis y tanques del tracto ———
  { id: "chasis-tracto", nombre: "Chasis del tracto (largueros)", zona: "chasis", grupo: "chasis", codigos: [],
    formas: ambosLados(-9.25, X.finTracto, RIEL.y0, RIEL.y1, RIEL.zi, RIEL.ze) },
  { id: "tanque-combustible", nombre: "Tanque de combustible", zona: "tanque", grupo: "chasis",
    formas: [cil([-6.45, 0.78, 1.0], 0.3, 1.6, "x"), cajaLado(1, -6.9, -6.6, 0.9, 1.0, RIEL.ze, 0.72), cajaLado(1, -6.3, -6.0, 0.9, 1.0, RIEL.ze, 0.72)] },
  { id: "bateria", nombre: "Caja de baterías", zona: "bateria", grupo: "chasis",
    formas: [cajaLado(-1, -7.2, -6.5, 0.55, 1.05, 0.75, 1.25), cajaLado(-1, -7.0, -6.7, 0.9, 1.0, RIEL.ze, 0.75)] },
  { id: "tanques-aire", nombre: "Tanques de aire (frenos)", zona: "chasis", grupo: "chasis", codigos: [],
    formas: [cil([-5.75, 0.63, 0.2], 0.15, 1.0, "x"), cil([-5.75, 0.63, -0.2], 0.15, 1.0, "x")] },
  { id: "quinta-rueda", nombre: "Quinta rueda", zona: "quinta", grupo: "chasis",
    formas: [cil([X.quinta, 1.17, 0], 0.5, 0.1, "y"), caja([X.quinta - 0.4, RIEL.y1, -RIEL.ze], [X.quinta + 0.4, 1.12, RIEL.ze])] },
  ...LADOS.map(([id, nombre, s]): Pieza => ({ id: `guardafango-trac-${id}`, nombre: `Guardafango de tracción · ${nombre}`, zona: "chasis", grupo: "chasis", codigos: [],
    formas: [cajaLado(s, -5.1, -2.55, 1.1, 1.16, RIEL.ze, 1.36)] })),
  ...LADOS.map(([id, nombre, s]): Pieza => ({ id: `lodera-trac-${id}`, nombre: `Lodera del tracto · ${nombre}`, zona: "chasis", grupo: "chasis", codigos: [],
    formas: [cajaLado(s, -2.55, -2.51, 0.25, 1.1, 0.66, 1.36)] })),
  // ——— Semirremolque furgón ———
  { id: "plancha-acople", nombre: "Plancha de acople y king pin", zona: "quinta", grupo: "semirremolque", codigos: [],
    formas: [caja([SR.x0, 1.22, -1.25], [-2.6, SR.piso, 1.25]), cil([X.quinta, 1.14, 0], 0.05, 0.16, "y")] },
  { id: "chasis-semirremolque", nombre: "Chasis del semirremolque (vigas)", zona: "chasis", grupo: "semirremolque", codigos: [],
    formas: ambosLados(-2.6, SR.x1, VIGA.y0, SR.piso, VIGA.zi, VIGA.ze) },
  { id: "caja-frente", nombre: "Furgón · pared delantera", zona: "caja", grupo: "semirremolque", formas: [caja([SR.x0, SR.piso, -SR.z], [SR.x0 + 0.04, SR.techo, SR.z])] },
  ...LADOS.map(([id, nombre, s]): Pieza => ({ id: `caja-lateral-${id}`, nombre: `Furgón · lateral ${nombre}`, zona: "caja", grupo: "semirremolque",
    formas: [cajaLado(s, SR.x0, SR.x1, SR.piso, SR.techo, SR.z - 0.02, SR.z)] })),
  { id: "caja-techo", nombre: "Furgón · techo", zona: "caja", grupo: "semirremolque", formas: [caja([SR.x0, SR.techo - 0.02, -SR.z], [SR.x1, SR.techo, SR.z])] },
  { id: "marco-trasero", nombre: "Marco trasero", zona: "caja", grupo: "semirremolque", formas: [caja([SR.x1 - 0.1, VIGA.y0, -SR.z], [SR.x1, SR.piso, SR.z])] },
  ...LADOS.map(([id, nombre, s]): Pieza => ({ id: `puerta-tras-${id}`, nombre: `Puerta trasera · ${nombre}`, zona: "caja", grupo: "semirremolque",
    formas: [cajaLado(s, SR.x1, SR.x1 + 0.03, SR.piso + 0.02, SR.techo - 0.04, 0.01, SR.z - 0.02)] })),
  { id: "parachoques-tras", nombre: "Parachoques trasero (antiempotramiento)", zona: "caja", grupo: "semirremolque",
    formas: [caja([8.55, 0.45, -1.15], [8.68, 0.6, 1.15]), ...ambosLados(8.56, 8.66, 0.6, VIGA.y0, VIGA.zi, VIGA.ze)] },
  ...LADOS.map(([id, nombre, s]): Pieza => ({ id: `pata-apoyo-${id}`, nombre: `Pata de apoyo · ${nombre}`, zona: "chasis", grupo: "semirremolque", codigos: [],
    formas: [cajaLado(s, PATAS_X - 0.08, PATAS_X + 0.08, 0.12, VIGA.y0, VIGA.zi, VIGA.ze), cajaLado(s, PATAS_X - 0.2, PATAS_X + 0.2, 0.06, 0.12, VIGA.zi - 0.06, VIGA.ze + 0.06)] })),
  ...LADOS.map(([id, nombre, s]): Pieza => ({ id: `defensa-lateral-${id}`, nombre: `Defensa lateral · ${nombre}`, zona: "caja", grupo: "semirremolque",
    formas: [cajaLado(s, -0.8, 4.0, 0.55, 0.85, SR.z - 0.04, SR.z), cajaLado(s, -0.7, -0.55, 0.85, SR.piso, SR.z - 0.1, SR.z), cajaLado(s, 3.75, 3.9, 0.85, SR.piso, SR.z - 0.1, SR.z)] })),
  ...LADOS.map(([id, nombre, s]): Pieza => ({ id: `lodera-${id}`, nombre: `Lodera del semirremolque · ${nombre}`, zona: "caja", grupo: "semirremolque",
    formas: [cajaLado(s, 8.05, 8.09, 0.25, VIGA.y0, 0.7, SR.z), cajaLado(s, 8.05, 8.09, 0.9, VIGA.y0, VIGA.ze, 0.7)] })),
  { id: "llanta-repuesto", nombre: "Llanta de repuesto (con su porta llanta)", zona: "llantas_sr", grupo: "llantas",
    formas: [cil([1.8, 0.8, 0], 0.5, 0.27, "y"), caja([1.2, 0.935, -VIGA.ze], [2.4, VIGA.y0, VIGA.ze])] },
  ...tren(),
  ...llantas(),
];

const PORID = new Map(PIEZAS.map((p) => [p.id, p]));

export function pieza(id: string | null | undefined): Pieza | null {
  return (id && PORID.get(id)) || null;
}

export function nombrePieza(id: string | null | undefined): string | null {
  return pieza(id)?.nombre ?? null;
}

/**
 * Las partes controladas (con desgaste) que tocan a una pieza: los frenos del semirremolque
 * pintan solo los frenos, y las llantas solo las llantas, aunque compartan zona.
 */
export function partesDePieza<T extends { zona: ZonaModelo; codigoTipo: string }>(p: Pieza, partes: T[]): T[] {
  if (p.codigos) return partes.filter((x) => p.codigos!.includes(x.codigoTipo));
  const clase = (codigo: string) => (codigo.includes("freno") ? "frenos" : codigo.includes("llanta") ? "llantas" : "otra");
  const mia = p.grupo === "frenos" ? "frenos" : p.grupo === "llantas" ? "llantas" : "otra";
  return partes.filter((x) => x.zona === p.zona && clase(x.codigoTipo) === mia);
}
