/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import type { FC } from "hono/jsx";
import {
  AVISO_RETORNO_VACIO, editarViajeFlota, emitirFactura, guiasConAvisoRetornoVacio, enlazarGuia, ErrorNegocio, finalizarViajeFlota, hoy, listarCobrosPendientes,
  listarGuias, listarGuiasSinViaje, listarUnidades, listarViajesFlota, parsearMonto, FaltaDatoTransporteError, prepararFactura, puedeEditar, rangoMes,
  registrarViajeFlota, sumarDias, formatearSoles, archivosDocumento, viajesEnRuta, listarDocumentosAtascados, confirmarFacturaEnSol, reconsultarGuia,
  type Contexto,
} from "@sunatapp/core";
import { guardarCobro } from "../acciones";
import { accion, formulario, pagina, servirDeAlmacen, volverA, type App, type C, type Deps } from "../base";
import { enteroONull } from "./flota";
import { Cabecera, diasEntre, ESTADO_GUIA, fechaDia, ListaViajes, mesLargo, nombreGuia, SelectMes, TarjetaEnRuta, TEXTO_GUIA, Vacio } from "../ui";

/** Formulario de «Facturar» de una guía aceptada (también lo usa el detalle del viaje). */
export const FormFacturar: FC<{ guiaId: number; etiqueta: string; volver: string; aviso?: string | null }> = (p) => (
  <details class="plegable">
    <summary class="btn chico primario">{p.etiqueta}</summary>
    <form method="post" action={`/guias/${p.guiaId}/facturar`} class="filas sub-form">
      <input type="hidden" name="volver" value={p.volver} />
      {p.aviso ? <span class="aviso info">⚠️ {p.aviso}</span> : null}
      <label class="campo"><span>Monto S/</span><input name="monto" inputmode="decimal" required /></label>
      <label class="campo"><span>El monto…</span><select name="igv"><option value="sin">no incluye IGV</option><option value="con">ya incluye IGV</option></select></label>
      <label class="campo"><span>Pago</span><select name="pago"><option value="contado">Contado</option><option value="credito">Crédito</option></select></label>
      <label class="campo"><span>Días de crédito</span><input name="dias" inputmode="numeric" placeholder="30" /></label>
      <button class="btn primario" type="submit">Emitir factura</button>
    </form>
  </details>
);

/** Ids de las guías (de [guias]) aceptadas y sin facturar cuya unidad jala una cisterna (aviso del ×1.4). */
export async function avisosRetornoVacio(ctx: Contexto, guias: Array<{ id: number; estado: string }>): Promise<Set<number>> {
  return guiasConAvisoRetornoVacio(ctx, guias.filter((g) => g.estado === "aceptada").map((g) => g.id));
}

type Atascados = Awaited<ReturnType<typeof listarDocumentosAtascados>>;

/** Facturas y guías de SUNAT que el fondo ya no mueve solo: el dueño las resuelve aquí (también se avisa en Inicio). */
const DocumentosAtascados: FC<{ a: Atascados }> = ({ a }) => (
  <section class="col" id="sunat-atascados">
    <h2 class="titulo-seccion">Documentos que esperan tu ayuda · SUNAT</h2>
    <div class="lista-filas">
      {a.facturas.map((f) => (
        <form method="post" action={`/facturas/${f.id}/en-sol`} class="fila-atascado">
          <span><b>Factura {f.serieNumero}</b>: SUNAT dice que ya la tiene, pero no mandó su constancia. Entra a SOL, busca esta factura y dinos qué ves.</span>
          <span class="aviso info">Si acabas de emitirla, espera unos minutos antes de responder: SOL puede tardar en mostrarla.</span>
          <div class="linea">
            <button class="btn primario" type="submit" name="enSol" value="si">YA LA VERIFIQUÉ EN SOL: ESTÁ ACEPTADA</button>
            <button class="btn" type="submit" name="enSol" value="no">NO ESTÁ EN SOL</button>
          </div>
        </form>
      ))}
      {a.porReemitir.map((f) => (
        <form method="post" action={`/facturas/${f.id}/reemitir`} class="fila-atascado">
          <span><b>Factura {f.serieNumero}</b>: no está en SOL. Vuelve a emitirla; saldrá con otro número.</span>
          <div class="linea"><button class="btn primario" type="submit">VOLVER A EMITIR</button></div>
        </form>
      ))}
      {a.guias.map((g) => (
        <form method="post" action={`/guias/${g.id}/reconsultar`} class="fila-atascado">
          <span><b>Guía {g.serieNumero}</b>: SUNAT no respondió y dejamos de preguntar.</span>
          <div class="linea"><button class="btn primario" type="submit">VOLVER A CONSULTAR</button></div>
        </form>
      ))}
    </div>
  </section>
);

async function vista(c: C, d: Deps) {
  const ctx = d.ctx;
  const h = hoy(ctx);
  const q = c.req.query("mes") ?? "";
  const mes = /^\d{4}-\d{2}$/.test(q) ? q : h.slice(0, 7);
  const { desde, hasta } = rangoMes(`${mes}-01`);
  const unidadId = c.req.query("unidad") ? Number(c.req.query("unidad")) : undefined;
  const edita = puedeEditar(c.get("usuario").rol, "viajes");
  const [unidades, viajes, enRuta, guias, sinViaje, recientes, cobros] = await Promise.all([
    listarUnidades(ctx), listarViajesFlota(ctx, { desde, hasta, vehiculoId: unidadId }), viajesEnRuta(ctx), listarGuias(ctx, 15),
    listarGuiasSinViaje(ctx), listarViajesFlota(ctx, { desde: sumarDias(h, -60), hasta: h }), listarCobrosPendientes(ctx),
  ]);
  // Documentos que el fondo ya no mueve solo: solo el dueño los resuelve.
  const atascados = c.get("usuario").rol === "dueno" ? await listarDocumentosAtascados(ctx) : null;
  const hayAtascados = !!atascados && atascados.facturas.length + atascados.guias.length + atascados.porReemitir.length > 0;
  const retornoVacio = await avisosRetornoVacio(ctx, guias.filter((g) => !g.facturada));
  const delMes = viajes.filter((v) => v.estado !== "en_curso");
  return pagina(c, d, { titulo: "Viajes", seccion: "viajes" }, (
    <>
      <Cabecera titulo="Viajes" der={edita ? <a class="btn primario" href="#nuevo-viaje">+ Nuevo viaje</a> : null} />
      {hayAtascados && atascados ? <DocumentosAtascados a={atascados} /> : null}
      {enRuta.length ? (
        <section class="col">
          <h2 class="titulo-seccion">En ruta</h2>
          <div class="grid-tarjetas">{enRuta.map((v) => <TarjetaEnRuta v={v} />)}</div>
        </section>
      ) : null}
      <section class="col">
        <div class="fila-sep">
          <h2 class="titulo-seccion">{mesLargo(mes)} {mes.slice(0, 4)} · {delMes.length} {delMes.length === 1 ? "viaje" : "viajes"}</h2>
          <form method="get" action="/viajes" class="linea filtro">
            <SelectMes nombre="mes" valor={mes} hasta={h.slice(0, 7)} etiqueta="Mes" />
            <select name="unidad" aria-label="Camión"><option value="">Todos</option>{unidades.map((u) => <option value={u.id} selected={u.id === unidadId}>{u.codigo}</option>)}</select>
            <button class="btn chico" type="submit">Ver</button>
          </form>
        </div>
        {delMes.length === 0 ? <div class="lista-filas"><Vacio>Sin viajes cerrados en {mesLargo(mes)}.</Vacio></div> : <ListaViajes viajes={delMes} />}
      </section>
      {edita ? (
        <details class="plegable panel" id="nuevo-viaje">
          <summary class="ver-mas">+ Nuevo viaje</summary>
          <form method="post" action="/viajes" class="filas">
            <p class="muted nota-saldo">Los viajes también nacen solos de la guía que le mandas al bot.</p>
            <div class="form-grid">
              <label class="campo"><span>Camión</span><select name="vehiculoId">{unidades.map((u) => <option value={u.id}>{u.codigo} · {u.placa}</option>)}</select></label>
              <label class="campo"><span>Origen *</span><input name="origen" required placeholder="Juliaca" /></label>
              <label class="campo"><span>Destino *</span><input name="destino" required placeholder="Arequipa" /></label>
              <label class="campo"><span>Flete S/ (sin IGV)</span><input name="flete" inputmode="decimal" /></label>
            </div>
            <fieldset class="grupo"><legend class="lbl">¿Ya se hizo o sale ahora?</legend>
              <div class="radios">
                <label><input type="radio" name="estado" value="en_curso" checked /><span>Sale ahora</span></label>
                <label><input type="radio" name="estado" value="cerrado" /><span>Ya se hizo (suma los km)</span></label>
              </div>
            </fieldset>
            <details class="plegable"><summary class="ver-mas">Más datos</summary>
              <div class="form-grid">
                <label class="campo"><span>Fecha</span><input type="date" name="fecha" value={h} /></label>
                <label class="campo"><span>Km</span><input name="km" inputmode="numeric" placeholder="1290" /></label>
                <label class="campo"><span>Toneladas</span><input name="toneladas" inputmode="decimal" /></label>
                <label class="campo"><span>Guía</span><input name="guia" placeholder="T001-0214" /></label>
              </div>
            </details>
            <button class="btn primario" type="submit">Guardar viaje</button>
          </form>
        </details>
      ) : null}
      <details class="plegable panel">
        <summary class="ver-mas">Ver más · guías, cobros y rutas</summary>
        <div class="filas">
          <h3 class="titulo-seccion">Guías de remisión (SUNAT)</h3>
          {guias.length === 0 ? <Vacio>Sin guías todavía: se emiten desde el bot mandándole el PDF del remitente.</Vacio> : (
            <div class="lista-filas">{guias.map((g) => (
              <div class="fila-papel">
                <span class={`chip ${ESTADO_GUIA[g.estado] ?? "neutro"}`}>{g.facturada ? "FACTURADA" : TEXTO_GUIA[g.estado] ?? g.estado.toUpperCase()}</span>
                <span><b>{nombreGuia(g.serieNumero)}</b> · {fechaDia(g.fechaTraslado)} · {g.destinatario}</span>
                {g.estado === "aceptada"
                  ? <span class="archivos"><a href={`/guias/${g.id}/pdf`}>PDF</a> · <a href={`/guias/${g.id}/xml`}>XML</a> · <a href={`/guias/${g.id}/cdr`}>CDR</a></span> : null}
                {edita && g.estado === "aceptada" && !g.facturada
                  ? <FormFacturar guiaId={g.id} etiqueta="Facturar" volver="/viajes" aviso={retornoVacio.has(g.id) ? AVISO_RETORNO_VACIO : null} /> : null}
              </div>
            ))}</div>
          )}
          {edita && sinViaje.length ? (
            <>
              <h3 class="titulo-seccion">Guías sin viaje</h3>
              <div class="lista-filas">{sinViaje.map((g) => (
                <form method="post" action={`/guias/${g.id}/enlazar`} class="linea fila-papel">
                  <input type="hidden" name="volver" value="/viajes" />
                  <span><b>{nombreGuia(g.serieNumero)}</b> · {fechaDia(g.fechaTraslado)}</span>
                  <select name="viajeId" aria-label="Viaje">{recientes.map((v) => <option value={v.id}>{v.unidad} · {v.ruta} · {fechaDia(v.fecha)}</option>)}</select>
                  <select name="tramo" aria-label="Tramo"><option value="ida">de ida</option><option value="retorno">de vuelta</option></select>
                  <button class="btn chico" type="submit">Enlazar</button>
                </form>
              ))}</div>
            </>
          ) : null}
          {edita && cobros.filas.length ? (
            <form method="post" action="/cobros/recordar"><button class="btn" type="submit">Recordar los cobros por Telegram ({cobros.filas.length})</button></form>
          ) : null}
          <a class="ver-mas" href="/rutas">Rutas y presupuestos →</a>
        </div>
      </details>
    </>
  ));
}

export function rutasViajes(app: App, d: Deps): void {
  app.get("/viajes", (c) => vista(c, d));
  app.post("/viajes", async (c) => {
    const f = await formulario(c);
    return accion(c, "/viajes", async () => {
      const flete = f.flete ? parsearMonto(f.flete) : null;
      if (f.flete && flete === null) throw new ErrorNegocio("Flete no válido");
      const ton = f.toneladas ? Number(f.toneladas.replace(",", ".")) : null;
      if (ton !== null && !Number.isFinite(ton)) throw new ErrorNegocio("Toneladas no válidas");
      const r = await registrarViajeFlota(d.ctx, {
        vehiculoId: Number(f.vehiculoId), origenLugar: f.origen ?? "", destinoLugar: f.destino ?? "", km: enteroONull(f.km), toneladas: ton,
        flete, guiaRef: f.guia || null, fecha: f.fecha || undefined, estado: f.estado === "en_curso" ? "en_curso" : "cerrado",
        origen: "web", usuarioId: c.get("usuario").id,
      });
      return `Viaje ${r.codigo} registrado`;
    });
  });
  app.post("/viajes/fin", async (c) => {
    const f = await formulario(c);
    return accion(c, "/viajes", async () => {
      const flete = f.flete ? parsearMonto(f.flete) : undefined;
      if (flete === null) throw new ErrorNegocio("Flete no válido");
      const r = await finalizarViajeFlota(d.ctx, {
        viajeId: Number(f.viajeId), odometroFin: enteroONull(f.odometro) ?? undefined, km: enteroONull(f.km) ?? undefined, flete, usuarioId: c.get("usuario").id,
      });
      return `Viaje ${r.codigo} cerrado${r.km ? ` · ${r.km.toLocaleString("en-US")} km sumados a las partes` : ""}`;
    });
  });
  app.post("/viajes/flete", async (c) => {
    const f = await formulario(c);
    return accion(c, volverA(f.volver, "/viajes"), async () => {
      const flete = f.flete ? parsearMonto(f.flete) : null;
      await editarViajeFlota(d.ctx, Number(f.viajeId), { flete }, c.get("usuario").id);
      return "Flete actualizado";
    });
  });
  app.post("/guias/:id/facturar", async (c) => {
    const f = await formulario(c);
    return accion(c, volverA(f.volver, "/viajes"), async () => {
      const monto = parsearMonto(f.monto ?? "");
      if (monto === null) throw new ErrorNegocio("Monto no válido");
      const credito = f.pago === "credito";
      let facturaId: number;
      try {
        ({ facturaId } = await prepararFactura(d.ctx, {
          guiaId: Number(c.req.param("id")), montoCentimos: monto, incluyeIgv: f.igv === "con", formaPago: credito ? "credito" : "contado",
          diasCredito: credito ? (enteroONull(f.dias) ?? 30) : undefined,
        }, c.get("usuario").id));
      } catch (error) {
        if (error instanceof FaltaDatoTransporteError) throw new ErrorNegocio(`${error.message} — complétalo en Ajustes › Rutas y presupuestos (valor referencial) o en Camiones › Datos (carga útil)`);
        throw error;
      }
      const r = await emitirFactura(d.ctx, facturaId);
      return `Factura ${r.serieNumero}: ${r.estado}${r.mensaje ? ` · ${r.mensaje}` : ""}`;
    });
  });
  // Documentos atascados (ver listarDocumentosAtascados): solo el dueño, y queda en la auditoría.
  const soloDueno = (c: C) => {
    if (c.get("usuario").rol !== "dueno") throw new ErrorNegocio("Solo el dueño puede resolver documentos de SUNAT");
  };
  app.post("/facturas/:id/en-sol", async (c) => {
    const f = await formulario(c);
    return accion(c, "/viajes", async () => {
      soloDueno(c);
      if (f.enSol !== "si" && f.enSol !== "no") throw new ErrorNegocio("Elige si la factura está o no en SOL");
      const r = await confirmarFacturaEnSol(d.ctx, Number(c.req.param("id")), f.enSol === "si", c.get("usuario").id);
      return r.estado === "aceptada" ? `Factura ${r.serieNumero} marcada como aceptada` : `Factura ${r.serieNumero}: no está en SOL. Toca VOLVER A EMITIR`;
    });
  });
  app.post("/facturas/:id/reemitir", async (c) => accion(c, "/viajes", async () => {
    soloDueno(c);
    const id = Number(c.req.param("id"));
    if (!(await listarDocumentosAtascados(d.ctx)).porReemitir.some((f) => f.id === id)) throw new ErrorNegocio("Esa factura no está esperando que la vuelvas a emitir");
    const r = await emitirFactura(d.ctx, id);
    return `Factura ${r.serieNumero}: ${r.estado}${r.mensaje ? ` · ${r.mensaje}` : ""}`;
  }));
  app.post("/guias/:id/reconsultar", async (c) => accion(c, "/viajes", async () => {
    soloDueno(c);
    const r = await reconsultarGuia(d.ctx, Number(c.req.param("id")), c.get("usuario").id);
    return `Guía ${r.serieNumero}: ${r.mensaje ?? "se volverá a consultar"}`;
  }));
  app.post("/guias/:id/enlazar", async (c) => {
    const f = await formulario(c);
    return accion(c, volverA(f.volver, "/viajes"), async () => {
      await enlazarGuia(d.ctx, Number(c.req.param("id")), Number(f.viajeId), f.tramo === "retorno" ? "retorno" : "ida", c.get("usuario").id);
      return "Guía enlazada al viaje";
    });
  });
  app.post("/cobros/recordar", async (c) => accion(c, "/viajes", async () => {
    const { filas, totalPendiente } = await listarCobrosPendientes(d.ctx);
    if (!filas.length) return "No hay cobros pendientes";
    const h = hoy(d.ctx);
    const lineas = filas.map((f) => `• ${f.serieNumero} · ${f.cliente} · ${formatearSoles(f.saldo)} · ${f.fechaVencimiento < h ? `vencida ${diasEntre(f.fechaVencimiento, h)} d` : `vence ${f.fechaVencimiento}`}`);
    await d.avisar(`💰 COBROS PENDIENTES · ${formatearSoles(totalPendiente)}\n${lineas.join("\n")}`);
    return "Recordatorio enviado al grupo de Telegram";
  }));
  app.post("/cobros/:id", async (c) => {
    const f = await formulario(c);
    return accion(c, volverA(f.volver, "/viajes"), () => guardarCobro(d, c.get("usuario").id, Number(c.req.param("id")), f));
  });
  for (const tipo of ["guia", "factura"] as const) {
    app.get(`/${tipo}s/:id/:archivo`, async (c) => {
      const a = await archivosDocumento(d.ctx, tipo, Number(c.req.param("id")));
      const k = c.req.param("archivo") as "pdf" | "xml" | "cdr";
      return servirDeAlmacen(c, d, a && k in a ? a[k] : null, k !== "pdf");
    });
  }
}
