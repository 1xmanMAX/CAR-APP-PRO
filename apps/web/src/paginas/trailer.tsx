/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import { ajustarVidaParte, ErrorNegocio, instalarParte, listarTiposParte, listarUnidades, partesDeUnidad, pieza, puedeEditar } from "@sunatapp/core";
import { accion, formulario, type App, type C, type Deps } from "../base";
import { conParteQueReinicia, guardarCambio } from "../acciones";
import { redirigir } from "../redirecciones";

const entero = (v: string | undefined): number | null => {
  if (v === undefined || v.trim() === "") return null;
  const n = Number(v.replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : NaN;
};

export function rutasTrailer(app: App, d: Deps): void {
  // La vista vive ahora en Camiones (/camiones/:id); aquí quedan las acciones.
  redirigir(app, "/trailer", () => "/camiones", ["pieza", "parte", "repuesto"]);
  redirigir(app, "/trailer/:id{[0-9]+}", (c: C) => `/camiones/${c.req.param("id")}`, ["pieza", "parte", "repuesto"]);
  app.post("/trailer/:id/instalar", async (c) => {
    const id = Number(c.req.param("id"));
    const f = await formulario(c);
    return accion(c, `/camiones/${id}?tab=toca`, async () => {
      const km = entero(f.km);
      const viajesDesdeInst = entero(f.viajesDesde) ?? 0;
      if (Number.isNaN(km) || Number.isNaN(viajesDesdeInst) || viajesDesdeInst < 0) throw new ErrorNegocio("Números no válidos");
      const unidad = (await listarUnidades(d.ctx)).find((u) => u.id === id);
      if (!unidad) throw new ErrorNegocio("La unidad no existe");
      const tipos = f.tipoParteId === "todas"
        ? (await listarTiposParte(d.ctx)).map((t) => t.id)
        : [Number(f.tipoParteId)];
      const existentes = new Set((await partesDeUnidad(d.ctx, id)).map((p) => p.tipoParteId));
      let n = 0;
      for (const t of tipos) {
        if (existentes.has(t)) continue;
        await instalarParte(d.ctx, {
          vehiculoId: id, tipoParteId: t, fecha: f.fecha || undefined, km: km ?? undefined,
          viajes: Math.max(0, unidad.viajesTotales - viajesDesdeInst),
        }, d.ctx.db, c.get("usuario").id);
        n++;
      }
      return `${n} ${n === 1 ? "parte controlada" : "partes controladas"} en ${unidad.codigo}`;
    });
  });
  app.post("/trailer/:id/pieza", async (c) => {
    const id = Number(c.req.param("id"));
    const f = await formulario(c);
    const p = pieza(f.componente);
    return accion(c, p ? `/camiones/${id}?pieza=${p.id}` : `/camiones/${id}`, async () => {
      if (!puedeEditar(c.get("usuario").rol, "reparaciones")) throw new ErrorNegocio("Tu rol no puede registrar reparaciones");
      if (!p) throw new ErrorNegocio("Elige una pieza del modelo");
      return (await guardarCambio(d, c.get("usuario").id, conParteQueReinicia({ ...f, vehiculoId: String(id) }), f.tipo || "correctivo", { trabajoEnPieza: true })).ok;
    });
  });
  app.post("/parte/:id/vida", async (c) => {
    const f = await formulario(c);
    const volverA = c.req.query("volver")?.startsWith("/") ? c.req.query("volver")! : "/camiones";
    return accion(c, volverA, async () => {
      const v = { vidaKm: entero(f.vidaKm), vidaViajes: entero(f.vidaViajes), vidaDias: entero(f.vidaDias) };
      if (Object.values(v).some((x) => Number.isNaN(x))) throw new ErrorNegocio("Números no válidos");
      await ajustarVidaParte(d.ctx, Number(c.req.param("id")), v, c.get("usuario").id);
      return "Vida útil actualizada";
    });
  });
}
