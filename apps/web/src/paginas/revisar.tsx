/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import {
  archivoDeDocumento, asignarViajeGasto, confirmarLectura, descartarLectura, ErrorNegocio, fijarLectura, parsearMonto, type Lectura,
} from "@sunatapp/core";
import { accion, formulario, servirDeAlmacen, volverA, type App, type C, type Deps } from "../base";
import { redirigir } from "../redirecciones";

/**
 * Lo que quedó a medias en Telegram ya no tiene página propia: se ve en Inicio («Necesita tu atención»,
 * `/?ver=atencion`) y cada mensaje se confirma en Anotar precargado (`/anotar?documento=`). Aquí quedan
 * los POST de siempre, que esos formularios reutilizan.
 */

/** Lo que la IA leyó, para precargar el formulario de Anotar. */
export function valoresLectura(l: Lectura | null): { tipo: "gasto" | "entrega"; categoria: string; monto: string; medio: string; nota: string } {
  if (l?.tipo === "gasto") return { tipo: "gasto", categoria: l.categoria, monto: l.monto.toFixed(2), medio: "efectivo", nota: [l.proveedorNombre, l.comprobante, l.nota].filter(Boolean).join(" · ") };
  if (l?.tipo === "entrega") return { tipo: "entrega", categoria: "otros_viaje", monto: l.monto.toFixed(2), medio: l.medio, nota: "" };
  return { tipo: "gasto", categoria: "otros_viaje", monto: "", medio: "efectivo", nota: "" };
}

export const ESTADO_LECTURA: Record<string, string> = { error: "No se pudo leer", por_confirmar: "Sin confirmar hace +24 h", pendiente: "La IA no responde" };

export function rutasRevisar(app: App, d: Deps): void {
  redirigir(app, "/revisar", () => "/?ver=atencion");
  app.get("/archivo/documento/:id{[0-9]+}", async (c) => {
    const a = await archivoDeDocumento(d.ctx, Number(c.req.param("id")));
    return servirDeAlmacen(c as C, d, a?.ruta ?? null);
  });
  app.post("/revisar/:id{[0-9]+}", async (c) => {
    const id = Number(c.req.param("id"));
    const f = await formulario(c);
    const destino = volverA(f.volver, "/?ver=atencion");
    // Si no se pudo guardar, vuelve al mismo formulario de Anotar con lo escrito.
    const otraVez = new URLSearchParams({ documento: String(id), tipo: f.tipo === "entrega" ? "chofer" : "gaste", volver: destino, monto: f.monto ?? "", categoria: (f.categoria === "otro" ? f.categoriaOtra : f.categoria) ?? "" });
    return accion(c, `/anotar?${otraVez}`, async () => {
      const monto = parsearMonto(f.monto ?? "");
      if (monto === null) throw new ErrorNegocio("Monto no válido");
      const soles = monto / 100;
      const categoria = f.categoria === "otro" ? f.categoriaOtra : f.categoria;
      const lectura: Lectura = f.tipo === "entrega"
        ? { tipo: "entrega", monto: soles, medio: (f.medio as "efectivo") ?? "efectivo", fecha: null, dudas: [] }
        : { tipo: "gasto", categoria: categoria || "otros_viaje", monto: soles, fecha: null, proveedorRuc: null, proveedorNombre: null, comprobante: null, nota: f.nota || null, dudas: [], medioPago: null, kmOdometro: null };
      await fijarLectura(d.ctx, id, lectura);
      const r = await confirmarLectura(d.ctx, id, { vehiculoId: Number(f.vehiculoId) || null, usuarioId: c.get("usuario").id });
      if (r.tipo === "ya_confirmado") return { ok: "Ya estaba guardado", ruta: destino };
      return { ok: r.tipo === "gasto" ? `Gasto guardado${r.viajeCodigo ? ` en ${r.viajeCodigo}` : ""}` : `Entrega anotada en ${r.viajeCodigo}`, ruta: destino };
    });
  });
  app.post("/revisar/:id{[0-9]+}/descartar", async (c) => accion(c, "/?ver=atencion", async () => {
    await descartarLectura(d.ctx, Number(c.req.param("id")), c.get("usuario").id);
    return "Descartado";
  }));
  app.post("/revisar/gasto/:id{[0-9]+}", async (c) => {
    const f = await formulario(c);
    return accion(c, "/?ver=atencion", async () => `Gasto pasado a ${await asignarViajeGasto(d.ctx, Number(c.req.param("id")), Number(f.viajeId), c.get("usuario").id)}`);
  });
}
