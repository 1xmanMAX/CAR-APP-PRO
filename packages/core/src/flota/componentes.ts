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

export type GrupoPieza = "cabina" | "luces" | "motor" | "electrico" | "direccion" | "chasis" | "ejes" | "frenos" | "llantas" | "semirremolque";

export interface Pieza {
  id: string;
  nombre: string;
  /** Zona de desgaste a la que pertenece. */
  zona: ZonaModelo;
  grupo: GrupoPieza;
  formas: Forma[];
  /** Códigos de tipo de parte que le corresponden (si no, se deducen de su zona y grupo). */
  codigos?: string[];
  /** Conjunto al que pertenece (ej. «suspension-sr1»: sus bolsas de aire, brazos y amortiguadores). */
  sistema?: string;
}

/** Un conjunto de piezas que también se puede elegir entero (y guarda su propio historial). */
export interface Conjunto extends Pieza {
  hijos: string[];
}

export const GRUPOS_PIEZA: Record<GrupoPieza, string> = {
  cabina: "Cabina", luces: "Luces y espejos", motor: "Motor y transmisión", electrico: "Eléctrico y baterías", direccion: "Dirección",
  chasis: "Chasis, tanques y aire", ejes: "Ejes, mazas y suspensión", frenos: "Frenos", llantas: "Llantas", semirremolque: "Semirremolque",
};

type V3 = [number, number, number];
const caja = (min: V3, max: V3): Forma => ({ t: "caja", min, max });
const cil = (c: V3, r: number, largo: number, eje: "x" | "y" | "z"): Forma => ({ t: "cil", c, r, largo, eje });
/** La misma caja en el lado izquierdo (s = 1) o derecho (s = -1): z0..z1 son distancias al centro. */
const cajaLado = (s: 1 | -1, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Forma =>
  caja([x0, y0, s > 0 ? z0 : -z1], [x1, y1, s > 0 ? z1 : -z0]);
const ambosLados = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Forma[] =>
  [cajaLado(1, x0, x1, y0, y1, z0, z1), cajaLado(-1, x0, x1, y0, y1, z0, z1)];

/** Nombre, grupo y zona de cada conjunto; sus piezas lo nombran con `sistema`. */
const CONJUNTOS = new Map<string, { nombre: string; grupo: GrupoPieza; zona: ZonaModelo }>();
const conjunto = (id: string, nombre: string, grupo: GrupoPieza, zona: ZonaModelo): string => {
  CONJUNTOS.set(id, { nombre, grupo, zona });
  return id;
};

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

/** Nombre del eje que no cambia con la tracción (para los conjuntos, que guardan historial). */
const nombreFijo = (e: Eje) => (e.id === "del" ? "eje delantero" : e.id === "t1" ? "1.er eje trasero del tracto" : e.id === "t2" ? "2.º eje trasero del tracto" : e.nombre);

/**
 * Ejes, mazas, frenos y suspensión de cada eje, pieza por pieza: por cada rueda su tambor con
 * zapatas, su pulmón (cámara de freno), su matraca y su maza; por cada lado su bolsa de aire,
 * amortiguador y brazo (o ballesta). Los frenos y la suspensión de un eje son además un conjunto.
 */
function tren(ejes: Eje[], t: Traccion): Pieza[] {
  const out: Pieza[] = [];
  const x = posiciones(t);
  for (const e of ejes) {
    const zT = e.llantas === "delantera" ? 0.78 : 0.6;
    const r = e.llantas === "simple" ? R_APOYO : R;
    const fuera = e.llantas === "delantera" ? 1.2 : e.llantas === "simple" ? 1.105 : 1.255; // cara exterior de la llanta
    const formasEje: Forma[] = [cil([e.x, r, 0], 0.07, e.llantas === "doble" ? 1.9 : 1.8, "z")];
    if (e.traccion) formasEje.push(caja([e.x - 0.22, 0.34, -0.2], [e.x + 0.22, 0.7, 0.2])); // diferencial
    out.push({ id: `eje-${e.id}`, nombre: e.traccion ? `Eje y diferencial · ${e.nombre}` : `Eje · ${e.nombre}`, zona: "chasis", grupo: "ejes", codigos: [], formas: formasEje });
    const frenos = conjunto(`freno-${e.id}`, `Frenos · ${nombreFijo(e)}`, "frenos", e.zona);
    const susp = conjunto(`suspension-${e.id}`, `Suspensión · ${nombreFijo(e)}`, "ejes", "chasis");
    for (const [id, nombre, s] of LADOS) {
      const donde = `${e.nombre} · ${nombre}`;
      out.push(
        { id: `tambor-${e.id}-${id}`, nombre: `Frenos · ${donde} (tambor y zapatas)`, zona: e.zona, grupo: "frenos", sistema: frenos,
          formas: [cil([e.x, r, s * zT], 0.24, 0.14, "z")] },
        { id: `pulmon-${e.id}-${id}`, nombre: `Pulmón de freno (cámara) · ${donde}`, zona: e.zona, grupo: "frenos", codigos: [], sistema: frenos,
          formas: [cil([e.x - 0.3, r - 0.12, s * (zT - 0.1)], 0.1, 0.16, "z")] },
        { id: `matraca-${e.id}-${id}`, nombre: `Matraca (ajustador de freno) · ${donde}`, zona: e.zona, grupo: "frenos", codigos: [], sistema: frenos,
          formas: [cajaLado(s, e.x - 0.2, e.x - 0.14, r - 0.3, r - 0.05, zT - 0.1, zT - 0.06)] },
        { id: `maza-${e.id}-${id}`, nombre: `Maza, rodajes y tapa de rueda · ${donde}`, zona: e.zona, grupo: "ejes", codigos: [],
          formas: [cil([e.x, r, s * (fuera + 0.03)], 0.13, 0.06, "z")] },
      );
      const amortiguador = (xa: number): Pieza => ({ id: `amortiguador-${e.id}-${id}`, nombre: `Amortiguador · ${donde}`, zona: "chasis", grupo: "ejes",
        codigos: ["amortiguadores"], sistema: susp, formas: [cil([xa, e.id.startsWith("sr") ? 0.79 : 0.69, s * (e.id.startsWith("sr") ? 0.48 : 0.52)], 0.04, e.id.startsWith("sr") ? 0.38 : 0.3, "y")] });
      if (e.id === "del") {
        out.push(
          { id: `ballesta-del-${id}`, nombre: `Muelle (ballesta) · ${donde}`, zona: "chasis", grupo: "ejes", codigos: [], sistema: susp,
            formas: [cajaLado(s, e.x - 0.65, e.x + 0.65, R + 0.07, RIEL.y0, RIEL.zi, RIEL.ze)] },
          amortiguador(e.x - 0.3),
        );
      } else if ((e.id === "t1" || e.id === "t2") && t === "6x2") {
        // Tándem de ballestas: cada eje con su muelle, desde su gemelo hasta el soporte en V entre los dos ejes.
        const medio = (x.t1 + x.t2) / 2;
        const desde = e.id === "t1" ? e.x - 0.6 : medio, hasta = e.id === "t1" ? medio : e.x + 0.6, gemelo = e.id === "t1" ? e.x - 0.6 : e.x + 0.6;
        out.push(
          { id: `ballesta-${e.id}-${id}`, nombre: `Muelle (ballesta) y gemelo · ${donde}`, zona: "chasis", grupo: "ejes", codigos: [], sistema: susp,
            formas: [cajaLado(s, desde, hasta, r + 0.07, 0.72, RIEL.zi, RIEL.ze), cajaLado(s, gemelo - 0.06, gemelo + 0.06, 0.72, RIEL.y0, RIEL.zi, RIEL.ze)] },
          amortiguador(e.x + (e.id === "t1" ? -0.3 : 0.3)),
        );
      } else if (e.id === "t1" || e.id === "t2") {
        // 6x4: bolsas de aire sobre el eje, bajo los largueros.
        const alto = RIEL.y0 - R - 0.07;
        out.push(
          { id: `bolsa-aire-${e.id}-${id}`, nombre: `Bolsa de aire (fuelle) · ${donde}`, zona: "chasis", grupo: "ejes", codigos: [], sistema: susp,
            formas: [cil([e.x, R + 0.07 + alto / 2, s * 0.41], 0.13, alto, "y")] },
          amortiguador(e.x + 0.3),
        );
      } else {
        // Semirremolque: brazo de arrastre con su soporte (hanger) y la bolsa de aire bajo la viga.
        const alto = VIGA.y0 - 0.6;
        out.push(
          { id: `brazo-${e.id}-${id}`, nombre: `Brazo de suspensión y soporte (hanger) · ${donde}`, zona: "chasis", grupo: "ejes", codigos: [], sistema: susp,
            formas: [cajaLado(s, e.x - 0.35, e.x + 0.42, 0.5, 0.6, 0.43, 0.53), cajaLado(s, e.x - 0.41, e.x - 0.29, 0.6, VIGA.y0, 0.43, 0.53)] },
          { id: `bolsa-aire-${e.id}-${id}`, nombre: `Bolsa de aire (fuelle) · ${donde}`, zona: "chasis", grupo: "ejes", codigos: [], sistema: susp,
            formas: [cil([e.x + 0.3, 0.6 + alto / 2, s * 0.48], 0.14, alto, "y")] },
          amortiguador(e.x - 0.12),
        );
      }
    }
    if (e.id === "t1" && t === "6x2") {
      const medio = (x.t1 + x.t2) / 2;
      out.push({ id: "soporte-v", nombre: "Soporte en V del tándem (balancín de ballestas)", zona: "chasis", grupo: "ejes", codigos: [], sistema: susp,
        formas: ambosLados(medio - 0.14, medio + 0.14, 0.72, RIEL.y0, RIEL.zi, RIEL.ze) });
    }
  }
  return out;
}

/** El tracto cara plana (Volvo FH12 de la foto): cabina, motor y sus accesorios, dirección, chasis, aire y baterías. */
function tracto(t: Traccion): Pieza[] {
  const x = posiciones(t);
  const baterias = conjunto("bateria", "Baterías (caja con 2 baterías)", "electrico", "bateria");
  const aire = conjunto("tanques-aire", "Sistema de aire (tanques y secador)", "chasis", "chasis");
  const mangueras = conjunto("mangueras", "Mangueras espirales al semirremolque", "chasis", "chasis");
  const direccion = conjunto("direccion", "Sistema de dirección", "direccion", "chasis");
  const TANQUES_IZQ = [-6.9, -6.55, -6.2];
  const largoMangueras = SR.x0 + 6.9;
  return [
    // ——— Cabina (frontal plana, techo alto, sobre el motor) ———
    { id: "cabina", nombre: "Cabina (carrocería)", zona: "cabina", grupo: "cabina",
      formas: [caja([CAB.x0, CAB.y0, -CAB.z], [CAB.x1, CAB.y1, CAB.z])] },
    { id: "visera", nombre: "Visera parasol", zona: "cabina", grupo: "cabina", formas: [caja([-9.6, 3.5, -1.15], [CAB.x0, 3.62, 1.15])] },
    { id: "parabrisas", nombre: "Parabrisas", zona: "cabina", grupo: "cabina", formas: [caja([-9.43, 2.4, -1.12], [CAB.x0, 3.4, 1.12])] },
    { id: "limpiaparabrisas", nombre: "Limpiaparabrisas (brazos y plumillas)", zona: "cabina", grupo: "cabina", codigos: [],
      formas: [caja([-9.44, 2.42, -1.0], [-9.4, 2.47, -0.15]), caja([-9.44, 2.42, 0.1], [-9.4, 2.47, 0.95])] },
    { id: "parrilla", nombre: "Parrilla frontal", zona: "motor", grupo: "cabina", codigos: [], formas: [caja([-9.43, 1.5, -0.85], [CAB.x0, 2.3, 0.85])] },
    ...LADOS.map(([id, nombre, s]): Pieza => ({ id: `puerta-${id}`, nombre: `Puerta · ${nombre} (${s > 0 ? "piloto" : "copiloto"})`, zona: "cabina", grupo: "cabina",
      formas: [cajaLado(s, -9.15, -7.85, 1.35, 3.35, CAB.z, CAB.z + 0.03)] })),
    ...LADOS.map(([id, nombre, s]): Pieza => ({ id: `pasamanos-${id}`, nombre: `Pasamanos (agarradera) · ${nombre}`, zona: "cabina", grupo: "cabina", codigos: [],
      formas: [cajaLado(s, -7.82, -7.76, 1.5, 3.0, CAB.z, CAB.z + 0.05)] })),
    ...LADOS.map(([id, nombre, s]): Pieza => ({ id: `deflector-lateral-${id}`, nombre: `Deflector lateral de la cabina · ${nombre}`, zona: "cabina", grupo: "cabina",
      formas: [cajaLado(s, -7.3, CAB.x1, 1.9, 3.55, CAB.z, CAB.z + 0.07)] })),
    ...LADOS.map(([id, nombre, s]): Pieza => ({ id: `escalones-${id}`, nombre: `Escalones de acceso · ${nombre}`, zona: "cabina", grupo: "cabina",
      formas: [cajaLado(s, -8.65, -8.3, 0.45, CAB.y0, 1.05, CAB.z)] })),
    { id: "parachoques-del", nombre: "Parachoques delantero (con estribo)", zona: "cabina", grupo: "cabina", formas: [caja([-9.55, 0.5, -CAB.z], [-9.25, CAB.y0, CAB.z])] },
    ...LADOS.map(([id, nombre, s]): Pieza => ({ id: `guardafango-del-${id}`, nombre: `Guardafango delantero · ${nombre}`, zona: "cabina", grupo: "cabina",
      formas: [cajaLado(s, -8.3, -7.35, 1.12, CAB.y0, 0.85, CAB.z)] })),
    { id: "bocinas-aire", nombre: "Bocinas de aire (claxon de techo)", zona: "cabina", grupo: "cabina", codigos: [],
      formas: [cil([-8.0, CAB.y1 + 0.06, 0.4], 0.06, 0.5, "x"), cil([-8.0, CAB.y1 + 0.06, 0.6], 0.06, 0.4, "x")] },
    { id: "antena", nombre: "Antena (radio)", zona: "cabina", grupo: "cabina", codigos: [], formas: [caja([-7.5, CAB.y1, 0.9], [-7.46, CAB.y1 + 0.45, 0.94])] },
    // ——— Luces y espejos ———
    { id: "luces-techo", nombre: "Luces de techo (gálibo)", zona: "cabina", grupo: "luces",
      formas: [-0.8, -0.4, 0, 0.4, 0.8].map((z) => caja([-9.3, CAB.y1, z - 0.07], [-9.15, CAB.y1 + 0.09, z + 0.07])) },
    ...LADOS.map(([id, nombre, s]): Pieza => ({ id: `retrovisor-${id}`, nombre: `Retrovisor · ${nombre}`, zona: "cabina", grupo: "luces",
      formas: [cajaLado(s, -9.5, -9.3, 3.0, 3.06, CAB.z, 1.42), cajaLado(s, -9.56, -9.44, 2.55, 3.4, 1.42, 1.56)] })),
    { id: "espejo-frontal", nombre: "Espejo frontal de acercamiento (sobre el parabrisas)", zona: "cabina", grupo: "luces", codigos: [],
      formas: [caja([-9.62, 3.28, -1.0], [-9.5, 3.48, -0.75]), caja([-9.5, 3.42, -0.9], [CAB.x0, 3.46, -0.85])] },
    ...LADOS.map(([id, nombre, s]): Pieza => ({ id: `faro-${id}`, nombre: `Faro delantero · ${nombre}`, zona: "cabina", grupo: "luces",
      formas: [cajaLado(s, -9.45, CAB.x0, 0.9, 1.1, 0.72, 1.15)] })),
    ...LADOS.map(([id, nombre, s]): Pieza => ({ id: `direccional-del-${id}`, nombre: `Direccional delantera · ${nombre}`, zona: "cabina", grupo: "luces", codigos: [],
      formas: [cajaLado(s, -9.45, CAB.x0, 0.9, 1.1, 1.15, 1.25)] })),
    // ——— Motor, accesorios y transmisión (bajo la cabina) ———
    { id: "motor", nombre: "Motor (bloque, bajo la cabina)", zona: "motor", grupo: "motor", codigos: ["aceite"], formas: [caja([-9.0, 0.6, -0.34], [-7.4, CAB.y0, 0.34])] },
    { id: "radiador", nombre: "Radiador e intercooler", zona: "motor", grupo: "motor", codigos: [], formas: [caja([-9.25, 0.55, -0.6], [-9.0, CAB.y0, 0.6])] },
    { id: "filtro-aceite", nombre: "Filtro de aceite", zona: "motor", grupo: "motor", codigos: ["aceite"], formas: [cil([-8.45, 0.64, 0.41], 0.07, 0.24, "y")] },
    { id: "compresor-aire", nombre: "Compresor de aire", zona: "motor", grupo: "motor", codigos: [], formas: [cil([-8.1, 0.82, 0.44], 0.1, 0.3, "x")] },
    { id: "turbo", nombre: "Turbo", zona: "motor", grupo: "motor", codigos: [], formas: [cil([-7.9, 1.06, -0.45], 0.13, 0.22, "z")] },
    { id: "filtro-combustible", nombre: "Filtro de combustible", zona: "motor", grupo: "motor", codigos: [], formas: [cil([-7.95, 0.8, -0.53], 0.06, 0.22, "y")] },
    { id: "trampa-agua", nombre: "Trampa de agua (separador del combustible)", zona: "motor", grupo: "motor", codigos: [], formas: [cil([-7.72, 0.8, -0.53], 0.06, 0.22, "y")] },
    { id: "caja-cambios", nombre: "Caja de cambios y embrague", zona: "motor", grupo: "motor", codigos: [], formas: [caja([-7.4, 0.68, -0.25], [-6.5, 1.05, 0.25])] },
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
    // ——— Eléctrico ———
    { id: "alternador", nombre: "Alternador", zona: "motor", grupo: "electrico", codigos: [], formas: [cil([-8.7, 1.0, 0.44], 0.1, 0.25, "x")] },
    { id: "motor-arranque", nombre: "Motor de arranque", zona: "motor", grupo: "electrico", codigos: [], formas: [cil([-8.6, 0.7, -0.43], 0.09, 0.3, "x")] },
    { id: "caja-baterias", nombre: "Caja de baterías (lado derecho, tapa con peldaño)", zona: "bateria", grupo: "electrico", codigos: [], sistema: baterias,
      formas: [cajaLado(-1, -7.35, -6.5, 0.98, 1.08, 0.8, 1.25), cajaLado(-1, -7.35, -6.5, 0.62, 0.64, 0.8, 1.25), cajaLado(-1, -7.1, -6.8, 0.9, 1.0, RIEL.ze, 0.8)] },
    ...[[1, -7.3], [2, -6.9]].map(([n, x0]): Pieza => ({ id: `bateria-${n}`, nombre: `Batería ${n} (12 V)`, zona: "bateria", grupo: "electrico", codigos: ["bateria"], sistema: baterias,
      formas: [cajaLado(-1, x0!, x0! + 0.35, 0.64, 0.98, 0.85, 1.2)] })),
    // ——— Dirección ———
    { id: "caja-direccion", nombre: "Caja de dirección (hidráulica)", zona: "chasis", grupo: "direccion", codigos: [], sistema: direccion,
      formas: [cajaLado(1, -8.98, -8.72, 0.6, 0.88, RIEL.ze, 0.68)] },
    { id: "barra-direccion", nombre: "Barra de dirección (varilla de mando)", zona: "chasis", grupo: "direccion", codigos: [], sistema: direccion,
      formas: [cajaLado(1, -8.72, -8.1, 0.64, 0.7, 0.62, 0.68)] },
    ...LADOS.map(([id, nombre, s]): Pieza => ({ id: `munon-del-${id}`, nombre: `Muñón y pin de dirección · ${nombre}`, zona: "chasis", grupo: "direccion", codigos: [], sistema: direccion,
      formas: [cajaLado(s, -8.1, -7.8, 0.4, 0.7, 0.7, 0.84)] })),
    { id: "barra-acoplamiento", nombre: "Barra de acoplamiento y terminales de dirección", zona: "chasis", grupo: "direccion", codigos: [], sistema: direccion,
      formas: [cil([-7.77, 0.46, 0], 0.035, 1.5, "z")] },
    // ——— Chasis, tanques y aire ———
    { id: "chasis-tracto", nombre: "Chasis del tracto (largueros)", zona: "chasis", grupo: "chasis", codigos: [],
      formas: ambosLados(-9.25, x.finTracto, RIEL.y0, RIEL.y1, RIEL.zi, RIEL.ze) },
    { id: "travesanos-tracto", nombre: "Travesaños del chasis del tracto", zona: "chasis", grupo: "chasis", codigos: [],
      formas: [-6.2, -5.3, -2.5].map((xt) => caja([xt - 0.05, 0.84, -RIEL.zi], [xt + 0.05, 1.02, RIEL.zi])) },
    { id: "tanque-combustible", nombre: "Tanque de combustible (cilíndrico, detrás de la cabina)", zona: "tanque", grupo: "chasis",
      formas: [cil([-6.72, 1.55, 0], 0.38, 1.55, "z"), caja([-6.95, RIEL.y1, -RIEL.ze], [-6.5, 1.19, RIEL.ze])] },
    ...TANQUES_IZQ.map((xt, i): Pieza => ({ id: `tanque-aire-${i + 1}`, nombre: `Tanque de aire ${i + 1} (izquierdo)`, zona: "chasis", grupo: "chasis", codigos: [], sistema: aire,
      formas: [cil([xt, 0.8, 0.72], 0.12, 0.45, "z"), cajaLado(1, xt - 0.12, xt + 0.12, 0.9, 1.0, RIEL.ze, 0.5)] })),
    { id: "tanque-aire-4", nombre: "Tanque de aire 4 (grande, derecho)", zona: "chasis", grupo: "chasis", codigos: [], sistema: aire,
      formas: [cil([-5.95, 0.82, -0.72], 0.22, 0.9, "x"), cajaLado(-1, -6.05, -5.85, 0.9, 1.0, RIEL.ze, 0.5)] },
    { id: "secador-aire", nombre: "Secador de aire (con su filtro)", zona: "chasis", grupo: "chasis", codigos: [], sistema: aire,
      formas: [cil([-6.55, 0.52, 0.72], 0.1, 0.3, "y")] },
    { id: "soporte-mangueras", nombre: "Soporte de mangueras (detrás de la cabina)", zona: "chasis", grupo: "chasis", codigos: [], sistema: mangueras,
      formas: [caja([CAB.x1, 1.85, -0.35], [-6.9, 2.1, 0.35])] },
    ...([["manguera-servicio", "Manguera espiral de aire · servicio (amarilla)", -0.25], ["manguera-emergencia", "Manguera espiral de aire · emergencia (roja)", 0],
      ["cable-electrico", "Cable espiral eléctrico (luces del semirremolque)", 0.25]] as const).map(([id, nombre, z]): Pieza => ({
      id, nombre, zona: "chasis", grupo: "chasis", codigos: [], sistema: mangueras, formas: [cil([-6.9 + largoMangueras / 2, 1.98, z], 0.05, largoMangueras, "x")] })),
    { id: "estribo-bateria", nombre: "Estribo (peldaños) bajo la batería", zona: "chasis", grupo: "chasis", codigos: [],
      formas: [cajaLado(-1, -7.35, -6.5, 0.3, 0.35, 0.95, 1.3), cajaLado(-1, -7.35, -7.28, 0.35, 0.62, 1.15, 1.25), cajaLado(-1, -6.57, -6.5, 0.35, 0.62, 1.15, 1.25)] },
    { id: "quinta-rueda", nombre: "Quinta rueda (plato)", zona: "quinta", grupo: "chasis",
      formas: [cil([X.quinta, 1.17, 0], 0.5, 0.1, "y"), caja([X.quinta - 0.4, RIEL.y1, -RIEL.ze], [X.quinta + 0.4, 1.12, RIEL.ze])] },
    { id: "seguro-quinta", nombre: "Palanca y seguro (mandíbula) de la quinta rueda", zona: "quinta", grupo: "chasis", codigos: [],
      formas: [cajaLado(1, X.quinta - 0.08, X.quinta + 0.08, 1.1, 1.16, 0.5, 0.75)] },
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

const KING_PIN: Pieza = { id: "king-pin", nombre: "King pin (perno rey)", zona: "quinta", grupo: "semirremolque", codigos: [],
  formas: [cil([X.quinta, 1.14, 0], 0.05, 0.16, "y")] };
const LUCES_TRASERAS: Pieza[] = LADOS.map(([id, nombre, s]): Pieza => ({ id: `luz-tras-${id}`, nombre: `Luz trasera (stop y direccional) · ${nombre}`, zona: "caja", grupo: "luces",
  formas: [cajaLado(s, SR.x1, SR.x1 + 0.05, 1.08, 1.3, 0.8, 1.2)] }));
const LUZ_PLACA: Pieza = { id: "luz-placa", nombre: "Luz de placa trasera", zona: "caja", grupo: "luces", codigos: [], formas: [caja([SR.x1, 1.1, -0.15], [SR.x1 + 0.05, 1.2, 0.15])] };
const PLANCHA: Pieza = { id: "plancha-acople", nombre: "Plancha de acople", zona: "quinta", grupo: "semirremolque", codigos: [],
  formas: [caja([SR.x0, 1.22, -1.25], [-2.6, SR.piso, 1.25])] };
const CHASIS_SR: Pieza = { id: "chasis-semirremolque", nombre: "Chasis del semirremolque (vigas)", zona: "chasis", grupo: "semirremolque", codigos: [],
  formas: ambosLados(-2.6, SR.x1, VIGA.y0, SR.piso, VIGA.zi, VIGA.ze) };
const TRAVESANOS_SR: Pieza = { id: "travesanos-semirremolque", nombre: "Travesaños del semirremolque", zona: "chasis", grupo: "semirremolque", codigos: [],
  formas: [0.5, 3.0, 5.45].map((xt) => caja([xt - 0.06, 1.1, -VIGA.zi], [xt + 0.06, 1.25, VIGA.zi])) };
const MARCO: Pieza = { id: "marco-trasero", nombre: "Marco trasero", zona: "caja", grupo: "semirremolque", formas: [caja([SR.x1 - 0.1, VIGA.y0, -SR.z], [SR.x1, SR.piso, SR.z])] };
const PARACHOQUES_TRAS: Pieza = { id: "parachoques-tras", nombre: "Parachoques trasero (antiempotramiento)", zona: "caja", grupo: "semirremolque",
  formas: [caja([8.55, 0.45, -1.15], [8.68, 0.6, 1.15]), ...ambosLados(8.56, 8.66, 0.6, VIGA.y0, VIGA.zi, VIGA.ze)] };
const patas = (arriba: number): Pieza[] => {
  const sistema = conjunto("patas-apoyo", "Patas de apoyo (landing gear)", "semirremolque", "chasis");
  const ym = Math.min(0.7, arriba - 0.1);
  return [
    ...LADOS.map(([id, nombre, s]): Pieza => ({ id: `pata-apoyo-${id}`, nombre: `Pata de apoyo · ${nombre}`, zona: "chasis", grupo: "semirremolque", codigos: [], sistema,
      formas: [cajaLado(s, PATAS_X - 0.08, PATAS_X + 0.08, 0.12, arriba, VIGA.zi, VIGA.ze), cajaLado(s, PATAS_X - 0.2, PATAS_X + 0.2, 0.06, 0.12, VIGA.zi - 0.06, VIGA.ze + 0.06)] })),
    { id: "manivela-patas", nombre: "Manivela y caja de engranajes de las patas", zona: "chasis", grupo: "semirremolque", codigos: [], sistema,
      formas: [cajaLado(-1, PATAS_X - 0.03, PATAS_X + 0.03, ym, ym + 0.05, VIGA.ze, VIGA.ze + 0.35), cajaLado(-1, PATAS_X - 0.03, PATAS_X + 0.2, ym, ym + 0.05, VIGA.ze + 0.32, VIGA.ze + 0.36)] },
  ];
};
const DEFENSAS: Pieza[] = LADOS.map(([id, nombre, s]): Pieza => ({ id: `defensa-lateral-${id}`, nombre: `Defensa lateral · ${nombre}`, zona: "caja", grupo: "semirremolque",
  formas: [cajaLado(s, -0.8, 4.0, 0.55, 0.85, SR.z - 0.04, SR.z), cajaLado(s, -0.7, -0.55, 0.85, SR.piso, SR.z - 0.1, SR.z), cajaLado(s, 3.75, 3.9, 0.85, SR.piso, SR.z - 0.1, SR.z)] }));
const LODERAS: Pieza[] = LADOS.map(([id, nombre, s]): Pieza => ({ id: `lodera-${id}`, nombre: `Lodera del semirremolque · ${nombre}`, zona: "caja", grupo: "semirremolque",
  formas: [cajaLado(s, 8.05, 8.09, 0.25, VIGA.y0, 0.7, SR.z), cajaLado(s, 8.05, 8.09, 0.9, VIGA.y0, VIGA.ze, 0.7)] }));
const REPUESTO: Pieza = { id: "llanta-repuesto", nombre: "Llanta de repuesto", zona: "llantas_sr", grupo: "llantas", formas: [cil([1.8, 0.8, 0], 0.5, 0.27, "y")] };
const PORTA_LLANTA: Pieza = { id: "porta-llanta", nombre: "Porta llanta de repuesto (canastilla)", zona: "chasis", grupo: "semirremolque", codigos: [],
  formas: [caja([1.2, 0.935, -VIGA.ze], [2.4, VIGA.y0, VIGA.ze])] };
const AIRE_SR: Pieza[] = [
  { id: "tanque-aire-sr", nombre: "Tanque de aire del semirremolque", zona: "chasis", grupo: "semirremolque", codigos: [], formas: [cil([3.3, 0.8, 0], 0.2, 0.84, "z")] },
  { id: "valvula-rele-sr", nombre: "Válvula relé de frenos del semirremolque", zona: "llantas_sr", grupo: "frenos", codigos: [], formas: [caja([5.35, 0.95, -0.15], [5.55, 1.1, 0.15])] },
];
const CAJA_HERRAMIENTAS: Pieza = { id: "caja-herramientas", nombre: "Caja de herramientas (lado derecho)", zona: "caja", grupo: "semirremolque", codigos: [],
  formas: [cajaLado(-1, 0.1, 0.9, 0.55, VIGA.y0, 0.6, 1.2), cajaLado(-1, 0.4, 0.6, 0.9, VIGA.y0, VIGA.ze, 0.6)] };
/** Luces de gálibo a lo largo del costado (en la baranda o en la pared del furgón). */
const lucesLaterales = (y0: number, z0: number): Pieza[] => LADOS.map(([id, nombre, s]): Pieza => ({
  id: `luces-laterales-${id}`, nombre: `Luces laterales de gálibo y reflectivos · ${nombre}`, zona: "caja", grupo: "luces", codigos: [],
  formas: [-3.5, -0.5, 2.5, 5.5, 8.2].map((xl) => cajaLado(s, xl - 0.06, xl + 0.06, y0, y0 + 0.08, z0, z0 + 0.03)) }));

function carroceria(tipo: TipoSemirremolque): Pieza[] {
  if (tipo === "furgon") {
    return [
      { id: "caja-frente", nombre: "Furgón · pared delantera", zona: "caja", grupo: "semirremolque", formas: [caja([SR.x0, SR.piso, -SR.z], [SR.x0 + 0.04, SR.techo, SR.z])] },
      ...LADOS.map(([id, nombre, s]): Pieza => ({ id: `caja-lateral-${id}`, nombre: `Furgón · lateral ${nombre}`, zona: "caja", grupo: "semirremolque",
        formas: [cajaLado(s, SR.x0, SR.x1, SR.piso, SR.techo, SR.z - 0.02, SR.z)] })),
      { id: "caja-techo", nombre: "Furgón · techo", zona: "caja", grupo: "semirremolque", formas: [caja([SR.x0, SR.techo - 0.02, -SR.z], [SR.x1, SR.techo, SR.z])] },
      ...LADOS.map(([id, nombre, s]): Pieza => ({ id: `puerta-tras-${id}`, nombre: `Puerta trasera · ${nombre}`, zona: "caja", grupo: "semirremolque",
        formas: [cajaLado(s, SR.x1, SR.x1 + 0.03, SR.piso + 0.02, SR.techo - 0.04, 0.01, SR.z - 0.02)] })),
      ...lucesLaterales(SR.piso + 0.05, SR.z),
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
      ...LADOS.map(([id, nombre, s]): Pieza => ({ id: `estacas-${id}`, nombre: `Plataforma · estacas de madera y baranda ${nombre}`, zona: "caja", grupo: "semirremolque", formas: estacas(s) })),
      ...LADOS.map(([id, nombre, s]): Pieza => ({ id: `ganchos-amarre-${id}`, nombre: `Plataforma · ganchos y winchas de amarre ${nombre}`, zona: "caja", grupo: "semirremolque", codigos: [],
        formas: [
          ...[-3.6, -2.4, -1.2, 0, 1.2, 2.4, 3.6, 4.8, 6.0, 7.2].map((xg) => cajaLado(s, xg - 0.05, xg + 0.05, SR.piso - 0.2, SR.piso - 0.12, SR.z - 0.03, SR.z + 0.03)),
          ...[-2.0, 1.8].map((xw) => cil([xw, SR.piso - 0.18, s * (SR.z - 0.06)], 0.06, 0.14, "z")),
        ] })),
      ...lucesLaterales(SR.piso - 0.1, SR.z + 0.04),
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
        formas: [caja([SR.x0, 1.22, -1.25], [-2.4, 1.62, 1.25]), caja([-2.4, 0.55, -1.25], [-2.1, 1.62, 1.25])] },
      KING_PIN,
      { id: "cama-chasis-trasero", nombre: "Cama baja · chasis y plataforma sobre los ejes", zona: "chasis", grupo: "semirremolque", codigos: [],
        formas: [...ambosLados(4.3, SR.x1, VIGA.y0, SR.piso, VIGA.zi, VIGA.ze), caja([4.0, 0.55, -SR.z], [4.3, SR.piso + 0.08, SR.z]), caja([4.3, SR.piso, -SR.z], [SR.x1, SR.piso + 0.08, SR.z])] },
      ...patas(0.55), MARCO, PARACHOQUES_TRAS, ...LODERAS, ...LUCES_TRASERAS, LUZ_PLACA,
    ]
    : [PLANCHA, KING_PIN, CHASIS_SR, TRAVESANOS_SR, ...patas(VIGA.y0), MARCO, PARACHOQUES_TRAS, ...DEFENSAS, ...LODERAS, REPUESTO, PORTA_LLANTA,
      ...AIRE_SR, CAJA_HERRAMIENTAS, ...LUCES_TRASERAS, LUZ_PLACA];
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

/**
 * Los conjuntos de unas piezas (frenos de un eje, suspensión, baterías…): se eligen enteros en
 * el visor, guardan su propio historial y su forma es la de todas sus piezas. Sus códigos de
 * parte son los de sus piezas, o se deducen de su zona si alguna los deduce.
 */
export function conjuntosDe(piezas: Pieza[]): Conjunto[] {
  const hijos = new Map<string, Pieza[]>();
  for (const p of piezas) if (p.sistema) hijos.set(p.sistema, [...(hijos.get(p.sistema) ?? []), p]);
  return [...hijos].map(([id, hs]) => {
    const meta = CONJUNTOS.get(id)!;
    return {
      id, ...meta, hijos: hs.map((h) => h.id), formas: hs.flatMap((h) => h.formas),
      ...(hs.every((h) => h.codigos) ? { codigos: [...new Set(hs.flatMap((h) => h.codigos!))] } : {}),
    };
  });
}

/** Todos los conjuntos posibles (de cualquier combinación de tracción y semirremolque). */
export const CONJUNTOS_PIEZAS: Conjunto[] = conjuntosDe(PIEZAS);

const PORID = new Map<string, Pieza>([...PIEZAS, ...CONJUNTOS_PIEZAS].map((p) => [p.id, p]));

/** Una pieza o un conjunto por su código. */
export function pieza(id: string | null | undefined): Pieza | null {
  return (id && PORID.get(id)) || null;
}

export function nombrePieza(id: string | null | undefined): string | null {
  return pieza(id)?.nombre ?? null;
}

/** ¿Es un conjunto (frenos de un eje, una suspensión…)? */
export const esConjunto = (id: string | null | undefined): boolean => !!id && CONJUNTOS.has(id);

/**
 * Lista para elegir una pieza, por grupo: cada conjunto seguido de sus piezas (sangradas) y
 * luego las piezas sueltas. Sirve para los selectores y la lista completa del visor.
 */
export function listaDePiezas(piezas: Pieza[] = PIEZAS): Array<{ grupo: GrupoPieza; nombre: string; items: Array<{ id: string; nombre: string; nivel: 0 | 1 }> }> {
  const conjuntos = conjuntosDe(piezas);
  const porId = new Map(piezas.map((p) => [p.id, p]));
  return (Object.keys(GRUPOS_PIEZA) as GrupoPieza[]).map((g) => {
    const items: Array<{ id: string; nombre: string; nivel: 0 | 1 }> = [];
    for (const c of conjuntos.filter((x) => x.grupo === g)) {
      items.push({ id: c.id, nombre: `${c.nombre} (conjunto)`, nivel: 0 });
      for (const h of c.hijos) items.push({ id: h, nombre: porId.get(h)!.nombre, nivel: 1 });
    }
    for (const p of piezas.filter((x) => x.grupo === g && !x.sistema)) items.push({ id: p.id, nombre: p.nombre, nivel: 0 });
    return { grupo: g, nombre: GRUPOS_PIEZA[g], items };
  }).filter((x) => x.items.length);
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
