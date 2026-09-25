// Arranque de la web sola (sin el bot): `pnpm web`. Para todo junto (bot + web) usa `pnpm app`.
import { cargarConfig, cargarEnv, crearContexto } from "@sunatapp/core";
import { cargarConfigWeb } from "./config";
import { iniciarServidorWeb } from "./servidor";

cargarEnv();
const config = cargarConfig();
const web = cargarConfigWeb();
const { ctx, cerrar } = await crearContexto(config);
const detener = iniciarServidorWeb(ctx, web, {}, (puerto) => console.log(`Web lista en ${web.urlPublica ?? `http://localhost:${puerto}`}`));
const apagar = () => {
  detener();
  void cerrar().finally(() => process.exit(0));
};
process.once("SIGINT", apagar);
process.once("SIGTERM", apagar);
