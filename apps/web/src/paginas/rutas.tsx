/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import {
  actualizarPlantilla, crearRuta, desactivarRuta, ErrorNegocio, listarCategorias, listarRutas, nombreCategoria, parsearMonto, partesDeRuta,
  promedioDeRuta, puedeEditar, type Categoria, type LineaPlantilla,
} from "@sunatapp/core";
import { accion, formulario, pagina, type App, type C, type Deps } from "../base";
import { Panel, soles2, Vacio } from "../ui";

const aSoles = (c: number | undefined) => (c ? (c / 100).toFixed(2) : "");

/** Lee los montos «m_combustible», «m_peaje»… de un formulario (vacío = 0, no se guarda). */
export function plantillaDeFormulario(f: Record<string, string>, categorias: Categoria[]): LineaPlantilla[] {
  const r: LineaPlantilla[] = [];
  for (const { clave: cat, nombre } of categorias) {
    const v = f[`m_${cat}`]?.trim();
    if (!v) continue;
    const monto = parsearMonto(v);
    if (monto === null) throw new ErrorNegocio(`Monto no válido en ${nombre}`);
    if (monto > 0) r.push({ categoria: cat, monto });
  }
  return r;
}

/** Las categorías que van en un presupuesto de viaje: las variables activas. */
export const categoriasDeViaje = (d: Deps) => listarCategorias(d.ctx, { tipo: "variable", soloActivas: true });

/** Campos de montos por categoría, con el promedio real al lado si se conoce. */
export function CamposPlantilla(p: { categorias: Categoria[]; valores: Map<string, number>; promedio?: Map<string, number> }) {
  return (
    <div class="form-grid">
      {p.categorias.map(({ clave: cat, nombre }) => (
        <label class="campo"><span>{nombre}{p.promedio?.get(cat) ? <b class="muted"> · prom. {soles2(p.promedio.get(cat)!)}</b> : null}</span>
          <input name={`m_${cat}`} inputmode="decimal" value={aSoles(p.valores.get(cat))} placeholder="0.00" />
        </label>
      ))}
    </div>
  );
}

/** **Rutas**: la plantilla de presupuesto de cada ruta; cada viaje nuevo de esa ruta la copia. */
async function vista(c: C, d: Deps) {
  const [rutas, categorias] = await Promise.all([listarRutas(d.ctx), categoriasDeViaje(d)]);
  const edita = puedeEditar(c.get("usuario").rol, "viajes");
  const conPromedio = await Promise.all(rutas.map(async (r) => {
    const p = partesDeRuta(r.nombre);
    return { r, prom: await promedioDeRuta(d.ctx, p?.origen ?? null, p?.destino ?? null) };
  }));
  return pagina(c, d, { titulo: "Rutas y presupuestos", seccion: "viajes" }, (
    <>
      <section class="panel" style="flex-direction:row;align-items:center;flex-wrap:wrap;gap:10px">
        <a class="btn chico" href="/viajes">← VIAJES</a>
        <b class="mono-t" style="font-size:16px">RUTAS · PRESUPUESTO POR VIAJE</b>
        <span class="muted" style="font-size:12px">Cada viaje nuevo de «origen → destino» copia la plantilla de su ruta (luego se puede ajustar en el viaje). Al lado va el promedio real de los últimos 5 viajes.</span>
      </section>
      {conPromedio.length === 0 ? <Panel titulo="RUTAS"><Vacio>Todavía no hay rutas. Crea la primera abajo.</Vacio></Panel> : conPromedio.map(({ r, prom }) => {
        const valores = new Map(r.plantilla.map((l) => [l.categoria, l.monto]));
        const total = r.plantilla.reduce((s, l) => s + l.monto, 0);
        return (
          <Panel titulo={r.nombre} der={<span class="lbl">PLANTILLA {soles2(total)}{prom.viajes ? ` · PROMEDIO DE ${prom.viajes} VIAJES ${soles2([...prom.montos.values()].reduce((a, b) => a + b, 0))}` : " · SIN VIAJES CERRADOS"}</span>}>
            {edita ? (
              <form method="post" action={`/rutas/${r.id}`} class="filas">
                <CamposPlantilla categorias={categorias} valores={valores} promedio={prom.montos} />
                <div class="acciones">
                  <button class="btn primario chico" type="submit">GUARDAR PLANTILLA</button>
                  {prom.viajes ? <button class="btn chico" type="submit" name="usarPromedio" value="1">USAR PROMEDIO</button> : null}
                  <button class="btn chico fantasma" type="submit" name="desactivar" value="1">DESACTIVAR RUTA</button>
                </div>
              </form>
            ) : (
              <div class="tabla-wrap"><table class="t"><tbody>{r.plantilla.map((l) => <tr><td>{nombreCategoria(l.categoria, categorias)}</td><td class="num">{soles2(l.monto)}</td></tr>)}</tbody></table></div>
            )}
          </Panel>
        );
      })}
      {edita ? (
        <Panel titulo="+ NUEVA RUTA">
          <form method="post" action="/rutas" class="filas">
            <div class="linea">
              <label class="campo" style="flex:1"><span>Origen *</span><input name="origen" required placeholder="Juliaca" /></label>
              <label class="campo" style="flex:1"><span>Destino *</span><input name="destino" required placeholder="Arequipa" /></label>
              <label class="campo" style="flex:1"><span>Sentido</span><select name="sentido"><option value="→">Solo ida (→)</option><option value="⇄">Ida y vuelta (⇄)</option></select></label>
            </div>
            <CamposPlantilla categorias={categorias} valores={new Map()} />
            <button class="btn primario" type="submit">CREAR RUTA</button>
          </form>
        </Panel>
      ) : null}
    </>
  ));
}

export function rutasRutas(app: App, d: Deps): void {
  app.get("/rutas", (c) => vista(c, d));
  app.post("/rutas", async (c) => {
    const f = await formulario(c);
    return accion(c, "/rutas", async () => {
      if (!f.origen?.trim() || !f.destino?.trim()) throw new ErrorNegocio("Indica el origen y el destino");
      const nombre = `${f.origen.trim()} ${f.sentido === "⇄" ? "⇄" : "→"} ${f.destino.trim()}`;
      await crearRuta(d.ctx, nombre, plantillaDeFormulario(f, await categoriasDeViaje(d)), c.get("usuario").id);
      return `Ruta ${nombre} creada`;
    });
  });
  app.post("/rutas/:id{[0-9]+}", async (c) => {
    const id = Number(c.req.param("id"));
    const f = await formulario(c);
    return accion(c, "/rutas", async () => {
      if (f.desactivar === "1") {
        await desactivarRuta(d.ctx, id);
        return "Ruta desactivada";
      }
      let plantilla = plantillaDeFormulario(f, await categoriasDeViaje(d));
      if (f.usarPromedio === "1") {
        const r = (await listarRutas(d.ctx)).find((x) => x.id === id);
        const p = r ? partesDeRuta(r.nombre) : null;
        const prom = await promedioDeRuta(d.ctx, p?.origen ?? null, p?.destino ?? null);
        plantilla = [...prom.montos].filter(([, m]) => m > 0).map(([categoria, monto]) => ({ categoria, monto }));
      }
      await actualizarPlantilla(d.ctx, id, plantilla, c.get("usuario").id);
      return f.usarPromedio === "1" ? "Plantilla igual al promedio real" : "Plantilla guardada";
    });
  });
}
