/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import {
  archivoDeDocumento, asignarViajeGasto, confirmarLectura, costoIaDelMes, descartarLectura, ErrorNegocio, fijarLectura,
  gastosSinViaje, hoy, listarCategorias, listarPorRevisar, viajesPorRevisar, listarUnidades, listarViajesFlota, MEDIOS_ENTREGA, nombreCategoria, parsearMonto, puedeEditar, sumarDias,
  type Lectura,
} from "@sunatapp/core";
import { accion, formulario, pagina, servirDeAlmacen, type App, type C, type Deps } from "../base";
import { fechaCorta, Panel, soles2, Vacio } from "../ui";

const ICONO_TIPO: Record<string, string> = { foto: "📷", voz: "🎤", texto: "💬" };
const ESTADO: Record<string, string> = { error: "NO SE PUDO LEER", por_confirmar: "SIN CONFIRMAR +24 H", pendiente: "LA IA NO RESPONDE" };

function valores(l: Lectura | null): { tipo: "gasto" | "entrega"; categoria: string; monto: string; medio: string; nota: string } {
  if (l?.tipo === "gasto") return { tipo: "gasto", categoria: l.categoria, monto: l.monto.toFixed(2), medio: "efectivo", nota: [l.proveedorNombre, l.comprobante, l.nota].filter(Boolean).join(" · ") };
  if (l?.tipo === "entrega") return { tipo: "entrega", categoria: "otros_viaje", monto: l.monto.toFixed(2), medio: l.medio, nota: "" };
  return { tipo: "gasto", categoria: "otros_viaje", monto: "", medio: "efectivo", nota: "" };
}

/** **Por revisar**: lo que quedó a medias en Telegram, para terminarlo desde la web. */
async function vista(c: C, d: Deps) {
  const ctx = d.ctx;
  const h = hoy(ctx);
  const categorias = await listarCategorias(ctx, { soloActivas: true });
  const [items, sinViaje, unidades, viajes, ia, viajesRev] = await Promise.all([
    listarPorRevisar(ctx), gastosSinViaje(ctx), listarUnidades(ctx),
    listarViajesFlota(ctx, { desde: sumarDias(h, -90), hasta: h }), costoIaDelMes(ctx, h.slice(0, 7)), viajesPorRevisar(ctx),
  ]);
  const edita = puedeEditar(c.get("usuario").rol, "viajes");
  return pagina(c, d, { titulo: "Por revisar", seccion: "viajes" }, (
    <>
      <section class="panel" style="flex-direction:row;align-items:center;flex-wrap:wrap;gap:10px">
        <a class="btn chico" href="/viajes">← VIAJES</a>
        <b class="mono-t" style="font-size:16px">🔎 POR REVISAR · {items.length + sinViaje.length + viajesRev.length}</b>
        <span class="muted" style="font-size:12px;margin-left:auto">IA este mes: US$ {ia.usd.toFixed(3)} · {ia.lecturas} lecturas</span>
      </section>
      <Panel titulo={`VIAJES Y GUÍAS · ${viajesRev.length}`}>
        {viajesRev.length === 0 ? <Vacio>Todos los viajes tienen su guía y sus datos completos.</Vacio> : viajesRev.map((x) => (
          <div class="linea" style="justify-content:space-between;gap:8px;border-bottom:1px solid var(--divider);padding:6px 0;flex-wrap:wrap">
            <span style="font-size:12px"><span class={`chip ${x.motivo === "guia_rechazada" ? "cambiar" : "proximo"}`}>{{ sin_guia: "SIN GUÍA", guia_rechazada: "GUÍA RECHAZADA", cierre_automatico: "CERRADO SOLO", guia_sin_viaje: "GUÍA SIN VIAJE" }[x.motivo]}</span> <b>{x.codigo}</b> · {x.detalle}</span>
            {x.viajeId ? <a class="btn chico" href={`/viajes/${x.viajeId}`}>ABRIR</a> : null}
          </div>
        ))}
      </Panel>
      <div class="grid g-2">
        <Panel titulo={`MENSAJES DE TELEGRAM · ${items.length}`}>
          {items.length === 0 ? <Vacio>Nada pendiente: todo lo que mandaron por Telegram está confirmado o descartado.</Vacio> : items.map((it) => {
            const v = valores(it.lectura);
            return (
              <div class="panel" style="background:var(--white);gap:6px">
                <div class="linea" style="justify-content:space-between">
                  <b>{ICONO_TIPO[it.tipo]} {fechaCorta(it.desde.toISOString().slice(0, 10))}</b>
                  <span class={`chip ${it.estado === "error" ? "cambiar" : "proximo"}`}>{ESTADO[it.estado]}</span>
                </div>
                {it.texto ? <span style="font-size:12px">«{it.texto}»</span> : null}
                {it.error ? <span class="muted" style="font-size:12px">⚠️ {it.error}</span> : null}
                {it.rutaArchivo && it.tipo === "foto" ? <a href={`/archivo/documento/${it.documentoId}`} target="_blank"><img src={`/archivo/documento/${it.documentoId}`} alt="Foto enviada" style="max-width:100%;max-height:220px;border-radius:4px" /></a> : null}
                {it.rutaArchivo && it.tipo === "voz" ? <audio controls src={`/archivo/documento/${it.documentoId}`} style="width:100%"></audio> : null}
                {edita ? (
                  <>
                    <form method="post" action={`/revisar/${it.documentoId}`} class="filas">
                      <div class="form-grid">
                        <label class="campo"><span>Es</span><select name="tipo"><option value="gasto" selected={v.tipo === "gasto"}>Gasto</option><option value="entrega" selected={v.tipo === "entrega"}>Dinero entregado</option></select></label>
                        <label class="campo"><span>Categoría</span><select name="categoria">{categorias.map((k) => <option value={k.clave} selected={k.clave === v.categoria}>{k.nombre}</option>)}</select></label>
                        <label class="campo"><span>Monto S/</span><input name="monto" inputmode="decimal" value={v.monto} required /></label>
                        <label class="campo"><span>Medio (si es entrega)</span><select name="medio">{Object.entries(MEDIOS_ENTREGA).map(([k, n]) => <option value={k} selected={k === v.medio}>{n}</option>)}</select></label>
                        <label class="campo"><span>Unidad</span><select name="vehiculoId">{unidades.map((u) => <option value={u.id}>{u.codigo} · {u.placa}</option>)}</select></label>
                      </div>
                      <label class="campo"><span>Nota</span><input name="nota" value={v.nota} /></label>
                      <button class="btn primario chico" type="submit">✅ GUARDAR</button>
                    </form>
                    <form method="post" action={`/revisar/${it.documentoId}/descartar`}><button class="btn chico fantasma" type="submit">❌ DESCARTAR</button></form>
                  </>
                ) : null}
              </div>
            );
          })}
        </Panel>
        <Panel titulo={`GASTOS SIN VIAJE · ${sinViaje.length}`}>
          {sinViaje.length === 0 ? <Vacio>Todos los gastos de Telegram tienen su viaje.</Vacio> : (
            <div class="filas">
              {sinViaje.map((g) => {
                const opciones = viajes.filter((v) => !g.vehiculoId || v.vehiculoId === g.vehiculoId);
                return (
                  <form method="post" action={`/revisar/gasto/${g.id}`} class="linea" style="flex-wrap:wrap;align-items:center;border-bottom:1px solid var(--divider);padding-bottom:6px">
                    <span style="flex:2;min-width:180px;font-size:12px"><b>{fechaCorta(g.fecha)}</b> · {nombreCategoria(g.categoria, categorias)} · <b>{soles2(g.monto)}</b>
                      {g.nota || g.proveedorNombre ? <span class="muted"> · {[g.proveedorNombre, g.nota].filter(Boolean).join(" · ")}</span> : null}
                      {g.conFoto ? <> <a href={`/archivo/gasto/${g.id}`} target="_blank">📷</a></> : null}</span>
                    {edita ? (
                      <>
                        <select name="viajeId" aria-label="Viaje" style="flex:2;min-width:160px">{opciones.map((v) => <option value={v.id}>{v.codigo} · {v.unidad} · {v.ruta}</option>)}</select>
                        <button class="btn chico" type="submit" disabled={opciones.length === 0}>ASIGNAR</button>
                      </>
                    ) : null}
                  </form>
                );
              })}
            </div>
          )}
        </Panel>
      </div>
    </>
  ));
}

export function rutasRevisar(app: App, d: Deps): void {
  app.get("/revisar", (c) => vista(c, d));
  app.get("/archivo/documento/:id{[0-9]+}", async (c) => {
    const a = await archivoDeDocumento(d.ctx, Number(c.req.param("id")));
    return servirDeAlmacen(c as C, d, a?.ruta ?? null);
  });
  app.post("/revisar/:id{[0-9]+}", async (c) => {
    const id = Number(c.req.param("id"));
    const f = await formulario(c);
    return accion(c, "/revisar", async () => {
      const monto = parsearMonto(f.monto ?? "");
      if (monto === null) throw new ErrorNegocio("Monto no válido");
      const soles = monto / 100;
      const lectura: Lectura = f.tipo === "entrega"
        ? { tipo: "entrega", monto: soles, medio: (f.medio as "efectivo") ?? "efectivo", fecha: null, dudas: [] }
        : { tipo: "gasto", categoria: f.categoria || "otros_viaje", monto: soles, fecha: null, proveedorRuc: null, proveedorNombre: null, comprobante: null, nota: f.nota || null, dudas: [], medioPago: null, kmOdometro: null };
      await fijarLectura(d.ctx, id, lectura);
      const r = await confirmarLectura(d.ctx, id, { vehiculoId: Number(f.vehiculoId) || null, usuarioId: c.get("usuario").id });
      if (r.tipo === "ya_confirmado") return "Ya estaba guardado";
      return r.tipo === "gasto" ? `Gasto guardado${r.viajeCodigo ? ` en ${r.viajeCodigo}` : ""}` : `Entrega anotada en ${r.viajeCodigo}`;
    });
  });
  app.post("/revisar/:id{[0-9]+}/descartar", async (c) => accion(c, "/revisar", async () => {
    await descartarLectura(d.ctx, Number(c.req.param("id")), c.get("usuario").id);
    return "Descartado";
  }));
  app.post("/revisar/gasto/:id{[0-9]+}", async (c) => {
    const f = await formulario(c);
    return accion(c, "/revisar", async () => `Gasto pasado a ${await asignarViajeGasto(d.ctx, Number(c.req.param("id")), Number(f.viajeId), c.get("usuario").id)}`);
  });
}
