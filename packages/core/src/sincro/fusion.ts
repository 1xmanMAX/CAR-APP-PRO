import { TABLA } from "./registro";
import type { Fila } from "./filas";

/**
 * **Juntar dos versiones de un registro sin que ninguna mande** (portado de PixPin, `sincro/Fusion.kt`).
 *
 * Fusión a tres bandas campo por campo, como Figma propiedad por propiedad: si en un celular se
 * corrigió el flete de un viaje y en otro su tonelaje, quedan los dos cambios. Solo choca el mismo
 * campo cambiado en los dos; entonces gana **el último cambio**, con la hora del otro corregida por el
 * desfase de reloj medido al conectar. Los valores que solo crecen (el odómetro) se quedan con el mayor.
 */
export interface CuentaFusion {
  choques: number;
}

const ORIGEN = new Set(["sinc_disp", "sinc_num", "sinc_creado"]);
const igual = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function fusionarFila(base: Fila["d"] | null, mia: Fila, suya: Fila, desfase: number, cuenta: CuentaFusion = { choques: 0 }): Fila {
  const maximos = new Set(TABLA.get(mia.t)?.maximo ?? []);
  const suHora = suya.k - desfase;
  const ganaMia = mia.k >= suHora;
  const d: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(mia.d), ...Object.keys(suya.d)])) {
    if (ORIGEN.has(k)) continue;
    const m = mia.d[k];
    const s = suya.d[k];
    const b = base ? base[k] : undefined;
    if (igual(m, s)) d[k] = m;
    else if (base && igual(m, b)) d[k] = s;
    else if (base && igual(s, b)) d[k] = m;
    else if (maximos.has(k) && typeof m === "number" && typeof s === "number") d[k] = Math.max(m, s);
    else {
      cuenta.choques++;
      d[k] = ganaMia ? m : s;
    }
  }
  // Los códigos de origen no cambian nunca: si difieren, se quedan los del que tiene dispositivo de
  // origen (y si los dos tienen, los del más antiguo).
  const origenMio = mia.d.sinc_disp != null && (suya.d.sinc_disp == null || Number(mia.d.sinc_creado ?? 0) <= Number(suya.d.sinc_creado ?? 0));
  for (const k of ORIGEN) d[k] = origenMio ? mia.d[k] : suya.d[k];
  // Una fila hecha de las dos es más nueva que las dos.
  const k = igual(d, mia.d) ? mia.k : igual(d, suya.d) ? suya.k : Math.max(mia.k, suHora) + 1;
  return { t: mia.t, u: mia.u, k, d };
}
