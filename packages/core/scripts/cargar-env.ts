try {
  process.loadEnvFile(".env");
} catch {
  // Sin .env: se usan variables del entorno y valores por defecto.
}
