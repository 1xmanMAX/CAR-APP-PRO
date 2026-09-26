import type { Categoria, EntradaLectura, Lectura, ProveedorIA } from "./tipos";

/**
 * **Lector por reglas**, sin internet ni costo: entiende textos como «grifo 350» o «yape 500». Es
 * el que se usa sin clave de IA (las fotos sin texto se preguntan) y el de las pruebas.
 */
const REGLAS: Array<[RegExp, Categoria]> = [
  [/\b(grifo|petroleo|diesel|combustible|gasolina|galones?)\b/, "combustible"],
  [/\bpeajes?\b/, "peaje"],
  [/\b(almuerzo|desayuno|cena|comida|menu|viaticos?)\b/, "viaticos"],
  [/\b(hotel|hospedaje|alojamiento)\b/, "hospedaje"],
  [/\b(estiba|estibadores?|descarga|carga)\b/, "estiba"],
  [/\b(balanza|pesaje)\b/, "balanza"],
  [/\b(cochera|parqueo|estacionamiento)\b/, "cochera"],
  [/\b(llantas?|mecanico|reparacion|repuestos?|taller|parchado)\b/, "reparacion"],
];

const normal = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** El primer monto del texto: «350», «S/ 28.50», «1,250.00». */
export function montoDe(texto: string): number | null {
  const m = /(?:s\/\.?\s*)?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:[.,]\d{1,2})?)/i.exec(texto);
  if (!m) return null;
  const s = m[1]!.includes(",") && /,\d{3}/.test(m[1]!) ? m[1]!.replace(/,/g, "") : m[1]!.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function leerPorReglas(e: EntradaLectura): Lectura {
  const anterior = e.contexto.lecturaAnterior;
  // Corrección: «eran 305» cambia el monto de la lectura anterior.
  const ultima = e.contexto.correcciones.at(-1);
  if (anterior && ultima && (anterior.tipo === "gasto" || anterior.tipo === "entrega")) {
    const monto = montoDe(ultima);
    const cat = REGLAS.find(([re]) => re.test(normal(ultima)))?.[1];
    return { ...anterior, ...(monto ? { monto } : {}), ...(cat && anterior.tipo === "gasto" ? { categoria: cat } : {}) };
  }
  const t = normal(e.texto ?? "");
  if (!t.trim()) return e.imagenes?.length ? { tipo: "otro", descripcion: "imagen" } : { tipo: "no_entendi", motivo: "mensaje vacío" };
  const monto = montoDe(t);
  if (monto === null) return { tipo: "no_entendi", motivo: "no encontré el monto" };
  if (/\b(yape|plin|deposito|transferencia|me dieron|adelanto|me yapearon)\b/.test(t)) {
    const medio = /\b(yape|plin|me yapearon)\b/.test(t) ? "yape" : /\b(deposito|transferencia)\b/.test(t) ? "transferencia" : "efectivo";
    return { tipo: "entrega", monto, medio, fecha: null, dudas: [] };
  }
  const regla = REGLAS.find(([re]) => re.test(t));
  if (!regla) return { tipo: "no_entendi", motivo: "no sé de qué es el gasto" };
  const cat = regla[1];
  // La nota es lo que queda sin el monto; si solo quedaba la palabra de la categoría, no hay nota.
  let nota = (e.texto ?? "").replace(/(?:s\/\.?\s*)?\d[\d.,]*/i, "").replace(/\s+/g, " ").trim();
  if (!normal(nota).replace(regla[0], "").trim()) nota = "";
  return { tipo: "gasto", categoria: cat, monto, fecha: null, proveedorRuc: null, proveedorNombre: null, comprobante: null, nota: nota || null, dudas: [] };
}

export function crearLectorReglas(): ProveedorIA {
  return {
    nombre: "reglas",
    leeImagenes: false,
    async leer(e) {
      return { lectura: leerPorReglas(e), uso: { proveedor: "reglas", modelo: "reglas", tokensEntrada: 0, tokensCache: 0, tokensSalida: 0, costoMicroUsd: 0 } };
    },
  };
}
