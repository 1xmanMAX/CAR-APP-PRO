import {
  cargarConfig,
  cargarEnv,
  crearContexto,
  duenoTelegramId,
  hayDueno,
  hayUsuarios,
  obtenerUbigeo,
  validarRuc,
  type ResultadoEmision,
} from "@sunatapp/core";
import { crearExtractor } from "@sunatapp/extractor";
import { crearBot, type Dependencias } from "./bot";
import { programarAvisoDiario, textoAvisoDiario } from "./aviso-diario";
import { cargarConfigBot } from "./config";
import { notificarFactura } from "./flujo-factura";
import { notificarGuia } from "./flujo-guia";
import { crearTareaFondo, type TipoDocumento } from "./fondo";
import { crearLogger } from "./log";
import { generarCodigoRegistro } from "./registro";

cargarEnv();

const config = cargarConfig();
const cfgBot = cargarConfigBot();
const log = crearLogger(cfgBot.logDir);

const { ctx, cerrar } = await crearContexto(config);
ctx.log = (n, m, d) => log[n](m, d);

if (!(await hayUsuarios(ctx))) {
  console.error("Ejecuta pnpm sembrar primero");
  await cerrar();
  process.exit(1);
}

let codigoRegistro: string | null = null;
if (!(await hayDueno(ctx))) {
  codigoRegistro = generarCodigoRegistro();
  console.log(`Código de registro: ${codigoRegistro} — envíalo al bot desde tu Telegram.`);
}

/** Usa `bot`, declarado justo debajo: solo se ejecuta con el bot ya creado. */
const descargarArchivo = async (fileId: string): Promise<Buffer> => {
  const f = await bot.api.getFile(fileId);
  // La URL lleva el token dentro: nunca debe aparecer en un log ni en un mensaje de error.
  const r = await fetch(`https://api.telegram.org/file/bot${cfgBot.token}/${f.file_path}`);
  if (!r.ok) throw new Error(`No se pudo descargar el archivo (${r.status})`);
  return Buffer.from(await r.arrayBuffer());
};

const deps: Dependencias = {
  ctx,
  extractor: crearExtractor({ tipo: cfgBot.extractor }, { validarRuc, obtenerUbigeo }),
  descargarArchivo,
  enSegundoPlano: (tarea) => {
    void tarea().catch((error: unknown) => log.error("error en tarea de segundo plano", error));
  },
  codigoRegistro,
  log,
};

const bot = crearBot(cfgBot.token, deps);

/** Los avisos automáticos van siempre al dueño; sin dueño registrado todavía, no hay a quién. */
async function notificarAlDueno(tipo: TipoDocumento, r: ResultadoEmision): Promise<void> {
  const chatId = await duenoTelegramId(ctx);
  if (chatId === null) return;
  if (tipo === "guia") await notificarGuia(deps, bot.api, chatId, r);
  else await notificarFactura(bot.api, deps, chatId, r);
}

const fondo = crearTareaFondo(deps, notificarAlDueno);
const detenerFondo = fondo.iniciar();

const detenerAviso = programarAvisoDiario(async () => {
  try {
    const chatId = await duenoTelegramId(ctx);
    if (chatId === null) return;
    const texto = await textoAvisoDiario(ctx);
    if (texto === null) return;
    await bot.api.sendMessage(chatId, texto);
  } catch (error) {
    log.error("no se pudo enviar el aviso diario", error);
  }
}, cfgBot.horaAviso);

/**
 * Apagado ordenado: se deja de aceptar mensajes, se cortan las dos tareas periódicas y recién
 * entonces se suelta la base de datos. Se guarda la promesa para esperarla abajo: `bot.stop()`
 * hace que `bot.start()` resuelva, y el proceso no debe terminar antes de cerrar la conexión.
 */
let apagado: Promise<void> | null = null;
const apagar = (senal: string): void => {
  if (apagado) return;
  log.info(`Apagando el bot (${senal})`);
  detenerFondo();
  detenerAviso();
  apagado = bot
    .stop()
    .catch((error: unknown) => log.error("error al detener el bot", error))
    .then(() => cerrar());
};
process.once("SIGINT", () => apagar("SIGINT"));
process.once("SIGTERM", () => apagar("SIGTERM"));

try {
  await bot.start({ onStart: () => log.info("Bot iniciado") });
  await apagado;
} catch (error) {
  // Telegram rechaza el token, no hay red…: hay que soltar la base de datos igual, no dejar el
  // proceso muriendo con un volcado crudo. El detalle va al log; el token nunca se imprime.
  log.error("el bot no pudo arrancar", error);
  console.error("El bot no pudo arrancar. Revisa TELEGRAM_BOT_TOKEN y tu conexión.");
  detenerFondo();
  detenerAviso();
  await cerrar();
  process.exit(1);
}
