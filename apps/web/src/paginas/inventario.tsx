/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import { crearRepuesto, editarRepuesto, GRUPOS_PIEZA, nombrePieza, PIEZAS, type GrupoPieza } from "@sunatapp/core";
import { accion, formulario, volverA, type App, type Deps } from "../base";
import { guardarCompra } from "../acciones";
import { enteroONull } from "./flota";
import { redirigir } from "../redirecciones";

/** Lista de piezas del modelo 3D para elegir varias (en el celular sale como lista con casillas). */
export function SelectPiezas(p: { elegidas?: string[] }) {
  const el = new Set(p.elegidas ?? []);
  return (
    <select name="piezas" multiple size={8} aria-label="Piezas del modelo 3D donde va">
      {(Object.keys(GRUPOS_PIEZA) as GrupoPieza[]).map((g) => (
        <optgroup label={GRUPOS_PIEZA[g]}>{PIEZAS.filter((x) => x.grupo === g).map((x) => <option value={x.id} selected={el.has(x.id)}>{x.nombre}</option>)}</optgroup>
      ))}
    </select>
  );
}

/** «3 piezas: Frenos · semirremolque eje 1, …». */
export function textoPiezas(ids: string[]): string {
  if (!ids.length) return "—";
  const nombres = ids.map((i) => nombrePieza(i)!);
  return `${ids.length} ${ids.length === 1 ? "pieza" : "piezas"}: ${nombres.slice(0, 2).join(", ")}${ids.length > 2 ? "…" : ""}`;
}

/** El formulario junta los valores repetidos con \u0001. */
const piezasDe = (v: string | undefined) => (v ? v.split("\u0001").filter(Boolean) : null);

export function rutasInventario(app: App, d: Deps): void {
  // Los repuestos se ven ahora en Camiones › Repuestos; aquí quedan las acciones.
  redirigir(app, "/inventario", () => "/camiones?tab=repuestos", ["q"]);
  app.post("/inventario/repuesto", async (c) => {
    const f = await formulario(c);
    return accion(c, volverA(f.volver, "/camiones?tab=repuestos"), async () => {
      await crearRepuesto(d.ctx, {
        nombre: f.nombre ?? "", categoria: f.categoria ?? "Otros", codigo: f.codigo || undefined, stockMinimo: enteroONull(f.stockMinimo) ?? 0,
        proveedor: f.proveedor || null, tipoParteId: f.tipoParteId ? Number(f.tipoParteId) : null, piezas: piezasDe(f.piezas),
      }, c.get("usuario").id);
      return "Repuesto creado. Ahora registra la compra para subir el stock.";
    });
  });
  app.post("/inventario/repuesto/:id", async (c) => {
    const f = await formulario(c);
    return accion(c, volverA(f.volver, "/camiones?tab=repuestos"), async () => {
      await editarRepuesto(d.ctx, Number(c.req.param("id")), { stockMinimo: enteroONull(f.stockMinimo) ?? undefined }, c.get("usuario").id);
      return "Repuesto actualizado";
    });
  });
  app.post("/inventario/repuesto/:id/piezas", async (c) => {
    const f = await formulario(c);
    return accion(c, volverA(f.volver, "/camiones?tab=repuestos"), async () => {
      await editarRepuesto(d.ctx, Number(c.req.param("id")), { piezas: piezasDe(f.piezas) }, c.get("usuario").id);
      return "Piezas del repuesto actualizadas";
    });
  });
  app.post("/inventario/compra", async (c) => {
    const f = await formulario(c);
    return accion(c, volverA(f.volver, "/camiones?tab=repuestos"), () => guardarCompra(d, c.get("usuario").id, f));
  });
}
