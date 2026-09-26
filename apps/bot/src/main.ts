// Arranque en la PC. `pnpm app`: web + sincronización + tareas de fondo + bot (si hay token).
// `pnpm bot`: lo mismo sin la web. Todo lo hace `arrancarApp`, el mismo que usa la app de Android.
import { arrancarApp } from "./arranque";

const conWeb = process.env.APP_MODO === "todo";
const app = await arrancarApp({
  archivoEnv: ".env",
  plataforma: "pc",
  web: conWeb ? {} : null,
  alListo: (puerto) => console.log(`🌐 Web: ${process.env.WEB_URL_PUBLICA?.trim() || `http://localhost:${puerto}`}`),
});
const e = app.servicios.estado();
if (e.bot.estado === "sin_token") {
  console.log("ℹ️  Sin TELEGRAM_BOT_TOKEN: el bot está apagado. Actívalo en la web: Ajustes → Este dispositivo.");
}
if (e.sunat.error) console.log(`⚠️  ${e.sunat.error}`);

const apagar = () => void app.detener().finally(() => process.exit(0));
process.once("SIGINT", apagar);
process.once("SIGTERM", apagar);
