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

/**
 * La base se suelta una sola vez, venga el apagado de donde venga (señal, fallo de arranque o
 * falta de datos sembrados): cerrarla dos veces revienta con "Called end on pool more than once".
 */
let cerrado: Promise<void> | null = null;
const cerrarUnaVez = (): Promise<void> =>
  (cerrado ??= cerrar().catch((error: unknown) => log.error("error al cerrar la base de datos", error)));

// Se rellenan conforme arranca cada pieza. Las señales se atienden desde ya —con el contexto
// abierto— porque un Ctrl-C a medio arranque también tiene que cerrar la base.
let detenerBot: (() => Promise<void>) | undefined;
let detenerFondo: (() => void) | undefined;
let detenerAviso: (() => void) | undefined;
let esperarPasada: (() => Promise<void>) | undefined;

/**
 * Apagado ordenado e idempotente: se deja de aceptar mensajes, se cortan las dos tareas
 * periódicas, se espera a la pasada de fondo que estuviera en vuelo (detener el bucle no la
 * cancela) y recién entonces se cierra la base. Nunca rechaza: cada paso anota su propio fallo,
 * para que el apagado no se disfrace de fallo de arranque más abajo.
 */
let apagado: Promise<void> | undefined;
const apagar = (senal: string): void => {
  if (apagado) return;
  log.info(`Apagando el bot (${senal})`);
  detenerFondo?.();
  detenerAviso?.();
  apagado = (async () => {
    try {
      await detenerBot?.();
    } catch (error) {
      log.error("error al detener el bot", error);
    }
    try {
      await esperarPasada?.();
    } catch (error) {
      log.error("error al terminar la pasada de fondo", error);
    }
    await cerrarUnaVez();
  })();
};
process.once("SIGINT", () => apagar("SIGINT"));
process.once("SIGTERM", () => apagar("SIGTERM"));

if (!(await hayUsuarios(ctx))) {
  console.error("Ejecuta pnpm sembrar primero");
  await cerrarUnaVez();
  process.exit(1);
}

let codigoRegistro: string | null = null;
if (!(await hayDueno(ctx))) {
  codigoRegistro = generarCodigoRegistro();
  console.log(`Código de registro: ${codigoRegistro} — envíalo al bot desde tu Telegram.`);
}

// Desde aquí todo va protegido: con el contexto ya abierto, cualquier tropiezo al montar el
// extractor o el bot (un token con formato inválido, por ejemplo) debe cerrar la base igual.
try {
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
  detenerBot = () => bot.stop();

  /** Los avisos automáticos van siempre al dueño; sin dueño registrado todavía, no hay a quién. */
  const notificarAlDueno = async (tipo: TipoDocumento, r: ResultadoEmision): Promise<void> => {
    const chatId = await duenoTelegramId(ctx);
    if (chatId === null) return;
    if (tipo === "guia") await notificarGuia(deps, bot.api, chatId, r);
    else await notificarFactura(bot.api, deps, chatId, r);
  };

  const fondo = crearTareaFondo(deps, notificarAlDueno);
  esperarPasada = () => fondo.esperarPasada();
  detenerFondo = fondo.iniciar();

  detenerAviso = programarAvisoDiario(async () => {
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

  // `bot.stop()` hace que esto resuelva: el proceso no debe terminar antes de que el apagado
  // que lo provocó haya cerrado la base.
  await bot.start({ onStart: () => log.info("Bot iniciado") });
  await apagado;
} catch (error) {
  if (apagado) {
    // Ya había un apagado en marcha: lo que falló es el cierre, no el arranque. Anunciar un
    // problema de token aquí sería mentir, y volver a cerrar reventaría la conexión.
    await apagado.catch(() => {});
    process.exit(1);
  }
  // Telegram rechaza el token, no hay red…: hay que soltar la base de datos igual, no dejar el
  // proceso muriendo con un volcado crudo. El detalle va al log; el token nunca se imprime.
  log.error("el bot no pudo arrancar", error);
  console.error("El bot no pudo arrancar. Revisa TELEGRAM_BOT_TOKEN y tu conexión.");
  detenerFondo?.();
  detenerAviso?.();
  await esperarPasada?.().catch(() => {});
  await cerrarUnaVez();
  process.exit(1);
}
