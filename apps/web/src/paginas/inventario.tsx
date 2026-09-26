/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import {
  CATEGORIAS_REPUESTO, crearRepuesto, editarRepuesto, ErrorNegocio, GRUPOS_PIEZA, listarCompras, listarRepuestos, listarTiposParte, listarUnidades,
  nombrePieza, parsearMonto, PIEZAS, puedeEditar, registrarCompra, resumirInventario, type GrupoPieza,
} from "@sunatapp/core";
import { accion, formulario, pagina, type App, type C, type Deps } from "../base";
import { enteroONull } from "./flota";
import { Barra, fechaCorta, Kpi, miles, Origen, Panel, soles, soles2, Vacio } from "../ui";

function vidaTexto(v: { km: number | null; viajes: number | null; dias: number | null } | null): string {
  if (!v) return "—";
  const partes = [v.km ? `${miles(v.km)} km` : null, v.viajes ? `${v.viajes} viajes` : null].filter(Boolean);
  return partes.length ? partes.join(" · ") : v.dias ? `${v.dias} días` : "—";
}

/** Lista de piezas del modelo 3D para elegir varias (en el celular sale como lista con casillas). */
function SelectPiezas(p: { elegidas?: string[] }) {
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
function textoPiezas(ids: string[]): string {
  if (!ids.length) return "—";
  const nombres = ids.map((i) => nombrePieza(i)!);
  return `${ids.length} ${ids.length === 1 ? "pieza" : "piezas"}: ${nombres.slice(0, 2).join(", ")}${ids.length > 2 ? "…" : ""}`;
}

const CHIP_ESTADO: Record<string, string> = { "EN STOCK": "ok", BAJO: "proximo", INSTALADO: "oscuro", AGOTADO: "cambiar" };

async function vista(c: C, d: Deps) {
  const ctx = d.ctx;
  const q = c.req.query("q") ?? "";
  const cat = c.req.query("cat") ?? "";
  const unidadId = c.req.query("unidad") ? Number(c.req.query("unidad")) : undefined;
  const tipo = c.req.query("tipo") ? Number(c.req.query("tipo")) : undefined;
  const [todos, unidades, tipos, compras] = await Promise.all([listarRepuestos(ctx), listarUnidades(ctx), listarTiposParte(ctx), listarCompras(ctx, { limite: 12 })]);
  const resumen = resumirInventario(todos);
  let filas = await listarRepuestos(ctx, { buscar: q || undefined, categoria: cat || undefined, vehiculoId: unidadId });
  if (tipo) filas = filas.filter((r) => r.tipoParteId === tipo);
  const categorias = [...new Set([...CATEGORIAS_REPUESTO, ...todos.map((r) => r.categoria)])];
  const maxCat = Math.max(1, ...resumen.porCategoria.map((x) => x.monto));
  const edita = puedeEditar(c.get("usuario").rol, "inventario");
  const tgCompras = compras.filter((x) => x.origen === "telegram");

  return pagina(c, d, { titulo: "Inventario", seccion: "inventario" }, (
    <>
      <section class="kpis">
        <Kpi oscuro etiqueta="INVERSIÓN TOTAL EN REPUESTOS" valor={soles(resumen.inversionTotal)} />
        <Kpi etiqueta="EN ALMACÉN" valor={soles(resumen.enAlmacen)} />
        <Kpi etiqueta="INSTALADO EN TRAILERS" valor={soles(resumen.instalado)} />
        <Kpi etiqueta="STOCK BAJO" valor={`${resumen.stockBajo} ÍTEMS`} negativo={resumen.stockBajo > 0} />
      </section>
      <div class="grid g-lado">
        <Panel titulo="REPUESTOS">
          <form method="get" action="/inventario" class="linea">
            <label class="campo" style="flex:2;min-width:160px"><span class="sr-only">Buscar</span><input type="search" name="q" value={q} placeholder=">_ buscar código, repuesto o proveedor" /></label>
            <label class="campo" style="flex:1;min-width:140px"><span class="sr-only">Categoría</span>
              <select name="cat"><option value="">TODAS LAS CATEGORÍAS</option>{categorias.map((x) => <option value={x} selected={x === cat}>{x}</option>)}</select>
            </label>
            <label class="campo" style="flex:1;min-width:140px"><span class="sr-only">Trailer</span>
              <select name="unidad"><option value="">TODOS LOS TRAILERS</option>{unidades.map((u) => <option value={u.id} selected={u.id === unidadId}>{u.codigo}</option>)}</select>
            </label>
            <button class="btn" type="submit">FILTRAR</button>
            {edita ? <a class="btn primario" href="#compra">+ REGISTRAR COMPRA</a> : null}
          </form>
          {tipo ? <div class="aviso info">Filtrando repuestos de: <b>{tipos.find((t) => t.id === tipo)?.nombre}</b> · <a href="/inventario">quitar filtro</a></div> : null}
          <div class="tabla-wrap">
            <table class="t">
              <thead><tr><th>Código</th><th>Repuesto</th><th>Categoría</th><th class="num">Stock</th><th class="num">Costo u.</th><th class="num">Inversión</th><th>Vida útil</th><th>Instalado en</th><th>Dónde va (3D)</th><th>Estado</th></tr></thead>
              <tbody>
                {filas.length === 0 ? <tr><td colspan={10}><Vacio>No hay repuestos{q || cat || unidadId || tipo ? " con ese filtro" : ". Registra el primero abajo"}.</Vacio></td></tr> : filas.map((r) => (
                  <tr>
                    <td class="nowrap"><b>{r.codigo}</b></td>
                    <td>{r.nombre}{r.proveedor ? <div class="muted" style="font-size:11px">{r.proveedor}</div> : null}</td>
                    <td>{r.categoria}</td>
                    <td class="num">{r.stock}{r.stockMinimo ? <span class="muted"> / mín {r.stockMinimo}</span> : null}</td>
                    <td class="num">{soles2(r.costoUnitario)}</td>
                    <td class="num">{soles(r.inversion)}</td>
                    <td class="nowrap">{vidaTexto(r.vida)}</td>
                    <td>{r.instalado.length ? r.instalado.map((i) => `${i.unidad}${i.posicion ? ` (${i.posicion})` : ""}`).join(", ") : "—"}</td>
                    <td style="min-width:170px">
                      <span style="font-size:11px">{textoPiezas(r.piezas)}</span>
                      {r.piezas.length ? <> <a class="lbl-12" href={`/trailer?repuesto=${r.id}`} title="Ver en el modelo 3D dónde va">VER EN 3D</a></> : null}
                      {edita ? (
                        <details class="plegable"><summary><span class="lbl-12" style="text-decoration:underline;cursor:pointer">{r.piezasElegidas ? "cambiar" : "elegir piezas"}</span></summary>
                          <form method="post" action={`/inventario/repuesto/${r.id}/piezas`} class="filas" style="margin-top:6px;min-width:240px">
                            <SelectPiezas elegidas={r.piezasElegidas ? r.piezas : []} />
                            <span class="muted" style="font-size:11px">Sin elegir ninguna, va donde va su tipo de parte.</span>
                            <button class="btn chico primario" type="submit">GUARDAR</button>
                          </form>
                        </details>
                      ) : null}
                    </td>
                    <td><span class={`chip ${CHIP_ESTADO[r.estado]}`}>{r.estado}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {edita ? (
            <div class="grid g-2" id="compra">
              <form method="post" action="/inventario/compra" class="panel" style="background:var(--white)">
                <b class="lbl-12">REGISTRAR COMPRA · SUBE EL STOCK</b>
                <label class="campo"><span>Repuesto</span>
                  <select name="repuestoId" required>{todos.map((r) => <option value={r.id}>{r.codigo} · {r.nombre}</option>)}</select>
                </label>
                <div class="form-grid">
                  <label class="campo"><span>Cantidad</span><input name="cantidad" inputmode="numeric" required /></label>
                  <label class="campo"><span>Costo unitario S/</span><input name="costo" inputmode="decimal" required /></label>
                  <label class="campo"><span>Fecha</span><input name="fecha" type="date" /></label>
                </div>
                <label class="campo"><span>Proveedor</span><input name="proveedor" /></label>
                <button class="btn primario" type="submit" disabled={todos.length === 0}>REGISTRAR COMPRA</button>
                {todos.length === 0 ? <span class="muted" style="font-size:11px">Primero crea el repuesto →</span> : null}
              </form>
              <form method="post" action="/inventario/repuesto" class="panel" style="background:var(--white)">
                <b class="lbl-12">NUEVO REPUESTO EN EL CATÁLOGO</b>
                <div class="form-grid">
                  <label class="campo"><span>Nombre *</span><input name="nombre" required /></label>
                  <label class="campo"><span>Categoría *</span><select name="categoria">{categorias.map((x) => <option>{x}</option>)}</select></label>
                  <label class="campo"><span>Stock mínimo</span><input name="stockMinimo" inputmode="numeric" placeholder="0" /></label>
                  <label class="campo"><span>Código</span><input name="codigo" placeholder="automático" /></label>
                </div>
                <label class="campo"><span>Parte del modelo que reemplaza</span>
                  <select name="tipoParteId"><option value="">— ninguna —</option>{tipos.map((t) => <option value={t.id}>{t.nombre}</option>)}</select>
                </label>
                <label class="campo"><span>Piezas del modelo 3D donde va (opcional; si no, las de la parte)</span><SelectPiezas /></label>
                <label class="campo"><span>Proveedor</span><input name="proveedor" /></label>
                <button class="btn" type="submit">CREAR REPUESTO</button>
              </form>
            </div>
          ) : null}
        </Panel>
        <div class="filas" style="gap:10px">
          <Panel titulo="INVERSIÓN · POR CATEGORÍA">
            {resumen.porCategoria.length === 0 ? <Vacio>Sin inversión registrada.</Vacio> : resumen.porCategoria.map((x) => (
              <div>
                <div style="display:flex;justify-content:space-between;font-size:12px"><span>{x.categoria}</span><b>{soles(x.monto)}</b></div>
                <Barra pct={(x.monto / maxCat) * 100} color="var(--accent)" />
              </div>
            ))}
          </Panel>
          <Panel clase="oscuro" titulo="COMPRAS · VÍA TELEGRAM">
            {tgCompras.length === 0 ? <span class="muted" style="font-size:12px">Los choferes y el taller pueden registrar compras con <b>/compra</b>.</span> : (
              <div class="feed">
                {tgCompras.map((x) => (
                  <div class="ev"><span class="h">{fechaCorta(x.fecha)}</span><div><span class="cmd">/compra</span> {x.cantidad} × {x.nombre}<div class="muted">{soles(x.total)} · {x.quien ?? "—"}</div></div></div>
                ))}
              </div>
            )}
          </Panel>
          <Panel titulo="ÚLTIMAS COMPRAS">
            {compras.length === 0 ? <Vacio>Sin compras.</Vacio> : (
              <div class="tabla-wrap"><table class="t"><tbody>
                {compras.map((x) => <tr><td>{fechaCorta(x.fecha)}</td><td>{x.cantidad} × {x.codigo}</td><td class="num">{soles(x.total)}</td><td><Origen origen={x.origen} /></td></tr>)}
              </tbody></table></div>
            )}
          </Panel>
        </div>
      </div>
    </>
  ));
}

/** El formulario junta los valores repetidos con \u0001. */
const piezasDe = (v: string | undefined) => (v ? v.split("\u0001").filter(Boolean) : null);

export function rutasInventario(app: App, d: Deps): void {
  app.get("/inventario", (c) => vista(c, d));
  app.post("/inventario/repuesto", async (c) => {
    const f = await formulario(c);
    return accion(c, "/inventario", async () => {
      await crearRepuesto(d.ctx, {
        nombre: f.nombre ?? "", categoria: f.categoria ?? "Otros", codigo: f.codigo || undefined, stockMinimo: enteroONull(f.stockMinimo) ?? 0,
        proveedor: f.proveedor || null, tipoParteId: f.tipoParteId ? Number(f.tipoParteId) : null, piezas: piezasDe(f.piezas),
      }, c.get("usuario").id);
      return "Repuesto creado. Ahora registra la compra para subir el stock.";
    });
  });
  app.post("/inventario/repuesto/:id", async (c) => {
    const f = await formulario(c);
    return accion(c, "/inventario", async () => {
      await editarRepuesto(d.ctx, Number(c.req.param("id")), { stockMinimo: enteroONull(f.stockMinimo) ?? undefined }, c.get("usuario").id);
      return "Repuesto actualizado";
    });
  });
  app.post("/inventario/repuesto/:id/piezas", async (c) => {
    const f = await formulario(c);
    return accion(c, "/inventario", async () => {
      await editarRepuesto(d.ctx, Number(c.req.param("id")), { piezas: piezasDe(f.piezas) }, c.get("usuario").id);
      return "Piezas del repuesto actualizadas";
    });
  });
  app.post("/inventario/compra", async (c) => {
    const f = await formulario(c);
    return accion(c, "/inventario", async () => {
      const costo = parsearMonto(f.costo ?? "");
      if (costo === null) throw new ErrorNegocio("Costo unitario no válido");
      const cantidad = enteroONull(f.cantidad);
      if (cantidad === null) throw new ErrorNegocio("Indica la cantidad");
      await registrarCompra(d.ctx, {
        repuestoId: Number(f.repuestoId), cantidad, costoUnitario: costo, fecha: f.fecha || undefined, proveedor: f.proveedor || null,
        origen: "web", usuarioId: c.get("usuario").id,
      });
      return `Compra registrada: +${cantidad} en stock`;
    });
  });
}
