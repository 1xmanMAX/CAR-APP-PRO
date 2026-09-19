import { Bot, Context, session, type SessionFlavor } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import type { Contexto } from "@sunatapp/core";
import type { ProveedorExtraccion } from "@sunatapp/extractor";
import type { Logger } from "./log";
import { registrarFlujoGuia } from "./flujo-guia";
import { middlewareAutorizacion } from "./registro";
import type { Sesion } from "./sesion";
import { textos } from "./textos";

export interface Dependencias {
  ctx: Contexto;
  extractor: ProveedorExtraccion;
  descargarArchivo(fileId: string): Promise<Buffer>;
  /** Lanza trabajo largo fuera del manejador: en producción se ignora el resultado y se loguea el error. */
  enSegundoPlano(tarea: () => Promise<void>): void;
  /** Código de 6 dígitos si al arrancar no hay dueño; se pone en null al usarse. */
  codigoRegistro: string | null;
  log: Logger;
}

export type ContextoBot = Context & SessionFlavor<Sesion>;

export function crearBot(token: string, deps: Dependencias, botInfo?: UserFromGetMe): Bot<ContextoBot> {
  const bot = new Bot<ContextoBot>(token, botInfo ? { botInfo } : {});
  bot.use(session({ initial: (): Sesion => ({}) }));
  bot.use(middlewareAutorizacion(deps));
  bot.command(["start", "ayuda"], (c) => c.reply(textos.ayuda));
  registrarFlujoGuia(bot, deps);
  bot.catch((e) => {
    deps.log.error("error en manejador", e.error);
    void e.ctx.reply(textos.errorGenerico).catch(() => {});
  });
  return bot;
}
