// Arranque de la web sola (sin el bot): `pnpm web`. Para todo junto (bot + web) usa `pnpm app`.
import { serve } from "@hono/node-server";
import { cargarConfig, cargarEnv, crearContexto } from "@sunatapp/core";
import { crearWeb } from "./app";
import { cargarConfigWeb } from "./config";

cargarEnv();
const config = cargarConfig();
const web = cargarConfigWeb();
const { ctx, cerrar } = await crearContexto(config);
const app = crearWeb(ctx, { urlPublica: web.urlPublica, cookieSegura: web.urlPublica?.startsWith("https://") ?? false });
const servidor = serve({ fetch: app.fetch, hostname: web.host, port: web.puerto }, (i) => {
  console.log(`Web lista en http://${web.host === "0.0.0.0" ? "localhost" : web.host}:${i.port}`);
});
const apagar = () => {
  servidor.close();
  void cerrar().finally(() => process.exit(0));
};
process.once("SIGINT", apagar);
process.once("SIGTERM", apagar);
