/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import {
  actualizarUnidad, crearUnidad, ErrorNegocio, instalarParte, listarTiposParte, registrarLecturaOdometro, esTipoSemirremolque,
  type EstadoUnidad, type TipoSemirremolque,
} from "@sunatapp/core";
import { accion, formulario, type App, type Deps } from "../base";
import { redirigir } from "../redirecciones";

export const enteroONull = (v: string | undefined): number | null => {
  if (v === undefined || v.trim() === "") return null;
  const n = Number(v.replace(/[,\s]/g, ""));
  if (!Number.isFinite(n)) throw new ErrorNegocio(`"${v}" no es un número válido`);
  return Math.round(n);
};

export function rutasFlota(app: App, d: Deps): void {
  // La flota se ve ahora en Camiones; aquí quedan las acciones (agregar, editar, odómetro).
  redirigir(app, "/flota", () => "/camiones");
  app.post("/flota", async (c) => {
    const f = await formulario(c);
    return accion(c, "/camiones/nuevo", async () => {
      const u = await crearUnidad(d.ctx, {
        placa: f.placa ?? "", marca: f.marca || null, modelo: f.modelo || null, anio: enteroONull(f.anio),
        odometroKm: enteroONull(f.odometro) ?? 0, viajesBase: enteroONull(f.viajesBase) ?? 0, placaCarreta: f.placaCarreta || null,
        semirremolque: esTipoSemirremolque(f.semirremolque ?? "") ? (f.semirremolque as TipoSemirremolque) : "furgon",
      }, c.get("usuario").id);
      if (f.catalogo) {
        for (const t of await listarTiposParte(d.ctx)) await instalarParte(d.ctx, { vehiculoId: u.id, tipoParteId: t.id }, d.ctx.db, c.get("usuario").id);
      }
      return { ok: `Unidad ${u.codigo} agregada`, ruta: `/camiones/${u.id}` };
    });
  });
  app.post("/flota/:id", async (c) => {
    const f = await formulario(c);
    return accion(c, `/camiones/${c.req.param("id")}?tab=datos`, async () => {
      const rend = f.rendimiento ? Number(f.rendimiento.replace(",", ".")) : null;
      if (rend !== null && !(rend > 0)) throw new ErrorNegocio("Rendimiento no válido");
      const carga = f.cargaUtilTm ? Number(f.cargaUtilTm.replace(",", ".")) : null;
      if (carga !== null && !(carga > 0)) throw new ErrorNegocio("Carga útil no válida");
      await actualizarUnidad(d.ctx, Number(c.req.param("id")), {
        estado: f.estado as EstadoUnidad, marca: f.marca || null, modelo: f.modelo || null, anio: enteroONull(f.anio),
        placaCarreta: f.placaCarreta || null, rendimientoKmGal: rend,
        configuracionVehicular: f.configuracionVehicular ?? null,
        cargaUtilTm: carga,
        ...(f.semirremolque ? { semirremolque: f.semirremolque as TipoSemirremolque } : {}),
      }, c.get("usuario").id);
      return "Unidad actualizada";
    });
  });
  app.post("/flota/:id/odometro", async (c) => {
    const f = await formulario(c);
    return accion(c, `/camiones/${c.req.param("id")}?tab=datos`, async () => {
      const km = enteroONull(f.km);
      if (km === null) throw new ErrorNegocio("Indica la lectura del odómetro");
      const r = await registrarLecturaOdometro(d.ctx, { vehiculoId: Number(c.req.param("id")), km, origen: "web", usuarioId: c.get("usuario").id });
      return `Odómetro actualizado: +${r.sumados.toLocaleString("en-US")} km a todas las partes`;
    });
  });
}
