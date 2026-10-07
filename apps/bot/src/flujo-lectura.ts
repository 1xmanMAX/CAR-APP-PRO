import {
  buscarUnidad, capturarContexto, confirmarLectura, describirContexto, liquidacionViaje, corregirLectura, descartarLectura, ErrorNegocio, fijarLectura,
  formatearSoles, leerDocumento, listarCategorias, listarUnidades, nombreCategoria, obtenerDocumento, recibirMensaje, registrarEvento, type Lectura, type MensajeEntrante, type ResultadoLeer,
} from "@sunatapp/core";
import { CATEGORIAS_BASE, montoDe } from "@sunatapp/ia";
import { InlineKeyboard, type Api, type Bot, type Filter } from "grammy";
import type { ContextoBot, Dependencias } from "./bot";
import { autor, lineaSaldo, recordarUnidad, tecladoUnidades, textoLiquidacion, unidadImplicita } from "./flujo-flota";

/**
 * **Boletas por Telegram**: el chofer manda la foto de la boleta, un texto («grifo 350») o una
 * nota de voz; el lector (IA o reglas) propone qué es y cuánto y la persona confirma con un botón.
 * Nada se guarda sin ese ✅. Los PDF siguen yendo al flujo de guía.
 */
export type EstadoFlujoLectura = { tipo: "lectura"; paso: "correccion" | "monto" | "km"; documentoId: number; categoria?: string };

const ICONO: Record<string, string> = {
  combustible: "⛽", peaje: "🛣️", viaticos: "🍽️", hospedaje: "🛏️", estiba: "📦", balanza: "⚖️", cochera: "🅿️", lavado: "🚿", llantas_ruta: "🛞",
  reparacion_ruta: "🔧", lubricantes: "🛢️", resguardo: "🛡️", multas: "🚨", otros_viaje: "🧾",
};
const icono = (cat: string) => ICONO[cat] ?? "🧾";
const MEDIO: Record<string, string> = { efectivo: "efectivo", yape: "Yape/Plin", transferencia: "transferencia", otro: "otro medio" };

function flujoLectura(c: ContextoBot): EstadoFlujoLectura | undefined {
  return c.session.flujo?.tipo === "lectura" ? (c.session.flujo as EstadoFlujoLectura) : undefined;
}

const fechaCorta = (f: string | null) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}` : null);

/** El resumen que se confirma: «⛽ Combustible · S/ 350.00 · Grifo Primax (RUC …) · B012-4471 · 18/09». */
export function resumenLectura(l: Lectura, contexto?: string | null): string {
  if (l.tipo === "gasto") {
    const cabeza = `${icono(l.categoria)} ${nombreCategoria(l.categoria)} · ${formatearSoles(Math.round(l.monto * 100))}`;
    const detalle = [
      l.proveedorNombre && `${l.proveedorNombre}${l.proveedorRuc ? ` (RUC ${l.proveedorRuc})` : ""}`, l.comprobante, fechaCorta(l.fecha), l.nota,
      l.kmOdometro ? `${l.kmOdometro.toLocaleString("en-US")} km` : null,
    ].filter(Boolean).join(" · ");
    // Lo que el gasto tomará solo (unidad, viaje y guía, forma de pago, km): se ve antes de confirmar.
    return [cabeza, detalle, l.dudas.length ? `⚠️ ${l.dudas.join(" · ")}` : "", contexto ? `📍 ${contexto}` : ""].filter(Boolean).join("\n");
  }
  if (l.tipo === "entrega") {
    return [`💵 Dinero recibido para el viaje · ${formatearSoles(Math.round(l.monto * 100))} · ${MEDIO[l.medio]}${l.fecha ? ` · ${fechaCorta(l.fecha)}` : ""}`,
      l.dudas.length ? `⚠️ ${l.dudas.join(" · ")}` : ""].filter(Boolean).join("\n");
  }
  if (l.tipo === "inicio_viaje") {
    const ruta = l.destino ? `${l.origen ? `${l.origen} → ` : "→ "}${l.destino}` : "¿a dónde?";
    return [`🚛 Sale de viaje · ${ruta}${l.adelanto ? ` · adelanto ${formatearSoles(Math.round(l.adelanto * 100))}` : ""}`, l.dudas.length ? `⚠️ ${l.dudas.join(" · ")}` : ""].filter(Boolean).join("\n");
  }
  if (l.tipo === "fin_viaje") return "🏁 Llegó: cerrar el viaje en curso";
  return l.tipo === "otro" ? `No encontré un gasto (${l.descripcion}).` : `No lo entendí (${l.motivo}).`;
}

const tecladoConfirmar = (id: number) =>
  new InlineKeyboard().text("✅ Correcto", `l:ok:${id}`).text("✏️ Corregir", `l:corr:${id}`).row().text("❌ Descartar", `l:desc:${id}`);

function tecladoCategorias(id: number): InlineKeyboard {
  const k = new InlineKeyboard();
  CATEGORIAS_BASE.forEach((cat, i) => {
    k.text(`${icono(cat)} ${nombreCategoria(cat)}`, `l:cat:${id}:${cat}`);
    if (i % 2 === 1) k.row();
  });
  return k.row().text("💵 Me dieron dinero", `l:cat:${id}:entrega`).row().text("❌ Descartar", `l:desc:${id}`);
}

/** Le cuenta a la persona lo que se leyó (lo usa también el reintento de fondo). */
export async function notificarLectura(api: Api, chatId: number, r: ResultadoLeer): Promise<void> {
  if (!r.ok) {
    await api.sendMessage(chatId, r.error === "pendiente" ? `⏳ ${r.mensaje}` : `⚠️ ${r.mensaje}`);
    return;
  }
  const l = r.lectura;
  if (l.tipo === "gasto" || l.tipo === "entrega" || l.tipo === "inicio_viaje" || l.tipo === "fin_viaje") {
    const pregunta = l.tipo === "inicio_viaje" ? "¿Abro el viaje?" : l.tipo === "fin_viaje" ? "¿Lo cierro?" : "¿Lo guardo?";
    await api.sendMessage(chatId, `${resumenLectura(l, r.contexto)}\n${pregunta}`, { reply_markup: tecladoConfirmar(r.documentoId) });
    return;
  }
  await api.sendMessage(chatId, `${resumenLectura(l)} ¿Qué gasto es? Elige y luego te pido el monto.`, { reply_markup: tecladoCategorias(r.documentoId) });
}

/** Lo que el gasto tomará solo, con la unidad que el bot deduce (la única, la última usada o la escrita). */
async function contextoDe(c: ContextoBot, deps: Dependencias, texto?: string | null): Promise<string | null> {
  const u = await unidadImplicita(c, deps, texto ?? undefined);
  return u ? describirContexto(await capturarContexto(deps.ctx, { vehiculoId: u.id })) : null;
}

/** Avisa la lectura con el contexto de la unidad. */
async function avisarConContexto(c: ContextoBot, deps: Dependencias, r: ResultadoLeer, texto?: string | null): Promise<void> {
  await notificarLectura(c.api, c.chat!.id, r.ok ? { ...r, contexto: r.contexto ?? (await contextoDe(c, deps, texto)) } : r);
}

async function procesar(c: ContextoBot, deps: Dependencias, m: MensajeEntrante): Promise<void> {
  const chatId = c.chat!.id;
  let doc: { id: number; nuevo: boolean };
  try {
    doc = await recibirMensaje(deps.ctx, { ...m, telegramChatId: chatId, telegramMessageId: c.msg?.message_id, usuarioId: c.session.usuarioId });
  } catch (e) {
    if (e instanceof ErrorNegocio) {
      await c.reply(`⚠️ ${e.message}`);
      return;
    }
    throw e;
  }
  if (!doc.nuevo) {
    const d = await obtenerDocumento(deps.ctx, doc.id);
    if (d.estado === "confirmado") {
      await c.reply("Esta foto ya la había guardado antes.");
      return;
    }
    if (d.estado === "por_confirmar" && d.lectura) {
      await avisarConContexto(c, deps, { ok: true, documentoId: doc.id, lectura: d.lectura }, d.texto);
      return;
    }
  }
  await c.reply("👀 Leyendo…");
  const texto = "texto" in m ? m.texto : undefined;
  deps.enSegundoPlano(async () => avisarConContexto(c, deps, await leerDocumento(deps.ctx, doc.id), texto));
}

async function descargar(deps: Dependencias, fileId: string): Promise<Buffer | null> {
  try {
    return await deps.descargarArchivo(fileId);
  } catch (e) {
    deps.log.error("no se pudo descargar el archivo de Telegram", e);
    return null;
  }
}

async function guardar(c: ContextoBot, deps: Dependencias, documentoId: number, vehiculoId: number | null): Promise<void> {
  try {
    const r = await confirmarLectura(deps.ctx, documentoId, { vehiculoId, usuarioId: c.session.usuarioId });
    delete c.session.flujo;
    if (r.tipo === "ya_confirmado") {
      await c.reply("Ya lo guardé.");
      return;
    }
    const u = vehiculoId ? await buscarUnidad(deps.ctx, vehiculoId) : null;
    if (vehiculoId) recordarUnidad(c, vehiculoId);
    const d = await obtenerDocumento(deps.ctx, documentoId);
    if (r.tipo === "inicio_viaje" || r.tipo === "fin_viaje") {
      const l = await liquidacionViaje(deps.ctx, r.viajeId);
      await c.reply(r.tipo === "inicio_viaje"
        ? `✅ VIAJE ABIERTO · ${r.viajeCodigo}\n${u ? `${u.codigo} · ` : ""}${r.ruta}${r.adelanto ? ` · adelanto ${formatearSoles(r.adelanto)} anotado` : ""}${l.presupuestoTotal ? `\nPresupuesto: ${formatearSoles(l.presupuestoTotal)}` : ""}. Manda tus gastos y al llegar escribe «ya llegué».`
        : `✅ VIAJE CERRADO · ${r.viajeCodigo}\n${textoLiquidacion(l)}\nSi tienes el odómetro, mándalo con /km.`);
      await registrarEvento(deps.ctx, {
        usuarioId: c.session.usuarioId, autor: autor(c), comando: r.tipo === "inicio_viaje" ? "/viaje (lectura)" : "/fin (lectura)",
        texto: `${u ? `${u.codigo} · ` : ""}${r.viajeCodigo}${r.tipo === "inicio_viaje" ? ` · ${r.ruta}` : " cerrado"}`, vehiculoId, entidad: "viaje", entidadId: r.viajeId,
      });
      return;
    }
    const que = d.lectura ? resumenLectura(d.lectura).split("\n")[0] : formatearSoles(r.monto);
    const texto = r.tipo === "gasto"
      ? `✅ GASTO GUARDADO\n${u ? `${u.codigo} · ` : ""}${que}${r.viajeCodigo ? ` · ${r.viajeCodigo}` : ""}${d.tipo === "foto" ? " · 📷 foto guardada" : ""}. Ya aparece en Finanzas.`
      : `✅ ENTREGA ANOTADA en ${r.viajeCodigo}\n${que}. Se descuenta en la liquidación del viaje.`;
    const saldo = await lineaSaldo(deps, vehiculoId);
    await c.reply(texto + (r.tipo === "gasto" && r.avisoKm ? `\n⚠️ ${r.avisoKm}` : "") + saldo);
    await registrarEvento(deps.ctx, {
      usuarioId: c.session.usuarioId, autor: autor(c), comando: r.tipo === "gasto" ? "gasto (lectura)" : "entrega (lectura)", texto: `${u ? `${u.codigo} · ` : ""}${que}`,
      vehiculoId, entidad: r.tipo, entidadId: r.tipo === "gasto" ? r.gastoId : r.entregaId,
    });
  } catch (e) {
    if (!(e instanceof ErrorNegocio)) throw e;
    await c.reply(`⚠️ ${e.message}`);
  }
}

/** Antes de guardar: al cargar combustible sin km pide el del tablero (una vez); luego la unidad si hace falta. */
async function continuarGuardado(c: ContextoBot, deps: Dependencias, id: number, preguntarKm = true): Promise<void> {
  const d = await obtenerDocumento(deps.ctx, id).catch(() => null);
  if (!d) return void (await c.reply("Ese mensaje ya no existe."));
  if (preguntarKm && d.estado === "por_confirmar" && d.lectura?.tipo === "gasto" && d.lectura.categoria === "combustible" && !d.lectura.kmOdometro) {
    c.session.flujo = { tipo: "lectura", paso: "km", documentoId: id } satisfies EstadoFlujoLectura;
    await c.reply("⛽ ¿Km del tablero? (escribe solo el número)", { reply_markup: new InlineKeyboard().text("No sé", `l:nokm:${id}`) });
    return;
  }
  const u = await unidadImplicita(c, deps, d.texto ?? undefined);
  if (!u) {
    await c.reply("¿De qué unidad es?", { reply_markup: tecladoUnidades(await listarUnidades(deps.ctx), `l:u:${id}:`) });
    return;
  }
  await guardar(c, deps, id, u.id);
}

async function manejarBoton(c: Filter<ContextoBot, "callback_query:data">, deps: Dependencias): Promise<void> {
  await c.answerCallbackQuery().catch(() => {});
  const [, accion, idTexto, valor] = c.callbackQuery.data.split(":");
  const id = Number(idTexto);
  if (accion === "ok") {
    await continuarGuardado(c, deps, id);
  } else if (accion === "nokm") {
    delete c.session.flujo;
    await continuarGuardado(c, deps, id, false);
  } else if (accion === "u") {
    await guardar(c, deps, id, Number(valor));
  } else if (accion === "corr") {
    c.session.flujo = { tipo: "lectura", paso: "correccion", documentoId: id } satisfies EstadoFlujoLectura;
    await c.reply("¿Qué corrijo? Por ejemplo: eran 305 · era peaje · me lo dieron por yape");
  } else if (accion === "desc") {
    delete c.session.flujo;
    try {
      await descartarLectura(deps.ctx, id, c.session.usuarioId);
    } catch (e) {
      // Ya se guardó (o descartó) desde la web o con otro botón: no se toca.
      if (!(e instanceof ErrorNegocio)) throw e;
      return void (await c.reply(`⚠️ ${e.message}`));
    }
    await c.reply("❌ Descartado. No guardé nada.");
  } else if (accion === "cat") {
    const activas = await listarCategorias(deps.ctx, { soloActivas: true });
    const categoria = valor === "entrega" ? "entrega" : activas.some((x) => x.clave === valor) ? valor! : null;
    if (!categoria) return void (await c.reply("Ese botón ya no está activo."));
    c.session.flujo = { tipo: "lectura", paso: "monto", documentoId: id, categoria } satisfies EstadoFlujoLectura;
    await c.reply(categoria === "entrega" ? "¿Cuánto te dieron? (ej. 500)" : `${icono(categoria)} ${nombreCategoria(categoria, activas)}: ¿cuánto fue? (ej. 350.50)`);
  } else {
    await c.reply("Ese botón ya no está activo.");
  }
}

async function manejarTexto(c: Filter<ContextoBot, "message:text">, deps: Dependencias, next: () => Promise<void>): Promise<void> {
  const t = c.message.text.trim();
  if (t.startsWith("/")) return next();
  const f = flujoLectura(c);
  if (f?.paso === "correccion") {
    delete c.session.flujo;
    await c.reply("👀 Corrigiendo…");
    await avisarConContexto(c, deps, await corregirLectura(deps.ctx, f.documentoId, t));
    return;
  }
  if (f?.paso === "km") {
    const km = Number(t.replace(/[,.\s]|km/gi, ""));
    if (!Number.isInteger(km) || km <= 0) return void (await c.reply("Escribe solo el número del tablero, por ejemplo 402380, o toca «No sé»."));
    delete c.session.flujo;
    const d = await obtenerDocumento(deps.ctx, f.documentoId);
    if (d.lectura?.tipo === "gasto") {
      try {
        await fijarLectura(deps.ctx, f.documentoId, { ...d.lectura, kmOdometro: km });
      } catch (e) {
        if (!(e instanceof ErrorNegocio)) throw e;
        return void (await c.reply(`⚠️ ${e.message}`));
      }
    }
    await continuarGuardado(c, deps, f.documentoId, false);
    return;
  }
  if (f?.paso === "monto") {
    const monto = montoDe(t);
    if (monto === null) return void (await c.reply("Escribe solo el monto, por ejemplo: 350.50"));
    delete c.session.flujo;
    const lectura: Lectura = f.categoria === "entrega"
      ? { tipo: "entrega", monto, medio: /yape|plin/i.test(t) ? "yape" : "efectivo", fecha: null, dudas: [] }
      : { tipo: "gasto", categoria: f.categoria ?? "otros_viaje", monto, fecha: null, proveedorRuc: null, proveedorNombre: null, comprobante: null, nota: null, dudas: [], medioPago: null, kmOdometro: null };
    try {
      await avisarConContexto(c, deps, { ok: true, documentoId: f.documentoId, lectura: await fijarLectura(deps.ctx, f.documentoId, lectura) });
    } catch (e) {
      if (!(e instanceof ErrorNegocio)) throw e;
      await c.reply(`⚠️ ${e.message}`);
    }
    return;
  }
  // Un texto suelto con palabras y un número («grifo 350», «peaje 28.50») es un gasto por leer; un
  // número solo no (suele ser la respuesta a una conversación que ya terminó).
  const conMonto = /\d/.test(t) && /\p{L}{3,}/u.test(t);
  // Sin \b: en JavaScript no reconoce la «é» como letra.
  const deViaje = /(?<!\p{L})(salgo|saliendo|salimos|parto|partimos|llegu[eé]|llegamos|ya volv[ií]|volvimos)(?!\p{L})/iu.test(t);
  if (!c.session.flujo && (conMonto || deViaje)) return procesar(c, deps, { tipo: "texto", texto: t });
  return next();
}

/**
 * Se registra después de los comandos y de los flujos de flota y factura, y antes que el de guía:
 * las fotos y notas de voz son siempre boletas (un PDF es una guía), y el texto suelto con un
 * monto se lee como gasto cuando no hay otra conversación abierta.
 */
export function registrarFlujoLectura(bot: Bot<ContextoBot>, deps: Dependencias): void {
  bot.on("message:photo", async (c, next) => {
    if (c.session.flujo && c.session.flujo.tipo !== "lectura") return next();
    const foto = c.message.photo[c.message.photo.length - 1]!;
    const contenido = await descargar(deps, foto.file_id);
    if (!contenido) return void (await c.reply("No pude descargar la foto. Mándala otra vez."));
    await procesar(c, deps, { tipo: "foto", contenido, mime: "image/jpeg", texto: c.message.caption, telegramFileId: foto.file_id });
  });
  bot.on(["message:voice", "message:audio"], async (c) => {
    const a = c.message.voice ?? c.message.audio!;
    const contenido = await descargar(deps, a.file_id);
    if (!contenido) return void (await c.reply("No pude descargar la nota de voz. Mándala otra vez."));
    await procesar(c, deps, { tipo: "voz", contenido, mime: a.mime_type ?? "audio/ogg", telegramFileId: a.file_id });
  });
  bot.callbackQuery(/^l:/, (c) => manejarBoton(c, deps));
  bot.on("message:text", (c, next) => manejarTexto(c, deps, next));
}
