import { defineProject } from "vitest/config";

export default defineProject({
  // 60 s medía la contención de arranque de PGlite, no el comportamiento probado: con la suite
  // completa en marcha, pruebas que solas tardan ~84 s (infra.test.ts) se caían por tiempo.
  test: { testTimeout: 180000, hookTimeout: 180000 },
});
