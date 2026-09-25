/**
 * Arranque dentro de la app de Android (y de cualquier dispositivo sin servidor aparte): la web
 * solo para este equipo (127.0.0.1) y la sincronización por el Wi-Fi. La app nativa pasa la carpeta
 * de datos en CF_DATOS y abre el visor cuando /salud responde.
 */
import { join } from "node:path";
import { cargarConfig, crearContexto } from "@sunatapp/core";
import { iniciarServidorWeb } from "./servidor";

const datos = process.env.CF_DATOS || "./datos";
process.env.DATA_DIR ||= datos;
process.env.STORAGE_DIR ||= join(datos, "archivos");
process.env.SUNAT_MODO ||= "simulado";

const puerto = Number(process.env.CF_PUERTO || 3939);
const config = cargarConfig();
const { ctx, cerrar } = await crearContexto(config);
ctx.log = (nivel, mensaje, detalle) => console[nivel === "error" ? "error" : "log"](mensaje, detalle ?? "");
const detener = iniciarServidorWeb(ctx, { host: "127.0.0.1", puerto, urlPublica: null }, {}, (p) => console.log(`CONTROLFLOTA_LISTO ${p}`));
const apagar = () => {
  detener();
  void cerrar().finally(() => process.exit(0));
};
process.once("SIGINT", apagar);
process.once("SIGTERM", apagar);
