/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import type { FC } from "hono/jsx";
import { raw } from "hono/html";
import {
  CATEGORIAS_REPUESTO, datosSunatVehiculo, GRUPOS_PIEZA, listarCompras, listarReparaciones, listarRepuestos, listarTiposParte, listarUnidades,
  partesDePieza, partesDeUnidad, piezasDeSemirremolque, puedeEditar, repuestosDePieza, resumirInventario, TIPOS_REPARACION, TIPOS_SEMIRREMOLQUE, ZONAS,
  type EstadoUnidad, type GrupoPieza, type ParteConDesgaste, type TipoSemirremolque, type Unidad,
} from "@sunatapp/core";
import { pagina, type App, type C, type Deps } from "../base";
import { RUTA } from "../lugares";
import { conParametros } from "../redirecciones";
import {
  Barra, Cabecera, CHIP_UNIDAD, ChipEstado, Datos, ESTADO_UNIDAD, ETIQUETA_ESTADO, fechaCorta, fechaMedia, miles, soles, soles2, Vacio,
} from "../ui";
import { SelectPiezas, textoPiezas } from "./inventario";

const TABS = { toca: "Lo que toca", historial: "Historial", repuestos: "Repuestos", datos: "Datos" } as const;
type Tab = keyof typeof TABS;
const CHIP_REPUESTO: Record<string, string> = { "EN STOCK": "ok", BAJO: "proximo", INSTALADO: "oscuro", AGOTADO: "cambiar" };
const TEXTO_REPUESTO: Record<string, string> = { "EN STOCK": "hay", BAJO: "quedan pocos", INSTALADO: "instalado", AGOTADO: "no hay" };
/** Cuántas partes se ven de frente en «Lo que toca»; el resto queda en «Ver todas». */
const PARTES_DE_FRENTE = 5;

function Contador(p: { etiqueta: string; uso: number; vida: number | null; unidad: string; manda: boolean }) {
  if (p.vida === null) return null;
  const r = Math.round((p.uso / p.vida) * 100);
  return (
    <div class={`contador${p.manda ? " manda" : ""}`}>
      <div class="fila-sep"><span class="lbl">{p.etiqueta}{p.manda ? <b class="t-cambiar"> · manda</b> : null}</span><span><b>{miles(p.uso)}</b> / {miles(p.vida)} {p.unidad}</span></div>
      <Barra pct={r} estado={r >= 90 ? "cambiar" : r >= 70 ? "proximo" : "ok"} />
    </div>
  );
}

/** El visor 3D de siempre (mismos ids que espera public/trailer3d.js). */
const Visor: FC<{ unidad: Unidad; piezas: number; sel: ParteConDesgaste | null }> = ({ unidad, piezas, sel }) => (
  <div class="visor" id="visor">
    <canvas role="img" aria-label={`Modelo 3D de ${unidad.codigo}: cada pieza va por separado y su color es el desgaste. Arrastra para girar, pellizca para acercar, toca una pieza para ver su historial.`}></canvas>
    <div class="cab">
      <span class="visor-titulo">{unidad.codigo} · {TIPOS_SEMIRREMOLQUE[unidad.semirremolque]} · {piezas} piezas</span>
      <div class="der">
        <button class="btn chico solo-pc" id="btn-izq" type="button" aria-label="Girar a la izquierda">&lt;</button>
        <button class="btn chico solo-pc" id="btn-der" type="button" aria-label="Girar a la derecha">&gt;</button>
        <button class="btn chico" id="btn-girar" type="button" aria-pressed="false">Girar</button>
        <button class="btn chico" id="btn-aislar" type="button" aria-pressed="false" disabled title="Elige una pieza y mírala sola">Solo esta</button>
        <button class="btn chico solo-pc" id="btn-despiece" type="button" aria-pressed="false">Despiece</button>
        <button class="btn chico" id="btn-todo" type="button">Ver todo</button>
        <span class="lbl solo-pc" style="color:var(--dark-muted)">Ángulo <span id="angulo">0</span>°</span>
      </div>
    </div>
    <div class="etiqueta" hidden>{sel ? <>{sel.nombreCorto} · desgaste <b>{sel.pct}%</b></> : null}</div>
    <div class="pie"><span><i class="d-ok"></i>bien</span><span><i class="d-proximo"></i>pronto</span><span><i class="d-cambiar"></i>cambiar ya</span><span><i style="background:#E9E3D6;opacity:.5"></i>sin control</span></div>
    {raw(`<script>setTimeout(function(){if(!window.__visor3d){var e=document.querySelector("#visor .sin-webgl");if(e)e.hidden=false;}},6000)</script>`)}
    <div class="sin-webgl" hidden>Este navegador no puede mostrar el modelo 3D (actualiza «Android System WebView» o Chrome). Las pestañas de abajo funcionan igual.</div>
  </div>
);

function FilaToca(p: { parte: ParteConDesgaste; aqui: string; sel: boolean }) {
  const x = p.parte;
  return (
    <a class={`fila-toca${p.sel ? " sel" : ""}`} href={`${p.aqui}?parte=${x.id}`} aria-current={p.sel ? "true" : undefined}>
      <span class="fila-sep"><span>{x.nombre}</span><b class={`t-${x.estado} mono-t`}>{x.pct}%</b></span>
      <Barra pct={x.pct} estado={x.estado} />
      <span class="muted">{x.viajesRestantes === null ? `Cambiar en ~${x.restanteTexto.toLowerCase()}` : `Quedan ≈ ${x.restanteTexto.toLowerCase()}`}</span>
    </a>
  );
}

async function vista(c: C, d: Deps) {
  const ctx = d.ctx;
  const u = c.get("usuario");
  const unidades = await listarUnidades(ctx);
  const unidad = unidades.find((x) => x.id === Number(c.req.param("id")));
  if (!unidad) return c.redirect(unidades[0] ? `/camiones/${unidades[0].id}` : "/camiones/nuevo");
  const pedida = c.req.query("tab") ?? "";
  const tab: Tab = pedida in TABS ? (pedida as Tab) : "toca";
  const editaTaller = puedeEditar(u.rol, "reparaciones");
  const editaFlota = puedeEditar(u.rol, "flota");
  const editaInv = puedeEditar(u.rol, "inventario");
  const aqui = `/camiones/${unidad.id}`;
  const [partes, historial, repuestos, tipos, sunat, compras] = await Promise.all([
    partesDeUnidad(ctx, unidad.id), listarReparaciones(ctx, { vehiculoId: unidad.id, limite: 400 }), listarRepuestos(ctx), listarTiposParte(ctx),
    datosSunatVehiculo(ctx, unidad.id), listarCompras(ctx, { limite: 8 }),
  ]);
  const PIEZAS = piezasDeSemirremolque(unidad.semirremolque);
  const piezaSel = PIEZAS.find((p) => p.id === c.req.query("pieza")) ?? null;
  const parteSel = partes.find((p) => p.id === Number(c.req.query("parte"))) ?? null;
  const porPieza: Record<string, Array<{ fecha: string; trabajo: string; tipo: string; km: string; costo: string | null; taller: string | null }>> = {};
  for (const h of historial.filter((x) => x.componente)) {
    (porPieza[h.componente!] ??= []).push({ fecha: fechaMedia(h.fecha), trabajo: h.trabajo, tipo: TIPOS_REPARACION[h.tipo], km: miles(h.odometro), costo: h.costoTotal ? soles2(h.costoTotal) : null, taller: h.taller });
  }
  const partesPieza: Record<string, Array<{ id: number; nombre: string; pct: number; estado: string; url: string }>> = {};
  for (const pz of PIEZAS) {
    const suyas = partesDePieza(pz, partes).sort((a, b) => b.pct - a.pct);
    if (suyas.length) partesPieza[pz.id] = suyas.map((p) => ({ id: p.id, nombre: p.nombre, pct: p.pct, estado: p.estado, url: `${aqui}?parte=${p.id}` }));
  }
  const repuestoVer = repuestos.find((r) => r.id === Number(c.req.query("repuesto"))) ?? null;
  const datosVisor = {
    parteSeleccionada: piezaSel ? null : parteSel?.id ?? null,
    piezaSeleccionada: piezaSel?.id ?? null,
    autogiro: false,
    nombresZona: ZONAS,
    piezas: PIEZAS,
    historial: porPieza,
    partesPieza,
    repuestosPieza: Object.fromEntries(PIEZAS.map((pz) => [pz.id, repuestosDePieza(repuestos, pz.id).map((r) => ({ id: r.id, codigo: r.codigo, nombre: r.nombre, stock: r.stock }))]).filter(([, rs]) => rs!.length)),
    resaltar: repuestoVer ? { titulo: `${repuestoVer.codigo} · ${repuestoVer.nombre}`, piezas: repuestoVer.piezas } : null,
  };
  const conHistorial = new Set(Object.keys(porPieza));
  const faltantes = tipos.filter((t) => !partes.some((p) => p.tipoParteId === t.id));
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const filas = q ? repuestos.filter((r) => `${r.codigo} ${r.nombre} ${r.categoria} ${r.proveedor ?? ""}`.toLowerCase().includes(q)) : repuestos;
  const anotarCambio = (extra: string, volver = aqui) => `/anotar?tipo=repare&vehiculoId=${unidad.id}${extra}&volver=${encodeURIComponent(volver)}`;
  const ordenadas = [...partes].sort((a, b) => b.pct - a.pct);
  const deFrente = ordenadas.slice(0, PARTES_DE_FRENTE);
  const resto = ordenadas.slice(PARTES_DE_FRENTE);
  const inventario = resumirInventario(repuestos);

  const tabToca = (
    <div class="col">
      {partes.length === 0 ? <div class="lista-filas"><Vacio>Este camión no tiene partes controladas todavía.</Vacio></div> : (
        <div class="lista-filas">
          {deFrente.map((p) => <FilaToca parte={p} aqui={aqui} sel={p.id === parteSel?.id} />)}
          {resto.length ? (
            <details class="plegable resto-partes" open={resto.some((p) => p.id === parteSel?.id)}>
              <summary class="ver-mas">Ver las otras {resto.length} partes</summary>
              {resto.map((p) => <FilaToca parte={p} aqui={aqui} sel={p.id === parteSel?.id} />)}
            </details>
          ) : null}
        </div>
      )}
      {editaTaller && !parteSel ? <a class="btn primario grande" href={anotarCambio("")} data-abrir-panel="">Registrar un cambio</a> : null}
      {parteSel ? (
        <section class="panel" id="parte-elegida">
          <div class="fila-sep"><b>{parteSel.nombre}</b><ChipEstado estado={parteSel.estado} /></div>
          <span class="muted">Puesta el {fechaMedia(parteSel.fechaInstalacion)} · repuesto {parteSel.repuesto?.codigo ?? "—"} · costó {parteSel.costo ? soles2(parteSel.costo) : "—"}</span>
          <Contador etiqueta="Kilómetros" uso={parteSel.uso.km} vida={parteSel.vida.km} unidad="km" manda={parteSel.manda === "km"} />
          <Contador etiqueta="Viajes" uso={parteSel.uso.viajes} vida={parteSel.vida.viajes} unidad="viajes" manda={parteSel.manda === "viajes"} />
          <Contador etiqueta="Días" uso={parteSel.uso.dias} vida={parteSel.vida.dias} unidad="días" manda={parteSel.manda === "dias"} />
          <div class="caja-oscura"><span class="lbl">Cambiar antes de</span><b>{parteSel.restanteTexto}</b><span class="muted">Manda el contador que se cumpla primero · {ETIQUETA_ESTADO[parteSel.estado].toLowerCase()}</span></div>
          {editaTaller ? <a class="btn primario grande" href={anotarCambio(`&parteId=${parteSel.id}`, `${aqui}?parte=${parteSel.id}`)} data-abrir-panel="">Registrar un cambio</a> : null}
          {editaTaller ? (
            <details class="plegable"><summary class="ver-mas">Ajustar la vida útil de esta parte</summary>
              <form method="post" action={`/parte/${parteSel.id}/vida?volver=${encodeURIComponent(`${aqui}?parte=${parteSel.id}`)}`} class="form-grid sub-form">
                <label class="campo"><span>Km</span><input name="vidaKm" inputmode="numeric" value={parteSel.vida.km ?? ""} /></label>
                <label class="campo"><span>Viajes</span><input name="vidaViajes" inputmode="numeric" value={parteSel.vida.viajes ?? ""} /></label>
                <label class="campo"><span>Días</span><input name="vidaDias" inputmode="numeric" value={parteSel.vida.dias ?? ""} /></label>
                <button class="btn" type="submit">Guardar vida útil</button>
              </form>
            </details>
          ) : null}
          <a class="ver-mas" href={aqui}>Cerrar esta parte</a>
        </section>
      ) : null}
      {editaTaller && faltantes.length ? (
        <details class="plegable panel"><summary class="ver-mas">+ Controlar otra parte</summary>
          <form method="post" action={`/trailer/${unidad.id}/instalar`} class="filas">
            <label class="campo"><span>Parte</span><select name="tipoParteId">{faltantes.map((t) => <option value={t.id}>{t.nombre}</option>)}<option value="todas">— Todas las que faltan —</option></select></label>
            <label class="campo"><span>Puesta el</span><input type="date" name="fecha" /></label>
            <label class="campo"><span>Odómetro cuando se puso (km)</span><input name="km" inputmode="numeric" placeholder={String(unidad.odometroKm)} /></label>
            <label class="campo"><span>Viajes hechos desde entonces</span><input name="viajesDesde" inputmode="numeric" placeholder="0" /></label>
            <span class="muted">Si no sabes la fecha, déjala vacía: se cuenta desde hoy.</span>
            <button class="btn primario" type="submit">Guardar</button>
          </form>
        </details>
      ) : null}
    </div>
  );

  const tabHistorial = (
    <div class="col">
      <div class="lista-filas">
        {historial.length === 0 ? <Vacio>Todavía no hay arreglos de este camión.</Vacio> : historial.slice(0, 60).map((h) => (
          <div class="fila-historial">
            <div class="fila-sep"><b>{fechaMedia(h.fecha)}</b><span>{h.costoTotal ? soles2(h.costoTotal) : "sin costo"}</span></div>
            <span>{h.trabajo}</span>
            <span class="muted">{[TIPOS_REPARACION[h.tipo], h.pieza, h.parte, h.taller, h.odometro ? `${miles(h.odometro)} km` : null].filter(Boolean).join(" · ")}</span>
            {h.componente ? <a class="ver-mas" href={`${aqui}?pieza=${h.componente}`}>Ver en el 3D</a> : null}
          </div>
        ))}
      </div>
      {historial.length > 60 ? <span class="muted">Se ven los 60 más recientes.</span> : null}
      <span class="muted">Total en arreglos: {soles(historial.reduce((s, h) => s + h.costoTotal, 0))}</span>
      {editaTaller ? <a class="btn primario grande" href={anotarCambio("", `${aqui}?tab=historial`)} data-abrir-panel="">Registrar un cambio</a> : null}
    </div>
  );

  const tabRepuestos = (
    <div class="col">
      <form method="get" action={aqui} class="linea filtro">
        <input type="hidden" name="tab" value="repuestos" />
        <input name="q" value={c.req.query("q") ?? ""} placeholder="Buscar repuesto" aria-label="Buscar repuesto" style="flex:1;min-width:0" />
        <button class="btn" type="submit">Buscar</button>
      </form>
      <span class="muted">En el almacén: {soles(inventario.enAlmacen)} · puesto en los camiones: {soles(inventario.instalado)}{inventario.stockBajo ? ` · ${inventario.stockBajo} con pocos` : ""}</span>
      <div class="lista-filas">
        {filas.length === 0 ? <Vacio>No hay repuestos{q ? " con esa búsqueda" : ""}.</Vacio> : filas.map((r) => (
          <div class="fila-historial">
            <div class="fila-sep"><b>{r.codigo} · {r.nombre}</b><span class={`chip ${CHIP_REPUESTO[r.estado]}`}>{TEXTO_REPUESTO[r.estado] ?? r.estado}</span></div>
            <span class="muted">Hay {r.stock}{r.stockMinimo ? ` (avisar bajo ${r.stockMinimo})` : ""} · {soles2(r.costoUnitario)} c/u · {textoPiezas(r.piezas)}</span>
            <div class="acciones">
              {r.piezas.length ? <a class="btn chico" href={`${aqui}?repuesto=${r.id}`}>Ver en el 3D</a> : null}
              {editaInv ? <a class="btn chico" href={`/anotar?tipo=repare&modo=compra&repuestoId=${r.id}&volver=${encodeURIComponent(`${aqui}?tab=repuestos`)}`} data-abrir-panel="">Compré más</a> : null}
              {editaInv ? (
                <details class="plegable"><summary class="btn chico fantasma">Editar</summary>
                  <form method="post" action={`/inventario/repuesto/${r.id}`} class="linea sub-form">
                    <input type="hidden" name="volver" value={`${aqui}?tab=repuestos`} />
                    <label class="campo"><span>Avisar si quedan menos de</span><input name="stockMinimo" inputmode="numeric" value={r.stockMinimo} /></label>
                    <button class="btn chico" type="submit">Guardar</button>
                  </form>
                  <form method="post" action={`/inventario/repuesto/${r.id}/piezas`} class="filas sub-form">
                    <input type="hidden" name="volver" value={`${aqui}?tab=repuestos`} />
                    <label class="campo"><span>¿En qué piezas va?</span><SelectPiezas elegidas={r.piezasElegidas ? r.piezas : []} /></label>
                    <span class="muted">Sin elegir ninguna, va donde va su tipo de parte.</span>
                    <button class="btn chico" type="submit">Guardar piezas</button>
                  </form>
                </details>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      {compras.length ? (
        <details class="plegable panel"><summary class="ver-mas">Últimas compras ({compras.length})</summary>
          <div class="filas">{compras.map((x) => <div class="fila-sep"><span>{fechaCorta(x.fecha)} · {x.codigo} · {x.nombre} · +{x.cantidad}</span><b>{soles2(x.total)}</b></div>)}</div>
        </details>
      ) : null}
      {editaInv ? (
        <details class="plegable panel" id="nuevo-repuesto"><summary class="ver-mas">Ver más · repuesto nuevo</summary>
          <form method="post" action="/inventario/repuesto" class="filas">
            <input type="hidden" name="volver" value={`${aqui}?tab=repuestos`} />
            <label class="campo"><span>Nombre *</span><input name="nombre" required placeholder="Pastillas de freno" /></label>
            <label class="campo"><span>Categoría</span><select name="categoria">{CATEGORIAS_REPUESTO.map((k) => <option value={k}>{k}</option>)}</select></label>
            <label class="campo"><span>Avisar si quedan menos de</span><input name="stockMinimo" inputmode="numeric" placeholder="0" /></label>
            <label class="campo"><span>Parte que reemplaza</span><select name="tipoParteId"><option value="">— ninguna —</option>{tipos.map((t) => <option value={t.id}>{t.nombre}</option>)}</select></label>
            <label class="campo"><span>¿En qué piezas va? (si no eliges, las de la parte)</span><SelectPiezas /></label>
            <label class="campo"><span>Proveedor</span><input name="proveedor" /></label>
            <label class="campo"><span>Código</span><input name="codigo" placeholder="se pone solo" /></label>
            <button class="btn primario" type="submit">Crear repuesto</button>
            <span class="muted">Después anota la compra con «Compré más» para subir lo que hay.</span>
          </form>
        </details>
      ) : null}
    </div>
  );

  const tabDatos = (
    <div class="col">
      <dl class="datos-camion">
        <div><dt>Placa</dt><dd>{unidad.placa}</dd></div>
        <div><dt>Carreta</dt><dd>{unidad.carreta?.placa ?? "—"}</dd></div>
        <div><dt>Marca y modelo</dt><dd>{[unidad.marca, unidad.modelo, unidad.anio].filter(Boolean).join(" ") || "—"}</dd></div>
        <div><dt>Estado</dt><dd><span class={`chip ${CHIP_UNIDAD[unidad.estado]}`}>{ESTADO_UNIDAD[unidad.estado]}</span></dd></div>
        <div><dt>Odómetro</dt><dd>{miles(unidad.odometroKm)} km</dd></div>
        <div><dt>Viajes hechos</dt><dd>{miles(unidad.viajesTotales)}</dd></div>
        <div><dt>Configuración vehicular</dt><dd>{sunat.configuracionVehicular ?? "falta"}</dd></div>
        <div><dt>Carga útil</dt><dd>{sunat.cargaUtilTm !== null ? `${sunat.cargaUtilTm} t` : "falta"}</dd></div>
        <div><dt>Rendimiento</dt><dd>{unidad.rendimientoKmGal ? `${unidad.rendimientoKmGal} km/gal` : "—"}</dd></div>
        <div><dt>Semirremolque</dt><dd>{TIPOS_SEMIRREMOLQUE[unidad.semirremolque]}</dd></div>
      </dl>
      {editaFlota && (sunat.configuracionVehicular === null || sunat.cargaUtilTm === null) ? (
        <div class="aviso info">Para facturar el flete a SUNAT falta la configuración vehicular o la carga útil: complétalas en «Editar datos del camión».</div>
      ) : null}
      {editaFlota ? (
        <form method="post" action={`/flota/${unidad.id}/odometro`} class="linea">
          <label class="campo" style="flex:1"><span>¿Cuánto marca el odómetro hoy?</span><input name="km" inputmode="numeric" required placeholder={String(unidad.odometroKm)} /></label>
          <button class="btn" type="submit">Guardar km</button>
        </form>
      ) : null}
      {editaFlota ? (
        <details class="plegable panel"><summary class="ver-mas">Editar datos del camión</summary>
          <form method="post" action={`/flota/${unidad.id}`} class="form-grid">
            <label class="campo"><span>Estado</span><select name="estado">{(["en_base", "en_ruta", "en_taller", "inactivo"] as EstadoUnidad[]).map((e) => <option value={e} selected={e === unidad.estado}>{ESTADO_UNIDAD[e]}</option>)}</select></label>
            <label class="campo"><span>Marca</span><input name="marca" value={unidad.marca ?? ""} /></label>
            <label class="campo"><span>Modelo</span><input name="modelo" value={unidad.modelo ?? ""} /></label>
            <label class="campo"><span>Año</span><input name="anio" inputmode="numeric" value={unidad.anio ?? ""} /></label>
            <label class="campo"><span>Placa de la carreta</span><input name="placaCarreta" value={unidad.carreta?.placa ?? ""} /></label>
            <label class="campo"><span>Semirremolque</span><select name="semirremolque">{(Object.keys(TIPOS_SEMIRREMOLQUE) as TipoSemirremolque[]).map((t) => <option value={t} selected={t === unidad.semirremolque}>{TIPOS_SEMIRREMOLQUE[t]}</option>)}</select></label>
            <label class="campo"><span>Rendimiento km/gal</span><input name="rendimiento" inputmode="decimal" value={unidad.rendimientoKmGal ?? ""} /></label>
            <label class="campo"><span>Configuración vehicular</span><input name="configuracionVehicular" value={sunat.configuracionVehicular ?? ""} placeholder="T3S3" /></label>
            <label class="campo"><span>Carga útil (toneladas)</span><input name="cargaUtilTm" inputmode="decimal" value={sunat.cargaUtilTm ?? ""} placeholder="30" /></label>
            <button class="btn" type="submit">Guardar</button>
          </form>
        </details>
      ) : null}
      <a class="ver-mas" href={`/viajes?unidad=${unidad.id}`}>Viajes de este camión →</a>
      {editaFlota ? <a class="ver-mas" href={RUTA.catalogoPartes}>Vida útil por defecto de cada parte (Ajustes) →</a> : null}
    </div>
  );

  return pagina(c, d, { titulo: `Camión ${unidad.codigo}`, seccion: "trailer", scripts: ["/static/trailer3d.js"], importmap: true }, (
    <>
      <Datos id="datos-visor" valor={datosVisor} />
      <Cabecera titulo="Mis camiones" sub={`${unidad.placa}${unidad.carreta ? ` + ${unidad.carreta.placa}` : ""} · ${[unidad.marca, unidad.modelo].filter(Boolean).join(" ") || "—"}`} />
      <nav class="segmentos" aria-label="Elige el camión">
        {unidades.map((x) => <a href={`/camiones/${x.id}`} class={x.id === unidad.id ? "activo" : undefined} aria-current={x.id === unidad.id ? "page" : undefined}>{x.placa}</a>)}
        {editaFlota ? <a href="/camiones/nuevo" class="nuevo">+ Nuevo</a> : null}
      </nav>
      <div class="camion-cols">
        <div class="col">
          <Visor unidad={unidad} piezas={PIEZAS.length} sel={parteSel} />
          {repuestoVer ? <div class="aviso info">Se marcan en el 3D las piezas donde va <b>{repuestoVer.codigo} · {repuestoVer.nombre}</b> · <a href={`${aqui}?tab=repuestos`}>volver a Repuestos</a></div> : null}
          <section class="panel" id="panel-pieza">
            <label class="campo"><span class="sr-only">Pieza del 3D</span>
              <select id="sel-pieza" aria-label="Pieza: tócala en el 3D o elígela aquí">
                <option value="">Elige una pieza del 3D</option>
                {(Object.keys(GRUPOS_PIEZA) as GrupoPieza[]).map((g) => (
                  <optgroup label={GRUPOS_PIEZA[g]}>{PIEZAS.filter((p) => p.grupo === g).map((p) => <option value={p.id} selected={p.id === piezaSel?.id}>{p.nombre}{conHistorial.has(p.id) ? " •" : ""}</option>)}</optgroup>
                ))}
              </select>
            </label>
            <div id="pieza-detalle" class="filas" hidden={!piezaSel}>
              <div><b id="pieza-nombre" class="mono-t">{piezaSel?.nombre ?? ""}</b><br /><span id="pieza-zona" class="muted"></span></div>
              <div id="pieza-partes" class="filas"></div>
              <div id="pieza-repuestos" class="filas"></div>
              <span class="lbl">Historial de esta pieza</span>
              <div id="pieza-historial" class="filas"></div>
              {editaTaller ? (
                <form method="get" action="/anotar" class="filas" data-panel-form="">
                  <input type="hidden" name="tipo" value="repare" />
                  <input type="hidden" name="vehiculoId" value={unidad.id} />
                  <input type="hidden" name="pieza" id="pieza-id" value={piezaSel?.id ?? ""} />
                  <input type="hidden" name="volver" value={aqui} />
                  <button class="btn primario grande" type="submit">Registrar un cambio</button>
                </form>
              ) : null}
            </div>
          </section>
        </div>
        <div class="col">
          <nav class="pestanas" aria-label="Secciones del camión">
            {(Object.keys(TABS) as Tab[]).map((t) => <a href={`${aqui}?tab=${t}`} class={t === tab ? "activo" : undefined} aria-current={t === tab ? "page" : undefined}>{TABS[t]}</a>)}
          </nav>
          {tab === "toca" ? tabToca : tab === "historial" ? tabHistorial : tab === "repuestos" ? tabRepuestos : tabDatos}
        </div>
      </div>
    </>
  ));
}

async function nuevo(c: C, d: Deps) {
  if (!puedeEditar(c.get("usuario").rol, "flota")) {
    // Sin redirigir a /camiones: sin camiones eso volvería aquí en un bucle.
    return pagina(c, d, { titulo: "Camiones", seccion: "trailer" }, (
      <>
        <Cabecera titulo="Mis camiones" />
        <div class="lista-filas"><Vacio>Solo el dueño agrega camiones. {(await listarUnidades(d.ctx)).length ? <a href="/camiones">Ver los camiones</a> : "Todavía no hay ninguno."}</Vacio></div>
      </>
    ));
  }
  return pagina(c, d, { titulo: "Nuevo camión", seccion: "trailer" }, (
    <>
      <Cabecera titulo="Nuevo camión" volver="/camiones" />
      <form method="post" action="/flota" class="panel filas">
        <label class="campo"><span>Placa del tracto *</span><input name="placa" required placeholder="ABC-123" /></label>
        <label class="campo"><span>Placa de la carreta</span><input name="placaCarreta" placeholder="XYZ-987" /></label>
        <label class="campo"><span>Semirremolque</span><select name="semirremolque">{(Object.keys(TIPOS_SEMIRREMOLQUE) as TipoSemirremolque[]).map((t) => <option value={t}>{TIPOS_SEMIRREMOLQUE[t]}</option>)}</select></label>
        <label class="campo"><span>Odómetro actual (km)</span><input name="odometro" inputmode="numeric" placeholder="0" /></label>
        <details class="plegable"><summary class="ver-mas">Más datos</summary>
          <div class="form-grid">
            <label class="campo"><span>Marca</span><input name="marca" placeholder="Volvo" /></label>
            <label class="campo"><span>Modelo</span><input name="modelo" placeholder="FH 540" /></label>
            <label class="campo"><span>Año</span><input name="anio" inputmode="numeric" /></label>
            <label class="campo"><span>Viajes ya hechos</span><input name="viajesBase" inputmode="numeric" placeholder="0" /></label>
          </div>
        </details>
        <label class="opcion-fila"><input type="checkbox" name="catalogo" value="1" checked /><span>Controlar todas las partes del catálogo desde hoy</span></label>
        <button class="btn primario guardar" type="submit">Agregar camión</button>
      </form>
    </>
  ));
}

export function rutasCamiones(app: App, d: Deps): void {
  app.get("/camiones", async (c) => {
    const [primera] = await listarUnidades(d.ctx);
    if (!primera) return c.redirect(conParametros("/camiones/nuevo", c.req.query(), ["ok", "error"]), 302);
    return c.redirect(conParametros(`/camiones/${primera.id}`, c.req.query(), ["tab", "pieza", "parte", "repuesto", "q", "ok", "error"]), 302);
  });
  app.get("/camiones/nuevo", (c) => nuevo(c as C, d));
  app.get("/camiones/:id{[0-9]+}", (c) => vista(c as C, d));
}
