import type { Update, UserFromGetMe } from "grammy/types";
import { crearExtractor } from "@sunatapp/extractor";
import { crearLectorReglas } from "@sunatapp/ia";
import { obtenerUbigeo, validarRuc, type Contexto } from "@sunatapp/core";
import { crearContextoPrueba, DATOS_INICIALES } from "../../../packages/core/test/helpers";
import { crearBot, type Dependencias } from "../src/bot";

/** El bot no depende de @sunatapp/sunat: el tipo del gateway se toma del helper de pruebas. */
type Gateway = NonNullable<NonNullable<Parameters<typeof crearContextoPrueba>[0]>["gateway"]>;

export interface Llamada {
  metodo: string;
  payload: Record<string, unknown>;
}

const BOT_INFO: UserFromGetMe = {
  id: 1,
  is_bot: true,
  first_name: "Bot",
  username: "prueba_bot",
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
} as UserFromGetMe;

export async function crearArnes(
  o: {
    codigoRegistro?: string | null;
    archivos?: Record<string, Buffer>;
    sinDueno?: boolean;
    gateway?: Gateway;
    ctx?: Contexto;
    /**
     * Simula que Telegram rechaza una llamada concreta (se decide antes de registrarla). Se
     * evalúa una sola vez por llamada que cumpla la condición: falla la primera y deja pasar
     * las siguientes, para no tragarse también el intento de aviso posterior.
     */
    fallarApi?: (metodo: string, llamadas: Llamada[]) => boolean;
  } = {},
) {
  const creado = o.ctx
    ? null
    : await crearContextoPrueba({
        ...(o.gateway ? { gateway: o.gateway } : {}),
        ...(o.sinDueno ? { datos: { ...DATOS_INICIALES, usuario: { nombre: "Dueño", email: "d@x.pe" } } } : {}),
      });
  const ctx = o.ctx ?? creado!.ctx;
  // Lector de boletas por reglas (sin red), como en un dispositivo sin clave de IA.
  ctx.ia ??= crearLectorReglas();
  const llamadas: Llamada[] = [];
  const tareas: Promise<void>[] = [];
  let mensajeId = 1000;
  const deps: Dependencias = {
    ctx,
    extractor: crearExtractor({ tipo: "reglas" }, { validarRuc, obtenerUbigeo }),
    descargarArchivo: async (id) => o.archivos?.[id] ?? Buffer.from(""),
    enSegundoPlano: (t) => {
      tareas.push(t());
    },
    codigoRegistro: o.codigoRegistro ?? null,
    log: { info() {}, error() {} },
  };
  const bot = crearBot("123:prueba", deps, BOT_INFO);
  let fallado = false;
  bot.api.config.use(async (_prev, metodo, payload) => {
    if (!fallado && o.fallarApi?.(metodo, llamadas)) {
      fallado = true;
      throw new Error(`Telegram rechazó ${metodo}`);
    }
    llamadas.push({ metodo, payload: payload as Record<string, unknown> });
    const conMensaje = ["sendMessage", "sendDocument", "editMessageText"].includes(metodo);
    return {
      ok: true,
      result: conMensaje ? { message_id: ++mensajeId, date: 0, chat: { id: 111, type: "private" } } : true,
    } as never;
  });
  let updateId = 1;
  const de = (id: number) => ({ id, is_bot: false, first_name: "Usuario" });
  const chat = (id: number) => ({ id, type: "private" as const, first_name: "U" });
  const enviar = (u: Omit<Update, "update_id">) => bot.handleUpdate({ update_id: updateId++, ...u } as Update);
  return {
    ctx,
    deps,
    /** Para llamar directamente a `notificarGuia`/`notificarFactura`, como hace el proceso de fondo. */
    api: bot.api,
    llamadas,
    cerrar: async () => {
      await Promise.allSettled(tareas);
      if (creado) await creado.cerrar();
    },
    texto: (t: string, userId = 111) =>
      enviar({
        message: {
          message_id: updateId,
          date: 0,
          chat: chat(userId),
          from: de(userId),
          text: t,
          ...(t.startsWith("/")
            ? { entities: [{ type: "bot_command", offset: 0, length: t.split(" ")[0]!.length }] }
            : {}),
        },
      } as never),
    documento: (fileId: string, mime = "application/pdf", userId = 111, tamano = 1000) =>
      enviar({
        message: {
          message_id: updateId,
          date: 0,
          chat: chat(userId),
          from: de(userId),
          document: { file_id: fileId, file_unique_id: fileId, mime_type: mime, file_size: tamano },
        },
      } as never),
    foto: (fileId: string, userId = 111, caption?: string) =>
      enviar({
        message: {
          message_id: updateId,
          date: 0,
          chat: chat(userId),
          from: de(userId),
          photo: [{ file_id: fileId, file_unique_id: fileId, width: 1, height: 1 }],
          ...(caption ? { caption } : {}),
        },
      } as never),
    voz: (fileId: string, userId = 111) =>
      enviar({
        message: {
          message_id: updateId,
          date: 0,
          chat: chat(userId),
          from: de(userId),
          voice: { file_id: fileId, file_unique_id: fileId, duration: 3, mime_type: "audio/ogg" },
        },
      } as never),
    boton: (data: string, userId = 111) =>
      enviar({
        callback_query: {
          id: String(updateId),
          from: de(userId),
          chat_instance: "x",
          data,
          message: { message_id: 1, date: 0, chat: chat(userId) },
        },
      } as never),
    async esperarTareas() {
      while (tareas.length) await tareas.shift();
    },
    ultimoTexto(): string {
      const enviados = this.textosEnviados();
      return enviados[enviados.length - 1] ?? "";
    },
    textosEnviados: () =>
      llamadas
        .filter(
          (l) =>
            ["sendMessage", "editMessageText"].includes(l.metodo) ||
            (l.metodo === "sendDocument" && l.payload.caption),
        )
        .map((l) => String(l.payload.text ?? l.payload.caption)),
    documentosEnviados: () => llamadas.filter((l) => l.metodo === "sendDocument"),
    botones: () => {
      const ultima = [...llamadas]
        .reverse()
        .find((l) => (l.payload.reply_markup as { inline_keyboard?: unknown } | undefined)?.inline_keyboard);
      return (
        (
          ultima?.payload.reply_markup as
            | { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }
            | undefined
        )?.inline_keyboard ?? []
      ).flat();
    },
  };
}
