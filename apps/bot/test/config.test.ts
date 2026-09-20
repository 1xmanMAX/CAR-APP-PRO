import { describe, expect, it } from "vitest";
import { cargarConfigBot, ErrorConfiguracion, mensajeDeArranque } from "../src/config";

describe("configuración del bot", () => {
  it("sin token avisa que falta en .env", () => {
    expect(() => cargarConfigBot({})).toThrow("Falta TELEGRAM_BOT_TOKEN en .env");
  });

  it("usa los valores por defecto", () => {
    const c = cargarConfigBot({ TELEGRAM_BOT_TOKEN: "123:abc" });
    expect(c).toEqual({ token: "123:abc", extractor: "reglas", horaAviso: "08:00", logDir: "./logs" });
  });

  it("lee la hora del aviso de BOT_HORA_AVISO", () => {
    expect(cargarConfigBot({ TELEGRAM_BOT_TOKEN: "123:abc", BOT_HORA_AVISO: "19:30" }).horaAviso).toBe("19:30");
    expect(() => cargarConfigBot({ TELEGRAM_BOT_TOKEN: "123:abc", BOT_HORA_AVISO: "25:00" })).toThrow(
      "BOT_HORA_AVISO debe tener el formato HH:MM",
    );
  });

  it("un .env mal puesto se distingue de un problema de token o de red", () => {
    // `EXTRACTOR=ia` (todavía no disponible) mandaba al dueño a revisar el token y la conexión.
    const deConfiguracion = mensajeDeArranque(new ErrorConfiguracion("Lector con IA no disponible aún"));
    expect(deConfiguracion).toContain("Lector con IA no disponible aún");
    expect(deConfiguracion).toContain(".env");
    expect(deConfiguracion).not.toContain("TELEGRAM_BOT_TOKEN");

    expect(mensajeDeArranque(new Error("fetch failed"))).toBe(
      "El bot no pudo arrancar. Revisa TELEGRAM_BOT_TOKEN y tu conexión.",
    );
    expect(() => cargarConfigBot({})).toThrow(ErrorConfiguracion);
  });
});
