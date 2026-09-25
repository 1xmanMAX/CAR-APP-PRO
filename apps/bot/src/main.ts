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
import { cargarConfigWeb, iniciarServidorWeb } from "@sunatapp/web";
import { encolarAviso, marcarLatidoBot, tomarAvisos } from "@sunatapp/core";
import { avisarDesgaste, enviarAlerta } from "./flujo-flota";
import { crearBot, type Dependencias } from "./bot";
import { programarAvisoDiario, textoAvisoDiario, textoAvisoFlota } from "./aviso-diario";
import { cargarConfigBot, ErrorConfiguracion, mensajeDeArranque, type ConfigBot } from "./config";
import { notificarFactura } from "./flujo-factura";
import { notificarGuia } from "./flujo-guia";
import { crearTareaFondo, type TipoDocumento } from "./fondo";
import { crearLogger } from "./log";
import { generarCodigoRegistro } from "./registro";

cargarEnv();

const config = cargarConfig();

// Un TELEGRAM_BOT_TOKEN ausente o un BOT_HORA_AVISO inválido no deben morir con un volcado de
// pila: sin base de datos abierta todavía, no hay nada que cerrar más que avisar en castellano.
const soloWeb = !process.env.TELEGRAM_BOT_TOKEN?.trim() && process.env.APP_MODO === "todo";
let cfgBot: ConfigBot;
try {
  cfgBot = soloWeb
    ? { token: "", extractor: "reglas", horaAviso: "08:00", logDir: process.env.LOG_DIR?.trim() || "./logs" }
    : cargarConfigBot();
} catch (error) {
  crearLogger("./logs").error("el bot no pudo arrancar", error);
  console.error(mensajeDeArranque(error));
  process.exit(1);
}
const log = crearLogger(cfgBot.logDir);
let cfgWeb: ReturnType<typeof cargarConfigWeb>;
try {
  cfgWeb = cargarConfigWeb();
} catch (error) {
  console.error(`Configuración de la web inválida: ${(error as Error).message}`);
  process.exit(1);
}

const { ctx, cerrar } = await crearContexto(config);
ctx.log = (n, m, d) => log[n](m, d);

/**
 * La web corre en el mismo proceso (pnpm app). Sus avisos al grupo de Telegram salen directo por
 * el bot cuando está conectado; si no, quedan en cola y se envían en cuanto conecte.
 */
let enviarDirecto: ((texto: string, adjunto?: { contenido: Buffer; nombre: string }) => Promise<void>) | null = null;
let detenerWeb: (() => void) | undefined;
if (process.env.APP_MODO === "todo") {
  detenerWeb = iniciarServidorWeb(ctx, cfgWeb, {
    avisar: async (texto: string, adjunto?: { contenido: Buffer; nombre: string }) => {
      if (enviarDirecto) {
        try {
          await enviarDirecto(texto, adjunto);
          return;
        } catch (error) {
          log.error("no se pudo enviar el aviso de la web; queda en cola", error);
        }
      }
      await encolarAviso(ctx, texto);
    },
  }, (puerto) => {
    log.info(`Web lista en el puerto ${puerto}`);
    console.log(`🌐 Web: ${cfgWeb.urlPublica ?? `http://localhost:${puerto}`}`);
  });
}
if (soloWeb) {
  console.log("⚠️  Falta TELEGRAM_BOT_TOKEN: arranca solo la web. Pon el token en .env y reinicia para activar el bot.");
  const cerrarWeb = () => {
    detenerWeb?.();
    void cerrar().finally(() => process.exit(0));
  };
  process.once("SIGINT", cerrarWeb);
  process.once("SIGTERM", cerrarWeb);
  await new Promise(() => {});
}

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
  detenerWeb?.();
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

  // Un lector que no existe (hoy `ia`) es un .env mal puesto, no un problema de red ni de token.
  let extractor;
  try {
    extractor = crearExtractor({ tipo: cfgBot.extractor }, { validarRuc, obtenerUbigeo });
  } catch (error) {
    throw new ErrorConfiguracion(`EXTRACTOR=${cfgBot.extractor}: ${(error as Error).message}`);
  }

  const deps: Dependencias = {
    ctx,
    extractor,
    descargarArchivo,
    enSegundoPlano: (tarea) => {
      void tarea().catch((error: unknown) => log.error("error en tarea de segundo plano", error));
    },
    codigoRegistro,
    log,
    urlWeb: cfgWeb.urlPublica,
  };

  const bot = crearBot(cfgBot.token, deps);
  detenerBot = () => bot.stop();

  /** Los avisos automáticos van siempre al dueño; sin dueño registrado todavía, no hay a quién. */
  const notificarAlDueno = async (tipo: TipoDocumento, r: ResultadoEmision): Promise<void> => {
    const chatId = await duenoTelegramId(ctx);
    if (chatId === null) return;
    if (tipo === "guia") await notificarGuia(deps, bot.api, chatId, r);
    else await notificarFactura(deps, bot.api, chatId, r);
  };

  enviarDirecto = (texto, adjunto) => enviarAlerta(bot.api, deps, texto, adjunto);
  const fondo = crearTareaFondo(deps, notificarAlDueno, [
    { nombre: "latido", tarea: () => marcarLatidoBot(ctx) },
    { nombre: "alertas de desgaste", tarea: () => avisarDesgaste(bot.api, deps) },
    {
      nombre: "avisos en cola",
      tarea: async () => {
        for (const a of await tomarAvisos(ctx)) await enviarAlerta(bot.api, deps, a.texto);
      },
    },
  ]);
  esperarPasada = () => fondo.esperarPasada();
  detenerFondo = fondo.iniciar();

  detenerAviso = programarAvisoDiario(async () => {
    try {
      const chatId = await duenoTelegramId(ctx);
      if (chatId === null) return;
      const texto = await textoAvisoDiario(ctx);
      if (texto !== null) await bot.api.sendMessage(chatId, texto);
      const flota = await textoAvisoFlota(ctx);
      if (flota !== null) await enviarAlerta(bot.api, deps, flota);
    } catch (error) {
      log.error("no se pudo enviar el aviso diario", error);
    }
  }, cfgBot.horaAviso);

  // `bot.stop()` hace que esto resuelva: el proceso no debe terminar antes de que el apagado
  // que lo provocó haya cerrado la base.
  await bot.start({
    onStart: () => {
      log.info("Bot iniciado");
      console.log("🤖 Bot de Telegram en línea");
      void marcarLatidoBot(ctx).catch(() => {});
      void fondo.pasada();
    },
  });
  await apagado;
} catch (error) {
  if (apagado) {
    // Ya había un apagado en marcha: lo que falló es el cierre, no el arranque. Anunciar un
    // problema de token aquí sería mentir, y volver a cerrar reventaría la conexión.
    await apagado.catch(() => {});
    process.exit(1);
  }
  // Telegram rechaza el token, no hay red, el .env está mal…: hay que soltar la base de datos
  // igual, no dejar el proceso muriendo con un volcado crudo. El detalle va al log; el token
  // nunca se imprime. `mensajeDeArranque` distingue la configuración del token/la conexión.
  log.error("el bot no pudo arrancar", error);
  console.error(mensajeDeArranque(error));
  detenerFondo?.();
  detenerAviso?.();
  await esperarPasada?.().catch(() => {});
  await cerrarUnaVez();
  process.exit(1);
}
