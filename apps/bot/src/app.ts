// `pnpm app`: todo en un solo proceso — bot de Telegram, web y tareas de fondo. Sin
// TELEGRAM_BOT_TOKEN arranca solo la web (el bot se activa al poner el token y reiniciar).
process.env.APP_MODO = "todo";
await import("./main");
export {};
