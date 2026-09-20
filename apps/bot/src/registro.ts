import { randomInt } from "node:crypto";
import { auditarTelegramDesconocido, registrarUsuarioTelegram, usuarioPorTelegram } from "@sunatapp/core";
import type { Middleware } from "grammy";
import type { ContextoBot, Dependencias } from "./bot";
import { textos } from "./textos";

/** Código de un solo uso para que el dueño se registre la primera vez. */
export function generarCodigoRegistro(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * Deja pasar solo al dueño. Un desconocido que envíe el código de registro vigente se convierte en
 * dueño (y el código deja de valer); cualquier otro desconocido no recibe respuesta alguna —así el
 * bot no revela que existe— y queda anotado en auditoría.
 */
export function middlewareAutorizacion(deps: Dependencias): Middleware<ContextoBot> {
  return async (c, next) => {
    const telegramId = c.from?.id;
    if (telegramId === undefined) return;
    const usuario = await usuarioPorTelegram(deps.ctx, telegramId);
    if (usuario) {
      c.session.usuarioId = usuario.id;
      return next();
    }
    const texto = c.message?.text?.trim();
    if (deps.codigoRegistro !== null && texto !== undefined && texto === deps.codigoRegistro) {
      try {
        await registrarUsuarioTelegram(deps.ctx, telegramId);
      } catch (error) {
        // Otro registro ganó la carrera: se trata como desconocido, sin responder nada.
        deps.log.error("registro del dueño rechazado", error);
        await auditarTelegramDesconocido(deps.ctx, telegramId, texto);
        return;
      }
      deps.codigoRegistro = null;
      deps.log.info("dueño registrado", { telegramId });
      await c.reply(textos.registroOk);
      return;
    }
    await auditarTelegramDesconocido(deps.ctx, telegramId, texto);
  };
}
