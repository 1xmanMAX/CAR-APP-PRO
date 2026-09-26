// Arranque dentro de la app de Android (Node.js en el celular): lo mismo que `pnpm app` en la PC.
// Los datos y los ajustes del dispositivo (.env) van en la carpeta que da la app (CF_DATOS).
import { join } from "node:path";
import { arrancarApp } from "./arranque";

const datos = process.env.CF_DATOS || "./datos";
process.env.DATA_DIR ||= datos;
process.env.STORAGE_DIR ||= join(datos, "archivos");
process.env.LOG_DIR ||= join(datos, "logs");

const app = await arrancarApp({
  archivoEnv: join(datos, ".env"),
  plataforma: "android",
  // Solo para la WebView del propio celular; la sincronización usa su propio puerto en el Wi-Fi.
  web: { host: "127.0.0.1", puerto: Number(process.env.CF_PUERTO || 3939), urlPublica: null },
  alListo: (p) => {
    (globalThis as { __controlFlotaListo?: boolean }).__controlFlotaListo = true;
    console.log(`CONTROLFLOTA_LISTO ${p}`);
  },
});
const apagar = () => void app.detener().finally(() => process.exit(0));
process.once("SIGINT", apagar);
process.once("SIGTERM", apagar);
