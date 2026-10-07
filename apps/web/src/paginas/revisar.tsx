/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import {
  archivoDeDocumento, asignarViajeGasto, confirmarLectura, descartarLectura, ErrorNegocio, fijarLectura, MENSAJE_YA_RESUELTO, obtenerDocumento, parsearMonto,
  puedeVer, type Lectura,
} from "@sunatapp/core";
import { accion, formulario, servirDeAlmacen, volverA, type App, type C, type Deps } from "../base";
import { redirigir } from "../redirecciones";

/**
 * Lo que quedó a medias en Telegram ya no tiene página propia: se ve en Inicio («Necesita tu atención»,
 * `/?ver=atencion`) y cada mensaje se confirma en Anotar precargado (`/anotar?documento=`). Aquí quedan
 * los POST de siempre, que esos formularios reutilizan.
 */

/** Lo que la IA leyó, para precargar el formulario de Anotar (proveedor, RUC y comprobante se conservan aparte). */
export function valoresLectura(l: Lectura | null): { tipo: "gasto" | "entrega"; categoria: string; monto: string; medio: string; nota: string } {
  if (l?.tipo === "gasto") return { tipo: "gasto", categoria: l.categoria, monto: l.monto.toFixed(2), medio: "efectivo", nota: l.nota ?? "" };
  if (l?.tipo === "entrega") return { tipo: "entrega", categoria: "otros_viaje", monto: l.monto.toFixed(2), medio: l.medio, nota: "" };
  return { tipo: "gasto", categoria: "otros_viaje", monto: "", medio: "efectivo", nota: "" };
}

export const ESTADO_LECTURA: Record<string, string> = { error: "No se pudo leer", por_confirmar: "Sin confirmar hace +24 h", pendiente: "La IA no responde" };

/**
 * Lo que se guarda: parte de lo que leyó la IA y cambia solo lo que se ve en el formulario (monto,
 * categoría, detalle, medio), así no se pierden el RUC, el comprobante ni el km de la boleta.
 */
export function lecturaConfirmada(base: Lectura | null, f: Record<string, string>, soles: number): Lectura {
  if (f.tipo === "entrega") {
    const medio = (f.medio || (base?.tipo === "entrega" ? base.medio : "efectivo")) as "efectivo";
    return base?.tipo === "entrega" ? { ...base, monto: soles, medio } : { tipo: "entrega", monto: soles, medio, fecha: null, dudas: [] };
  }
  const categoria = (f.categoria === "otro" ? f.categoriaOtra : f.categoria) || (base?.tipo === "gasto" ? base.categoria : "otros_viaje");
  const nota = f.nota !== undefined ? f.nota || null : base?.tipo === "gasto" ? base.nota : null;
  return base?.tipo === "gasto"
    ? { ...base, monto: soles, categoria, nota }
    : { tipo: "gasto", categoria, monto: soles, fecha: null, proveedorRuc: null, proveedorNombre: null, comprobante: null, nota, dudas: [], medioPago: null, kmOdometro: null };
}

/** Si otro (u otra pestaña, o el bot) ya lo resolvió, no es un error: se avisa qué pasó. */
async function yaResuelto(d: Deps, id: number, e: unknown): Promise<string> {
  if (!(e instanceof ErrorNegocio) || e.message !== MENSAJE_YA_RESUELTO) throw e;
  return (await obtenerDocumento(d.ctx, id)).estado === "descartado" ? "Ya estaba descartado" : "Ya estaba guardado";
}

export function rutasRevisar(app: App, d: Deps): void {
  redirigir(app, "/revisar", () => "/?ver=atencion");
  app.get("/archivo/documento/:id{[0-9]+}", async (c) => {
    // Las boletas del chofer son de Viajes (el taller no las abre aunque adivine el número).
    if (!puedeVer(c.get("usuario").rol, "viajes")) return c.text("Tu rol no ve lo que manda el chofer", 403);
    const a = await archivoDeDocumento(d.ctx, Number(c.req.param("id")));
    return servirDeAlmacen(c as C, d, a?.ruta ?? null);
  });
  app.post("/revisar/:id{[0-9]+}", async (c) => {
    const id = Number(c.req.param("id"));
    const f = await formulario(c);
    const destino = volverA(f.volver, "/?ver=atencion");
    // Si no se pudo guardar, vuelve al mismo formulario de Anotar con lo escrito.
    const otraVez = new URLSearchParams({
      documento: String(id), tipo: f.tipo === "entrega" ? "chofer" : "gaste", volver: destino, monto: f.monto ?? "",
      categoria: (f.categoria === "otro" ? f.categoriaOtra : f.categoria) ?? "", medio: f.medio ?? "", vehiculoId: f.vehiculoId ?? "",
    });
    return accion(c, `/anotar?${otraVez}`, async () => {
      const monto = parsearMonto(f.monto ?? "");
      if (monto === null) throw new ErrorNegocio("Monto no válido");
      try {
        const antes = await obtenerDocumento(d.ctx, id);
        await fijarLectura(d.ctx, id, lecturaConfirmada(antes.lectura, f, monto / 100));
        // Si no se puede guardar, vuelve al estado que tenía (un error sigue en «Necesita tu atención»).
        const r = await confirmarLectura(d.ctx, id, { vehiculoId: Number(f.vehiculoId) || null, usuarioId: c.get("usuario").id, siFalla: antes.estado });
        if (r.tipo === "ya_confirmado") return { ok: "Ya estaba guardado", ruta: destino };
        return { ok: r.tipo === "gasto" ? `Gasto guardado${r.viajeCodigo ? ` en ${r.viajeCodigo}` : ""}` : `Entrega anotada en ${r.viajeCodigo}`, ruta: destino };
      } catch (e) {
        return { ok: await yaResuelto(d, id, e), ruta: destino };
      }
    });
  });
  app.post("/revisar/:id{[0-9]+}/descartar", async (c) => accion(c, "/?ver=atencion", async () => {
    const id = Number(c.req.param("id"));
    try {
      await descartarLectura(d.ctx, id, c.get("usuario").id);
      return "Descartado";
    } catch (e) {
      return yaResuelto(d, id, e);
    }
  }));
  app.post("/revisar/gasto/:id{[0-9]+}", async (c) => {
    const f = await formulario(c);
    return accion(c, "/?ver=atencion", async () => `Gasto pasado a ${await asignarViajeGasto(d.ctx, Number(c.req.param("id")), Number(f.viajeId), c.get("usuario").id)}`);
  });
}
