/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import { accion, formulario, type App, type C, type Deps } from "../base";
import { guardarCambio } from "../acciones";
import { redirigir } from "../redirecciones";

export function rutasReparaciones(app: App, d: Deps): void {
  // El historial se ve ahora en Camiones › Historial; aquí queda la acción.
  redirigir(app, "/reparaciones", (c: C) => (Number(c.req.query("unidad")) ? `/camiones/${Number(c.req.query("unidad"))}?tab=historial` : "/camiones?tab=historial"), ["parte", "pieza"]);
  app.post("/reparaciones", async (c) => {
    const f = await formulario(c);
    return accion(c, `/camiones/${Number(f.vehiculoId)}?tab=historial`, async () => (await guardarCambio(d, c.get("usuario").id, f, f.tipo)).ok);
  });
}
