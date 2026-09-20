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

/**
 * Un .env mal puesto (una variable ausente o con un valor que no existe). Se distingue de
 * cualquier otro fallo de arranque para no mandar al dueño a revisar el token y la conexión
 * cuando lo que pasa es que escribió `EXTRACTOR=ia`.
 */
export class ErrorConfiguracion extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorConfiguracion";
  }
}

/** El texto que se imprime en consola cuando el bot no llega a arrancar. */
export function mensajeDeArranque(error: unknown): string {
  if (error instanceof ErrorConfiguracion) {
    return `El bot no pudo arrancar por un problema de configuración.\n${error.message}\nCorrígelo en tu .env y vuelve a intentarlo.`;
  }
  return "El bot no pudo arrancar. Revisa TELEGRAM_BOT_TOKEN y tu conexión.";
}

function limpiar(valor: string | undefined): string | undefined {
  const v = valor?.trim();
  return v ? v : undefined;
}

export function cargarConfigBot(env: Record<string, string | undefined> = process.env): ConfigBot {
  const token = limpiar(env.TELEGRAM_BOT_TOKEN);
  if (!token) throw new ErrorConfiguracion("Falta TELEGRAM_BOT_TOKEN en .env");
  const extractor = limpiar(env.EXTRACTOR) ?? "reglas";
  if (extractor !== "reglas" && extractor !== "ia") {
    throw new ErrorConfiguracion('EXTRACTOR debe ser "reglas" o "ia"');
  }
  const horaAviso = limpiar(env.BOT_HORA_AVISO) ?? "08:00";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(horaAviso)) {
    throw new ErrorConfiguracion("BOT_HORA_AVISO debe tener el formato HH:MM");
  }
  return { token, extractor, horaAviso, logDir: limpiar(env.LOG_DIR) ?? "./logs" };
}
