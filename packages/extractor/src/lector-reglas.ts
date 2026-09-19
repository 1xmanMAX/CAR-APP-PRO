import type { Campo, GuiaExtraida, Validadores } from "./tipos";

/**
 * Lector determinista (sin IA) del texto que `unpdf` saca de una Guía de Remisión Remitente.
 * El texto sale con etiquetas y valores en bloques separados y varios valores pegados, así que
 * cada campo se busca por su forma, no por su posición. Regla de oro: si no hay un único
 * candidato claro, el campo queda en `null` con confianza "dudosa" — nunca se adivina.
 */

const UNIDADES = ["BLS", "NIU", "KGM", "TNE", "BX", "ZZ", "MTR", "LTR", "GLN", "UND"] as const;

const RE_SERIE = /^([A-Z0-9]{4})\s*-\s*(\d{1,8})$/;
const RE_RUC_REMITENTE = /^RUC\s+(\d{11})$/;
const RE_RAZON_CON_RUC = /^(.*\D)(\d{11})$/;
const RE_SOLO_RUC = /^\d{11}$/;
const RE_PLACAS = /^([A-Z0-9]{3}-?[A-Z0-9]{3})((\s*-\s*[A-Z0-9]{3}-?[A-Z0-9]{3})*)$/;
const RE_NUMERO = /^\d+(\.\d+)?$/;
const RE_UNIDAD_PESO = /^(KGM|TNE)$/;
const RE_CONDUCTOR = /^([A-ZÑÁÉÍÓÚ ]+?)(\d{8})$/;
const RE_LICENCIA_PEGADA = /([A-Z]\d{8})(?=LICENCIA)/;
const RE_LICENCIA_SOLA = /^[A-Z]\d{8}$/;
const RE_UBIGEO = /^(.*?)(?:\s*-)?\s*(\d{6})$/;
const RE_FECHA = /(\d{1,2})\/(\d{2})\/(\d{4})/g;
const RE_ITEM = new RegExp(`^(.+?)\\s+(${UNIDADES.join("|")})\\s+(\\d+\\.\\d{4})\\S*$`);
const RE_FACTURA = /FACTURA\s+([A-Z0-9]{4}-\d+)/g;
const RE_LETRA = /[A-Za-zÑñÁÉÍÓÚáéíóú]/;

function dudoso<T>(): Campo<T> {
  return { valor: null, confianza: "dudosa" };
}

function campo<T>(valor: T | null, seguro: boolean): Campo<T> {
  if (valor === null) return dudoso<T>();
  return { valor, confianza: seguro ? "segura" : "dudosa" };
}

function sinCerosIzquierda(numero: string): string {
  return numero.replace(/^0+(?=\d)/, "");
}

function sinCerosSobrantes(cantidad: string): string {
  if (!cantidad.includes(".")) return cantidad;
  return cantidad.replace(/0+$/, "").replace(/\.$/, "");
}

function esTexto(linea: string): boolean {
  return RE_LETRA.test(linea);
}

export function leerGuiaDeTexto(texto: string, v: Validadores): GuiaExtraida {
  const lineas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // --- Ítems (se necesitan antes del peso: su suma identifica el número de bultos) ---
  const items: Array<{ descripcion: string; cantidad: string; unidadMedida: string }> = [];
  for (const linea of lineas) {
    const m = RE_ITEM.exec(linea);
    if (!m) continue;
    const unidad = m[2]!;
    items.push({
      descripcion: m[1]!.trim(),
      cantidad: sinCerosSobrantes(m[3]!),
      unidadMedida: unidad === "UND" ? "NIU" : unidad,
    });
  }

  // --- Serie y número ---
  const seriesCandidatas = lineas.flatMap((l) => {
    const m = RE_SERIE.exec(l);
    return m ? [`${m[1]}-${sinCerosIzquierda(m[2]!)}`] : [];
  });
  const serieNumero = campo(seriesCandidatas[0] ?? null, seriesCandidatas.length === 1);

  // --- RUC del remitente (encabezado) ---
  let rucRemitente: string | null = null;
  for (const linea of lineas) {
    const m = RE_RUC_REMITENTE.exec(linea);
    if (m && v.validarRuc(m[1]!)) {
      rucRemitente = m[1]!;
      break;
    }
  }

  // --- Transportista: razón social + RUC pegados en la misma línea ---
  let transportista: { ruc: string; razonSocial: string } | null = null;
  let iTransportista = -1;
  for (let i = 0; i < lineas.length; i += 1) {
    const linea = lineas[i]!;
    if (linea.startsWith("RUC")) continue;
    const m = RE_RAZON_CON_RUC.exec(linea);
    if (!m || !v.validarRuc(m[2]!)) continue;
    const razonSocial = m[1]!.trim();
    if (!esTexto(razonSocial)) continue;
    transportista = { ruc: m[2]!, razonSocial };
    iTransportista = i;
    break;
  }

  // --- Destinatario: línea de texto seguida de una línea con solo el RUC ---
  let destinatario: { numeroDoc: string; razonSocial: string } | null = null;
  for (let i = Math.max(iTransportista, 0); i < lineas.length - 1; i += 1) {
    const razonSocial = lineas[i]!;
    const siguiente = lineas[i + 1]!;
    if (!esTexto(razonSocial)) continue;
    if (!RE_SOLO_RUC.test(siguiente) || !v.validarRuc(siguiente)) continue;
    destinatario = { numeroDoc: siguiente, razonSocial };
    break;
  }

  // --- Unidad del peso: la unidad suelta manda sobre la etiqueta "(KGM)" ---
  const iUnidad = lineas.findIndex((l) => RE_UNIDAD_PESO.test(l));
  const unidadPeso: Campo<"KGM" | "TNE"> =
    iUnidad >= 0
      ? { valor: lineas[iUnidad] as "KGM" | "TNE", confianza: "segura" }
      : { valor: "KGM", confianza: "dudosa" };

  // --- Razón social del remitente: la del destinatario si comparten RUC, si no el membrete ---
  let razonRemitente: string | null = null;
  if (destinatario && rucRemitente && destinatario.numeroDoc === rucRemitente) {
    razonRemitente = destinatario.razonSocial;
  } else if (iUnidad >= 0) {
    razonRemitente = lineas.slice(iUnidad + 1).find((l) => esTexto(l)) ?? null;
  }
  const remitente = campo(
    rucRemitente && razonRemitente ? { numeroDoc: rucRemitente, razonSocial: razonRemitente } : null,
    true,
  );

  // --- Placas ---
  let placas: { principal: string; secundarias: string[] } | null = null;
  let iPlacas = -1;
  for (let i = 0; i < lineas.length; i += 1) {
    const m = RE_PLACAS.exec(lineas[i]!);
    if (!m) continue;
    const secundarias = m[2]!.match(/[A-Z0-9]{3}-?[A-Z0-9]{3}/g) ?? [];
    placas = { principal: m[1]!, secundarias };
    iPlacas = i;
    break;
  }

  // --- Peso bruto: de los dos números que siguen a las placas, el que no es la suma de bultos ---
  let pesoBruto: Campo<string> = dudoso<string>();
  if (iPlacas >= 0) {
    const numeros = lineas.slice(iPlacas + 1).filter((l) => RE_NUMERO.test(l)).slice(0, 2);
    const sumaItems = items.reduce((total, it) => total + Number(it.cantidad), 0);
    const candidatos = items.length > 0 ? numeros.filter((n) => Number(n) !== sumaItems) : numeros;
    pesoBruto = campo(candidatos.length === 1 ? candidatos[0]! : null, true);
  }

  // --- Conductor ---
  let conductor: { numeroDoc: string; nombres: string; apellidos: string; licencia: string | null } | null = null;
  const licenciaPegada = RE_LICENCIA_PEGADA.exec(texto)?.[1] ?? null;
  const licencia = licenciaPegada ?? lineas.find((l) => RE_LICENCIA_SOLA.test(l)) ?? null;
  let conductorSeguro = false;
  for (const linea of lineas) {
    const m = RE_CONDUCTOR.exec(linea);
    if (!m) continue;
    const palabras = m[1]!.trim().split(/\s+/).filter(Boolean);
    if (palabras.length === 0) continue;
    const apellidos = palabras.slice(-2).join(" ");
    const nombres = palabras.slice(0, -2).join(" ");
    conductor = { numeroDoc: m[2]!, nombres, apellidos, licencia };
    conductorSeguro = licencia !== null && palabras.length >= 3;
    break;
  }

  // --- Punto de partida y de llegada: direcciones con ubigeo válido pegado al final ---
  const ubigeos = lineas.flatMap((l) => {
    const m = RE_UBIGEO.exec(l);
    if (!m) return [];
    const codigo = m[2]!;
    const direccion = m[1]!.trim().replace(/-+$/, "").trim();
    if (!direccion || !v.obtenerUbigeo(codigo)) return [];
    return [{ direccion, ubigeo: codigo }];
  });
  const dosUbigeos = ubigeos.length === 2;
  const partida = campo(dosUbigeos ? ubigeos[0]! : null, true);
  const llegada = campo(dosUbigeos ? ubigeos[1]! : null, true);

  // --- Fecha de traslado ---
  const fechas = [...texto.matchAll(RE_FECHA)].map((m) => `${m[3]}-${m[2]}-${m[1]!.padStart(2, "0")}`);
  const fechaTraslado = campo(
    fechas.length > 0 ? fechas[fechas.length - 1]! : null,
    fechas.every((f) => f === fechas[0]),
  );

  // --- Documentos relacionados (informativo) ---
  const documentosRelacionados = [...new Set([...texto.matchAll(RE_FACTURA)].map((m) => m[1]!))];

  return {
    serieNumero,
    remitente,
    destinatario: campo(destinatario, true),
    transportista: campo(transportista, true),
    partida,
    llegada,
    fechaTraslado,
    pesoBruto,
    unidadPeso,
    placas: campo(placas, true),
    conductor: campo(conductor, conductorSeguro),
    items: campo(items.length > 0 ? items : null, true),
    documentosRelacionados,
  };
}
