import {
  formatearSoles,
  obtenerUbigeo,
  type Borrador,
  type FilaCobro,
  type FilaGuia,
  type MontosFactura,
  type TransporteGuia,
} from "@sunatapp/core";

export const textos = {
  registroOk: "✅ Listo. Solo te atenderé a ti.",
  errorGenerico: "😕 Algo salió mal. Ya quedó anotado; intenta de nuevo en un momento.",
  ayuda: [
    "📋 Qué puedo hacer:",
    "• Envíame el PDF de la guía del remitente y emito la guía de transportista.",
    "/guias — últimas guías",
    "/pendientes — guías por terminar",
    "/facturar V001-1 — facturar una guía",
    "/cobros — facturas por cobrar",
    "/pagado F001-1 [monto] — registrar un cobro",
    "/cancelar — cancelar lo que estemos haciendo",
  ].join("\n"),

  // --- Flujo de guía ---
  leyendoGuia: "📄 Leyendo la guía…",
  soloPdf: "Por ahora solo leo PDF. Envíame el PDF de la guía.",
  archivoGrande: "Ese archivo pasa de 20 MB, el límite de Telegram para bots. Envíame el PDF original de SUNAT.",
  pdfSinTexto: "No pude leer texto en ese PDF. Envíame el PDF original de SUNAT.",
  guiaYaRegistrada: (serieNumero: string, estado: string) => `Esta guía ya la registré como ${serieNumero} (${estado}).`,
  transportistaAjeno: (ruc: string) => `⛔ Esta guía indica otro transportista (RUC ${ruc}). No la puedo emitir.`,
  placaNueva: (placa: string) => `La placa ${placa} no está registrada.`,
  botonRegistrarPlaca: (placa: string) => `Registrar ${placa}`,
  botonPlacaHabitual: (placa: string) => `Usar la habitual ${placa}`,
  conductorNuevo: (nombres: string, apellidos: string, dni: string) =>
    `El conductor ${nombres} ${apellidos} (DNI ${dni}) no está registrado.`,
  botonRegistrarConductor: "Registrar conductor",
  botonConductorHabitual: "Usar conductor habitual",
  preguntaDistrito: "¿En qué distrito?",
  elegirDistrito: "Elige el distrito:",
  distritoNoEncontrado: "No encontré ese distrito. Escribe solo el nombre del distrito.",
  queCorrijo: "¿Qué corrijo?",
  enviandoSunat: "📤 Enviando a SUNAT…",
  yaEnviando: "Ya la estoy enviando.",
  cancelado: "Cancelado.",
  sinFlujo: "Envíame el PDF de la guía del remitente o escribe /ayuda.",
  guiaAceptada: (serieNumero: string) => `✅ Guía ${serieNumero} aceptada.`,
  guiaRechazada: (serieNumero: string, mensaje: string) => `❌ SUNAT rechazó la guía ${serieNumero}: ${mensaje}`,
  botonReenviar: "✏️ Corregir y reenviar",
  guiaSinRespuesta: "⏳ SUNAT no respondió; lo reintento solo y te aviso.",

  // --- Flujo de factura ---
  ofrecerFactura: (serieNumero: string) => `¿Facturar este flete (${serieNumero})?`,
  botonFacturarSi: "Sí",
  botonFacturarDespues: "Después",
  facturarDespues: (serieNumero: string) => `Listo, queda sin facturar. Usa /facturar ${serieNumero} cuando quieras.`,
  facturarSinGuia: "Dime qué guía facturo, por ejemplo /facturar V001-1.",
  guiaNoEncontrada: (serieNumero: string) => `No encontré la guía ${serieNumero}.`,
  soloGuiasAceptadas: "Solo se pueden facturar guías aceptadas por SUNAT.",
  guiaYaFacturada: (serieNumero: string) => `La guía ${serieNumero} ya tiene factura.`,
  preguntaMonto: "¿Cuál es el monto del flete? (ej. 2500)",
  montoNoEntendido: "No entendí el monto. Escríbelo así: 2500 o 2,500.50",
  preguntaIgv: "¿El monto incluye IGV?",
  botonIncluyeIgv: "Incluye IGV",
  botonMasIgv: "Más IGV",
  preguntaCliente: "¿A quién se factura?",
  botonClienteRemitente: (razonSocial: string) => `Remitente: ${razonSocial}`,
  botonClienteOtro: "Otro RUC",
  preguntaRucCliente: "Escribe el RUC del cliente.",
  rucNoRegistrado: "Ese RUC no está registrado. Por ahora factura al remitente o a un cliente con el que ya trabajaste.",
  clienteSinRuc: "La factura requiere un cliente con RUC.",
  preguntaPago: "¿Forma de pago?",
  botonContado: "Contado",
  botonCredito: (dias: number) => `Crédito ${dias} días`,
  botonOtroPlazo: "Otro plazo",
  preguntaDias: "¿Cuántos días de crédito?",
  diasNoEntendidos: "No entendí los días. Escribe un número entero mayor a cero, por ejemplo 45.",
  enviandoFactura: "📤 Enviando la factura a SUNAT…",
  facturaAceptada: (serieNumero: string) => `✅ Factura ${serieNumero} aceptada.`,
  facturaRechazada: (serieNumero: string, mensaje: string) => `❌ SUNAT rechazó la factura ${serieNumero}: ${mensaje}`,
  facturaSinRespuesta: "⏳ SUNAT no respondió; lo reintento solo y te aviso.",

  // --- Comandos ---
  sinGuias: "Todavía no hay guías.",
  sinPendientes: "No hay guías pendientes.",
  botonRetomar: (serieNumero: string) => `Retomar ${serieNumero}`,
  sinCobros: "No hay facturas por cobrar. 🎉",
  pagadoUso: "Úsalo así: /pagado F001-2 1500",
  facturaNoEncontrada: (serieNumero: string) => `No encontré la factura ${serieNumero}.`,
  facturaSinSaldo: (serieNumero: string) => `La factura ${serieNumero} no tiene saldo pendiente.`,
  cobroRegistrado: (saldoCentimos: number, estadoCobro: string) =>
    `💰 Cobro registrado. Saldo: ${formatearSoles(saldoCentimos)} (${estadoCobro})`,
  noHayNadaQueCancelar: "No hay nada que cancelar.",
};

/** Una pregunta por campo; son las únicas frases que el dueño ve cuando falta un dato. */
export const preguntas = {
  serieNumero: "¿Cuál es la serie y número de la guía del remitente? (ej. EG07-5531)",
  remitente: "¿RUC y razón social del remitente?",
  destinatario: "¿RUC y razón social del destinatario?",
  partida: "¿Dirección del punto de partida?",
  llegada: "¿Dirección del punto de llegada?",
  fechaTraslado: "¿Cuál es la fecha de inicio de traslado? (dd/mm/aaaa)",
  pesoBruto: "¿Cuál es el peso bruto? (ej. 31.87)",
  unidadPeso: "¿En qué unidad está el peso?",
  items: "¿Qué bien se traslada? (ej. CEMENTO 750 BLS)",
} as const;

export function fechaLocal(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

function lugar(l: { direccion: string; ubigeo: string } | null): string {
  if (!l) return "—";
  const u = obtenerUbigeo(l.ubigeo);
  return u ? `${l.direccion} — ${u.distrito}, ${u.provincia}` : l.direccion;
}

function parte(p: { numeroDoc: string; razonSocial: string } | null): string {
  return p ? `${p.razonSocial} (${p.numeroDoc})` : "—";
}

/** El resumen que el dueño confirma antes de mandar nada a SUNAT: todo lo que va en la GRE-T. */
export function resumenGuia(b: Borrador, t: TransporteGuia, nombresConductor: string): string {
  const placas = [t.placaPrincipal, ...t.placasSecundarias].join(" / ");
  const bienes = (b.items ?? [])
    .map((it, i) => `${i + 1}. ${it.descripcion} — ${it.cantidad} ${it.unidadMedida}`)
    .join("; ");
  return [
    "🧾 Guía de transportista (borrador)",
    `Remitente: ${parte(b.remitente)}`,
    `Destinatario: ${parte(b.destinatario)}`,
    `Partida: ${lugar(b.partida)}`,
    `Llegada: ${lugar(b.llegada)}`,
    `Traslado: ${b.fechaTraslado ? fechaLocal(b.fechaTraslado) : "—"} · Peso: ${b.pesoBruto ?? "—"} ${b.unidadPeso ?? ""}`.trim(),
    `Vehículo: ${placas} · Conductor: ${nombresConductor}`,
    `Bienes: ${bienes}`,
    `GRE remitente: ${b.greRemitenteRef ?? "—"}`,
  ].join("\n");
}

/** El resumen que el dueño confirma antes de emitir la factura: montos ya calculados por el núcleo. */
export function resumenFactura(d: {
  serieNumeroGuia: string;
  cliente: { numeroDoc: string; razonSocial: string };
  montos: MontosFactura;
  formaPago: "contado" | "credito";
  diasCredito?: number;
}): string {
  const m = d.montos;
  const neto = `Neto a cobrar: ${formatearSoles(m.cobrable)}`;
  return [
    "🧾 Factura (borrador)",
    `Guía: ${d.serieNumeroGuia}`,
    `Cliente: ${d.cliente.razonSocial} (${d.cliente.numeroDoc})`,
    `Subtotal: ${formatearSoles(m.subtotal)} · IGV: ${formatearSoles(m.igv)} · Total: ${formatearSoles(m.total)}`,
    m.detraccionPorcentaje === null
      ? neto
      : `Detracción ${m.detraccionPorcentaje}%: ${formatearSoles(m.detraccionMonto)} · ${neto}`,
    `Pago: ${d.formaPago === "credito" ? `crédito ${d.diasCredito} días` : "contado"}`,
  ].join("\n");
}

/** "yyyy-mm-dd" → "dd/mm", sin año: alcanza para las listas de /guias, /pendientes y /cobros. */
function fechaCorta(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

const ICONO_ESTADO_GUIA: Record<FilaGuia["estado"], string> = {
  borrador: "📝",
  pendiente_envio: "⏳",
  enviada: "⏳",
  aceptada: "✅",
  rechazada: "❌",
};

/** Una línea de /guias: serie, fecha, destinatario, estado y —solo si está aceptada— si ya se facturó. */
export function lineaGuia(f: FilaGuia): string {
  const partes = [f.serieNumero, fechaCorta(f.fechaTraslado), f.destinatario, `${ICONO_ESTADO_GUIA[f.estado]} ${f.estado}`];
  if (f.estado === "aceptada") partes.push(f.facturada ? "facturada" : "sin facturar");
  return partes.join(" · ");
}

/** Una línea de /pendientes: sin fecha, va junto al botón para retomarla. */
export function lineaPendiente(f: FilaGuia): string {
  return [f.serieNumero, `${ICONO_ESTADO_GUIA[f.estado]} ${f.estado}`, f.destinatario].join(" · ");
}

const ICONO_ESTADO_COBRO: Record<FilaCobro["estado"], string> = {
  vencida: "🔴",
  vence_hoy: "🟡",
  pendiente: "⚪",
};

/** Una línea de /cobros: a qué factura, quién debe, cuándo vence (o si ya venció) y cuánto falta. */
export function lineaCobro(f: FilaCobro): string {
  const vencimiento =
    f.estado === "vence_hoy"
      ? "vence hoy"
      : f.estado === "vencida"
        ? `vencida ${fechaCorta(f.fechaVencimiento)}`
        : `vence ${fechaCorta(f.fechaVencimiento)}`;
  return `${ICONO_ESTADO_COBRO[f.estado]} ${f.serieNumero} · ${f.cliente} · ${vencimiento} · ${formatearSoles(f.saldo)}`;
}
