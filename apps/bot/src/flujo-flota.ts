import {
  buscarRepuestoPorCodigo, buscarUnidad, categoriaDesdeTexto, chatAlertas, crearEnlaceWeb, duenoTelegramId, ErrorNegocio,
  finalizarViajeFlota, formatearSoles, guardarChatAlertas, listarRepuestos, listarUnidades, NOMBRE_CATEGORIA, nombrePieza, parsearMonto, piezasDeTipo,
  partesDeUnidad, registrarCambio, registrarCompra, registrarEvento, registrarGasto, registrarLecturaOdometro,
  registrarViajeFlota, tomarAlertasDesgaste, viajeEnCursoDeUnidad, type Unidad,
} from "@sunatapp/core";
import { InlineKeyboard, InputFile, type Api, type Bot, type Context, type Filter } from "grammy";
import type { ContextoBot, Dependencias } from "./bot";

/** Conversaciones de flota que viven en la sesión (una a la vez, como las de guía y factura). */
export type EstadoFlujoFlota =
  | { tipo: "viaje"; paso: "unidad" | "ruta"; vehiculoId?: number }
  | { tipo: "fin"; paso: "unidad" | "km"; viajeId?: number; vehiculoId?: number }
  | { tipo: "gasto"; paso: "unidad"; categoria: string; monto: number; nota: string | null; rutaFoto: string | null }
  | { tipo: "km"; paso: "unidad"; km: number }
  | {
    tipo: "cambio"; paso: "unidad" | "parte" | "pieza" | "repuesto" | "cantidad" | "mano"; vehiculoId?: number; parteId?: number;
    /** La pieza exacta del modelo 3D (cuál de las 12 llantas, por ejemplo). */
    componente?: string; repuestoId?: number | null; cantidad?: number;
  };

type CtxTexto = Filter<ContextoBot, "message:text">;
type CtxBoton = Filter<ContextoBot, "callback_query:data">;

const TIPOS_FLOTA = new Set(["viaje", "fin", "gasto", "km", "cambio"]);

function flujoFlota(c: ContextoBot): EstadoFlujoFlota | undefined {
  return c.session.flujo && TIPOS_FLOTA.has(c.session.flujo.tipo) ? (c.session.flujo as EstadoFlujoFlota) : undefined;
}

export const autor = (c: Context) => [c.from?.first_name, c.from?.last_name].filter(Boolean).join(" ") || "Telegram";

function error(e: unknown): string {
  if (e instanceof ErrorNegocio) return `⚠️ ${e.message}`;
  throw e;
}

/** Teclado con las unidades activas. */
export function tecladoUnidades(unidades: Unidad[], prefijo: string): InlineKeyboard {
  const k = new InlineKeyboard();
  unidades.forEach((u, i) => {
    k.text(u.codigo, `${prefijo}${u.id}`);
    if (i % 5 === 4) k.row();
  });
  return k;
}

/**
 * La unidad con la que trabaja quien escribe: la que nombró ("T-02" en el texto), la que usó por
 * última vez, la única de la flota o la que tiene su viaje en curso. null = hay que preguntar.
 */
export async function unidadImplicita(c: ContextoBot, deps: Dependencias, texto?: string): Promise<Unidad | null> {
  const m = texto ? /\b(T-?\d{1,3})\b/i.exec(texto) : null;
  if (m) return buscarUnidad(deps.ctx, m[1]!);
  const unidades = await listarUnidades(deps.ctx);
  if (unidades.length === 1) return unidades[0]!;
  const ultima = c.session.unidadId;
  if (ultima) return unidades.find((u) => u.id === ultima) ?? null;
  const enRuta = unidades.filter((u) => u.estado === "en_ruta");
  return enRuta.length === 1 ? enRuta[0]! : null;
}

export function recordarUnidad(c: ContextoBot, id: number): void {
  c.session.unidadId = id;
}

/** Envía un aviso al grupo del equipo (o al dueño por privado si no hay grupo). */
export async function enviarAlerta(api: Api, deps: Dependencias, texto: string, adjunto?: { contenido: Buffer; nombre: string }): Promise<void> {
  const chat = (await chatAlertas(deps.ctx)) ?? (await duenoTelegramId(deps.ctx));
  if (chat === null) return;
  if (adjunto) await api.sendDocument(chat, new InputFile(adjunto.contenido, adjunto.nombre), { caption: texto.slice(0, 1000) });
  else await api.sendMessage(chat, texto);
}

/** Revisa los umbrales de desgaste (70 % / 90 %) y avisa al grupo; cada umbral una sola vez. */
export async function avisarDesgaste(api: Api, deps: Dependencias, vehiculoIds?: number[]): Promise<number> {
  const alertas = await tomarAlertasDesgaste(deps.ctx, vehiculoIds);
  for (const a of alertas) {
    const p = a.parte;
    const texto = `${a.umbral === 90 ? "🔴" : "🟡"} ALERTA · ${a.unidad}\n${p.nombre} al ${p.pct}%. Quedan ≈ ${p.restanteTexto.toLowerCase()}. ${a.umbral === 90 ? "Cambiar ya." : "Programa el cambio."}`;
    try {
      await enviarAlerta(api, deps, texto);
      await registrarEvento(deps.ctx, { comando: "alerta", texto: `${a.unidad} · ${p.nombreCorto} al ${p.pct}%`, vehiculoId: p.vehiculoId, autor: "Bot" });
    } catch (e) {
      deps.log.error("no se pudo enviar la alerta de desgaste", e);
    }
  }
  return alertas.length;
}

// ── /viaje ───────────────────────────────────────────────────────────────────

async function iniciarViaje(c: ContextoBot, deps: Dependencias, texto: string): Promise<void> {
  const unidad = /\bT-?\d/i.test(texto) ? await unidadImplicita(c, deps, texto) : null;
  const resto = texto.replace(/^inicio\b/i, "").replace(/\bT-?\d{1,3}\b/i, "").trim();
  if (unidad && resto) {
    c.session.flujo = { tipo: "viaje", paso: "ruta", vehiculoId: unidad.id } satisfies EstadoFlujoFlota;
    await recibirRuta(c, deps, resto);
    return;
  }
  const unidades = (await listarUnidades(deps.ctx)).filter((u) => u.estado !== "en_ruta");
  if (unidades.length === 0) {
    await c.reply("Todas las unidades están en ruta. Cierra un viaje con /fin.");
    return;
  }
  c.session.flujo = { tipo: "viaje", paso: "unidad" } satisfies EstadoFlujoFlota;
  await c.reply("🚛 ¿Qué unidad sale?", { reply_markup: tecladoUnidades(unidades, "t:vu:") });
}

/** "Juliaca → Arequipa · 30 ton" · "Juliaca a Arequipa 30t" · "Puno - Lima". */
export function leerRuta(texto: string): { origen: string; destino: string; toneladas: number | null } | null {
  const ton = /(\d+(?:[.,]\d+)?)\s*(?:t|ton|tons|toneladas|tn)\b/i.exec(texto);
  const sinTon = (ton ? texto.replace(ton[0], "") : texto).replace(/[·|,]/g, " ").trim();
  const partes = sinTon.split(/\s*(?:→|->|>|–|—|\s-\s|\sa\s|\shacia\s)\s*/i).map((s) => s.trim()).filter(Boolean);
  if (partes.length < 2) return null;
  const cap = (s: string) => s.replace(/\s+/g, " ").replace(/\b\p{L}/gu, (l) => l.toUpperCase());
  return { origen: cap(partes[0]!), destino: cap(partes[partes.length - 1]!), toneladas: ton ? Number(ton[1]!.replace(",", ".")) : null };
}

async function recibirRuta(c: ContextoBot, deps: Dependencias, texto: string): Promise<void> {
  const f = flujoFlota(c) as Extract<EstadoFlujoFlota, { tipo: "viaje" }>;
  const r = leerRuta(texto);
  if (!r) {
    await c.reply("Escribe la ruta y las toneladas, por ejemplo: Juliaca → Arequipa · 30 ton");
    return;
  }
  try {
    const v = await registrarViajeFlota(deps.ctx, {
      vehiculoId: f.vehiculoId!, origenLugar: r.origen, destinoLugar: r.destino, toneladas: r.toneladas, estado: "en_curso",
      origen: "telegram", usuarioId: c.session.usuarioId,
    });
    delete c.session.flujo;
    recordarUnidad(c, f.vehiculoId!);
    const u = await buscarUnidad(deps.ctx, f.vehiculoId!);
    await c.reply(`✅ VIAJE REGISTRADO · ${v.codigo}\n${u?.codigo} · ${r.origen} → ${r.destino}${r.toneladas ? ` · ${r.toneladas} ton` : ""}\nSe suma 1 viaje a cada parte de la unidad. Al llegar: /fin`);
    await registrarEvento(deps.ctx, { usuarioId: c.session.usuarioId, autor: autor(c), comando: "/viaje inicio", texto: `${u?.codigo} sale: ${r.origen} → ${r.destino}${r.toneladas ? ` · ${r.toneladas} ton` : ""}`, vehiculoId: f.vehiculoId, entidad: "viaje", entidadId: v.id });
    await avisarDesgaste(c.api, deps, [f.vehiculoId!]);
  } catch (e) {
    delete c.session.flujo;
    await c.reply(error(e));
  }
}

// ── /fin ─────────────────────────────────────────────────────────────────────

async function iniciarFin(c: ContextoBot, deps: Dependencias, texto: string): Promise<void> {
  const unidades = await listarUnidades(deps.ctx);
  const conViaje: Array<{ u: Unidad; viajeId: number }> = [];
  for (const u of unidades) {
    const v = await viajeEnCursoDeUnidad(deps.ctx, u.id);
    if (v) conViaje.push({ u, viajeId: v.id });
  }
  if (conViaje.length === 0) {
    await c.reply("No hay viajes en curso. Para registrar uno: /viaje");
    return;
  }
  const nombrada = /\bT-?\d/i.test(texto) ? await unidadImplicita(c, deps, texto) : null;
  const elegido = nombrada ? conViaje.find((x) => x.u.id === nombrada.id) : conViaje.length === 1 ? conViaje[0] : conViaje.find((x) => x.u.id === c.session.unidadId);
  if (!elegido) {
    c.session.flujo = { tipo: "fin", paso: "unidad" } satisfies EstadoFlujoFlota;
    await c.reply("¿Qué unidad llegó?", { reply_markup: tecladoUnidades(conViaje.map((x) => x.u), "t:fu:") });
    return;
  }
  c.session.flujo = { tipo: "fin", paso: "km", viajeId: elegido.viajeId, vehiculoId: elegido.u.id } satisfies EstadoFlujoFlota;
  const num = /\b(\d[\d,.]*)\b/.exec(texto.replace(/\bT-?\d{1,3}\b/i, ""));
  if (num) {
    await recibirKmFinal(c, deps, num[1]!);
    return;
  }
  await c.reply(`🏁 ${elegido.u.codigo}: escribe el odómetro final (el actual es ${elegido.u.odometroKm.toLocaleString("en-US")} km) o los km recorridos.`);
}

async function recibirKmFinal(c: ContextoBot, deps: Dependencias, texto: string): Promise<void> {
  const f = flujoFlota(c) as Extract<EstadoFlujoFlota, { tipo: "fin" }>;
  const n = Number(texto.replace(/[,.\s]|km/gi, ""));
  if (!Number.isInteger(n) || n <= 0) {
    await c.reply("Escribe solo el número del odómetro (ej. 412380) o los km (ej. 1290).");
    return;
  }
  const u = (await buscarUnidad(deps.ctx, f.vehiculoId!))!;
  try {
    // Un número menor que el odómetro actual son los km recorridos, no la lectura.
    const r = await finalizarViajeFlota(deps.ctx, { viajeId: f.viajeId!, ...(n > u.odometroKm ? { odometroFin: n } : { km: n }), usuarioId: c.session.usuarioId });
    delete c.session.flujo;
    await c.reply(`✅ VIAJE CERRADO · ${r.codigo}\n${u.codigo}: +${(r.km ?? 0).toLocaleString("en-US")} km sumados a todas sus partes.`);
    await registrarEvento(deps.ctx, { usuarioId: c.session.usuarioId, autor: autor(c), comando: "/fin", texto: `${u.codigo} llegó · ${(r.km ?? 0).toLocaleString("en-US")} km`, vehiculoId: u.id, entidad: "viaje", entidadId: f.viajeId });
    await avisarDesgaste(c.api, deps, [u.id]);
  } catch (e) {
    await c.reply(error(e));
  }
}

// ── /gasto ───────────────────────────────────────────────────────────────────

/** "/gasto combustible 480 grifo Primax" → categoría, monto y nota. */
export function leerGasto(texto: string): { categoria: string; monto: number; nota: string | null } | null {
  const partes = texto.trim().split(/\s+/);
  if (partes.length < 2) return null;
  const categoria = categoriaDesdeTexto(partes[0]!);
  if (!categoria) return null;
  const monto = parsearMonto(partes[1]!);
  if (monto === null) return null;
  const nota = partes.slice(2).join(" ").replace(/\bT-?\d{1,3}\b/i, "").trim();
  return { categoria, monto, nota: nota || null };
}

const USO_GASTO = "Uso: /gasto combustible 480 [detalle]\nCategorías: combustible, peaje, viáticos, hospedaje, estiba, balanza, cochera, reparación, otros.\nPuedes mandar la foto del voucher con el comando como pie de foto.";

async function comandoGasto(c: ContextoBot, deps: Dependencias, texto: string, rutaFoto: string | null): Promise<void> {
  const g = leerGasto(texto);
  if (!g) {
    await c.reply(USO_GASTO);
    return;
  }
  const unidad = await unidadImplicita(c, deps, texto);
  if (!unidad) {
    c.session.flujo = { tipo: "gasto", paso: "unidad", ...g, rutaFoto } satisfies EstadoFlujoFlota;
    await c.reply("¿De qué unidad es el gasto?", { reply_markup: tecladoUnidades(await listarUnidades(deps.ctx), "t:gu:") });
    return;
  }
  await guardarGasto(c, deps, unidad, { ...g, rutaFoto });
}

async function guardarGasto(c: ContextoBot, deps: Dependencias, u: Unidad, g: { categoria: string; monto: number; nota: string | null; rutaFoto: string | null }): Promise<void> {
  try {
    const r = await registrarGasto(deps.ctx, {
      categoria: g.categoria as never, monto: g.monto, vehiculoId: u.id, nota: g.nota, rutaFoto: g.rutaFoto, origen: "telegram", usuarioId: c.session.usuarioId,
    });
    delete c.session.flujo;
    recordarUnidad(c, u.id);
    const cat = NOMBRE_CATEGORIA[g.categoria as keyof typeof NOMBRE_CATEGORIA];
    await c.reply(`✅ GASTO GUARDADO\n${u.codigo} · ${cat} · ${formatearSoles(g.monto)}${r.viajeCodigo ? ` · ${r.viajeCodigo}` : ""}${g.rutaFoto ? " · 📷 voucher guardado" : ""}. Ya aparece en Finanzas.`);
    await registrarEvento(deps.ctx, { usuarioId: c.session.usuarioId, autor: autor(c), comando: "/gasto", texto: `${cat} ${formatearSoles(g.monto)}${g.rutaFoto ? " · con foto del voucher" : ""}`, vehiculoId: u.id, entidad: "gasto", entidadId: r.id });
  } catch (e) {
    delete c.session.flujo;
    await c.reply(error(e));
  }
}

async function fotoConGasto(c: Filter<ContextoBot, "message:photo">, deps: Dependencias, next: () => Promise<void>): Promise<void> {
  const caption = c.message.caption?.trim() ?? "";
  const m = /^\/gasto(?:@\w+)?\s*(.*)$/is.exec(caption);
  // Sin /gasto en el pie de foto la atiende el flujo de guía (que explica qué hacer).
  if (!m) return next();
  const foto = c.message.photo[c.message.photo.length - 1]!;
  let rutaFoto: string | null = null;
  try {
    const contenido = await deps.descargarArchivo(foto.file_id);
    rutaFoto = await deps.ctx.almacen.guardar(`vouchers/${Date.now()}-${foto.file_unique_id}.jpg`, contenido);
  } catch (e) {
    deps.log.error("no se pudo guardar la foto del voucher", e);
  }
  await comandoGasto(c, deps, m[1]!, rutaFoto);
}

// ── /km ──────────────────────────────────────────────────────────────────────

async function comandoKm(c: ContextoBot, deps: Dependencias, texto: string): Promise<void> {
  const n = Number(texto.replace(/\bT-?\d{1,3}\b/i, "").replace(/[,.\s]|km/gi, ""));
  if (!Number.isInteger(n) || n <= 0) {
    await c.reply("Uso: /km 412380 [T-01] — la lectura del odómetro.");
    return;
  }
  const unidad = await unidadImplicita(c, deps, texto);
  if (!unidad) {
    c.session.flujo = { tipo: "km", paso: "unidad", km: n } satisfies EstadoFlujoFlota;
    await c.reply("¿De qué unidad es el odómetro?", { reply_markup: tecladoUnidades(await listarUnidades(deps.ctx), "t:ku:") });
    return;
  }
  await guardarKm(c, deps, unidad, n);
}

async function guardarKm(c: ContextoBot, deps: Dependencias, u: Unidad, km: number): Promise<void> {
  try {
    const r = await registrarLecturaOdometro(deps.ctx, { vehiculoId: u.id, km, origen: "telegram", usuarioId: c.session.usuarioId });
    delete c.session.flujo;
    recordarUnidad(c, u.id);
    const partes = (await partesDeUnidad(deps.ctx, u.id)).slice(0, 3).map((p) => p.nombreCorto.toLowerCase());
    await c.reply(`✅ Odómetro de ${u.codigo} actualizado: +${r.sumados.toLocaleString("en-US")} km${partes.length ? ` a ${partes.join(", ")}…` : ""}`);
    await registrarEvento(deps.ctx, { usuarioId: c.session.usuarioId, autor: autor(c), comando: "/km", texto: `${u.codigo} odómetro ${km.toLocaleString("en-US")} km (+${r.sumados.toLocaleString("en-US")})`, vehiculoId: u.id });
    await avisarDesgaste(c.api, deps, [u.id]);
  } catch (e) {
    delete c.session.flujo;
    await c.reply(error(e));
  }
}

// ── /estado ──────────────────────────────────────────────────────────────────

async function comandoEstado(c: ContextoBot, deps: Dependencias, texto: string): Promise<void> {
  const unidades = texto ? [await buscarUnidad(deps.ctx, texto)].filter((u): u is Unidad => !!u) : await listarUnidades(deps.ctx);
  if (unidades.length === 0) {
    await c.reply(texto ? `No encontré la unidad ${texto}.` : "No hay unidades registradas.");
    return;
  }
  const bloques: string[] = [];
  for (const u of unidades) {
    const partes = await partesDeUnidad(deps.ctx, u.id);
    const icono = (e: string) => (e === "cambiar" ? "🔴" : e === "proximo" ? "🟡" : "🔵");
    const top = partes.slice(0, texto ? 6 : 3).map((p) => `${icono(p.estado)} ${p.nombreCorto} ${p.pct}% · ${p.restanteTexto.toLowerCase()}`);
    bloques.push(`🚛 ${u.codigo} · ${u.placa} · ${u.odometroKm.toLocaleString("en-US")} km\n${top.join("\n") || "sin partes controladas"}`);
  }
  await c.reply(bloques.join("\n\n"));
}

// ── /cambio ──────────────────────────────────────────────────────────────────

async function pasoCambio(c: ContextoBot, deps: Dependencias): Promise<void> {
  const f = flujoFlota(c) as Extract<EstadoFlujoFlota, { tipo: "cambio" }>;
  if (f.paso === "unidad") {
    await c.reply("🔧 ¿En qué unidad fue el cambio?", { reply_markup: tecladoUnidades(await listarUnidades(deps.ctx), "t:cu:") });
  } else if (f.paso === "parte") {
    const partes = await partesDeUnidad(deps.ctx, f.vehiculoId!);
    const k = new InlineKeyboard();
    for (const p of partes.slice(0, 12)) k.text(`${p.nombreCorto} ${p.pct}%`, `t:cp:${p.id}`).row();
    k.text("Reparación general (sin parte)", "t:cp:0");
    await c.reply("¿Qué parte se cambió?", { reply_markup: k });
  } else if (f.paso === "pieza") {
    const parte = (await partesDeUnidad(deps.ctx, f.vehiculoId!)).find((p) => p.id === f.parteId)!;
    const k = new InlineKeyboard();
    piezasDeTipo({ zona: parte.zona, codigo: parte.codigoTipo }).slice(0, 24).forEach((id, i) => {
      // «Llanta semirremolque eje 2 · derecha exterior» → «Eje 2 · derecha exterior» (cabe en el botón).
      const corto = nombrePieza(id)!.replace(/^(Llanta|Frenos ·)\s*(semirremolque|tracción)?\s*/i, "");
      k.text(corto.charAt(0).toUpperCase() + corto.slice(1), `t:cz:${id}`);
      if (i % 2 === 1) k.row();
    });
    k.row().text("No sé / varias", "t:cz:-");
    await c.reply(`¿Cuál exactamente? (${parte.nombreCorto.toLowerCase()}) Queda marcada en el modelo 3D.`, { reply_markup: k });
  } else if (f.paso === "repuesto") {
    const parte = f.parteId ? (await partesDeUnidad(deps.ctx, f.vehiculoId!)).find((p) => p.id === f.parteId) : undefined;
    const puntaje = (r: { tipoParteId: number | null; piezas: string[] }) => (f.componente && r.piezas.includes(f.componente) ? 2 : 0) + (r.tipoParteId === parte?.tipoParteId ? 1 : 0);
    const reps = (await listarRepuestos(deps.ctx)).filter((r) => r.stock > 0).sort((a, b) => puntaje(b) - puntaje(a)).slice(0, 10);
    const k = new InlineKeyboard();
    for (const r of reps) k.text(`${r.codigo} ${r.nombre.slice(0, 22)} (${r.stock})`, `t:cr:${r.id}`).row();
    k.text("Sin repuesto del almacén", "t:cr:0");
    await c.reply("¿Qué repuesto se usó?", { reply_markup: k });
  } else if (f.paso === "cantidad") {
    await c.reply("¿Cuántas unidades del repuesto? (ej. 6)");
  } else {
    await c.reply("¿Cuánto costó la mano de obra? Escribe el monto en soles (0 si no hubo). Puedes agregar el taller: 150 Taller Juliaca");
  }
}

async function terminarCambio(c: ContextoBot, deps: Dependencias, texto: string): Promise<void> {
  const f = flujoFlota(c) as Extract<EstadoFlujoFlota, { tipo: "cambio" }>;
  const [primero, ...resto] = texto.trim().split(/\s+/);
  const mano = primero === "0" ? 0 : parsearMonto(primero ?? "");
  if (mano === null) {
    await c.reply("No entendí el monto. Escribe por ejemplo: 150 (o 0 si no hubo mano de obra).");
    return;
  }
  delete c.session.flujo;
  try {
    const r = await registrarCambio(deps.ctx, {
      vehiculoId: f.vehiculoId!, parteInstaladaId: f.parteId || null, componente: f.componente ?? null, tipo: "preventivo",
      repuestos: f.repuestoId ? [{ repuestoId: f.repuestoId, cantidad: f.cantidad ?? 1 }] : [], manoObra: mano,
      taller: resto.join(" ") || null, origen: "telegram", usuarioId: c.session.usuarioId,
    });
    recordarUnidad(c, f.vehiculoId!);
    await c.reply(`✅ ${r.resumen}`);
    await registrarEvento(deps.ctx, { usuarioId: c.session.usuarioId, autor: autor(c), comando: "/cambio", texto: `${r.unidad} · ${r.trabajo}${r.desgastePct !== null ? ` al ${r.desgastePct}% (${r.etiqueta})` : ""} · ${formatearSoles(r.costoTotal)}`, vehiculoId: f.vehiculoId, entidad: "reparacion", entidadId: r.reparacionId });
    let aviso = r.resumen;
    if (r.stockBajo.length) aviso += `\n⚠️ Stock bajo: ${r.stockBajo.map((s) => `${s.codigo} ${s.nombre} (${s.stock})`).join(", ")}`;
    if (c.chat?.id !== (await chatAlertas(deps.ctx))) await enviarAlerta(c.api, deps, aviso).catch((e) => deps.log.error("aviso de cambio", e));
  } catch (e) {
    await c.reply(error(e));
  }
}

// ── /compra ──────────────────────────────────────────────────────────────────

const USO_COMPRA = "Uso: /compra REP-014 6 180 [proveedor]\n(código del repuesto, cantidad, costo unitario en soles). Los códigos están en Inventario de la web.";

async function comandoCompra(c: ContextoBot, deps: Dependencias, texto: string): Promise<void> {
  const [codigo, cant, costo, ...prov] = texto.trim().split(/\s+/);
  const cantidad = Number(cant);
  const unitario = parsearMonto(costo ?? "");
  if (!codigo || !Number.isInteger(cantidad) || cantidad <= 0 || unitario === null) {
    await c.reply(USO_COMPRA);
    return;
  }
  const rep = await buscarRepuestoPorCodigo(deps.ctx, codigo);
  if (!rep) {
    await c.reply(`No encontré el repuesto ${codigo}. Créalo primero en Inventario (web).`);
    return;
  }
  try {
    await registrarCompra(deps.ctx, { repuestoId: rep.id, cantidad, costoUnitario: unitario, proveedor: prov.join(" ") || null, origen: "telegram", usuarioId: c.session.usuarioId });
    await c.reply(`✅ COMPRA REGISTRADA\n${cantidad} × ${rep.codigo} ${rep.nombre} · ${formatearSoles(cantidad * unitario)}\nStock: ${rep.stock + cantidad}`);
    await registrarEvento(deps.ctx, { usuarioId: c.session.usuarioId, autor: autor(c), comando: "/compra", texto: `${cantidad} × ${rep.nombre} · ${formatearSoles(cantidad * unitario)}`, entidad: "repuesto", entidadId: rep.id });
  } catch (e) {
    await c.reply(error(e));
  }
}

// ── Botones y textos ─────────────────────────────────────────────────────────

async function manejarBoton(c: CtxBoton, deps: Dependencias): Promise<void> {
  await c.answerCallbackQuery().catch(() => {});
  const [, accion, valor] = c.callbackQuery.data.split(":");
  const id = Number(valor);
  const f = flujoFlota(c);
  const u = accion?.endsWith("u") ? await buscarUnidad(deps.ctx, id) : null;
  if (accion?.endsWith("u") && !u) {
    await c.reply("Esa unidad ya no existe.");
    return;
  }
  if (accion === "vu" && f?.tipo === "viaje") {
    c.session.flujo = { tipo: "viaje", paso: "ruta", vehiculoId: id } satisfies EstadoFlujoFlota;
    await c.reply(`${u!.codigo} · escribe la ruta y las toneladas, por ejemplo:\nJuliaca → Arequipa · 30 ton`);
  } else if (accion === "fu" && f?.tipo === "fin") {
    const v = await viajeEnCursoDeUnidad(deps.ctx, id);
    if (!v) {
      await c.reply(`${u!.codigo} no tiene viaje en curso.`);
      return;
    }
    c.session.flujo = { tipo: "fin", paso: "km", viajeId: v.id, vehiculoId: id } satisfies EstadoFlujoFlota;
    await c.reply(`🏁 ${u!.codigo}: escribe el odómetro final (el actual es ${u!.odometroKm.toLocaleString("en-US")} km) o los km recorridos.`);
  } else if (accion === "gu" && f?.tipo === "gasto") {
    await guardarGasto(c, deps, u!, f);
  } else if (accion === "ku" && f?.tipo === "km") {
    await guardarKm(c, deps, u!, f.km);
  } else if (accion === "cu" && f?.tipo === "cambio") {
    c.session.flujo = { tipo: "cambio", paso: "parte", vehiculoId: id } satisfies EstadoFlujoFlota;
    await pasoCambio(c, deps);
  } else if (accion === "cp" && f?.tipo === "cambio" && f.paso === "parte") {
    f.parteId = id;
    const parte = id ? (await partesDeUnidad(deps.ctx, f.vehiculoId!)).find((p) => p.id === id) : undefined;
    const piezas = parte ? piezasDeTipo({ zona: parte.zona, codigo: parte.codigoTipo }) : [];
    if (piezas.length === 1) f.componente = piezas[0];
    f.paso = piezas.length > 1 ? "pieza" : "repuesto";
    await pasoCambio(c, deps);
  } else if (accion === "cz" && f?.tipo === "cambio" && f.paso === "pieza") {
    const pz = c.callbackQuery.data.slice("t:cz:".length);
    if (pz !== "-") f.componente = pz;
    f.paso = "repuesto";
    await pasoCambio(c, deps);
  } else if (accion === "cr" && f?.tipo === "cambio" && f.paso === "repuesto") {
    f.repuestoId = id || null;
    f.paso = id ? "cantidad" : "mano";
    await pasoCambio(c, deps);
  } else {
    await c.reply("Ese botón ya no está activo. Empieza de nuevo con el comando.");
  }
}

async function manejarTexto(c: CtxTexto, deps: Dependencias, next: () => Promise<void>): Promise<void> {
  const f = flujoFlota(c);
  if (!f || c.message.text.startsWith("/")) return next();
  const t = c.message.text.trim();
  if (f.tipo === "viaje" && f.paso === "ruta") return recibirRuta(c, deps, t);
  if (f.tipo === "fin" && f.paso === "km") return recibirKmFinal(c, deps, t);
  if (f.tipo === "cambio" && f.paso === "cantidad") {
    const n = Number(t);
    if (!Number.isInteger(n) || n <= 0) {
      await c.reply("Escribe la cantidad como número entero (ej. 6).");
      return;
    }
    f.cantidad = n;
    f.paso = "mano";
    return pasoCambio(c, deps);
  }
  if (f.tipo === "cambio" && f.paso === "mano") return terminarCambio(c, deps, t);
  await c.reply("Elige una opción con los botones de arriba, o escribe /cancelar.");
}

export interface OpcionesFlota {
  /** URL pública de la web para /web; null = /web explica cómo configurarla. */
  urlWeb: string | null;
}

/**
 * Comandos de control de flota. Van antes que los flujos de guía y factura: su texto pasa primero
 * por aquí y cede con `next` cuando no hay una conversación de flota abierta.
 */
export function registrarFlujoFlota(bot: Bot<ContextoBot>, deps: Dependencias, o: OpcionesFlota = { urlWeb: null }): void {
  bot.command("viaje", (c) => {
    const arg = c.match.trim();
    if (/^(fin|llegu[eé])\b/i.test(arg)) return iniciarFin(c, deps, arg.replace(/^\S+/, ""));
    return iniciarViaje(c, deps, arg);
  });
  bot.command("fin", (c) => iniciarFin(c, deps, c.match.trim()));
  bot.command("gasto", (c) => comandoGasto(c, deps, c.match, null));
  bot.command("km", (c) => comandoKm(c, deps, c.match.trim()));
  bot.command("estado", (c) => comandoEstado(c, deps, c.match.trim()));
  bot.command("compra", (c) => comandoCompra(c, deps, c.match));
  bot.command("cambio", async (c) => {
    const u = /\bT-?\d/i.test(c.match) ? await unidadImplicita(c, deps, c.match) : null;
    c.session.flujo = (u ? { tipo: "cambio", paso: "parte", vehiculoId: u.id } : { tipo: "cambio", paso: "unidad" }) satisfies EstadoFlujoFlota;
    await pasoCambio(c, deps);
  });
  bot.command("web", async (c) => {
    if (!o.urlWeb) {
      await c.reply("La web todavía no tiene dirección pública. Pon WEB_URL_PUBLICA en el .env (ej. http://192.168.1.10:3000).");
      return;
    }
    if (c.chat.type !== "private") {
      await c.reply("Pídeme el enlace por mensaje privado: es personal.");
      return;
    }
    const token = await crearEnlaceWeb(deps.ctx, c.session.usuarioId!);
    await c.reply(`🔗 Tu enlace para entrar a la web (vale 10 minutos, un solo uso):\n${o.urlWeb}/entrar/enlace?t=${token}`);
  });
  bot.command("grupo", async (c) => {
    if (c.chat.type === "private") {
      await c.reply("Escribe /grupo dentro del grupo del equipo donde quieres recibir las alertas.");
      return;
    }
    if ((await duenoTelegramId(deps.ctx)) !== c.from?.id) {
      await c.reply("Solo el dueño puede elegir el grupo de alertas.");
      return;
    }
    await guardarChatAlertas(deps.ctx, c.chat.id);
    await c.reply("✅ Desde ahora las alertas de desgaste, stock y cobros llegan a este grupo.");
  });
  bot.on("message:photo", (c, next) => fotoConGasto(c, deps, next));
  bot.callbackQuery(/^t:/, (c) => manejarBoton(c, deps));
  bot.on("message:text", (c, next) => manejarTexto(c, deps, next));
}
