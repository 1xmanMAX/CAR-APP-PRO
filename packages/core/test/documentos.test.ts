import { describe, expect, it, afterEach } from "vitest";
import { registrarDocumentoRecibido } from "../src/documentos/recibidos";
import { registrarGuiaBorrador } from "../src/guias/registrar";
import { crearContextoPrueba, entradaGuia } from "./helpers";

const cerrables: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cerrables.length) await cerrables.pop()!();
});

async function contexto(o: Parameters<typeof crearContextoPrueba>[0] = {}) {
  const r = await crearContextoPrueba(o);
  cerrables.push(r.cerrar);
  return r.ctx;
}

describe("registrarDocumentoRecibido", () => {
  it("guarda el archivo una vez y devuelve el mismo documento al repetir", async () => {
    const ctx = await contexto();
    const pdf = Buffer.from("%PDF-1.4 prueba");
    const a = await registrarDocumentoRecibido(ctx, { contenido: pdf, mime: "application/pdf" });
    const b = await registrarDocumentoRecibido(ctx, { contenido: pdf, mime: "application/pdf" });
    expect(a.nuevo).toBe(true);
    expect(b).toEqual({ ...a, nuevo: false });
    expect(a.rutaArchivo).toMatch(/^recibidos\/[0-9a-f]{64}\.pdf$/);
    expect(await ctx.almacen.leer(a.rutaArchivo)).toEqual(pdf);
  });

  it("informa la guía ya registrada para ese documento y no crea otra", async () => {
    const ctx = await contexto();
    const d = await registrarDocumentoRecibido(ctx, { contenido: Buffer.from("x"), mime: "application/pdf" });
    const g1 = await registrarGuiaBorrador(ctx, { ...entradaGuia(), documentoRecibidoId: d.id });
    const g2 = await registrarGuiaBorrador(ctx, { ...entradaGuia(), documentoRecibidoId: d.id });
    expect(g2).toBe(g1);
    expect((await registrarDocumentoRecibido(ctx, { contenido: Buffer.from("x"), mime: "application/pdf" })).guiaId).toBe(g1);
  });
});
