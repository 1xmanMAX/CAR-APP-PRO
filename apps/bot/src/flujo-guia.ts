import {
  aplicarLugar,
  aplicarRespuesta,
  borradorDesdeExtraccion,
  borradorDesdeGuia,
  buscarUbigeos,
  cargarGuiaCompleta,
  compararTransporte,
  emitirGuia,
  entradaDesdeBorrador,
  ETIQUETAS_CAMPO,
  guardarExtraccion,
  normalizarPlaca,
  ORDEN_CAMPOS,
  registrarConductor,
  registrarDocumentoRecibido,
  registrarGuiaBorrador,
  registrarVehiculo,
  actualizarGuiaBorrador,
  resultadoGuia,
  transporteHabitual,
  type CampoGuia,
  type ResultadoEmision,
  type TransporteGuia,
} from "@sunatapp/core";
import { PdfSinTextoError, type GuiaExtraida } from "@sunatapp/extractor";
import { InlineKeyboard, InputFile, type Api, type Bot, type Filter } from "grammy";
import type { ContextoBot, Dependencias } from "./bot";
import { ofrecerFactura } from "./flujo-factura";
import { flujoGuia, type EstadoFlujoGuia, type PendienteTransporte } from "./sesion";
import { preguntas, resumenGuia, textos } from "./textos";

/** Telegram no deja a un bot descargar archivos de más de 20 MB. */
const MAX_BYTES = 20 * 1024 * 1024;
const MIME_PDF = "application/pdf";

type CtxDocumento = Filter<ContextoBot, "message:document">;
type CtxTexto = Filter<ContextoBot, "message:text">;
type CtxBoton = Filter<ContextoBot, "callback_query:data">;
type Ctx = ContextoBot;

/** Avisa del desenlace de una guía. También la usa el proceso de fondo (Task 12). */
export async function notificarGuia(deps: Dependencias, api: Api, chatId: number, r: ResultadoEmision): Promise<void> {
  if (r.estado === "aceptada") {
    if (r.rutaPdf) {
      await api.sendDocument(chatId, new InputFile(deps.ctx.almacen.rutaAbsoluta(r.rutaPdf)), {
        caption: textos.guiaAceptada(r.serieNumero),
      });
    } else {
      await api.sendMessage(chatId, textos.guiaAceptada(r.serieNumero));
    }
    await ofrecerFactura(api, chatId, r.id, r.serieNumero);
    return;
  }
  if (r.estado === "rechazada") {
    await api.sendMessage(chatId, textos.guiaRechazada(r.serieNumero, r.mensaje ?? ""), {
      reply_markup: new InlineKeyboard().text(textos.botonReenviar, `g:reenviar:${r.id}`),
    });
    return;
  }
  await api.sendMessage(chatId, textos.guiaSinRespuesta);
}

// --- Lectura del PDF -------------------------------------------------------

function seguro<T>(c: { valor: T | null; confianza: string }): T | null {
  return c.confianza === "segura" ? c.valor : null;
}

/** Separa valores y confianzas para guardarlos junto al documento recibido (trazabilidad). */
function partirExtraccion(g: GuiaExtraida): { valores: Record<string, unknown>; confianzas: Record<string, string> } {
  const valores: Record<string, unknown> = {};
  const confianzas: Record<string, string> = {};
  for (const [nombre, campo] of Object.entries(g)) {
    if (campo && typeof campo === "object" && "confianza" in campo) {
      valores[nombre] = (campo as { valor: unknown }).valor;
      confianzas[nombre] = String((campo as { confianza: unknown }).confianza);
    } else {
      valores[nombre] = campo;
    }
  }
  return { valores, confianzas };
}

/**
 * El transporte que dice la guía del remitente, si se leyó entero y seguro; si falta algo se usa
 * el habitual de la empresa (el dueño lo ve en el resumen antes de emitir).
 */
async function transporteDe(deps: Dependencias, g: GuiaExtraida): Promise<TransporteGuia> {
  const t = seguro(g.transportista);
  const placas = seguro(g.placas);
  const cond = seguro(g.conductor);
  if (t && placas && cond && cond.licencia) {
    return {
      rucTransportista: t.ruc,
      placaPrincipal: placas.principal,
      placasSecundarias: placas.secundarias,
      conductor: { numeroDoc: cond.numeroDoc, nombres: cond.nombres, apellidos: cond.apellidos, licencia: cond.licencia },
    };
  }
  return transporteHabitual(deps.ctx);
}

export async function manejarDocumento(c: CtxDocumento, deps: Dependencias): Promise<void> {
  const doc = c.message.document;
  if (doc.mime_type !== MIME_PDF) {
    await c.reply(textos.soloPdf);
    return;
  }
  if ((doc.file_size ?? 0) > MAX_BYTES) {
    await c.reply(textos.archivoGrande);
    return;
  }
  await c.reply(textos.leyendoGuia);
  const contenido = await deps.descargarArchivo(doc.file_id);
  const registro = await registrarDocumentoRecibido(deps.ctx, {
    contenido,
    mime: MIME_PDF,
    telegramFileId: doc.file_id,
    ...(c.session.usuarioId !== undefined ? { usuarioId: c.session.usuarioId } : {}),
  });
  if (registro.guiaId !== null) {
    const r = await resultadoGuia(deps.ctx, registro.guiaId);
    await c.reply(textos.guiaYaRegistrada(r.serieNumero, r.estado));
    return;
  }

  let extraida: GuiaExtraida;
  try {
    extraida = await deps.extractor.extraer({ contenido, mime: MIME_PDF });
  } catch (error) {
    if (error instanceof PdfSinTextoError) {
      await c.reply(textos.pdfSinTexto);
      return;
    }
    throw error;
  }
  const { valores, confianzas } = partirExtraccion(extraida);
  await guardarExtraccion(deps.ctx, registro.id, valores, confianzas);

  const transporte = await transporteDe(deps, extraida);
  const comparacion = await compararTransporte(deps.ctx, transporte);
  if (!comparacion.rucEmpresaCoincide) {
    await c.reply(textos.transportistaAjeno(transporte.rucTransportista));
    return;
  }
  const placasNuevas = [
    ...(comparacion.placaPrincipal === "nueva" ? [{ placa: transporte.placaPrincipal, principal: true }] : []),
    ...comparacion.placasSecundarias.filter((s) => s.estado === "nueva").map((s) => ({ placa: s.placa, principal: false })),
  ];
  const pendientes: PendienteTransporte[] = [];
  if (placasNuevas.length > 0) {
    // Solo se consulta el transporte habitual si hay algo que ofrecer con él.
    const habitual = await transporteHabitual(deps.ctx);
    for (const { placa, principal } of placasNuevas) {
      // La habitual de una carreta es el 2.º vehículo activo; si no hay, solo queda registrarla.
      const alternativa = principal ? habitual.placaPrincipal : (habitual.placasSecundarias[0] ?? null);
      pendientes.push({ tipo: "placa", placa, habitual: alternativa });
    }
  }
  if (comparacion.conductor === "nuevo") pendientes.push({ tipo: "conductor", datos: transporte.conductor });

  const flujo: EstadoFlujoGuia = {
    tipo: "guia",
    paso: "transporte",
    documentoId: registro.id,
    borrador: borradorDesdeExtraccion(extraida),
    transporte,
    pendientesTransporte: pendientes,
  };
  c.session.flujo = flujo;
  await avanzar(c, deps, flujo);
}

// --- Conversación ----------------------------------------------------------

/** Siguiente cosa que falta: transporte → campos pendientes → resumen. */
async function avanzar(c: Ctx, deps: Dependencias, f: EstadoFlujoGuia): Promise<void> {
  const pendiente = f.pendientesTransporte[0];
  if (pendiente) {
    f.paso = "transporte";
    await preguntarTransporte(c, pendiente);
    return;
  }
  const campo = f.borrador.faltantes[0];
  if (campo) {
    await preguntarCampo(c, f, campo);
    return;
  }
  await mostrarResumen(c, f);
}

async function preguntarTransporte(c: Ctx, p: PendienteTransporte): Promise<void> {
  if (p.tipo === "placa") {
    const teclado = new InlineKeyboard().text(textos.botonRegistrarPlaca(p.placa), `g:placa:reg:${p.placa}`);
    if (p.habitual) teclado.text(textos.botonPlacaHabitual(p.habitual), `g:placa:hab:${p.placa}`);
    await c.reply(textos.placaNueva(p.placa), { reply_markup: teclado });
    return;
  }
  await c.reply(textos.conductorNuevo(p.datos.nombres, p.datos.apellidos, p.datos.numeroDoc), {
    reply_markup: new InlineKeyboard()
      .text(textos.botonRegistrarConductor, "g:cond:reg")
      .text(textos.botonConductorHabitual, "g:cond:hab"),
  });
}

async function preguntarCampo(c: Ctx, f: EstadoFlujoGuia, campo: CampoGuia): Promise<void> {
  f.campoActual = campo;
  f.paso = "preguntando";
  delete f.direccionPendiente;
  if (campo === "unidadPeso") {
    await c.reply(preguntas.unidadPeso, {
      reply_markup: new InlineKeyboard().text("KGM", "g:unidad:KGM").text("TNE", "g:unidad:TNE"),
    });
    return;
  }
  await c.reply(preguntas[campo]);
}

async function mostrarResumen(c: Ctx, f: EstadoFlujoGuia): Promise<void> {
  f.paso = "resumen";
  delete f.campoActual;
  delete f.direccionPendiente;
  const conductor = `${f.transporte.conductor.nombres} ${f.transporte.conductor.apellidos}`.trim();
  await c.reply(resumenGuia(f.borrador, f.transporte, conductor), {
    reply_markup: new InlineKeyboard()
      .text("✅ Emitir", "g:emitir")
      .text("✏️ Corregir", "g:corregir")
      .text("❌ Cancelar", "g:cancelar"),
  });
}

async function mostrarDistritos(c: Ctx, texto: string): Promise<void> {
  const encontrados = buscarUbigeos(texto, 8);
  if (encontrados.length === 0) {
    await c.reply(textos.distritoNoEncontrado);
    return;
  }
  const teclado = new InlineKeyboard();
  for (const u of encontrados) teclado.text(`${u.distrito} (${u.provincia}, ${u.departamento})`, `g:ubigeo:${u.codigo}`).row();
  await c.reply(textos.elegirDistrito, { reply_markup: teclado });
}

/** Una guía ya emitida sigue su curso aunque el chat se quede con el flujo en "emitiendo". */
async function siguePendiente(deps: Dependencias, guiaId: number | undefined): Promise<boolean> {
  if (guiaId === undefined) return true;
  const r = await resultadoGuia(deps.ctx, guiaId);
  return r.estado !== "aceptada" && r.estado !== "rechazada";
}

export async function manejarTexto(c: CtxTexto, deps: Dependencias): Promise<void> {
  const f = flujoGuia(c.session);
  if (!f) {
    await c.reply(textos.sinFlujo);
    return;
  }
  const texto = c.message.text;
  if (f.paso === "emitiendo") {
    if (await siguePendiente(deps, f.guiaId)) {
      await c.reply(textos.yaEnviando);
      return;
    }
    delete c.session.flujo;
    await c.reply(textos.sinFlujo);
    return;
  }
  if (f.paso === "distrito") {
    await mostrarDistritos(c, texto);
    return;
  }
  const campo = f.paso === "preguntando" ? f.campoActual : undefined;
  if (!campo) {
    // Un texto suelto mientras esperamos un botón: se repite lo que toca.
    await avanzar(c, deps, f);
    return;
  }
  if (campo === "partida" || campo === "llegada") {
    if (!texto.trim()) {
      await c.reply(preguntas[campo]);
      return;
    }
    f.direccionPendiente = texto.trim();
    f.paso = "distrito";
    await c.reply(textos.preguntaDistrito);
    return;
  }
  const r = aplicarRespuesta(f.borrador, campo, texto);
  if (r.error) {
    await c.reply(r.error);
    await preguntarCampo(c, f, campo);
    return;
  }
  f.borrador = r.borrador;
  delete f.campoActual;
  await avanzar(c, deps, f);
}

function tecladoCampos(): InlineKeyboard {
  const teclado = new InlineKeyboard();
  for (const campo of ORDEN_CAMPOS) teclado.text(ETIQUETAS_CAMPO[campo], `g:campo:${campo}`).row();
  return teclado;
}

function reemplazarPlaca(t: TransporteGuia, vieja: string, nueva: string): void {
  const igual = (p: string) => normalizarPlaca(p) === normalizarPlaca(vieja);
  if (igual(t.placaPrincipal)) t.placaPrincipal = nueva;
  t.placasSecundarias = t.placasSecundarias.map((p) => (igual(p) ? nueva : p));
}

async function emitir(c: Ctx, deps: Dependencias, f: EstadoFlujoGuia): Promise<void> {
  const paso = f.paso;
  f.paso = "emitiendo";
  let guiaId: number;
  try {
    const entrada = entradaDesdeBorrador(f.borrador, f.transporte, f.documentoId);
    if (f.guiaId !== undefined) {
      await actualizarGuiaBorrador(deps.ctx, f.guiaId, entrada, c.session.usuarioId);
      guiaId = f.guiaId;
    } else {
      guiaId = await registrarGuiaBorrador(deps.ctx, entrada, c.session.usuarioId);
    }
  } catch (error) {
    f.paso = paso;
    throw error;
  }
  // El flujo se queda en "emitiendo" (no se borra) para que un segundo clic no vuelva a emitir:
  // el envío tarda y el dueño no ve todavía ninguna confirmación. Al resolverse la guía, el
  // siguiente mensaje limpia la sesión (siguePendiente).
  f.guiaId = guiaId;
  await c.reply(textos.enviandoSunat);
  const chatId = c.chat!.id;
  const api = c.api;
  deps.enSegundoPlano(async () => {
    const r = await emitirGuia(deps.ctx, guiaId);
    await notificarGuia(deps, api, chatId, r);
  });
}

/** "Corregir y reenviar": rearma la conversación desde la guía guardada, sin depender del chat. */
async function retomarGuia(c: Ctx, deps: Dependencias, guiaId: number): Promise<void> {
  const d = await cargarGuiaCompleta(deps.ctx.db, guiaId);
  const flujo: EstadoFlujoGuia = {
    tipo: "guia",
    paso: "resumen",
    documentoId: d.guia.documentoRecibidoId ?? 0,
    guiaId,
    borrador: borradorDesdeGuia(d),
    transporte: {
      rucTransportista: d.empresa.ruc,
      placaPrincipal: d.vehiculo.placa,
      placasSecundarias: d.vehiculoSecundario ? [d.vehiculoSecundario.placa] : [],
      conductor: {
        numeroDoc: d.conductor.numeroDoc,
        nombres: d.conductor.nombres,
        apellidos: d.conductor.apellidos,
        licencia: d.conductor.licencia,
      },
    },
    pendientesTransporte: [],
  };
  c.session.flujo = flujo;
  await mostrarResumen(c, flujo);
}

export async function manejarBoton(c: CtxBoton, deps: Dependencias): Promise<void> {
  // Telegram deja el botón "cargando" hasta que se le responde: siempre, pase lo que pase después.
  await c.answerCallbackQuery().catch(() => {});
  const data = c.callbackQuery.data;
  let f = flujoGuia(c.session);
  // Mientras el envío sigue en curso no se atiende ningún botón; en cuanto SUNAT responde, el
  // flujo caduca y deja de tragarse los botones (incluidos los que manda el proceso de fondo).
  if (f?.paso === "emitiendo") {
    if (await siguePendiente(deps, f.guiaId)) {
      await c.reply(textos.yaEnviando);
      return;
    }
    delete c.session.flujo;
    f = undefined;
  }
  // "g:reenviar:" (corregir y reenviar una guía rechazada) y "g:retomar:" (el botón de
  // /pendientes) hacen exactamente lo mismo: rearman la conversación desde la guía guardada.
  const prefijoRetomar = data.startsWith("g:reenviar:") ? "g:reenviar:" : data.startsWith("g:retomar:") ? "g:retomar:" : null;
  if (prefijoRetomar) {
    const guiaId = Number(data.slice(prefijoRetomar.length));
    if (!Number.isInteger(guiaId) || guiaId <= 0) {
      await c.reply(textos.sinFlujo);
      return;
    }
    await retomarGuia(c, deps, guiaId);
    return;
  }
  if (!f) {
    await c.reply(textos.sinFlujo);
    return;
  }
  if (data === "g:cancelar") {
    delete c.session.flujo;
    await c.reply(textos.cancelado);
    return;
  }
  if (data === "g:emitir") {
    // El botón sigue visible en mensajes anteriores: solo vale sobre el resumen del flujo actual.
    // Si mientras tanto llegó otro PDF (o falta resolver el transporte), se retoma donde toca.
    if (f.paso !== "resumen" || f.pendientesTransporte.length > 0) {
      await avanzar(c, deps, f);
      return;
    }
    await emitir(c, deps, f);
    return;
  }
  if (data === "g:corregir") {
    f.paso = "eligiendo_campo";
    await c.reply(textos.queCorrijo, { reply_markup: tecladoCampos() });
    return;
  }
  if (data.startsWith("g:campo:")) {
    const campo = data.slice("g:campo:".length) as CampoGuia;
    if (!(ORDEN_CAMPOS as readonly string[]).includes(campo)) {
      await avanzar(c, deps, f);
      return;
    }
    await preguntarCampo(c, f, campo);
    return;
  }
  if (data.startsWith("g:ubigeo:")) {
    const codigo = data.slice("g:ubigeo:".length);
    const campo = f.campoActual;
    if ((campo === "partida" || campo === "llegada") && f.direccionPendiente) {
      f.borrador = aplicarLugar(f.borrador, campo, f.direccionPendiente, codigo);
      delete f.direccionPendiente;
      delete f.campoActual;
    }
    await avanzar(c, deps, f);
    return;
  }
  if (data.startsWith("g:unidad:")) {
    const r = aplicarRespuesta(f.borrador, "unidadPeso", data.slice("g:unidad:".length));
    if (r.error) {
      await c.reply(r.error);
      return;
    }
    f.borrador = r.borrador;
    delete f.campoActual;
    await avanzar(c, deps, f);
    return;
  }
  if (data.startsWith("g:placa:")) {
    const [, , accion, placa] = data.split(":");
    const pendiente = f.pendientesTransporte[0];
    if (!placa || !pendiente || pendiente.tipo !== "placa" || pendiente.placa !== placa) {
      await avanzar(c, deps, f);
      return;
    }
    if (accion === "hab") {
      // "Usar la habitual" sin habitual que usar no puede acabar registrando la placa nueva a
      // espaldas del dueño: se vuelve a preguntar.
      if (!pendiente.habitual) {
        await avanzar(c, deps, f);
        return;
      }
      reemplazarPlaca(f.transporte, placa, pendiente.habitual);
    } else {
      await registrarVehiculo(deps.ctx, placa);
    }
    f.pendientesTransporte.shift();
    await avanzar(c, deps, f);
    return;
  }
  if (data === "g:cond:reg" || data === "g:cond:hab") {
    const pendiente = f.pendientesTransporte[0];
    if (!pendiente || pendiente.tipo !== "conductor") {
      await avanzar(c, deps, f);
      return;
    }
    if (data === "g:cond:hab") f.transporte.conductor = (await transporteHabitual(deps.ctx)).conductor;
    else await registrarConductor(deps.ctx, pendiente.datos);
    f.pendientesTransporte.shift();
    await avanzar(c, deps, f);
    return;
  }
  await avanzar(c, deps, f);
}

export function registrarFlujoGuia(bot: Bot<ContextoBot>, deps: Dependencias): void {
  bot.on("message:document", (c) => manejarDocumento(c, deps));
  bot.on("message:photo", (c) => c.reply(textos.soloPdf).then(() => {}));
  bot.callbackQuery(/^g:/, (c) => manejarBoton(c, deps));
  bot.on("message:text", (c) => manejarTexto(c, deps));
}
