import type { ZonaModelo } from "@sunatapp/db";

/**
 * **Piezas del modelo 3D**: un tracto **cara plana** (cabina frontal plana, sobre el motor, sin
 * capó), modelado igual a la unidad real: Volvo FH12 420 **6x2** (eje de tracción con llantas
 * dobles + eje de apoyo con llantas simples 315/70 y ballestas), escape bajo, tanque cilíndrico
 * detrás de la cabina y caja de baterías a la derecha; con un **semirremolque de 3 ejes**
 * (por defecto plataforma con mampara alta y estacas; también furgón, cama baja o cisterna). Cada pieza va por separado
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
  ejes: "Ejes y suspensión", frenos: "Frenos", llantas: "Llantas", semirremolque: "Semirremolque",
};

type V3 = [number, number, number];
const caja = (min: V3, max: V3): Forma => ({ t: "caja", min, max });
const cil = (c: V3, r: number, largo: number, eje: "x" | "y" | "z"): Forma => ({ t: "cil", c, r, largo, eje });
/** La misma caja en el lado izquierdo (s = 1) o derecho (s = -1): z0..z1 son distancias al centro. */
const cajaLado = (s: 1 | -1, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Forma =>
  caja([x0, y0, s > 0 ? z0 : -z1], [x1, y1, s > 0 ? z1 : -z0]);
const ambosLados = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Forma[] =>
  [cajaLado(1, x0, x1, y0, y1, z0, z1), cajaLado(-1, x0, x1, y0, y1, z0, z1)];

// ——— Medidas (m): tomadas de la unidad real (Volvo FH12 420 6x2 + plataforma de 3 ejes) ———
const R = 0.52; // llanta 295/80 R22.5
const R_APOYO = 0.505; // llanta simple 315/70 R22.5 del eje de apoyo
const CAB = { x0: -9.4, x1: -7.1, y0: 1.2, y1: 3.75, z: 1.25 }; // cabina frontal plana (techo alto), sobre el motor
const RIEL = { y0: 0.78, y1: 1.08, zi: 0.36, ze: 0.46 }; // largueros del tracto
const SR = { x0: -4.9, x1: 8.7, piso: 1.38, techo: 4.1, z: 1.3 }; // semirremolque de 13.6 m
const VIGA = { y0: 0.98, zi: 0.42, ze: 0.55 }; // vigas del semirremolque
const EJES_SR = [4.78, 6.09, 7.4];
const PATAS_X = -1.6;

/** Tracción del tracto: 6x2 (tracción + eje de apoyo con llantas simples, como el FH12) o 6x4 (dos ejes de tracción). */
export const TRACCIONES = { "6x2": "6x2 · tracción + eje de apoyo", "6x4": "6x4 · doble tracción" } as const;
export type Traccion = keyof typeof TRACCIONES;
export const esTraccion = (t: string): t is Traccion => t in TRACCIONES;

const posiciones = (t: Traccion) => (t === "6x2"
  ? { del: -8.0, t1: -4.4, t2: -3.05, quinta: -3.85, finTracto: -2.35 }
  : { del: -8.0, t1: -4.5, t2: -3.15, quinta: -3.9, finTracto: -2.35 });
const X = posiciones("6x4"); // lo que no depende de la tracción (quinta rueda, fin del tracto)

const LADOS = [["izq", "izquierda", 1], ["der", "derecha", -1]] as const;
type Eje = { id: string; nombre: string; x: number; zona: ZonaModelo; llantas: "delantera" | "doble" | "simple"; traccion: boolean };
function ejesDe(t: Traccion): Eje[] {
  const x = posiciones(t);
  return [
    { id: "del", nombre: "eje delantero", x: x.del, zona: "llantas_del", llantas: "delantera", traccion: false },
    { id: "t1", nombre: t === "6x2" ? "eje de tracción" : "tracción eje 1", x: x.t1, zona: "llantas_trac", llantas: "doble", traccion: true },
    t === "6x2"
      ? { id: "t2", nombre: "eje de apoyo", x: x.t2, zona: "llantas_trac", llantas: "simple", traccion: false }
      : { id: "t2", nombre: "tracción eje 2", x: x.t2, zona: "llantas_trac", llantas: "doble", traccion: true },
    ...EJES_SR.map((xs, i): Eje => ({ id: `sr${i + 1}`, nombre: `semirremolque eje ${i + 1}`, x: xs, zona: "llantas_sr", llantas: "doble", traccion: false })),
  ];
}

function llantas(ejes: Eje[]): Pieza[] {
  const out: Pieza[] = [];
  for (const e of ejes) {
    for (const [id, nombre, s] of LADOS) {
      if (e.llantas === "delantera") {
        out.push({ id: `llanta-${e.id}-${id}`, nombre: `Llanta delantera · ${nombre}`, zona: e.zona, grupo: "llantas",
          formas: [{ t: "llanta", c: [e.x, R, s * 1.05], r: R, ancho: 0.3 }] });
      } else if (e.llantas === "simple") {
        out.push({ id: `llanta-${e.id}-${id}`, nombre: `Llanta ${e.nombre} (simple 315/70) · ${nombre}`, zona: e.zona, grupo: "llantas",
          formas: [{ t: "llanta", c: [e.x, R_APOYO, s * 0.95], r: R_APOYO, ancho: 0.31 }] });
      } else {
        for (const [pos, nombrePos, z] of [["ext", "exterior", 1.12], ["int", "interior", 0.85]] as const) {
          out.push({ id: `llanta-${e.id}-${id}-${pos}`, nombre: `Llanta ${e.nombre} · ${nombre} ${nombrePos}`, zona: e.zona, grupo: "llantas",
            formas: [{ t: "llanta", c: [e.x, R, s * z], r: R, ancho: 0.27 }] });
        }
      }
    }
  }
  return out;
}

/** Ejes (atraviesan los tambores hasta el aro), frenos y suspensión de cada eje. */
function tren(ejes: Eje[], t: Traccion): Pieza[] {
  const out: Pieza[] = [];
  const x = posiciones(t);
  for (const e of ejes) {
    const zTambor = e.llantas === "delantera" ? 0.78 : 0.6;
    const r = e.llantas === "simple" ? R_APOYO : R;
    const formasEje: Forma[] = [cil([e.x, r, 0], 0.07, e.llantas === "doble" ? 1.9 : 1.8, "z")];
    if (e.traccion) formasEje.push(caja([e.x - 0.22, 0.34, -0.2], [e.x + 0.22, 0.7, 0.2])); // diferencial
    out.push({ id: `eje-${e.id}`, nombre: `Eje · ${e.nombre}`, zona: "chasis", grupo: "ejes", codigos: [], formas: formasEje });
    out.push({ id: `freno-${e.id}`, nombre: `Frenos · ${e.nombre}`, zona: e.zona, grupo: "frenos",
      formas: [cil([e.x, r, zTambor], 0.24, 0.14, "z"), cil([e.x, r, -zTambor], 0.24, 0.14, "z")] });
    let susp: Forma[];
    if (e.id === "del") {
      // Muelles (ballestas) entre el eje y los largueros.
      susp = ambosLados(e.x - 0.65, e.x + 0.65, R + 0.07, RIEL.y0, RIEL.zi, RIEL.ze);
    } else if (e.id === "t1" || e.id === "t2") {
      if (t === "6x2") {
        // Tándem de ballestas: cada eje con su muelle hasta el soporte en V que cuelga del larguero (entre los dos ejes).
        const medio = (x.t1 + x.t2) / 2;
        const desde = e.id === "t1" ? e.x - 0.6 : medio, hasta = e.id === "t1" ? medio : e.x + 0.6;
        susp = ambosLados(desde, hasta, r + 0.07, 0.72, RIEL.zi, RIEL.ze);
        if (e.id === "t1") susp.push(...ambosLados(medio - 0.14, medio + 0.14, 0.72, RIEL.y0, RIEL.zi, RIEL.ze));
      } else {
        // Bolsas de aire sobre el eje, bajo los largueros.
        const alto = RIEL.y0 - R - 0.07, y = R + 0.07 + alto / 2;
        susp = [cil([e.x, y, 0.41], 0.13, alto, "y"), cil([e.x, y, -0.41], 0.13, alto, "y")];
      }
    } else {
      // Brazo de arrastre desde el eje y bolsa de aire bajo la viga.
      const xb = e.x + 0.3, alto = VIGA.y0 - 0.6;
      susp = [
        ...ambosLados(e.x, e.x + 0.42, 0.5, 0.6, 0.43, 0.53),
        cil([xb, 0.6 + alto / 2, 0.48], 0.14, alto, "y"), cil([xb, 0.6 + alto / 2, -0.48], 0.14, alto, "y"),
      ];
    }
    const nombreSusp = t === "6x2" && e.id === "t1" ? `Suspensión · ${e.nombre} (ballestas y soporte en V)` : `Suspensión · ${e.nombre}`;
    out.push({ id: `suspension-${e.id}`, nombre: nombreSusp, zona: "chasis", grupo: "ejes", codigos: ["amortiguadores"], formas: susp });
  }
  return out;
}

/** El tracto cara plana (Volvo FH12 de la foto): cabina, motor, chasis, tanques y equipos. */
function tracto(t: Traccion): Pieza[] {
  const x = posiciones(t);
  return [
    // ——— Cabina (frontal plana, techo alto, sobre el motor) ———
    { id: "cabina", nombre: "Cabina (carrocería)", zona: "cabina", grupo: "cabina",
      formas: [caja([CAB.x0, CAB.y0, -CAB.z], [CAB.x1, CAB.y1, CAB.z])] },
    { id: "visera", nombre: "Visera parasol", zona: "cabina", grupo: "cabina", formas: [caja([-9.6, 3.5, -1.15], [CAB.x0, 3.62, 1.15])] },
    { id: "luces-techo", nombre: "Luces de techo (galibo)", zona: "cabina", grupo: "luces",
      formas: [-0.8, -0.4, 0, 0.4, 0.8].map((z) => caja([-9.3, CAB.y1, z - 0.07], [-9.15, CAB.y1 + 0.09, z + 0.07])) },
    { id: "parabrisas", nombre: "Parabrisas", zona: "cabina", grupo: "cabina", formas: [caja([-9.43, 2.4, -1.12], [CAB.x0, 3.4, 1.12])] },
    { id: "parrilla", nombre: "Parrilla frontal y radiador", zona: "motor", grupo: "cabina", codigos: [], formas: [caja([-9.43, 1.5, -0.85], [CAB.x0, 2.3, 0.85])] },
    ...LADOS.map(([id, nombre, s]): Pieza => ({ id: `puerta-${id}`, nombre: `Puerta · ${nombre} (${s > 0 ? "piloto" : "copiloto"})`, zona: "cabina", grupo: "cabina",
      formas: [cajaLado(s, -9.15, -7.85, 1.35, 3.35, CAB.z, CAB.z + 0.03)] })),
    ...LADOS.map(([id, nombre, s]): Pieza => ({ id: `deflector-lateral-${id}`, nombre: `Deflector lateral de la cabina · ${nombre}`, zona: "cabina", grupo: "cabina",
      formas: [cajaLado(s, -7.3, CAB.x1, 1.9, 3.55, CAB.z, CAB.z + 0.07)] })),
    ...LADOS.map(([id, nombre, s]): Pieza => ({ id: `escalones-${id}`, nombre: `Escalones de acceso · ${nombre}`, zona: "cabina", grupo: "cabina",
      formas: [cajaLado(s, -8.65, -8.3, 0.45, CAB.y0, 1.05, CAB.z)] })),
    { id: "parachoques-del", nombre: "Parachoques delantero (con estribo)", zona: "cabina", grupo: "cabina", formas: [caja([-9.55, 0.5, -CAB.z], [-9.25, CAB.y0, CAB.z])] },
    ...LADOS.map(([id, nombre, s]): Pieza => ({ id: `guardafango-del-${id}`, nombre: `Guardafango delantero · ${nombre}`, zona: "cabina", grupo: "cabina",
      formas: [cajaLado(s, -8.3, -7.35, 1.12, CAB.y0, 0.85, CAB.z)] })),
    // ——— Luces y espejos ———
    ...LADOS.map(([id, nombre, s]): Pieza => ({ id: `retrovisor-${id}`, nombre: `Retrovisor · ${nombre}`, zona: "cabina", grupo: "luces",
      formas: [cajaLado(s, -9.5, -9.3, 3.0, 3.06, CAB.z, 1.42), cajaLado(s, -9.56, -9.44, 2.55, 3.4, 1.42, 1.56)] })),
    ...LADOS.map(([id, nombre, s]): Pieza => ({ id: `faro-${id}`, nombre: `Faro delantero · ${nombre}`, zona: "cabina", grupo: "luces",
      formas: [cajaLado(s, -9.45, CAB.x0, 0.9, 1.1, 0.72, 1.15)] })),
    // ——— Motor y transmisión (bajo la cabina) ———
    { id: "motor", nombre: "Motor (bajo la cabina)", zona: "motor", grupo: "motor", codigos: ["aceite"], formas: [caja([-9.0, 0.6, -0.34], [-7.4, CAB.y0, 0.34])] },
    { id: "caja-cambios", nombre: "Caja de cambios", zona: "motor", grupo: "motor", codigos: [], formas: [caja([-7.4, 0.68, -0.25], [-6.5, 1.05, 0.25])] },
    { id: "cardan", nombre: "Cardán (árbol de transmisión)", zona: "motor", grupo: "motor", codigos: [], formas: [
      cil([(-6.5 + x.t1 - 0.22) / 2, 0.72, 0], 0.07, x.t1 - 0.22 + 6.5, "x"), // caja de cambios → diferencial
      ...(t === "6x4" ? [cil([(x.t1 + x.t2) / 2, 0.55, 0], 0.06, x.t2 - x.t1 - 0.44, "x")] : []), // entre los dos diferenciales
    ] },
    { id: "filtro-aire", nombre: "Toma y filtro de aire (detrás de la cabina)", zona: "motor", grupo: "motor", codigos: ["filtro_aire"],
      formas: [caja([CAB.x1, 2.5, -1.2], [-6.85, 3.3, -0.75])] },
    { id: "escape", nombre: "Tubo de escape (salida baja, lado derecho)", zona: "motor", grupo: "motor", codigos: [],
      formas: [cil([-7.0, 0.45, -0.62], 0.07, 0.9, "x"), cajaLado(-1, -6.62, -6.52, 0.5, RIEL.y0, RIEL.ze - 0.02, 0.69)] },
    { id: "silenciador", nombre: "Silenciador", zona: "motor", grupo: "motor", codigos: [],
      formas: [cajaLado(1, -5.9, -5.1, 0.5, 0.85, 0.5, 0.95), cajaLado(1, -5.6, -5.4, 0.85, 0.95, RIEL.ze, 0.5)] },
    // ——— Chasis, tanques y equipos del tracto ———
    { id: "chasis-tracto", nombre: "Chasis del tracto (largueros)", zona: "chasis", grupo: "chasis", codigos: [],
      formas: ambosLados(-9.25, x.finTracto, RIEL.y0, RIEL.y1, RIEL.zi, RIEL.ze) },
    { id: "tanque-combustible", nombre: "Tanque de combustible (cilíndrico, detrás de la cabina)", zona: "tanque", grupo: "chasis",
      formas: [cil([-6.72, 1.55, 0], 0.38, 1.55, "z"), caja([-6.95, RIEL.y1, -RIEL.ze], [-6.5, 1.19, RIEL.ze])] },
    { id: "mangueras", nombre: "Mangueras espirales de aire y luces", zona: "chasis", grupo: "chasis", codigos: [],
      formas: [caja([CAB.x1, 1.85, -0.35], [-6.9, 2.1, 0.35]), ...[-0.25, 0, 0.25].map((z) => cil([(-6.9 + SR.x0) / 2, 1.98, z], 0.05, SR.x0 + 6.9, "x"))] },
    { id: "bateria", nombre: "Caja de baterías (lado derecho, tapa con peldaño)", zona: "bateria", grupo: "chasis",
      formas: [cajaLado(-1, -7.35, -6.5, 0.62, 1.08, 0.8, 1.25), cajaLado(-1, -7.1, -6.8, 0.9, 1.0, RIEL.ze, 0.8)] },
    { id: "estribo-bateria", nombre: "Estribo (peldaños) bajo la batería", zona: "chasis", grupo: "chasis", codigos: [],
      formas: [cajaLado(-1, -7.35, -6.5, 0.3, 0.35, 0.95, 1.3), cajaLado(-1, -7.35, -7.28, 0.35, 0.62, 1.15, 1.25), cajaLado(-1, -6.57, -6.5, 0.35, 0.62, 1.15, 1.25)] },
    { id: "tanques-aire", nombre: "Tanques de aire (frenos)", zona: "chasis", grupo: "chasis", codigos: [],
      formas: [
        ...[-6.9, -6.55, -6.2].map((x) => cil([x, 0.8, 0.72], 0.12, 0.45, "z")), cajaLado(1, -7.0, -6.1, 0.9, 1.0, RIEL.ze, 0.5), // los pequeños, lado izquierdo
        cil([-5.95, 0.82, -0.72], 0.22, 0.9, "x"), cajaLado(-1, -6.05, -5.85, 0.9, 1.0, RIEL.ze, 0.5), // el grande, lado derecho
      ] },
    { id: "quinta-rueda", nombre: "Quinta rueda", zona: "quinta", grupo: "chasis",
      formas: [cil([X.quinta, 1.17, 0], 0.5, 0.1, "y"), caja([X.quinta - 0.4, RIEL.y1, -RIEL.ze], [X.quinta + 0.4, 1.12, RIEL.ze])] },
    ...LADOS.map(([id, nombre, s]): Pieza => ({ id: `guardafango-trac-${id}`, nombre: `Guardafango trasero del tracto · ${nombre}`, zona: "chasis", grupo: "chasis", codigos: [],
      formas: [cajaLado(s, -5.1, -2.55, 1.1, 1.16, RIEL.ze, 1.36)] })),
    ...LADOS.map(([id, nombre, s]): Pieza => ({ id: `lodera-trac-${id}`, nombre: `Lodera del tracto · ${nombre}`, zona: "chasis", grupo: "chasis", codigos: [],
      formas: [cajaLado(s, -2.55, -2.51, 0.25, 1.1, 0.66, 1.36)] })),
  ];
}



// ——— Semirremolque: lo común y la carrocería según el tipo ———

export const TIPOS_SEMIRREMOLQUE = { furgon: "Furgón", plataforma: "Plataforma", cama_baja: "Cama baja", cisterna: "Cisterna" } as const;
export type TipoSemirremolque = keyof typeof TIPOS_SEMIRREMOLQUE;
export const esTipoSemirremolque = (t: string): t is TipoSemirremolque => t in TIPOS_SEMIRREMOLQUE;

const kingPin = cil([X.quinta, 1.14, 0], 0.05, 0.16, "y");
const LUCES_TRASERAS: Pieza[] = LADOS.map(([id, nombre, s]): Pieza => ({ id: `luz-tras-${id}`, nombre: `Luz trasera · ${nombre}`, zona: "caja", grupo: "luces",
  formas: [cajaLado(s, SR.x1, SR.x1 + 0.05, 1.08, 1.3, 0.8, 1.2)] }));
const PLANCHA: Pieza = { id: "plancha-acople", nombre: "Plancha de acople y king pin", zona: "quinta", grupo: "semirremolque", codigos: [],
  formas: [caja([SR.x0, 1.22, -1.25], [-2.6, SR.piso, 1.25]), kingPin] };
const CHASIS_SR: Pieza = { id: "chasis-semirremolque", nombre: "Chasis del semirremolque (vigas)", zona: "chasis", grupo: "semirremolque", codigos: [],
  formas: ambosLados(-2.6, SR.x1, VIGA.y0, SR.piso, VIGA.zi, VIGA.ze) };
const MARCO: Pieza = { id: "marco-trasero", nombre: "Marco trasero", zona: "caja", grupo: "semirremolque", formas: [caja([SR.x1 - 0.1, VIGA.y0, -SR.z], [SR.x1, SR.piso, SR.z])] };
const PARACHOQUES_TRAS: Pieza = { id: "parachoques-tras", nombre: "Parachoques trasero (antiempotramiento)", zona: "caja", grupo: "semirremolque",
  formas: [caja([8.55, 0.45, -1.15], [8.68, 0.6, 1.15]), ...ambosLados(8.56, 8.66, 0.6, VIGA.y0, VIGA.zi, VIGA.ze)] };
const patas = (arriba: number): Pieza[] => LADOS.map(([id, nombre, s]): Pieza => ({ id: `pata-apoyo-${id}`, nombre: `Pata de apoyo · ${nombre}`, zona: "chasis", grupo: "semirremolque", codigos: [],
  formas: [cajaLado(s, PATAS_X - 0.08, PATAS_X + 0.08, 0.12, arriba, VIGA.zi, VIGA.ze), cajaLado(s, PATAS_X - 0.2, PATAS_X + 0.2, 0.06, 0.12, VIGA.zi - 0.06, VIGA.ze + 0.06)] }));
const DEFENSAS: Pieza[] = LADOS.map(([id, nombre, s]): Pieza => ({ id: `defensa-lateral-${id}`, nombre: `Defensa lateral · ${nombre}`, zona: "caja", grupo: "semirremolque",
  formas: [cajaLado(s, -0.8, 4.0, 0.55, 0.85, SR.z - 0.04, SR.z), cajaLado(s, -0.7, -0.55, 0.85, SR.piso, SR.z - 0.1, SR.z), cajaLado(s, 3.75, 3.9, 0.85, SR.piso, SR.z - 0.1, SR.z)] }));
const LODERAS: Pieza[] = LADOS.map(([id, nombre, s]): Pieza => ({ id: `lodera-${id}`, nombre: `Lodera del semirremolque · ${nombre}`, zona: "caja", grupo: "semirremolque",
  formas: [cajaLado(s, 8.05, 8.09, 0.25, VIGA.y0, 0.7, SR.z), cajaLado(s, 8.05, 8.09, 0.9, VIGA.y0, VIGA.ze, 0.7)] }));
const REPUESTO: Pieza = { id: "llanta-repuesto", nombre: "Llanta de repuesto (con su porta llanta)", zona: "llantas_sr", grupo: "llantas",
  formas: [cil([1.8, 0.8, 0], 0.5, 0.27, "y"), caja([1.2, 0.935, -VIGA.ze], [2.4, VIGA.y0, VIGA.ze])] };

function carroceria(tipo: TipoSemirremolque): Pieza[] {
  if (tipo === "furgon") {
    return [
      { id: "caja-frente", nombre: "Furgón · pared delantera", zona: "caja", grupo: "semirremolque", formas: [caja([SR.x0, SR.piso, -SR.z], [SR.x0 + 0.04, SR.techo, SR.z])] },
      ...LADOS.map(([id, nombre, s]): Pieza => ({ id: `caja-lateral-${id}`, nombre: `Furgón · lateral ${nombre}`, zona: "caja", grupo: "semirremolque",
        formas: [cajaLado(s, SR.x0, SR.x1, SR.piso, SR.techo, SR.z - 0.02, SR.z)] })),
      { id: "caja-techo", nombre: "Furgón · techo", zona: "caja", grupo: "semirremolque", formas: [caja([SR.x0, SR.techo - 0.02, -SR.z], [SR.x1, SR.techo, SR.z])] },
      ...LADOS.map(([id, nombre, s]): Pieza => ({ id: `puerta-tras-${id}`, nombre: `Puerta trasera · ${nombre}`, zona: "caja", grupo: "semirremolque",
        formas: [cajaLado(s, SR.x1, SR.x1 + 0.03, SR.piso + 0.02, SR.techo - 0.04, 0.01, SR.z - 0.02)] })),
    ];
  }
  if (tipo === "plataforma") {
    const tope = SR.piso + 0.08;
    const estacas = (s: 1 | -1): Forma[] => [
      ...[-4.2, -3.0, -1.8, -0.6, 0.6, 1.8, 3.0, 4.2, 5.4, 6.6, 7.8].map((x) => cajaLado(s, x - 0.05, x + 0.05, tope, 2.5, SR.z - 0.06, SR.z)), // estacas de madera
      cajaLado(s, SR.x0, SR.x1, SR.piso - 0.12, tope, SR.z, SR.z + 0.04), // baranda lateral (con reflectivos)
    ];
    return [
      { id: "plataforma-piso", nombre: "Plataforma · piso", zona: "caja", grupo: "semirremolque", formas: [caja([SR.x0, SR.piso, -SR.z], [SR.x1, tope, SR.z])] },
      { id: "mampara-frontal", nombre: "Plataforma · mampara delantera (cajón alto con ganchos)", zona: "caja", grupo: "semirremolque",
        formas: [caja([SR.x0, tope, -1.25], [SR.x0 + 0.45, 3.35, 1.25])] },
      ...LADOS.map(([id, nombre, s]): Pieza => ({ id: `estacas-${id}`, nombre: `Plataforma · estacas y baranda ${nombre}`, zona: "caja", grupo: "semirremolque", formas: estacas(s) })),
    ];
  }
  if (tipo === "cisterna") {
    return [
      { id: "cisterna-tanque", nombre: "Cisterna · tanque", zona: "caja", grupo: "semirremolque", formas: [cil([1.85, 2.58, 0], 1.18, 13.3, "x")] },
      { id: "cisterna-bocas", nombre: "Cisterna · bocas de carga (manholes)", zona: "caja", grupo: "semirremolque",
        formas: [-1.5, 2, 5.5].map((x) => cil([x, 3.84, 0], 0.28, 0.16, "y")) },
      { id: "cisterna-pasarela", nombre: "Cisterna · pasarela superior", zona: "caja", grupo: "semirremolque", formas: [caja([-2.5, 3.92, -0.3], [7, 3.96, 0.3])] },
      { id: "cisterna-escalera", nombre: "Cisterna · escalera trasera", zona: "caja", grupo: "semirremolque", formas: [caja([8.5, SR.piso, -0.25], [8.62, 3.9, 0.25])] },
      { id: "cisterna-valvulas", nombre: "Cisterna · válvulas de descarga", zona: "caja", grupo: "semirremolque", formas: [cil([8.0, 1.2, 0], 0.09, 1.2, "z")] },
    ];
  }
  // Cama baja: cuello alto sobre la quinta rueda, piso bajo entre el cuello y los ejes, y rampas.
  return [
    { id: "cama-piso-bajo", nombre: "Cama baja · piso bajo", zona: "caja", grupo: "semirremolque", formas: [caja([-2.1, 0.55, -SR.z], [4.3, 0.72, SR.z])] },
    ...LADOS.map(([id, nombre, s]): Pieza => ({ id: `cama-rampa-${id}`, nombre: `Cama baja · rampa ${nombre}`, zona: "caja", grupo: "semirremolque",
      formas: [cajaLado(s, SR.x1, SR.x1 + 0.08, SR.piso, 3.0, 0.45, 0.95)] })),
  ];
}

/** Todas las piezas de una unidad: el tracto, el semirremolque de su tipo, ejes, frenos y llantas. */
export function piezasDeSemirremolque(tipo: TipoSemirremolque = "plataforma", traccion: Traccion = "6x2"): Pieza[] {
  const comunes: Pieza[] = tipo === "cama_baja"
    ? [
      { id: "cama-cuello", nombre: "Cama baja · cuello y king pin", zona: "quinta", grupo: "semirremolque", codigos: [],
        formas: [caja([SR.x0, 1.22, -1.25], [-2.4, 1.62, 1.25]), caja([-2.4, 0.55, -1.25], [-2.1, 1.62, 1.25]), kingPin] },
      { id: "cama-chasis-trasero", nombre: "Cama baja · chasis y plataforma sobre los ejes", zona: "chasis", grupo: "semirremolque", codigos: [],
        formas: [...ambosLados(4.3, SR.x1, VIGA.y0, SR.piso, VIGA.zi, VIGA.ze), caja([4.0, 0.55, -SR.z], [4.3, SR.piso + 0.08, SR.z]), caja([4.3, SR.piso, -SR.z], [SR.x1, SR.piso + 0.08, SR.z])] },
      ...patas(0.55), MARCO, PARACHOQUES_TRAS, ...LODERAS, ...LUCES_TRASERAS,
    ]
    : [PLANCHA, CHASIS_SR, ...patas(VIGA.y0), MARCO, PARACHOQUES_TRAS, ...DEFENSAS, ...LODERAS, REPUESTO, ...LUCES_TRASERAS];
  const ejes = ejesDe(traccion);
  return [...tracto(traccion), ...comunes, ...carroceria(tipo), ...tren(ejes, traccion), ...llantas(ejes)];
}

/** Todas las piezas posibles (de cualquier tipo de semirremolque), para buscar una por su código. */
export const PIEZAS: Pieza[] = (() => {
  const vistas = new Map<string, Pieza>();
  for (const tr of Object.keys(TRACCIONES) as Traccion[]) {
    for (const t of Object.keys(TIPOS_SEMIRREMOLQUE) as TipoSemirremolque[]) for (const p of piezasDeSemirremolque(t, tr)) if (!vistas.has(p.id)) vistas.set(p.id, p);
  }
  return [...vistas.values()];
})();

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

/** Piezas donde va un tipo de parte (ej. «Pastillas de freno · semirremolque» → frenos de sus 3 ejes). */
export function piezasDeTipo(t: { zona: ZonaModelo; codigo: string }): string[] {
  return PIEZAS.filter((p) => partesDePieza(p, [{ zona: t.zona, codigoTipo: t.codigo }]).length > 0).map((p) => p.id);
}

/** «a,b, c» → ids válidos, sin repetir. */
export function leerPiezas(texto: string | null | undefined): string[] {
  return [...new Set((texto ?? "").split(",").map((x) => x.trim()).filter((x) => PORID.has(x)))];
}
