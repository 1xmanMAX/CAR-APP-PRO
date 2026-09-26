import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { GrammyError, HttpError, type Bot } from "grammy";
import {
  cargarConfig, crearContexto, duenoTelegramId, encolarAviso, guardarEnv, hayDueno, hayUsuarios, leerEnv, marcarLatidoBot,
  obtenerUbigeo, procesarLecturasPendientes, reconfigurarSunat, tomarAvisos, validarRuc, type Config, type Contexto, type ResultadoEmision,
} from "@sunatapp/core";
import { cargarConfigIa, crearLectorReglas, crearProveedorIA, crearTranscriptor } from "@sunatapp/ia";
import { crearExtractor } from "@sunatapp/extractor";
import { cargarConfigWeb, iniciarServidorWeb, type ConfigWeb, type EstadoServicios, type ServiciosDispositivo } from "@sunatapp/web";
import { programarAvisoDiario, textoAvisoDiario, textoAvisoFlota } from "./aviso-diario";
import { crearBot, type ContextoBot, type Dependencias } from "./bot";
import { notificarFactura } from "./flujo-factura";
import { avisarDesgaste, enviarAlerta } from "./flujo-flota";
import { notificarGuia } from "./flujo-guia";
import { notificarLectura } from "./flujo-lectura";
import { crearTareaFondo, type TipoDocumento } from "./fondo";
import { crearLogger, type Logger } from "./log";
import { generarCodigoRegistro } from "./registro";

/**
 * **El arranque completo de Control Flota, igual en la PC y en el celular**: la web, la
 * sincronización por Wi-Fi, las tareas de fondo (reintentos con SUNAT, alertas de desgaste,
 * avisos en cola, aviso diario) y el bot de Telegram si el dispositivo tiene token.
 *
 * Los ajustes del dispositivo viven en su `.env` (en la PC el de la carpeta de la app; en Android
 * el de su carpeta de datos). La pantalla Ajustes → Este dispositivo los cambia y se aplican al
 * momento: se detienen bot y tareas, se relee el `.env` y se vuelven a arrancar, sin cerrar la web.
 */
export interface OpcionesArranque {
  archivoEnv: string;
  plataforma: "pc" | "android";
  /** Con web (pnpm app, Android) o solo bot (pnpm bot). Lo que se da pisa lo del `.env`. */
  web: Partial<ConfigWeb> | null;
  alListo?: (puerto: number) => void;
}

export interface AppEnMarcha {
  ctx: Contexto;
  servicios: ServiciosDispositivo;
  detener(): Promise<void>;
}

const REINTENTO_BOT_MS = 60_000;
/** Claves que se cambian desde Ajustes → Este dispositivo: las del `.env` mandan sobre el entorno. */
const AJUSTABLES = /^(TELEGRAM_|SUNAT_|EXTRACTOR$|BOT_HORA_AVISO$|IA_|DEEPSEEK_|WHISPER_|FFMPEG_)/;

/** El motivo, en castellano, por el que el bot no conecta. */
function motivoBot(error: unknown): { mensaje: string; reintentar: boolean } {
  if (error instanceof GrammyError) {
    if (error.error_code === 401 || error.error_code === 404) return { mensaje: "Telegram rechazó el token: revísalo con @BotFather.", reintentar: false };
    if (error.error_code === 409) {
      return { mensaje: "Este bot ya está conectado en otro dispositivo. Deja el token solo en uno (el que pasa más tiempo encendido).", reintentar: true };
    }
    return { mensaje: `Telegram respondió: ${error.description}`, reintentar: true };
  }
  if (error instanceof HttpError) return { mensaje: "Sin conexión con Telegram (¿hay internet?). Se reintenta cada minuto.", reintentar: true };
  return { mensaje: (error as Error)?.message ?? String(error), reintentar: true };
}

export async function arrancarApp(o: OpcionesArranque): Promise<AppEnMarcha> {
  const archivoEnv = resolve(o.archivoEnv);
  // Lo que viene del entorno real (o que puso el arranque de Android) y lo que se tomó del `.env`,
  // para poder releerlo: una clave borrada del archivo vuelve a su valor de entorno.
  const base: Record<string, string | undefined> = { ...process.env };
  let delArchivo: string[] = [];
  const aplicarEnv = (): void => {
    for (const k of delArchivo) {
      if (base[k] === undefined) delete process.env[k];
      else process.env[k] = base[k];
    }
    const valores = leerEnv(archivoEnv);
    for (const [k, v] of Object.entries(valores)) if (base[k] === undefined || AJUSTABLES.test(k)) process.env[k] = v;
    delArchivo = Object.keys(valores);
  };
  aplicarEnv();

  const estado: EstadoServicios = {
    plataforma: o.plataforma,
    archivoAjustes: archivoEnv,
    bot: { estado: "sin_token" },
    sunat: { modo: "simulado" },
    ia: { lector: "reglas", voz: false },
    codigoRegistro: null,
  };

  /** Lector de boletas y notas de voz según el `.env` (sin clave: el lector por reglas, sin internet). */
  const aplicarIa = (ctx: Contexto): void => {
    try {
      const cfg = cargarConfigIa();
      ctx.ia = crearProveedorIA(cfg);
      ctx.transcriptor = crearTranscriptor(cfg);
      estado.ia = { lector: cfg.proveedor, voz: ctx.transcriptor.disponible };
    } catch (e) {
      ctx.ia = crearLectorReglas();
      ctx.transcriptor = crearTranscriptor(cargarConfigIa({}));
      estado.ia = { lector: "reglas", voz: false, error: `${(e as Error).message}. Mientras tanto, lector por reglas.` };
    }
  };

  /** La configuración de SUNAT pedida y, si no es válida, la simulada (con el motivo en `estado`). */
  const leerConfig = (): { pedida: Config | null; segura: Config; error?: string } => {
    try {
      const pedida = cargarConfig();
      return { pedida, segura: { ...pedida, sunatModo: "simulado" } };
    } catch (e) {
      return { pedida: null, segura: cargarConfig({ ...process.env, SUNAT_MODO: "simulado" }), error: (e as Error).message };
    }
  };
  const aplicarSunat = async (ctx: Contexto): Promise<void> => {
    const c = leerConfig();
    estado.sunat = { modo: "simulado", ...(c.error ? { error: c.error } : {}) };
    if (!c.pedida || c.pedida.sunatModo === "simulado") {
      await reconfigurarSunat(ctx, c.segura);
      return;
    }
    try {
      await reconfigurarSunat(ctx, c.pedida);
      estado.sunat = { modo: c.pedida.sunatModo };
    } catch (e) {
      await reconfigurarSunat(ctx, c.segura);
      estado.sunat = { modo: "simulado", error: `No se pudo usar SUNAT ${c.pedida.sunatModo}: ${(e as Error).message}. Mientras tanto, modo simulado.` };
    }
  };

  const inicial = leerConfig();
  const dirDatos = inicial.segura.dataDir;
  const log: Logger = crearLogger(process.env.LOG_DIR?.trim() || join(dirDatos, "logs"));
  const { ctx, cerrar } = await crearContexto(inicial.segura);
  ctx.log = (n, m, d) => log[n](m, d);
  await aplicarSunat(ctx);

  // ——— Bot y tareas de fondo: se pueden detener y volver a arrancar con ajustes nuevos. ———
  let enviarDirecto: ((texto: string, adjunto?: { contenido: Buffer; nombre: string }) => Promise<void>) | null = null;
  let detenerNegocio: (() => Promise<void>) | null = null;

  const iniciarNegocio = async (): Promise<void> => {
    let parado = false;
    aplicarIa(ctx);
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
    const horaAviso = /^([01]\d|2[0-3]):[0-5]\d$/.test(process.env.BOT_HORA_AVISO?.trim() ?? "") ? process.env.BOT_HORA_AVISO!.trim() : "08:00";
    let extractor;
    try {
      extractor = crearExtractor({ tipo: process.env.EXTRACTOR?.trim() === "ia" ? "ia" : "reglas" }, { validarRuc, obtenerUbigeo });
    } catch {
      extractor = crearExtractor({ tipo: "reglas" }, { validarRuc, obtenerUbigeo });
    }
    const conUsuarios = await hayUsuarios(ctx);
    const codigoRegistro = token && conUsuarios && !(await hayDueno(ctx)) ? generarCodigoRegistro() : null;
    if (codigoRegistro) console.log(`Código de registro: ${codigoRegistro} — envíalo al bot desde tu Telegram.`);

    let bot: Bot<ContextoBot> | null = null;
    const deps: Dependencias = {
      ctx,
      extractor,
      descargarArchivo: async (fileId) => {
        const f = await bot!.api.getFile(fileId);
        // La URL lleva el token dentro: nunca debe aparecer en un log ni en un mensaje de error.
        const r = await fetch(`https://api.telegram.org/file/bot${token}/${f.file_path}`);
        if (!r.ok) throw new Error(`No se pudo descargar el archivo (${r.status})`);
        return Buffer.from(await r.arrayBuffer());
      },
      enSegundoPlano: (tarea) => {
        void tarea().catch((error: unknown) => log.error("error en tarea de segundo plano", error));
      },
      codigoRegistro,
      log,
      urlWeb: process.env.WEB_URL_PUBLICA?.trim() || null,
    };
    Object.defineProperty(estado, "codigoRegistro", { get: () => deps.codigoRegistro, configurable: true, enumerable: true });

    const enLinea = () => bot !== null && estado.bot.estado === "en_linea";
    const notificarAlDueno = async (tipo: TipoDocumento, r: ResultadoEmision): Promise<void> => {
      if (!enLinea()) return;
      const chatId = await duenoTelegramId(ctx);
      if (chatId === null) return;
      if (tipo === "guia") await notificarGuia(deps, bot!.api, chatId, r);
      else await notificarFactura(deps, bot!.api, chatId, r);
    };
    // Los reintentos con SUNAT corren siempre; lo que va a Telegram, solo con el bot conectado
    // (si no, los avisos quedan en cola para cuando conecte).
    const fondo = crearTareaFondo(deps, notificarAlDueno, [
      { nombre: "latido", tarea: async () => { if (enLinea()) await marcarLatidoBot(ctx, { usuario: estado.bot.usuario }); } },
      { nombre: "alertas de desgaste", tarea: async () => { if (enLinea()) await avisarDesgaste(bot!.api, deps); } },
      {
        // Boletas que quedaron en cola porque la IA no respondía: se reintentan y se avisa el resumen.
        nombre: "lecturas en cola",
        tarea: async () => {
          if (!enLinea()) return;
          for (const r of await procesarLecturasPendientes(ctx)) if (r.telegramChatId !== null) await notificarLectura(bot!.api, r.telegramChatId, r);
        },
      },
      {
        nombre: "avisos en cola",
        tarea: async () => {
          if (!enLinea()) return;
          for (const a of await tomarAvisos(ctx)) await enviarAlerta(bot!.api, deps, a.texto);
        },
      },
    ]);
    const detenerFondo = fondo.iniciar();
    void fondo.pasada();
    const detenerAviso = programarAvisoDiario(async () => {
      if (!enLinea()) return;
      try {
        const chatId = await duenoTelegramId(ctx);
        if (chatId === null) return;
        const texto = await textoAvisoDiario(ctx);
        if (texto !== null) await bot!.api.sendMessage(chatId, texto);
        const flota = await textoAvisoFlota(ctx);
        if (flota !== null) await enviarAlerta(bot!.api, deps, flota);
      } catch (error) {
        log.error("no se pudo enviar el aviso diario", error);
      }
    }, horaAviso);

    let reintento: ReturnType<typeof setTimeout> | null = null;
    let corriendo: Promise<void> | null = null;
    if (!token) estado.bot = { estado: "sin_token" };
    else if (!conUsuarios) estado.bot = { estado: "esperando_datos", mensaje: "Completa la configuración inicial y el bot arrancará." };
    else {
      const real = crearBot(token, deps);
      bot = real;
      const conectar = async (): Promise<void> => {
        if (parado) return;
        estado.bot = { estado: "conectando" };
        try {
          await real.init();
          const usuario = real.botInfo.username;
          estado.bot = { estado: "en_linea", usuario };
          enviarDirecto = (texto, adjunto) => enviarAlerta(real.api, deps, texto, adjunto);
          corriendo = real.start({
            onStart: () => {
              log.info("Bot iniciado");
              console.log("🤖 Bot de Telegram en línea");
              void marcarLatidoBot(ctx, { usuario }).catch(() => {});
              void fondo.pasada();
            },
          }).catch((e: unknown) => {
            enviarDirecto = null;
            if (parado) return;
            const m = motivoBot(e);
            estado.bot = { estado: "error", mensaje: m.mensaje };
            log.error("el bot se desconectó", e);
            if (m.reintentar) reintento = setTimeout(() => void conectar(), REINTENTO_BOT_MS);
          });
        } catch (e) {
          const m = motivoBot(e);
          estado.bot = { estado: m.reintentar ? "conectando" : "error", mensaje: m.mensaje };
          log.error("el bot no pudo conectar", e);
          if (m.reintentar) reintento = setTimeout(() => void conectar(), REINTENTO_BOT_MS);
        }
      };
      void conectar();
      detenerNegocio = async () => {
        parado = true;
        if (reintento) clearTimeout(reintento);
        enviarDirecto = null;
        detenerFondo();
        detenerAviso();
        try { if (real.isRunning()) await real.stop(); } catch (e) { log.error("error al detener el bot", e); }
        await corriendo?.catch(() => {});
        await fondo.esperarPasada().catch(() => {});
      };
      return;
    }
    detenerNegocio = async () => {
      parado = true;
      detenerFondo();
      detenerAviso();
      await fondo.esperarPasada().catch(() => {});
    };
  };

  const reiniciarNegocio = async (): Promise<void> => {
    await detenerNegocio?.();
    detenerNegocio = null;
    aplicarEnv();
    await aplicarSunat(ctx);
    await iniciarNegocio();
  };

  const servicios: ServiciosDispositivo = {
    estado: () => ({ ...estado, bot: { ...estado.bot }, sunat: { ...estado.sunat }, ia: { ...estado.ia } }),
    ajustes: () => leerEnv(archivoEnv),
    async guardarAjustes(cambios, certificado) {
      if (certificado) {
        const destino = join(dirDatos, "certificado-sunat.pfx");
        await mkdir(dirDatos, { recursive: true });
        await writeFile(destino, certificado);
        cambios = { ...cambios, SUNAT_CERT_PATH: resolve(destino) };
      }
      guardarEnv(archivoEnv, cambios);
      await reiniciarNegocio();
    },
    alConfigurar: reiniciarNegocio,
  };

  let detenerWeb: (() => void) | null = null;
  if (o.web) {
    const cfgWeb: ConfigWeb = { ...cargarConfigWeb(), ...o.web };
    detenerWeb = iniciarServidorWeb(ctx, cfgWeb, {
      servicios,
      avisar: async (texto, adjunto) => {
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
      o.alListo?.(puerto);
    });
  }
  await iniciarNegocio();

  let apagado: Promise<void> | null = null;
  return {
    ctx,
    servicios,
    detener: () => (apagado ??= (async () => {
      await detenerNegocio?.().catch((e: unknown) => log.error("error al detener", e));
      detenerWeb?.();
      await cerrar().catch((e: unknown) => log.error("error al cerrar la base de datos", e));
    })()),
  };
}
