/**
 * Carga el `.env` del directorio de trabajo en `process.env`. Se llama una sola vez, al arrancar
 * un proceso (scripts y bot); las funciones del núcleo siempre reciben la configuración ya leída.
 */
export function cargarEnv(archivo = ".env"): void {
  try {
    process.loadEnvFile(archivo);
  } catch {
    // Sin .env: se usan variables del entorno y valores por defecto.
  }
}
