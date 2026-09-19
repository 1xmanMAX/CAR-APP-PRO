import { obtenerUbigeo, type Borrador, type TransporteGuia } from "@sunatapp/core";

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
