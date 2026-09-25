import type { Apunte } from "./filas";

/**
 * **Qué hay que hacer para que dos dispositivos queden iguales** (portado de PixPin,
 * `sincro/Diferencia.kt`). Es una función pura: todas las decisiones difíciles se prueban sin red.
 *
 * [base] es lo acordado la última vez con ese dispositivo (clave → resumen). Con ella se sabe quién
 * se movió: el que difiere de la base.
 *
 * - Cambió en un solo lado: pasa al otro.
 * - Cambió en los dos (o nunca se acordó nada y son distintos): **se fusiona**, campo por campo.
 * - Borrado en un lado y **sin tocar** en el otro: se borra en los dos.
 * - Borrado en un lado y **cambiado** en el otro (o sin base con que saberlo): se queda lo cambiado.
 */
export type Paso = { tipo: "traer" | "mandar" | "fusionar"; c: string };

export function planificar(mio: Apunte[], suyo: Apunte[], base: Map<string, string> = new Map()): Paso[] {
  const aqui = new Map(mio.map((a) => [a.c, a]));
  const alli = new Map(suyo.map((a) => [a.c, a]));
  const pasos: Paso[] = [];
  for (const c of [...new Set([...aqui.keys(), ...alli.keys()])].sort()) {
    const a = aqui.get(c);
    const b = alli.get(c);
    if (!a) {
      // Solo él lo tiene; si es una marca de borrado no hay nada que traer.
      if (b && !b.b) pasos.push({ tipo: "traer", c });
      continue;
    }
    if (!b) {
      // Solo yo: se lo mando, borrado incluido (la marca también viaja, o me lo devolvería).
      pasos.push({ tipo: "mandar", c });
      continue;
    }
    if (a.b && b.b) continue;
    if (!a.b && !b.b && a.h === b.h) continue;
    pasos.push(queHacerConLosDos(c, a, b, base.get(c)));
  }
  return pasos;
}

function queHacerConLosDos(c: string, a: Apunte, b: Apunte, base: string | undefined): Paso {
  if (!!a.b !== !!b.b) {
    const vivoEsMio = !!b.b;
    const vivo = vivoEsMio ? a : b;
    // Lo modificado gana a lo borrado; sin base no se sabe si se tocó: se conserva.
    const tocado = base === undefined || vivo.h !== base;
    if (tocado) return { tipo: vivoEsMio ? "mandar" : "traer", c };
    return { tipo: vivoEsMio ? "traer" : "mandar", c };
  }
  if (base === undefined) return { tipo: "fusionar", c };
  const yoMeMovi = a.h !== base;
  const elSeMovio = b.h !== base;
  if (!yoMeMovi && elSeMovio) return { tipo: "traer", c };
  if (yoMeMovi && !elSeMovio) return { tipo: "mandar", c };
  return { tipo: "fusionar", c };
}
