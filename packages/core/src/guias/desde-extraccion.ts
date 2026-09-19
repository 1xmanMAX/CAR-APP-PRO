import { existeUbigeo } from "../dominio/ubigeos";
import { tipoDocumentoDe } from "../dominio/validaciones";
import { ErrorValidacion } from "../errores";
import type { TransporteGuia } from "../transporte/transporte";
import type { GuiaCompleta } from "./cargar";
import { validarEntradaGuia, type EntradaGuia } from "./validar";

/**
 * Puente entre lo que leyó el extractor y una EntradaGuia válida. El paquete extractor no se
 * importa aquí: se declara el mínimo que este módulo necesita (tipo estructural), así el núcleo
 * sigue sin depender de quién hizo la lectura (reglas hoy, IA mañana).
 *
 * Regla de oro: solo se da por bueno un campo leído con confianza "segura" Y válido; todo lo demás
 * entra en `faltantes` para preguntárselo al dueño. Nunca se adivina un dato que va a SUNAT.
 */

export interface CampoExtraido<T> {
  valor: T | null;
  confianza: "segura" | "dudosa";
}

export interface GuiaExtraidaMinima {
  serieNumero: CampoExtraido<string>;
  remitente: CampoExtraido<{ numeroDoc: string; razonSocial: string }>;
  destinatario: CampoExtraido<{ numeroDoc: string; razonSocial: string }>;
  partida: CampoExtraido<{ direccion: string; ubigeo: string }>;
  llegada: CampoExtraido<{ direccion: string; ubigeo: string }>;
  fechaTraslado: CampoExtraido<string>;
  pesoBruto: CampoExtraido<string>;
  unidadPeso: CampoExtraido<"KGM" | "TNE">;
  items: CampoExtraido<Array<{ descripcion: string; cantidad: string; unidadMedida: string }>>;
}

export const ORDEN_CAMPOS = [
  "serieNumero",
  "remitente",
  "destinatario",
  "partida",
  "llegada",
  "fechaTraslado",
  "pesoBruto",
  "unidadPeso",
  "items",
] as const;

export type CampoGuia = (typeof ORDEN_CAMPOS)[number];

/** Nombres cortos para los botones de "Corregir" y para los mensajes de error. */
export const ETIQUETAS_CAMPO: Record<CampoGuia, string> = {
  serieNumero: "GRE remitente",
  remitente: "Remitente",
  destinatario: "Destinatario",
  partida: "Partida",
  llegada: "Llegada",
  fechaTraslado: "Fecha",
  pesoBruto: "Peso",
  unidadPeso: "Unidad",
  items: "Bienes",
};

export interface Parte {
  numeroDoc: string;
  razonSocial: string;
}

export interface Lugar {
  direccion: string;
  ubigeo: string;
}

export interface ItemGuia {
  descripcion: string;
  cantidad: string;
  unidadMedida: string;
}

export interface Borrador {
  fechaTraslado: string | null;
  remitente: Parte | null;
  destinatario: Parte | null;
  partida: Lugar | null;
  llegada: Lugar | null;
  pesoBruto: string | null;
  unidadPeso: "KGM" | "TNE" | null;
  greRemitenteRef: string | null;
  items: ItemGuia[] | null;
  /** Campos en null, dudosos o inválidos, siempre en el orden de ORDEN_CAMPOS. */
  faltantes: CampoGuia[];
}

export const UNIDADES_MEDIDA = ["BLS", "NIU", "KGM", "TNE", "BX", "ZZ", "MTR", "LTR", "GLN"] as const;

const RE_SERIE = /^[A-Z0-9]{4}-\d{1,8}$/;
const RE_FECHA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const RE_FECHA_LOCAL = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const RE_PESO = /^\d+(?:[.,]\d+)?$/;
const RE_PARTE = /^(\d{8}|\d{11})\s+(.+)$/;
const RE_ITEM = /^(.+?)\s+(\d+(?:[.,]\d+)?)\s+([A-Za-z]{2,4})$/;

export const ERRORES_CAMPO: Record<CampoGuia, string> = {
  serieNumero: "Escríbela así: EG07-5531",
  remitente: "Escribe el RUC y la razón social así: 20131312955 DISTRIBUIDORA SAC",
  destinatario: "Escribe el RUC y la razón social así: 20131312955 DISTRIBUIDORA SAC",
  partida: "Escribe la dirección del punto de partida.",
  llegada: "Escribe la dirección del punto de llegada.",
  fechaTraslado: "Escribe la fecha así: 14/09/2026",
  pesoBruto: "Escribe el peso así: 31.87",
  unidadPeso: "Elige KGM o TNE con los botones.",
  items: "Escribe el bien así: CEMENTO 750 BLS",
};

function parteValida(p: Parte | null): boolean {
  return p !== null && tipoDocumentoDe(p.numeroDoc) !== null && p.razonSocial.trim() !== "";
}

function lugarValido(l: Lugar | null): boolean {
  return l !== null && l.direccion.trim() !== "" && existeUbigeo(l.ubigeo);
}

function fechaValida(f: string | null): boolean {
  return f !== null && RE_FECHA_ISO.test(f) && !Number.isNaN(Date.parse(f));
}

function itemsValidos(items: ItemGuia[] | null): boolean {
  return (
    items !== null &&
    items.length > 0 &&
    items.every(
      (it) =>
        it.descripcion.trim() !== "" &&
        Number(it.cantidad) > 0 &&
        (UNIDADES_MEDIDA as readonly string[]).includes(it.unidadMedida),
    )
  );
}

/** Un campo está listo si su valor actual del borrador es utilizable tal cual. */
function campoListo(b: Borrador, campo: CampoGuia): boolean {
  switch (campo) {
    case "serieNumero":
      return b.greRemitenteRef !== null && RE_SERIE.test(b.greRemitenteRef);
    case "remitente":
      return parteValida(b.remitente);
    case "destinatario":
      return parteValida(b.destinatario);
    case "partida":
      return lugarValido(b.partida);
    case "llegada":
      return lugarValido(b.llegada);
    case "fechaTraslado":
      return fechaValida(b.fechaTraslado);
    case "pesoBruto":
      return b.pesoBruto !== null && Number(b.pesoBruto) > 0;
    case "unidadPeso":
      return b.unidadPeso === "KGM" || b.unidadPeso === "TNE";
    case "items":
      return itemsValidos(b.items);
  }
}

/** Recalcula `faltantes` sobre los valores actuales, siempre en el orden de ORDEN_CAMPOS. */
function conFaltantes(b: Omit<Borrador, "faltantes">): Borrador {
  const parcial: Borrador = { ...b, faltantes: [] };
  return { ...parcial, faltantes: ORDEN_CAMPOS.filter((c) => !campoListo(parcial, c)) };
}

/** Solo sobrevive lo leído con confianza "segura": lo dudoso se vuelve a preguntar. */
function tomar<T>(c: CampoExtraido<T>): T | null {
  return c.confianza === "segura" ? c.valor : null;
}

export function borradorDesdeExtraccion(g: GuiaExtraidaMinima): Borrador {
  const b = conFaltantes({
    fechaTraslado: tomar(g.fechaTraslado),
    remitente: tomar(g.remitente),
    destinatario: tomar(g.destinatario),
    partida: tomar(g.partida),
    llegada: tomar(g.llegada),
    pesoBruto: tomar(g.pesoBruto),
    unidadPeso: tomar(g.unidadPeso),
    greRemitenteRef: tomar(g.serieNumero),
    items: tomar(g.items),
  });
  // Un valor inválido no se conserva a medias: se borra para que el resumen nunca lo muestre.
  return limpiarFaltantes(b);
}

function limpiarFaltantes(b: Borrador): Borrador {
  const limpio = { ...b };
  for (const campo of b.faltantes) {
    if (campo === "serieNumero") limpio.greRemitenteRef = null;
    else if (campo === "items") limpio.items = null;
    else limpio[campo] = null as never;
  }
  return limpio;
}

function normalizarFecha(texto: string): string | null {
  const t = texto.trim();
  const local = RE_FECHA_LOCAL.exec(t);
  const iso = local
    ? `${local[3]}-${local[2]!.padStart(2, "0")}-${local[1]!.padStart(2, "0")}`
    : RE_FECHA_ISO.test(t)
      ? t
      : null;
  if (iso === null || !fechaValida(iso)) return null;
  // Date.parse acepta "2026-02-31" corriendo el día: se comprueba que el ida y vuelta coincida.
  return new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso ? iso : null;
}

function normalizarItem(texto: string): ItemGuia | null {
  const m = RE_ITEM.exec(texto.trim());
  if (!m) return null;
  const unidadBruta = m[3]!.toUpperCase();
  const unidadMedida = unidadBruta === "UND" ? "NIU" : unidadBruta;
  if (!(UNIDADES_MEDIDA as readonly string[]).includes(unidadMedida)) return null;
  const cantidad = m[2]!.replace(",", ".");
  if (!(Number(cantidad) > 0)) return null;
  const descripcion = m[1]!.trim();
  if (!descripcion) return null;
  return { descripcion, cantidad, unidadMedida };
}

/**
 * Aplica lo que escribió el dueño para un campo. Si el texto no se entiende, devuelve el borrador
 * intacto y el mensaje de error que el bot repite tal cual (y el campo sigue pendiente).
 */
export function aplicarRespuesta(
  b: Borrador,
  campo: Exclude<CampoGuia, "partida" | "llegada">,
  texto: string,
): { borrador: Borrador; error?: string } {
  const t = texto.trim();
  const sinCampo = { ...b } as Borrador;
  switch (campo) {
    case "serieNumero": {
      const serie = t.toUpperCase();
      if (!RE_SERIE.test(serie)) return { borrador: b, error: ERRORES_CAMPO.serieNumero };
      sinCampo.greRemitenteRef = serie;
      break;
    }
    case "fechaTraslado": {
      const fecha = normalizarFecha(t);
      if (fecha === null) return { borrador: b, error: ERRORES_CAMPO.fechaTraslado };
      sinCampo.fechaTraslado = fecha;
      break;
    }
    case "pesoBruto": {
      if (!RE_PESO.test(t)) return { borrador: b, error: ERRORES_CAMPO.pesoBruto };
      const peso = t.replace(",", ".");
      if (!(Number(peso) > 0)) return { borrador: b, error: ERRORES_CAMPO.pesoBruto };
      sinCampo.pesoBruto = peso;
      break;
    }
    case "unidadPeso": {
      const unidad = t.toUpperCase();
      if (unidad !== "KGM" && unidad !== "TNE") return { borrador: b, error: ERRORES_CAMPO.unidadPeso };
      sinCampo.unidadPeso = unidad;
      break;
    }
    case "remitente":
    case "destinatario": {
      const m = RE_PARTE.exec(t);
      if (!m || tipoDocumentoDe(m[1]!) === null || !m[2]!.trim()) {
        return { borrador: b, error: ERRORES_CAMPO[campo] };
      }
      sinCampo[campo] = { numeroDoc: m[1]!, razonSocial: m[2]!.trim() };
      break;
    }
    case "items": {
      const item = normalizarItem(t);
      if (!item) return { borrador: b, error: ERRORES_CAMPO.items };
      sinCampo.items = [item];
      break;
    }
  }
  return { borrador: conFaltantes(sinCampo) };
}

export function aplicarLugar(b: Borrador, campo: "partida" | "llegada", direccion: string, ubigeo: string): Borrador {
  return conFaltantes({ ...b, [campo]: { direccion: direccion.trim(), ubigeo } });
}

export function entradaDesdeBorrador(b: Borrador, transporte: TransporteGuia, documentoRecibidoId: number): EntradaGuia {
  if (b.faltantes.length > 0) {
    throw new ErrorValidacion(b.faltantes.map((c) => `Falta ${ETIQUETAS_CAMPO[c]}`));
  }
  const entrada: EntradaGuia = {
    fechaTraslado: b.fechaTraslado!,
    remitente: b.remitente!,
    destinatario: b.destinatario!,
    partida: b.partida!,
    llegada: b.llegada!,
    pesoBruto: b.pesoBruto!,
    unidadPeso: b.unidadPeso!,
    greRemitenteRef: b.greRemitenteRef,
    items: b.items!,
    documentoRecibidoId,
    transporte,
  };
  const errores = validarEntradaGuia(entrada);
  if (errores.length > 0) throw new ErrorValidacion(errores);
  return entrada;
}

/** Vuelve a la conversación desde una guía ya guardada: "Corregir y reenviar" y "Retomar". */
export function borradorDesdeGuia(d: GuiaCompleta): Borrador {
  return conFaltantes({
    fechaTraslado: d.guia.fechaTraslado,
    remitente: { numeroDoc: d.remitente.numeroDoc, razonSocial: d.remitente.razonSocial },
    destinatario: { numeroDoc: d.destinatario.numeroDoc, razonSocial: d.destinatario.razonSocial },
    partida: { direccion: d.guia.partidaDireccion, ubigeo: d.guia.partidaUbigeo },
    llegada: { direccion: d.guia.llegadaDireccion, ubigeo: d.guia.llegadaUbigeo },
    // numeric de Postgres vuelve con los decimales de la columna ("1500.500"): se recorta el
    // relleno para que el resumen muestre lo mismo que escribió o leyó el dueño.
    pesoBruto: sinCerosSobrantes(d.guia.pesoBruto),
    unidadPeso: d.guia.unidadPeso === "TNE" ? "TNE" : "KGM",
    greRemitenteRef: d.guia.greRemitenteRef,
    items: d.items.map((it) => ({
      descripcion: it.descripcion,
      cantidad: sinCerosSobrantes(it.cantidad),
      unidadMedida: it.unidadMedida,
    })),
  });
}

function sinCerosSobrantes(numero: string): string {
  if (!numero.includes(".")) return numero;
  return numero.replace(/0+$/, "").replace(/\.$/, "");
}
