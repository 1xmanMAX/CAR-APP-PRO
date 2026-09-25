import { serve } from "@hono/node-server";
import type { Contexto } from "@sunatapp/core";
import { crearWeb, type OpcionesWeb } from "./app";
import type { ConfigWeb } from "./config";

/** Levanta la web en el puerto configurado. Devuelve la función que la apaga. */
export function iniciarServidorWeb(ctx: Contexto, cfg: ConfigWeb, o: Omit<OpcionesWeb, "urlPublica" | "cookieSegura"> = {}, alIniciar?: (puerto: number) => void): () => void {
  const app = crearWeb(ctx, { ...o, urlPublica: cfg.urlPublica, cookieSegura: cfg.urlPublica?.startsWith("https://") ?? false });
  const servidor = serve({ fetch: app.fetch, hostname: cfg.host, port: cfg.puerto }, (i) => alIniciar?.(i.port));
  return () => servidor.close();
}
