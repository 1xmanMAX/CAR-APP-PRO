/**
 * Lógica de desgaste de las partes (handoff §5). Todo aquí es puro: recibe los contadores ya
 * calculados y devuelve el % de desgaste, el estado, el contador que "manda" y lo que queda.
 */

export type EstadoDesgaste = "ok" | "proximo" | "cambiar";
export type Contador = "km" | "viajes" | "dias";

export interface Vida {
  km: number | null;
  viajes: number | null;
  dias: number | null;
}

export interface Uso {
  km: number;
  viajes: number;
  dias: number;
}

export interface ResultadoDesgaste {
  /** Desgaste en %, redondeado; puede pasar de 100 si la parte ya se pasó de su vida útil. */
  pct: number;
  estado: EstadoDesgaste;
  /** El contador con el ratio mayor: el que se cumple primero. null si la parte no tiene vida útil. */
  manda: Contador | null;
  ratios: { km: number | null; viajes: number | null; dias: number | null };
  /** Viajes restantes estimados; null si no se puede estimar en viajes (solo vida en días o sin viajes). */
  viajesRestantes: number | null;
  /** Días restantes (solo si tiene vida en días). */
  diasRestantes: number | null;
  /** Texto corto: "2 VIAJES" o "45 DÍAS". */
  restanteTexto: string;
}

export const UMBRAL_PROXIMO = 70;
export const UMBRAL_CAMBIAR = 90;

export function estadoDe(pct: number): EstadoDesgaste {
  return pct >= UMBRAL_CAMBIAR ? "cambiar" : pct >= UMBRAL_PROXIMO ? "proximo" : "ok";
}

function ratio(uso: number, vida: number | null): number | null {
  if (vida === null || vida <= 0) return null;
  return Math.max(0, uso) / vida;
}

/**
 * @param promedioKmPorViaje km por viaje histórico del trailer, para estimar cuando la parte
 *   todavía no tiene viajes propios (recién instalada).
 * @param promedioDiasPorViaje ídem en días.
 */
export function calcularDesgaste(
  vida: Vida,
  uso: Uso,
  promedios: { kmPorViaje?: number | null; diasPorViaje?: number | null } = {},
): ResultadoDesgaste {
  const ratios = { km: ratio(uso.km, vida.km), viajes: ratio(uso.viajes, vida.viajes), dias: ratio(uso.dias, vida.dias) };
  let manda: Contador | null = null;
  let mayor = -1;
  for (const c of ["viajes", "km", "dias"] as const) {
    const r = ratios[c];
    if (r !== null && r > mayor) {
      mayor = r;
      manda = c;
    }
  }
  const pct = manda === null ? 0 : Math.round(mayor * 100);

  const kmPorViaje = uso.viajes > 0 ? uso.km / uso.viajes : (promedios.kmPorViaje ?? null);
  const diasPorViaje = uso.viajes > 0 ? uso.dias / uso.viajes : (promedios.diasPorViaje ?? null);
  const candidatos: number[] = [];
  if (vida.viajes !== null) candidatos.push(vida.viajes - uso.viajes);
  if (vida.km !== null && kmPorViaje && kmPorViaje > 0) candidatos.push(Math.floor((vida.km - uso.km) / kmPorViaje));
  if (vida.dias !== null && diasPorViaje && diasPorViaje > 0) candidatos.push(Math.floor((vida.dias - uso.dias) / diasPorViaje));
  const soloDias = vida.viajes === null && vida.km === null;
  const viajesRestantes = soloDias || candidatos.length === 0 ? null : Math.max(0, Math.min(...candidatos));
  const diasRestantes = vida.dias !== null ? Math.max(0, vida.dias - uso.dias) : null;

  const restanteTexto = viajesRestantes !== null
    ? `${viajesRestantes} ${viajesRestantes === 1 ? "VIAJE" : "VIAJES"}`
    : diasRestantes !== null
      ? `${diasRestantes} ${diasRestantes === 1 ? "DÍA" : "DÍAS"}`
      : "—";

  return { pct, estado: estadoDe(pct), manda, ratios, viajesRestantes, diasRestantes, restanteTexto };
}

/** Diferencia en días entre dos fechas YYYY-MM-DD (b - a). */
export function diasEntre(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.floor(ms / 86_400_000);
}

/** Etiqueta del panel "¿Se cambió a tiempo?" (meta 80–95%). */
export function etiquetaCambio(pct: number): "MUY PRONTO" | "A TIEMPO" | "TARDE" {
  return pct < 80 ? "MUY PRONTO" : pct <= 100 ? "A TIEMPO" : "TARDE";
}
