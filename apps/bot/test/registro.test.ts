import { textos } from "../src/textos";
import { describe, expect, it } from "vitest";
import { contarAuditoria, usuarioPorTelegram } from "@sunatapp/core";
import { generarCodigoRegistro } from "../src/registro";
import { crearArnes } from "./arnes";

describe("registro del dueño", () => {
  it("el primero que envía el código queda como dueño y el código deja de valer", async () => {
    const a = await crearArnes({ sinDueno: true, codigoRegistro: "482913" });
    await a.texto("482913", 555);
    expect(a.textosEnviados().at(-1)).toBe(textos.registroOk);
    expect(await usuarioPorTelegram(a.ctx, 555)).not.toBeNull();
    await a.texto("482913", 777);
    expect(a.textosEnviados()).toHaveLength(1);
    await a.cerrar();
  });

  it("ignora y audita a desconocidos", async () => {
    const a = await crearArnes();
    await a.texto("hola", 999);
    expect(a.llamadas).toHaveLength(0);
    expect(await contarAuditoria(a.ctx, "telegram_desconocido")).toBe(1);
    await a.cerrar();
  });

  it("atiende al dueño registrado", async () => {
    const a = await crearArnes(); // DATOS_INICIALES tiene telegramId 111
    await a.texto("/ayuda");
    expect(a.textosEnviados().at(-1)).toContain("/cobros");
    await a.cerrar();
  });

  it("generarCodigoRegistro da 6 dígitos", () => {
    expect(generarCodigoRegistro()).toMatch(/^\d{6}$/);
  });
});
