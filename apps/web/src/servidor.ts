import { serve } from "@hono/node-server";
import { RedSinc, type Contexto } from "@sunatapp/core";
import { crearWeb, type OpcionesWeb } from "./app";
import type { ConfigWeb } from "./config";

/**
 * Levanta la web en el puerto configurado y, con ella, la red de sincronización entre dispositivos
 * (escucha en el Wi-Fi y se anuncia a los del grupo). Devuelve la función que apaga las dos.
 */
export function iniciarServidorWeb(
  ctx: Contexto, cfg: ConfigWeb, o: Omit<OpcionesWeb, "urlPublica" | "cookieSegura" | "red"> = {}, alIniciar?: (puerto: number) => void,
): () => void {
  const red = new RedSinc(ctx, (m, e) => ctx.log?.("error", m, e));
  void red.iniciar().catch((e: unknown) => ctx.log?.("error", "no se pudo iniciar la sincronización", e));
  const app = crearWeb(ctx, { ...o, red, urlPublica: cfg.urlPublica, cookieSegura: cfg.urlPublica?.startsWith("https://") ?? false });
  const servidor = serve({ fetch: app.fetch, hostname: cfg.host, port: cfg.puerto }, (i) => alIniciar?.(i.port));
  return () => {
    red.detener();
    servidor.close();
  };
}
