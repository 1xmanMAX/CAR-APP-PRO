import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*"],
    // PGlite es pesado: demasiados archivos en paralelo agotan CPU/RAM y producen timeouts falsos.
    maxWorkers: 2,
  },
});
