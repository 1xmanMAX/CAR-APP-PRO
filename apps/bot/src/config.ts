/**
 * Configuración del bot. El token sale siempre del entorno (.env): nunca se escribe en el código
 * ni se registra en los logs.
 */
export interface ConfigBot {
  token: string;
  extractor: "reglas" | "ia";
  /** Hora local "HH:MM" del aviso diario de tareas de fondo. */
  horaAviso: string;
  logDir: string;
}

function limpiar(valor: string | undefined): string | undefined {
  const v = valor?.trim();
  return v ? v : undefined;
}

export function cargarConfigBot(env: Record<string, string | undefined> = process.env): ConfigBot {
  const token = limpiar(env.TELEGRAM_BOT_TOKEN);
  if (!token) throw new Error("Falta TELEGRAM_BOT_TOKEN en .env");
  const extractor = limpiar(env.EXTRACTOR) ?? "reglas";
  if (extractor !== "reglas" && extractor !== "ia") {
    throw new Error('EXTRACTOR debe ser "reglas" o "ia"');
  }
  const horaAviso = limpiar(env.HORA_AVISO) ?? "08:00";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(horaAviso)) {
    throw new Error("HORA_AVISO debe tener el formato HH:MM");
  }
  return { token, extractor, horaAviso, logDir: limpiar(env.LOG_DIR) ?? "./logs" };
}
