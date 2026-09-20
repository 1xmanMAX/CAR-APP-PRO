import {
  buscarContrapartePorDoc,
  buscarGuiaPorSerieNumero,
  calcularMontosFactura,
  cargarGuiaCompleta,
  emitirFactura,
  ErrorNegocio,
  listarGuiasSinFacturar,
  parsearMonto,
  prepararFactura,
  resultadoGuia,
  type ResultadoEmision,
} from "@sunatapp/core";
import { InlineKeyboard, InputFile, type Api, type Bot, type Filter, type NextFunction } from "grammy";
import type { ContextoBot, Dependencias } from "./bot";
import { flujoFactura, type EstadoFlujoFactura, type Sesion } from "./sesion";
import { resumenFactura, textos } from "./textos";

type CtxTexto = Filter<ContextoBot, "message:text">;
type CtxBoton = Filter<ContextoBot, "callback_query:data">;
type Ctx = ContextoBot;

/** Se ofrece justo después de la leyenda de la guía aceptada; la llama notificarGuia. */
export async function ofrecerFactura(api: Api, chatId: number, guiaId: number, serieNumero: string): Promise<void> {
  await api.sendMessage(chatId, textos.ofrecerFactura(serieNumero), {
    reply_markup: new InlineKeyboard()
      .text(textos.botonFacturarSi, `f:si:${guiaId}`)
      .text(textos.botonFacturarDespues, `f:despues:${guiaId}`),
  });
}

/** Avisa del desenlace de una factura. También la usará el proceso de fondo (Task 12). */
export async function notificarFactura(api: Api, deps: Dependencias, chatId: number, r: ResultadoEmision): Promise<void> {
  if (r.estado === "aceptada" || r.estado === "observada") {
    if (r.rutaPdf) {
      await api.sendDocument(chatId, new InputFile(deps.ctx.almacen.rutaAbsoluta(r.rutaPdf)), {
        caption: textos.facturaAceptada(r.serieNumero),
      });
    } else {
      await api.sendMessage(chatId, textos.facturaAceptada(r.serieNumero));
    }
    return;
  }
  if (r.estado === "rechazada") {
    await api.sendMessage(chatId, textos.facturaRechazada(r.serieNumero, r.mensaje ?? ""));
    return;
  }
  await api.sendMessage(chatId, textos.facturaSinRespuesta);
}

// --- Conversación ----------------------------------------------------------

/** Arranca la conversación sobre una guía concreta, si es facturable. */
export async function iniciarFlujoFactura(c: Ctx, deps: Dependencias, guiaId: number): Promise<void> {
  const guia = await resultadoGuia(deps.ctx, guiaId);
  if (guia.estado !== "aceptada") {
    await c.reply(textos.soloGuiasAceptadas);
    return;
  }
  const sinFacturar = await listarGuiasSinFacturar(deps.ctx);
  if (!sinFacturar.some((g) => g.id === guiaId)) {
    await c.reply(textos.guiaYaFacturada(guia.serieNumero));
    return;
  }
  const flujo: EstadoFlujoFactura = { tipo: "factura", guiaId, paso: "monto" };
  c.session.flujo = flujo;
  await avanzar(c, deps, flujo);
}

/** Lo siguiente que falta: monto → IGV → cliente → forma de pago → resumen. */
async function avanzar(c: Ctx, deps: Dependencias, f: EstadoFlujoFactura): Promise<void> {
  if (f.montoCentimos === undefined) {
    f.paso = "monto";
    await c.reply(textos.preguntaMonto);
    return;
  }
  if (f.incluyeIgv === undefined) {
    f.paso = "igv";
    await c.reply(textos.preguntaIgv, {
      reply_markup: new InlineKeyboard().text(textos.botonIncluyeIgv, "f:igv:si").text(textos.botonMasIgv, "f:igv:no"),
    });
    return;
  }
  if (f.clienteId === undefined) {
    f.paso = "cliente";
    const d = await cargarGuiaCompleta(deps.ctx.db, f.guiaId);
    await c.reply(textos.preguntaCliente, {
      reply_markup: new InlineKeyboard()
        .text(textos.botonClienteRemitente(d.remitente.razonSocial), "f:cli:rem")
        .text(textos.botonClienteOtro, "f:cli:otro"),
    });
    return;
  }
  if (f.formaPago === undefined) {
    f.paso = "pago";
    await c.reply(textos.preguntaPago, {
      reply_markup: new InlineKeyboard()
        .text(textos.botonContado, "f:pago:contado")
        .text(textos.botonCredito(15), "f:pago:15")
        .text(textos.botonCredito(30), "f:pago:30")
        .text(textos.botonOtroPlazo, "f:pago:otro"),
    });
    return;
  }
  if (f.formaPago === "credito" && f.diasCredito === undefined) {
    f.paso = "dias";
    await c.reply(textos.preguntaDias);
    return;
  }
  await mostrarResumen(c, deps, f);
}

async function mostrarResumen(c: Ctx, deps: Dependencias, f: EstadoFlujoFactura): Promise<void> {
  f.paso = "resumen";
  const d = await cargarGuiaCompleta(deps.ctx.db, f.guiaId);
  const montos = calcularMontosFactura({
    montoCentimos: f.montoCentimos!,
    incluyeIgv: f.incluyeIgv!,
    detraccion: { porcentaje: d.empresa.detraccionPorcentaje, umbralCentimos: d.empresa.detraccionUmbral },
  });
  const cliente = f.cliente ?? { numeroDoc: d.remitente.numeroDoc, razonSocial: d.remitente.razonSocial };
  await c.reply(
    resumenFactura({
      serieNumeroGuia: `${d.guia.serie}-${d.guia.numero}`,
      cliente,
      montos,
      formaPago: f.formaPago!,
      ...(f.diasCredito !== undefined ? { diasCredito: f.diasCredito } : {}),
    }),
    { reply_markup: new InlineKeyboard().text("✅ Emitir", "f:emitir").text("❌ Cancelar", "f:cancelar") },
  );
}

async function elegirCliente(c: Ctx, deps: Dependencias, f: EstadoFlujoFactura, ruc: string): Promise<void> {
  const cliente = await buscarContrapartePorDoc(deps.ctx, ruc.trim());
  if (!cliente) {
    await c.reply(textos.rucNoRegistrado);
    return;
  }
  if (cliente.tipoDoc !== "6") {
    await c.reply(textos.clienteSinRuc);
    return;
  }
  f.clienteId = cliente.id;
  f.cliente = { numeroDoc: cliente.numeroDoc, razonSocial: cliente.razonSocial };
  await avanzar(c, deps, f);
}

/**
 * Prepara la factura y la manda a SUNAT en segundo plano. El flujo se queda en "emitiendo" para
 * que un segundo clic no emita dos veces, y la propia tarea lo borra al terminar: así el chat no
 * se queda atascado respondiendo "Ya la estoy enviando." para siempre.
 */
async function emitir(c: Ctx, deps: Dependencias, f: EstadoFlujoFactura): Promise<void> {
  const paso = f.paso;
  f.paso = "emitiendo";
  let facturaId: number;
  try {
    const preparada = await prepararFactura(
      deps.ctx,
      {
        guiaId: f.guiaId,
        montoCentimos: f.montoCentimos!,
        incluyeIgv: f.incluyeIgv!,
        formaPago: f.formaPago!,
        ...(f.clienteId !== undefined ? { clienteId: f.clienteId } : {}),
        ...(f.diasCredito !== undefined ? { diasCredito: f.diasCredito } : {}),
      },
      c.session.usuarioId,
    );
    facturaId = preparada.facturaId;
  } catch (error) {
    if (error instanceof ErrorNegocio) {
      // Nada se envió a SUNAT: se le dice al dueño qué pasó y la conversación termina aquí.
      delete c.session.flujo;
      await c.reply(error.message);
      return;
    }
    f.paso = paso;
    throw error;
  }
  await c.reply(textos.enviandoFactura);
  const sesion: Sesion = c.session;
  const chatId = c.chat!.id;
  const api = c.api;
  deps.enSegundoPlano(async () => {
    try {
      const r = await emitirFactura(deps.ctx, facturaId);
      await notificarFactura(api, deps, chatId, r);
    } finally {
      if (sesion.flujo === f) delete sesion.flujo;
    }
  });
}

export async function manejarTextoFactura(c: CtxTexto, deps: Dependencias, next: NextFunction): Promise<void> {
  const f = flujoFactura(c.session);
  if (!f) {
    await next();
    return;
  }
  const texto = c.message.text;
  // Un comando (/cancelar, /guias…) nunca es una respuesta: se deja pasar a quien lo atiende.
  if (texto.startsWith("/")) {
    await next();
    return;
  }
  if (f.paso === "emitiendo") {
    await c.reply(textos.yaEnviando);
    return;
  }
  if (f.paso === "monto") {
    const monto = parsearMonto(texto);
    if (monto === null) {
      await c.reply(textos.montoNoEntendido);
      return;
    }
    f.montoCentimos = monto;
    await avanzar(c, deps, f);
    return;
  }
  if (f.paso === "ruc_cliente") {
    await elegirCliente(c, deps, f, texto);
    return;
  }
  if (f.paso === "dias") {
    const dias = /^\d+$/.test(texto.trim()) ? Number(texto.trim()) : 0;
    if (!Number.isSafeInteger(dias) || dias <= 0) {
      await c.reply(textos.diasNoEntendidos);
      return;
    }
    f.diasCredito = dias;
    await avanzar(c, deps, f);
    return;
  }
  // Un texto suelto mientras esperamos un botón: se repite lo que toca.
  await avanzar(c, deps, f);
}

export async function manejarBotonFactura(c: CtxBoton, deps: Dependencias): Promise<void> {
  // Telegram deja el botón "cargando" hasta que se le responde: siempre, pase lo que pase después.
  await c.answerCallbackQuery().catch(() => {});
  const data = c.callbackQuery.data;
  const f = flujoFactura(c.session);
  // Mientras el envío sigue en curso no se atiende ningún botón (ni el "Sí" de otra guía).
  if (f?.paso === "emitiendo") {
    await c.reply(textos.yaEnviando);
    return;
  }
  if (data.startsWith("f:si:") || data.startsWith("f:despues:")) {
    const guiaId = Number(data.slice(data.lastIndexOf(":") + 1));
    if (!Number.isInteger(guiaId) || guiaId <= 0) {
      await c.reply(textos.sinFlujo);
      return;
    }
    if (data.startsWith("f:si:")) {
      await iniciarFlujoFactura(c, deps, guiaId);
      return;
    }
    const guia = await resultadoGuia(deps.ctx, guiaId);
    await c.reply(textos.facturarDespues(guia.serieNumero));
    return;
  }
  if (!f) {
    await c.reply(textos.sinFlujo);
    return;
  }
  if (data === "f:cancelar") {
    delete c.session.flujo;
    await c.reply(textos.cancelado);
    return;
  }
  if (data === "f:emitir") {
    // El botón sigue visible en mensajes anteriores: solo vale sobre el resumen del flujo actual.
    if (f.paso !== "resumen") {
      await avanzar(c, deps, f);
      return;
    }
    await emitir(c, deps, f);
    return;
  }
  if ((data === "f:igv:si" || data === "f:igv:no") && f.paso === "igv") {
    f.incluyeIgv = data === "f:igv:si";
    await avanzar(c, deps, f);
    return;
  }
  if ((data === "f:cli:rem" || data === "f:cli:otro") && f.paso === "cliente") {
    if (data === "f:cli:otro") {
      f.paso = "ruc_cliente";
      await c.reply(textos.preguntaRucCliente);
      return;
    }
    const d = await cargarGuiaCompleta(deps.ctx.db, f.guiaId);
    f.clienteId = d.guia.remitenteId;
    f.cliente = { numeroDoc: d.remitente.numeroDoc, razonSocial: d.remitente.razonSocial };
    await avanzar(c, deps, f);
    return;
  }
  if (data.startsWith("f:pago:") && f.paso === "pago") {
    const opcion = data.slice("f:pago:".length);
    if (opcion === "contado") {
      f.formaPago = "contado";
    } else if (opcion === "otro") {
      f.formaPago = "credito";
      delete f.diasCredito;
    } else if (opcion === "15" || opcion === "30") {
      f.formaPago = "credito";
      f.diasCredito = Number(opcion);
    } else {
      await avanzar(c, deps, f);
      return;
    }
    await avanzar(c, deps, f);
    return;
  }
  // Botón viejo de un paso que ya pasó: se repite lo que toca ahora.
  await avanzar(c, deps, f);
}

/**
 * Se registra antes que el flujo de guía: su `bot.on("message:text")` es un atrapatodo, así que
 * el texto de la factura tiene que pasar por aquí primero (y ceder con `next` si no hay factura).
 */
export function registrarFlujoFactura(bot: Bot<ContextoBot>, deps: Dependencias): void {
  bot.command("facturar", async (c) => {
    const texto = c.match.trim();
    if (!texto) {
      await c.reply(textos.facturarSinGuia);
      return;
    }
    const guia = await buscarGuiaPorSerieNumero(deps.ctx, texto);
    if (!guia) {
      await c.reply(textos.guiaNoEncontrada(texto.toUpperCase()));
      return;
    }
    await iniciarFlujoFactura(c, deps, guia.id);
  });
  bot.callbackQuery(/^f:/, (c) => manejarBotonFactura(c, deps));
  bot.on("message:text", (c, next) => manejarTextoFactura(c, deps, next));
}
