import type { ZonaModelo } from "@sunatapp/db";

/**
 * **Piezas del modelo 3D del trailer**, cada una por separado (cada llanta, cada retrovisor,
 * cada faro…). Una reparación o incidente se guarda con la pieza (`reparacion.componente`) y el
 * visor la resalta para ver dónde está. La forma de cada pieza va aquí mismo: el visor solo la
 * dibuja como nube de puntos.
 *
 * Coordenadas (metros aprox.): x a lo largo (el frente del tracto hacia -x), y hacia arriba,
 * z a lo ancho: +z es el lado izquierdo (piloto) y -z el derecho.
 */
export type Forma =
  /** Caja: puntos en sus caras. */
  | { t: "caja"; min: [number, number, number]; max: [number, number, number] }
  /** Cilindro (tanques, escape, frenos) con su eje en x, y o z. */
  | { t: "cil"; c: [number, number, number]; r: number; largo: number; eje: "x" | "y" | "z" }
  /** Llanta: banda de rodadura, flancos y aro; el eje es z. */
  | { t: "llanta"; c: [number, number, number]; r: number; ancho: number };

export type GrupoPieza = "cabina" | "motor" | "chasis" | "semirremolque" | "llantas" | "frenos" | "luces";

export interface Pieza {
  id: string;
  nombre: string;
  /** Zona de desgaste a la que pertenece (colorea la pieza según sus partes controladas). */
  zona: ZonaModelo;
  grupo: GrupoPieza;
  formas: Forma[];
  /** Códigos de tipo de parte que le corresponden (si no, se deducen de su zona y grupo). */
  codigos?: string[];
}

export const GRUPOS_PIEZA: Record<GrupoPieza, string> = {
  cabina: "Cabina", motor: "Motor", chasis: "Chasis y tanques", semirremolque: "Semirremolque (caja)",
  llantas: "Llantas", frenos: "Frenos", luces: "Luces y espejos",
};

const caja = (min: [number, number, number], max: [number, number, number]): Forma => ({ t: "caja", min, max });
const cil = (c: [number, number, number], r: number, largo: number, eje: "x" | "y" | "z"): Forma => ({ t: "cil", c, r, largo, eje });

const RADIO_LLANTA = 0.52;
const lados = [["izq", "izquierda", 1], ["der", "derecha", -1]] as const;

function llantas(): Pieza[] {
  const out: Pieza[] = [];
  // Eje delantero: una llanta por lado.
  for (const [id, nombre, s] of lados) {
    out.push({ id: `llanta-del-${id}`, nombre: `Llanta delantera · ${nombre}`, zona: "llantas_del", grupo: "llantas",
      formas: [{ t: "llanta", c: [-8, RADIO_LLANTA, s * 1.05], r: RADIO_LLANTA, ancho: 0.3 }] });
  }
  // Tracción (2 ejes) y semirremolque (3 ejes): llantas dobles, interior y exterior.
  const ejes: Array<[string, string, number, ZonaModelo]> = [
    ["t1", "tracción eje 1", -4.6, "llantas_trac"], ["t2", "tracción eje 2", -3.4, "llantas_trac"],
    ["sr1", "semirremolque eje 1", 5.8, "llantas_sr"], ["sr2", "semirremolque eje 2", 7.0, "llantas_sr"], ["sr3", "semirremolque eje 3", 8.2, "llantas_sr"],
  ];
  for (const [eje, nombreEje, x, zona] of ejes) {
    for (const [id, nombre, s] of lados) {
      for (const [pos, nombrePos, z] of [["ext", "exterior", 1.17], ["int", "interior", 0.85]] as const) {
        out.push({ id: `llanta-${eje}-${id}-${pos}`, nombre: `Llanta ${nombreEje} · ${nombre} ${nombrePos}`, zona, grupo: "llantas",
          formas: [{ t: "llanta", c: [x, RADIO_LLANTA, s * z], r: RADIO_LLANTA, ancho: 0.27 }] });
      }
    }
  }
  return out;
}

function frenos(): Pieza[] {
  const ejes: Array<[string, string, number, ZonaModelo, number]> = [
    ["del", "eje delantero", -8, "llantas_del", 0.78], ["t1", "tracción eje 1", -4.6, "llantas_trac", 0.6], ["t2", "tracción eje 2", -3.4, "llantas_trac", 0.6],
    ["sr1", "semirremolque eje 1", 5.8, "llantas_sr", 0.6], ["sr2", "semirremolque eje 2", 7.0, "llantas_sr", 0.6], ["sr3", "semirremolque eje 3", 8.2, "llantas_sr", 0.6],
  ];
  return ejes.map(([id, nombre, x, zona, z]) => ({
    id: `freno-${id}`, nombre: `Frenos · ${nombre}`, zona, grupo: "frenos" as const,
    formas: [cil([x, RADIO_LLANTA, z], 0.24, 0.14, "z"), cil([x, RADIO_LLANTA, -z], 0.24, 0.14, "z")],
  }));
}

export const PIEZAS: Pieza[] = [
  // ——— Cabina ———
  { id: "cabina", nombre: "Cabina (carrocería)", zona: "cabina", grupo: "cabina", formas: [caja([-9, 1.0, -1.25], [-6.6, 3.7, 1.25])] },
  { id: "deflector", nombre: "Deflector de techo", zona: "cabina", grupo: "cabina", formas: [caja([-8.7, 3.72, -1.1], [-6.9, 4.15, 1.1])] },
  { id: "parabrisas", nombre: "Parabrisas", zona: "cabina", grupo: "cabina", formas: [caja([-9.06, 2.35, -1.1], [-9.02, 3.4, 1.1])] },
  { id: "puerta-izq", nombre: "Puerta · izquierda (piloto)", zona: "cabina", grupo: "cabina", formas: [caja([-8.6, 1.35, 1.27], [-7.3, 3.25, 1.31])] },
  { id: "puerta-der", nombre: "Puerta · derecha (copiloto)", zona: "cabina", grupo: "cabina", formas: [caja([-8.6, 1.35, -1.31], [-7.3, 3.25, -1.27])] },
  { id: "parachoques-del", nombre: "Parachoques delantero", zona: "cabina", grupo: "cabina", formas: [caja([-9.75, 0.7, -1.25], [-9.5, 1.0, 1.25])] },
  { id: "guardafango-del-izq", nombre: "Guardafango delantero · izquierdo", zona: "chasis", grupo: "cabina", formas: [caja([-8.65, 1.08, 0.82], [-7.35, 1.16, 1.3])] },
  { id: "guardafango-del-der", nombre: "Guardafango delantero · derecho", zona: "chasis", grupo: "cabina", formas: [caja([-8.65, 1.08, -1.3], [-7.35, 1.16, -0.82])] },
  // ——— Luces y espejos ———
  { id: "retrovisor-izq", nombre: "Retrovisor · izquierdo", zona: "cabina", grupo: "luces", formas: [caja([-9.25, 2.55, 1.5], [-9.05, 3.35, 1.62]), caja([-9.2, 3.0, 1.25], [-9.1, 3.05, 1.5])] },
  { id: "retrovisor-der", nombre: "Retrovisor · derecho", zona: "cabina", grupo: "luces", formas: [caja([-9.25, 2.55, -1.62], [-9.05, 3.35, -1.5]), caja([-9.2, 3.0, -1.5], [-9.1, 3.05, -1.25])] },
  { id: "faro-izq", nombre: "Faro delantero · izquierdo", zona: "cabina", grupo: "luces", formas: [caja([-9.5, 1.15, 0.62], [-9.44, 1.42, 1.08])] },
  { id: "faro-der", nombre: "Faro delantero · derecho", zona: "cabina", grupo: "luces", formas: [caja([-9.5, 1.15, -1.08], [-9.44, 1.42, -0.62])] },
  { id: "luz-tras-izq", nombre: "Luz trasera · izquierda", zona: "caja", grupo: "luces", formas: [caja([9.02, 1.28, 0.85], [9.08, 1.5, 1.25])] },
  { id: "luz-tras-der", nombre: "Luz trasera · derecha", zona: "caja", grupo: "luces", formas: [caja([9.02, 1.28, -1.25], [9.08, 1.5, -0.85])] },
  // ——— Motor ———
  { id: "motor", nombre: "Motor (capó)", zona: "motor", grupo: "motor", codigos: ["aceite"], formas: [caja([-9.45, 0.9, -1.1], [-8.0, 2.0, 1.1])] },
  { id: "parrilla", nombre: "Parrilla y radiador", zona: "motor", grupo: "motor", formas: [caja([-9.5, 1.0, -0.55], [-9.46, 1.95, 0.55])] },
  { id: "escape", nombre: "Tubo de escape (chimenea)", zona: "motor", grupo: "motor", formas: [cil([-6.45, 2.7, -1.15], 0.09, 3.0, "y")] },
  { id: "filtro-aire", nombre: "Filtro de aire", zona: "motor", grupo: "motor", codigos: ["filtro_aire"], formas: [cil([-6.45, 2.2, 1.12], 0.2, 1.4, "y")] },
  // ——— Chasis y tanques ———
  { id: "chasis-tracto", nombre: "Chasis del tracto", zona: "chasis", grupo: "chasis", formas: [caja([-9, 0.75, -0.5], [-2.6, 1.0, 0.5])] },
  { id: "tanque-combustible", nombre: "Tanque de combustible", zona: "tanque", grupo: "chasis", formas: [cil([-5.8, 1.1, 1.05], 0.3, 1.0, "x")] },
  { id: "bateria", nombre: "Caja de baterías", zona: "bateria", grupo: "chasis", formas: [caja([-6.25, 0.8, -1.35], [-5.45, 1.3, -0.95])] },
  { id: "quinta-rueda", nombre: "Quinta rueda", zona: "quinta", grupo: "chasis", formas: [cil([-3.7, 1.17, 0], 0.62, 0.1, "y")] },
  { id: "guardafango-trac-izq", nombre: "Guardafango de tracción · izquierdo", zona: "chasis", grupo: "chasis", formas: [caja([-5.3, 1.12, 0.66], [-2.7, 1.2, 1.36])] },
  { id: "guardafango-trac-der", nombre: "Guardafango de tracción · derecho", zona: "chasis", grupo: "chasis", formas: [caja([-5.3, 1.12, -1.36], [-2.7, 1.2, -0.66])] },
  // ——— Semirremolque ———
  { id: "caja-frente", nombre: "Caja · pared delantera", zona: "caja", grupo: "semirremolque", formas: [caja([-4, 1.35, -1.3], [-3.96, 4.0, 1.3])] },
  { id: "caja-lateral-izq", nombre: "Caja · lateral izquierdo", zona: "caja", grupo: "semirremolque", formas: [caja([-4, 1.35, 1.28], [9, 4.0, 1.3])] },
  { id: "caja-lateral-der", nombre: "Caja · lateral derecho", zona: "caja", grupo: "semirremolque", formas: [caja([-4, 1.35, -1.3], [9, 4.0, -1.28])] },
  { id: "caja-techo", nombre: "Caja · techo", zona: "caja", grupo: "semirremolque", formas: [caja([-4, 3.98, -1.3], [9, 4.0, 1.3])] },
  { id: "puerta-tras-izq", nombre: "Puerta trasera · izquierda", zona: "caja", grupo: "semirremolque", formas: [caja([8.98, 1.55, 0.02], [9.02, 3.95, 1.28])] },
  { id: "puerta-tras-der", nombre: "Puerta trasera · derecha", zona: "caja", grupo: "semirremolque", formas: [caja([8.98, 1.55, -1.28], [9.02, 3.95, -0.02])] },
  { id: "chasis-semirremolque", nombre: "Chasis del semirremolque", zona: "chasis", grupo: "semirremolque", formas: [caja([-3.3, 1.0, -0.55], [9, 1.3, 0.55])] },
  { id: "pata-apoyo-izq", nombre: "Pata de apoyo · izquierda", zona: "chasis", grupo: "semirremolque", formas: [caja([0.9, 0.12, 0.85], [1.05, 1.3, 0.98]), caja([0.8, 0.08, 0.8], [1.15, 0.12, 1.03])] },
  { id: "pata-apoyo-der", nombre: "Pata de apoyo · derecha", zona: "chasis", grupo: "semirremolque", formas: [caja([0.9, 0.12, -0.98], [1.05, 1.3, -0.85]), caja([0.8, 0.08, -1.03], [1.15, 0.12, -0.8])] },
  { id: "parachoques-tras", nombre: "Parachoques trasero", zona: "caja", grupo: "semirremolque", formas: [caja([9.0, 0.5, -1.15], [9.12, 0.68, 1.15]), caja([8.9, 0.68, 0.6], [8.98, 1.3, 0.7]), caja([8.9, 0.68, -0.7], [8.98, 1.3, -0.6])] },
  { id: "lodera-izq", nombre: "Lodera · izquierda", zona: "caja", grupo: "semirremolque", formas: [caja([8.86, 0.22, 0.7], [8.9, 1.0, 1.32])] },
  { id: "lodera-der", nombre: "Lodera · derecha", zona: "caja", grupo: "semirremolque", formas: [caja([8.86, 0.22, -1.32], [8.9, 1.0, -0.7])] },
  { id: "llanta-repuesto", nombre: "Llanta de repuesto", zona: "llantas_sr", grupo: "llantas", formas: [cil([3.2, 0.8, 0], 0.48, 0.26, "y")] },
  ...llantas(),
  ...frenos(),
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
