/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import type { Child, FC, PropsWithChildren } from "hono/jsx";
import {
  asiQueda, camionDeMensaje, capturarContexto, categoriasMasUsadas, ErrorNegocio, fechaHoraLima, GRUPOS_PIEZA, hoy, listarCategorias, listarCobrosPendientes, listarCostosFijos, listarPrestamos,
  documentoPorConfirmar, listarRepuestos, liquidacionViaje, listarUnidades, listarViajesFlota, MEDIOS_ENTREGA, NOMBRE_MEDIO_PAGO, nombreCategoria, partesDePieza, partesDeUnidad,
  parsearMonto, pieza, piezasDeSemirremolque, puedeEditar, textoYaSeCarga, TIPOS_REPARACION, ultimaUnidadDeUsuario, viajesEnRuta,
  type AsiQueda, type FilaCobro, type GrupoPieza, type TipoReparacion, type UsuarioWeb, type ViajeEnRuta,
} from "@sunatapp/core";
import { accion, formularioMultiparte, pagina, volverA, type App, type C, type Deps } from "../base";
import {
  guardarCambio, guardarCobro, guardarCompra, guardarEntrega, guardarGasto, guardarGastoEmpresa, guardarIngreso, guardarPrestamo, guardarReinversion,
  CATEGORIA_CUOTA, pagarCuotaDe, type Campos,
} from "../acciones";
import { TIPOS_ANOTAR, tiposAnotar, type TipoAnotar } from "../lugares";
import { ESTADO_LECTURA, valoresLectura } from "./revisar";
import { Cabecera, diasEntre, fechaCorta, nDias, Icono, miles, soles, soles2, Vacio, type NombreIcono } from "../ui";

/** `documento`: un mensaje de Telegram por confirmar (ver `parteDocumento`). `monto`, `categoria` y `medio` solo vuelven en la URL cuando no se pudo guardar (así no se pierde lo escrito). */
const CLAVES_Q = ["tipo", "modo", "volver", "viajeId", "vehiculoId", "facturaId", "prestamoId", "pieza", "parteId", "repuestoId", "monto", "categoria", "medio", "documento"] as const;
type ClaveQ = (typeof CLAVES_Q)[number];
/** Lo que llega en la URL de /anotar (todo texto; "" = no vino). */
export type Q = Record<ClaveQ, string> & { parcial: boolean };

const num = (v: string | undefined): number | null => (v && /^\d+$/.test(v) ? Number(v) : null);

function leerQ(c: C, permitidos: TipoAnotar[]): Q {
  const q = Object.fromEntries(CLAVES_Q.map((k) => [k, (c.req.query(k) ?? "").trim()])) as Record<ClaveQ, string>;
  const tipo = permitidos.includes(q.tipo as TipoAnotar) ? q.tipo : permitidos[0]!;
  return { ...q, tipo, volver: volverA(q.volver, "/"), parcial: c.req.query("parcial") === "1" };
}

/** Enlace a Anotar con estos datos (los vacíos no se ponen). */
export function urlAnotar(q: Partial<Record<ClaveQ, string | number | null>>): string {
  const p = new URLSearchParams();
  for (const k of CLAVES_Q) {
    const v = q[k];
    if (v !== null && v !== undefined && v !== "") p.set(k, String(v));
  }
  return `/anotar?${p.toString()}`;
}
const otroTipo = (q: Q, tipo: TipoAnotar) => urlAnotar({ tipo, volver: q.volver, viajeId: q.viajeId, vehiculoId: q.vehiculoId, documento: q.documento });

/** Lo que cada tipo pone en el formulario. */
export interface PartesForm {
  campos: Child;
  /** Bloque azul «Se pone solo» con su «cambiar» plegado. */
  solo?: { texto: string; cambiar?: Child; abierto?: boolean };
  /** Sub-opciones del tipo (por ejemplo «Una factura» / «Otro ingreso»). */
  modos?: Array<{ modo: string; etiqueta: string }>;
  /** En vez del formulario, solo este mensaje (por ejemplo: nadie te debe). */
  soloMensaje?: Child;
  accion?: string;
  tipoOculto?: string;
  arriba?: Child;
  abajo?: Child;
  boton?: string;
}

// ── Piezas del formulario ────────────────────────────────────────────────────

const CampoMonto: FC<{ valor?: string; etiqueta?: string }> = (p) => (
  <label class="campo campo-monto">
    <span>{p.etiqueta ?? "¿Cuánto?"}</span>
    <span class="monto-caja"><span aria-hidden="true">S/</span><input name="monto" inputmode="decimal" required autocomplete="off" placeholder="0.00" value={p.valor ?? ""} /></span>
  </label>
);

/** Mismo aspecto que CampoMonto con otro nombre de campo (Reparé manda `manoObra`, la compra `costo`). */
const CampoPlata: FC<{ nombre: string; etiqueta: string; requerido?: boolean }> = (p) => (
  <label class="campo campo-monto"><span>{p.etiqueta}</span>
    <span class="monto-caja"><span aria-hidden="true">S/</span><input name={p.nombre} inputmode="decimal" required={p.requerido} autocomplete="off" placeholder="0.00" /></span>
  </label>
);

const OpcionIcono: FC<{ nombre: string; valor: string; icono: NombreIcono; texto: string; marcado?: boolean }> = (p) => (
  <label class="opcion"><input type="radio" name={p.nombre} value={p.valor} checked={p.marcado} required /><Icono n={p.icono} t={22} /><span>{p.texto}</span></label>
);

const OpcionTexto: FC<{ nombre: string; valor: string; texto: string; marcado?: boolean }> = (p) => (
  <label class="opcion"><input type="radio" name={p.nombre} value={p.valor} checked={p.marcado} /><span>{p.texto}</span></label>
);

const FotoOpcional: FC = () => (
  <label class="foto-opcional"><Icono n="camara" t={20} /><span>Foto del voucher (opcional)</span><input type="file" name="foto" accept="image/*,application/pdf" /></label>
);

const SePoneSolo: FC<PropsWithChildren<{ texto: string; abierto?: boolean }>> = (p) => (
  <div class="se-pone-solo">
    <b class="lbl">Se pone solo</b>
    <span>{p.texto}</span>
    {p.children ? <details open={p.abierto}><summary>cambiar</summary><div class="filas">{p.children}</div></details> : null}
  </div>
);

const SelectUnidad: FC<{ unidades: Array<{ id: number; codigo: string; placa: string }>; elegido: number | null; vacio?: string }> = (p) => (
  <label class="campo"><span>Camión</span>
    <select name="vehiculoId">{p.vacio ? <option value="">{p.vacio}</option> : null}{p.unidades.map((u) => <option value={u.id} selected={u.id === p.elegido}>{u.codigo} · {u.placa}</option>)}</select>
  </label>
);

type OpcionViaje = { id: number; texto: string };
const SelectViaje: FC<{ opciones: OpcionViaje[]; elegido: number | null; requerido?: boolean }> = (p) => (
  <label class="campo"><span>Viaje</span>
    <select name="viajeId" required={p.requerido}>
      {p.requerido ? null : <option value="">— sin viaje —</option>}
      {p.opciones.map((o) => <option value={o.id} selected={o.id === p.elegido}>{o.texto}</option>)}
    </select>
  </label>
);

/** «Si hay varios, se elige con un toque.» */
const ViajesRadios: FC<{ viajes: ViajeEnRuta[] }> = (p) => (
  <fieldset class="grupo"><legend class="lbl">¿De qué viaje?</legend>
    <div class="opciones-lista">
      {p.viajes.map((v, i) => (
        <label class="opcion-fila"><input type="radio" name="viajeId" value={v.viajeId} checked={i === 0} required /><span><b>{v.unidad}</b> · {v.ruta} <span class="muted">· {v.chofer}</span></span></label>
      ))}
    </div>
  </fieldset>
);

const CampoFecha: FC<{ d: Deps }> = (p) => <label class="campo"><span>Fecha</span><input type="date" name="fecha" value={hoy(p.d.ctx)} /></label>;
const ahora = (d: Deps) => fechaHoraLima(d.ctx.reloj()).hora.slice(0, 5);
const iconoCategoria = (k: string): NombreIcono => (({ combustible: "combustible", peaje: "peaje", viaticos: "comida" }) as Record<string, NombreIcono>)[k] ?? "otro";

function opcionesDeViaje(enRuta: ViajeEnRuta[], actual: { viajeId: number | null; viajeCodigo: string | null }): OpcionViaje[] {
  const r = enRuta.map((v) => ({ id: v.viajeId, texto: `${v.codigo} · ${v.unidad} · ${v.ruta}` }));
  if (actual.viajeId !== null && !r.some((o) => o.id === actual.viajeId)) r.unshift({ id: actual.viajeId, texto: actual.viajeCodigo ?? `Viaje ${actual.viajeId}` });
  return r;
}

/** Junta las partes de un texto con « · », sin las vacías. */
const unir = (partes: Array<string | null | undefined | false>) => partes.filter(Boolean).join(" · ");
const km = (n: number | null) => (n !== null ? `km ${n.toLocaleString("en-US")}` : null);

/** Camión, ruta y chofer de un viaje en palabras simples (el en ruta si está, si no su liquidación). */
async function datosViaje(d: Deps, enRuta: ViajeEnRuta[], viajeId: number): Promise<{ unidad: string | null; ruta: string | null; chofer: string | null }> {
  const v = enRuta.find((x) => x.viajeId === viajeId);
  if (v) return { unidad: v.unidad, ruta: v.ruta, chofer: v.chofer };
  const l = await liquidacionViaje(d.ctx, viajeId).catch(() => null);
  return { unidad: l?.viaje.unidad ?? null, ruta: l?.viaje.ruta ?? null, chofer: null };
}

// ── «Así queda después de guardar» ───────────────────────────────────────────

/** «a Juan» / «al chofer» (sin nombre, primerNombre da «el chofer»). */
const aQuien = (nombre: string) => (nombre === "el chofer" ? "al chofer" : `a ${nombre}`);
const AQuien = (nombre: string) => (nombre === "el chofer" ? "Al chofer" : `A ${nombre}`);

/** «El viaje deja S/ 2,510 (antes S/ 2,860)»; si queda en negativo, «pierde». */
function textoViaje(v: NonNullable<AsiQueda["viaje"]>): string {
  if (v.dejaDespues >= 0) return `El viaje deja ${soles(v.dejaDespues)} (antes ${soles(v.dejaAntes)})`;
  const antes = v.dejaAntes >= 0 ? `antes dejaba ${soles(v.dejaAntes)}` : `antes perdía ${soles(-v.dejaAntes)}`;
  return `El viaje pierde ${soles(-v.dejaDespues)} (${antes})`;
}

/** «Así queda después de guardar» (solo en la PC: en el celular satura). Solo cuentas que ya se pueden calcular. */
export const AsiQuedaBloque: FC<{ r: AsiQueda | null; sinViaje?: boolean }> = ({ r, sinViaje }) => (
  <div class="asi-queda solo-pc" id="asi-queda" aria-live="polite">
    <b class="lbl">Así queda después de guardar</b>
    {!r ? (
      <span>{sinViaje ? "Sin viaje: no cambia las cuentas de ningún viaje." : "Escribe el monto y verás cómo quedan las cuentas del viaje."}</span>
    ) : (
      <ul>
        {r.chofer ? (
          <li>{r.chofer.quedaDespues >= 0
            ? `${AQuien(r.chofer.nombre)} le quedan ${soles(r.chofer.quedaDespues)} de ${soles(r.chofer.entregado)}`
            : `Le debes ${soles(-r.chofer.quedaDespues)} ${aQuien(r.chofer.nombre)}`}</li>
        ) : null}
        {r.viaje ? <li class={r.viaje.dejaDespues < 0 ? "t-cambiar" : undefined}>{textoViaje(r.viaje)}</li> : null}
        {r.categoria ? (
          <li class={r.categoria.presupuesto > 0 && r.categoria.realDespues > r.categoria.presupuesto ? "t-cambiar" : undefined}>
            {r.categoria.nombre} del viaje: {soles(r.categoria.realDespues)}{r.categoria.presupuesto > 0 ? ` · presupuesto ${soles(r.categoria.presupuesto)}` : " · sin presupuesto"}
          </li>
        ) : null}
      </ul>
    )}
  </div>
);

/** null si falta el monto o el viaje (o el viaje no existe). */
async function calcularAsiQueda(d: Deps, tipo: string, monto: string, viajeId: string, categoria: string, medioPago = ""): Promise<AsiQueda | null> {
  const m = parsearMonto(monto);
  const v = num(viajeId);
  if (!m || v === null || (tipo !== "gaste" && tipo !== "chofer")) return null;
  return asiQueda(d.ctx, { tipo: tipo === "gaste" ? "gasto" : "entrega", monto: m, viajeId: v, categoria: categoria || null, medioPago: medioPago || null }).catch(() => null);
}

// ── Cada tipo ────────────────────────────────────────────────────────────────

async function parteGaste(c: C, d: Deps, q: Q): Promise<PartesForm> {
  const ctx = d.ctx;
  const [categorias, masUsadas, unidades, enRuta] = await Promise.all([
    listarCategorias(ctx, { tipo: "variable", soloActivas: true }), categoriasMasUsadas(ctx, 3), listarUnidades(ctx), viajesEnRuta(ctx),
  ]);
  const botones = [...new Set([...masUsadas, "combustible", "peaje", "viaticos"])].filter((k) => categorias.some((x) => x.clave === k)).slice(0, 3);
  const viajeId = num(q.viajeId) ?? (enRuta.length === 1 ? enRuta[0]!.viajeId : null);
  const elegirViaje = viajeId === null && enRuta.length > 1;
  const vehiculoId = num(q.vehiculoId) ?? (await ultimaUnidadDeUsuario(ctx, c.get("usuario").id)) ?? unidades[0]?.id ?? null;
  const g = await capturarContexto(ctx, { viajeId, vehiculoId, sinViaje: elegirViaje });
  const ruta = g.viajeId !== null ? (await datosViaje(d, enRuta, g.viajeId)).ruta : null;
  const texto = elegirViaje
    ? unir(["Camión y viaje: los del viaje que elijas", `hoy ${ahora(d)}`])
    : g.viajeId !== null
      ? unir([g.unidad && `Camión ${g.unidad}`, ruta ? `viaje ${ruta}` : "con viaje", `hoy ${ahora(d)}`, km(g.km)])
      : unir([g.unidad ? `Camión ${g.unidad}` : "De la empresa", "sin viaje", `hoy ${ahora(d)}`]);
  // Si vuelve con lo escrito (no se pudo guardar), «Así queda» ya sale calculado.
  const viajeInicial = elegirViaje ? enRuta[0]!.viajeId : g.viajeId;
  const inicial = await calcularAsiQueda(d, "gaste", q.monto, String(viajeInicial ?? ""), q.categoria || botones[0] || "");
  return {
    campos: (
      <>
        <CampoMonto valor={q.monto} />
        <fieldset class="grupo">
          <legend class="lbl">¿En qué?</legend>
          <div class="opciones-icono">
            {botones.map((k, i) => <OpcionIcono nombre="categoria" valor={k} icono={iconoCategoria(k)} texto={nombreCategoria(k, categorias)} marcado={q.categoria ? k === q.categoria : i === 0} />)}
            <OpcionIcono nombre="categoria" valor="otro" icono="otro" texto="Otro" marcado={!!q.categoria && !botones.includes(q.categoria)} />
          </div>
          <label class="campo otro-cual"><span>¿Cuál?</span><select name="categoriaOtra">{categorias.map((k) => <option value={k.clave} selected={k.clave === q.categoria}>{k.nombre}</option>)}</select></label>
        </fieldset>
        {elegirViaje ? <ViajesRadios viajes={enRuta} /> : null}
        <FotoOpcional />
      </>
    ),
    solo: {
      texto,
      cambiar: (
        <>
          <SelectUnidad unidades={unidades} elegido={g.vehiculoId} vacio="— de la empresa —" />
          {elegirViaje ? null : <SelectViaje opciones={opcionesDeViaje(enRuta, g)} elegido={g.viajeId} />}
          <CampoFecha d={d} />
          <label class="campo"><span>Km del tablero</span><input name="km" inputmode="numeric" placeholder={g.km !== null ? String(g.km) : ""} /></label>
          <label class="campo"><span>¿Cómo se pagó?</span>
            <select name="medioPago"><option value="">Automático ({NOMBRE_MEDIO_PAGO[g.medioPago]})</option>{Object.entries(NOMBRE_MEDIO_PAGO).map(([k, n]) => <option value={k}>{n}</option>)}</select>
          </label>
          <label class="campo"><span>Detalle</span><input name="nota" maxlength={200} /></label>
        </>
      ),
    },
    abajo: <AsiQuedaBloque r={inicial} sinViaje={viajeInicial === null && !!q.monto} />,
  };
}

async function parteChofer(_c: C, d: Deps, q: Q): Promise<PartesForm> {
  const ctx = d.ctx;
  const enRuta = await viajesEnRuta(ctx);
  const viajeId = num(q.viajeId) ?? (enRuta.length === 1 ? enRuta[0]!.viajeId : null);
  const recientes = viajeId === null && enRuta.length === 0 ? await listarViajesFlota(ctx, { limite: 10 }) : [];
  const g = viajeId !== null ? await capturarContexto(ctx, { viajeId }) : null;
  const elegido = viajeId !== null ? await datosViaje(d, enRuta, viajeId) : null;
  const viajeInicial = viajeId ?? (enRuta.length > 1 ? enRuta[0]!.viajeId : null);
  const inicial = await calcularAsiQueda(d, "chofer", q.monto, String(viajeInicial ?? ""), "");
  return {
    campos: (
      <>
        <CampoMonto valor={q.monto} />
        <fieldset class="grupo"><legend class="lbl">¿Cómo se la diste?</legend>
          <div class="opciones-texto">{Object.entries(MEDIOS_ENTREGA).map(([k, n], i) => <OpcionTexto nombre="medio" valor={k} texto={n} marcado={i === 0} />)}</div>
        </fieldset>
        {viajeId === null && enRuta.length > 1 ? <ViajesRadios viajes={enRuta} /> : null}
        {viajeId === null && enRuta.length === 0 ? (
          recientes.length
            ? <SelectViaje requerido opciones={recientes.map((v) => ({ id: v.id, texto: `${v.codigo} · ${v.unidad} · ${v.ruta}` }))} elegido={null} />
            : <Vacio>Todavía no hay viajes. Crea uno en Viajes.</Vacio>
        ) : null}
      </>
    ),
    solo: g ? {
      texto: unir([elegido?.unidad && `Camión ${elegido.unidad}`, elegido?.ruta ? `viaje ${elegido.ruta}` : g.viajeCodigo, elegido?.chofer, `hoy ${ahora(d)}`]),
      cambiar: (
        <>
          <SelectViaje requerido opciones={opcionesDeViaje(enRuta, g)} elegido={viajeId} />
          <CampoFecha d={d} />
          <label class="campo"><span>Nota</span><input name="nota" placeholder="Adelanto de salida" /></label>
        </>
      ),
    } : undefined,
    abajo: <AsiQuedaBloque r={inicial} />,
  };
}

const ListaFacturas: FC<{ q: Q; filas: FilaCobro[]; selId: number | null; hoy: string }> = ({ q, filas, selId, hoy: h }) => (
  <fieldset class="grupo"><legend class="lbl">¿Quién te pagó?</legend>
    <div class="lista-filas">
      {filas.map((f) => (
        <a class={`fila-aviso${f.facturaId === selId ? " sel" : ""}`} href={urlAnotar({ ...q, facturaId: f.facturaId, monto: "" })} data-panel-link="" aria-current={f.facturaId === selId ? "true" : undefined}>
          <span class="punto" style={`background:var(${f.estado === "vencida" ? "--accent" : "--amber-bar"})`}></span>
          <span class="txt"><b>{f.cliente}</b> · {f.serieNumero}<br /><span class="muted">{f.estado === "vencida" ? `vencida hace ${nDias(diasEntre(f.fechaVencimiento, h))}` : `vence ${fechaCorta(f.fechaVencimiento)}`}</span></span>
          <b>{soles2(f.saldo)}</b>
        </a>
      ))}
    </div>
  </fieldset>
);

async function parteCobro(c: C, d: Deps, q: Q): Promise<PartesForm> {
  const modos = puedeEditar(c.get("usuario").rol, "finanzas") ? [{ modo: "", etiqueta: "Una factura" }, { modo: "otro", etiqueta: "Otro ingreso" }] : undefined;
  if (q.modo === "otro") {
    const unidades = await listarUnidades(d.ctx);
    return {
      modos,
      campos: (
        <>
          <CampoMonto valor={q.monto} />
          <label class="campo"><span>¿De qué?</span><input name="concepto" required placeholder="Alquiler de la carreta, venta de chatarra…" /></label>
        </>
      ),
      solo: { texto: `Entra hoy ${ahora(d)} · a la empresa`, cambiar: <><SelectUnidad unidades={unidades} elegido={null} vacio="— de la empresa —" /><CampoFecha d={d} /></> },
    };
  }
  const { filas } = await listarCobrosPendientes(d.ctx);
  const ordenadas = [...filas].sort((a, b) => a.fechaVencimiento.localeCompare(b.fechaVencimiento));
  const pedida = num(q.facturaId);
  const sel = pedida !== null ? ordenadas.find((f) => f.facturaId === pedida) : ordenadas[0];
  const h = hoy(d.ctx);
  // La factura pedida ya no se debe: no se elige otra sola, se avisa y se deja escoger.
  const yaPagada = pedida !== null && !sel ? <div class="aviso info" role="status">Esa factura ya está pagada.{ordenadas.length ? " Elige la que te pagaron:" : ""}</div> : null;
  if (!ordenadas.length) return { modos, campos: null, soloMensaje: <>{yaPagada}<div class="lista-filas"><Vacio>Nadie te debe facturas.</Vacio></div></> };
  if (!sel) return { modos, campos: null, soloMensaje: <>{yaPagada}<ListaFacturas q={q} filas={ordenadas} selId={null} hoy={h} /></> };
  return {
    modos,
    campos: (
      <>
        <ListaFacturas q={q} filas={ordenadas} selId={sel.facturaId} hoy={h} />
        <input type="hidden" name="facturaId" value={sel.facturaId} />
        <CampoMonto valor={q.monto || (sel.saldo / 100).toFixed(2)} etiqueta="¿Cuánto te pagaron?" />
        <fieldset class="grupo"><legend class="lbl">¿Cómo?</legend>
          <div class="opciones-texto">{[["transferencia", "Transferencia"], ["efectivo", "Efectivo"], ["otro", "Otro"]].map(([k, n], i) => <OpcionTexto nombre="medio" valor={k!} texto={n!} marcado={i === 0} />)}</div>
        </fieldset>
      </>
    ),
    solo: { texto: `Hoy ${ahora(d)} · se descuenta de lo que te deben` },
  };
}

async function parteRepare(c: C, d: Deps, q: Q): Promise<PartesForm> {
  const ctx = d.ctx;
  const rol = c.get("usuario").rol;
  const modos = puedeEditar(rol, "inventario") && puedeEditar(rol, "reparaciones")
    ? [{ modo: "", etiqueta: "Cambio o arreglo" }, { modo: "compra", etiqueta: "Compra para stock" }] : undefined;
  const [unidades, repuestos] = await Promise.all([listarUnidades(ctx), listarRepuestos(ctx)]);
  if (q.modo === "compra") {
    const elegido = num(q.repuestoId);
    return {
      modos,
      campos: (
        <>
          <label class="campo"><span>¿Qué repuesto?</span>
            <select name="repuestoId" required>{repuestos.map((r) => <option value={r.id} selected={r.id === elegido}>{r.codigo} · {r.nombre} (hay {r.stock})</option>)}</select>
          </label>
          <label class="campo"><span>¿Cuántos?</span><input name="cantidad" inputmode="numeric" required value="1" /></label>
          <CampoPlata nombre="costo" etiqueta="¿Cuánto costó cada uno?" requerido />
          <label class="campo"><span>¿Dónde lo compraste? (opcional)</span><input name="proveedor" /></label>
        </>
      ),
      solo: { texto: `Entra al stock hoy ${ahora(d)} · el repuesto nuevo se crea en Camiones › Repuestos`, cambiar: <CampoFecha d={d} /> },
    };
  }
  const pedido = num(q.vehiculoId) ?? (await ultimaUnidadDeUsuario(ctx, c.get("usuario").id));
  const unidad = unidades.find((u) => u.id === pedido) ?? unidades[0];
  if (!unidad) return { modos, campos: null, soloMensaje: <div class="lista-filas"><Vacio>Primero agrega un camión.</Vacio></div> };
  const partes = await partesDeUnidad(ctx, unidad.id);
  const piezas = piezasDeSemirremolque(unidad.semirremolque);
  // Si llegó una pieza (desde el 3D) y el camión tiene una parte instalada ahí, queda elegida; su contador
  // solo se reinicia si se marca «Cambié la pieza por una nueva» (un arreglo no la vuelve nueva).
  const piezaPedida = pieza(q.pieza);
  const parteSel = num(q.parteId) ?? (piezaPedida ? partesDePieza(piezaPedida, partes)[0]?.id ?? null : null);
  const parteReinicia = partes.find((p) => p.id === parteSel);
  // Sin campo «monto»: el costo es la mano de obra más los repuestos que salen del stock.
  return {
    modos,
    campos: (
      <>
        <fieldset class="grupo"><legend class="lbl">¿Qué camión?</legend>
          <div class="segmentos">
            {unidades.map((u) => (
              <a href={urlAnotar({ ...q, vehiculoId: u.id, parteId: "", pieza: "" })} data-panel-link="" class={u.id === unidad.id ? "activo" : undefined} aria-current={u.id === unidad.id ? "true" : undefined}>{u.codigo}</a>
            ))}
          </div>
        </fieldset>
        <input type="hidden" name="vehiculoId" value={unidad.id} />
        <label class="campo"><span>Pieza</span>
          <select name="componente">
            <option value="">— general, sin pieza —</option>
            {(Object.keys(GRUPOS_PIEZA) as GrupoPieza[]).map((g) => (
              <optgroup label={GRUPOS_PIEZA[g]}>{piezas.filter((p) => p.grupo === g).map((p) => <option value={p.id} selected={p.id === q.pieza}>{p.nombre}</option>)}</optgroup>
            ))}
          </select>
        </label>
        <label class="campo"><span>¿Qué se hizo?</span><input name="trabajo" maxlength={200} placeholder="Parchado, cambio…" /></label>
        <CampoPlata nombre="manoObra" etiqueta="Mano de obra (si hubo)" />
        <input type="hidden" name="casillaReinicia" value="1" />
        {partes.length ? (
          <label class="opcion-fila"><input type="checkbox" name="reinicia" value="1" /><span>{parteReinicia
            ? "Cambié la pieza por una nueva (reinicia el contador de la parte elegida)"
            : "Cambié una parte por una nueva (elige cuál en «cambiar»; su contador vuelve a 0)"}</span></label>
        ) : null}
      </>
    ),
    solo: {
      texto: unir([unidad.codigo, `hoy ${ahora(d)}`, `${miles(unidad.odometroKm)} km`]),
      cambiar: (
        <>
          <label class="campo"><span>Si la cambiaste por una nueva, ¿qué parte era?</span>
            <select name="parteId"><option value="">— ninguna —</option>{partes.map((p) => <option value={p.id} selected={p.id === parteSel}>{p.nombre} · {p.pct}% (vuelve a 0)</option>)}</select>
          </label>
          <label class="campo"><span>Repuesto del stock</span>
            <select name="repuestoId"><option value="">— ninguno —</option>{repuestos.filter((r) => r.stock > 0).map((r) => <option value={r.id}>{r.codigo} · {r.nombre} (hay {r.stock})</option>)}</select>
          </label>
          <label class="campo"><span>Cantidad</span><input name="cantidad" inputmode="numeric" value="1" /></label>
          <label class="campo"><span>Tipo</span>
            <select name="tipoReparacion"><option value="" selected>Automático (con pieza: reparación; sin pieza: preventivo)</option>{(Object.keys(TIPOS_REPARACION) as TipoReparacion[]).map((t) => <option value={t}>{TIPOS_REPARACION[t]}</option>)}</select>
          </label>
          <label class="campo"><span>Taller o mecánico</span><input name="taller" /></label>
          <CampoFecha d={d} />
          <label class="campo"><span>Odómetro (km)</span><input name="odometro" inputmode="numeric" placeholder={String(unidad.odometroKm)} /></label>
        </>
      ),
    },
  };
}

async function parteEmpresa(c: C, d: Deps, q: Q): Promise<PartesForm> {
  const [todas, unidades, activos] = await Promise.all([listarCategorias(d.ctx, { tipo: "fijo", soloActivas: true }), listarUnidades(d.ctx), listarCostosFijos(d.ctx)]);
  // Las cuotas se pagan en «Préstamo o cuota» (ahí ya quedan como gasto).
  const fijas = todas.filter((k) => k.clave !== CATEGORIA_CUOTA);
  // Crear un gasto de cada mes es de Ajustes (el contador anota el pago, no crea el fijo).
  const puedeMensual = puedeEditar(c.get("usuario").rol, "ajustes");
  // Lo que ya se carga solo en cada categoría: anotarlo otra vez lo contaría dos veces.
  const yaSeCarga = new Map<string, string>();
  for (const f of activos) if (!yaSeCarga.has(f.categoria)) yaSeCarga.set(f.categoria, textoYaSeCarga(f));
  const avisoElegida = yaSeCarga.get(q.categoria) ?? null;
  return {
    campos: (
      <>
        <CampoMonto valor={q.monto} />
        <label class="campo"><span>¿En qué?</span>
          <select name="categoria" required data-con-fijos=""><option value="">Elige…</option>{fijas.map((k) => <option value={k.clave} selected={k.clave === q.categoria} data-fijo={yaSeCarga.get(k.clave)}>{k.nombre}</option>)}</select>
        </label>
        <div class="ya-fijo" data-ya-fijo="" hidden={!avisoElegida}>
          <div class="aviso info" role="status">{avisoElegida ?? ""}</div>
          <label class="opcion-fila"><input type="checkbox" name="igualAparte" value="1" /><span>Igual es un pago aparte<br /><span class="muted">Un pago extra, no el de cada mes</span></span></label>
        </div>
        {puedeMensual && !avisoElegida ? (
          <label class="opcion-fila" data-mensual=""><input type="checkbox" name="mensual" value="1" /><span>Se repite cada mes<br /><span class="muted">Sueldo, alquiler, GPS: se carga solo</span></span></label>
        ) : null}
        <FotoOpcional />
      </>
    ),
    solo: {
      texto: `Hoy ${ahora(d)} · de la empresa, sin camión ni viaje`,
      cambiar: (
        <>
          <SelectUnidad unidades={unidades} elegido={null} vacio="— de la empresa —" />
          <CampoFecha d={d} />
          {puedeMensual ? <label class="campo"><span>Nombre (si se repite cada mes)</span><input name="concepto" placeholder="Sueldo de Mario" /></label> : null}
          <label class="campo"><span>¿Cómo se pagó?</span><select name="medioPago"><option value="">Automático</option>{Object.entries(NOMBRE_MEDIO_PAGO).map(([k, n]) => <option value={k}>{n}</option>)}</select></label>
          <label class="campo"><span>Detalle</span><input name="nota" maxlength={200} /></label>
        </>
      ),
    },
  };
}

async function parteAnotarPrestamo(_c: C, d: Deps, q: Q): Promise<PartesForm> {
  const modos = [{ modo: "", etiqueta: "Pagar cuota" }, { modo: "nuevo", etiqueta: "Préstamo nuevo" }, { modo: "reinversion", etiqueta: "Reinversión" }];
  const unidades = await listarUnidades(d.ctx);
  if (q.modo === "nuevo") {
    return {
      modos,
      campos: (
        <>
          <label class="campo"><span>¿Quién te prestó?</span><input name="entidad" required placeholder="Banco, caja, financiera" /></label>
          <CampoMonto etiqueta="¿Cuánto te prestaron?" />
          <label class="campo"><span>¿Qué interés al año? (%)</span><input name="tasa" inputmode="decimal" required /></label>
          <label class="campo"><span>¿En cuántas cuotas?</span><input name="cuotas" inputmode="numeric" required /></label>
        </>
      ),
      solo: { texto: `Desembolso hoy · de la empresa`, cambiar: <><label class="campo"><span>Desembolso</span><input type="date" name="fecha" value={hoy(d.ctx)} /></label><SelectUnidad unidades={unidades} elegido={null} vacio="— de la empresa —" /></> },
    };
  }
  if (q.modo === "reinversion") {
    return {
      modos,
      campos: (
        <>
          <label class="campo"><span>¿En qué invertiste?</span><input name="concepto" required placeholder="Carreta nueva, GPS, motor…" /></label>
          <CampoMonto />
        </>
      ),
      solo: { texto: `Hoy ${ahora(d)} · de la empresa`, cambiar: <><SelectUnidad unidades={unidades} elegido={null} vacio="— de la empresa —" /><CampoFecha d={d} /></> },
    };
  }
  // La que vence (o venció) primero, arriba y elegida.
  const conCuota = (await listarPrestamos(d.ctx)).filter((p) => p.proxima).sort((a, b) => a.proxima!.vencimiento.localeCompare(b.proxima!.vencimiento));
  if (!conCuota.length) return { modos, campos: null, soloMensaje: <div class="lista-filas"><Vacio>No tienes cuotas pendientes. 👌</Vacio></div> };
  const sel = conCuota.find((p) => p.id === num(q.prestamoId)) ?? conCuota[0]!;
  const h = hoy(d.ctx);
  return {
    modos,
    campos: (
      <>
        <fieldset class="grupo"><legend class="lbl">¿Qué cuota pagaste?</legend>
          <div class="lista-filas">
            {conCuota.map((p) => (
              <a class={`fila-aviso${p.id === sel.id ? " sel" : ""}`} href={urlAnotar({ ...q, prestamoId: p.id })} data-panel-link="" aria-current={p.id === sel.id ? "true" : undefined}>
                <span class="punto" style={`background:var(${p.proxima!.vencimiento < h ? "--accent" : "--amber-bar"})`}></span>
                <span class="txt"><b>{p.entidad}</b> · cuota {p.pagadas + 1} de {p.total}<br />{p.proxima!.vencimiento < h
                  ? <span class="vencida">vencida hace {nDias(diasEntre(p.proxima!.vencimiento, h))}</span>
                  : <span class="muted">vence {fechaCorta(p.proxima!.vencimiento)}</span>}</span>
                <b>{soles2(p.proxima!.monto)}</b>
              </a>
            ))}
          </div>
        </fieldset>
        <input type="hidden" name="prestamoId" value={sel.id} />
      </>
    ),
    solo: { texto: `Se paga hoy la cuota de ${soles2(sel.proxima!.monto)} de ${sel.entidad}` },
    boton: "PAGAR CUOTA",
  };
}

/** Lo que mandó el chofer por Telegram y no se pudo guardar solo: mismo formulario, precargado. */
async function parteDocumento(d: Deps, q: Q, pedido: string | undefined): Promise<PartesForm | null> {
  const ctx = d.ctx;
  const id = num(q.documento);
  // Por su número (no por la lista): un intento fallido o un mensaje recién llegado no se esconde.
  const item = id === null ? null : await documentoPorConfirmar(ctx, id);
  if (!item) return null;
  const v = valoresLectura(item.lectura);
  // Sin «tipo» en la URL manda lo que leyó la IA; con «tipo» manda el botón que tocó el usuario.
  const tipo = pedido === "chofer" || pedido === "gaste" ? pedido : v.tipo === "entrega" ? "chofer" : "gaste";
  const [categorias, unidades, enRuta] = await Promise.all([listarCategorias(ctx, { soloActivas: true }), listarUnidades(ctx), viajesEnRuta(ctx)]);
  // El camión: el que se eligió (si volvió por un error); si no, la placa escrita, el viaje de quien lo mandó o su último camión.
  const pedidoCamion = num(q.vehiculoId) ?? (await camionDeMensaje(ctx, item))?.vehiculoId ?? null;
  const unidad = unidades.find((u) => u.id === pedidoCamion) ?? null;
  const viajeDe = (vehiculoId: number) => enRuta.find((x) => x.vehiculoId === vehiculoId) ?? null;
  const vj = unidad ? viajeDe(unidad.id) : null;
  const dia = `hoy ${fechaCorta(hoy(ctx)).toLowerCase()}`;
  const texto = !unidad
    ? "¿De qué camión es? Elígelo abajo"
    : vj
      ? unir([`Camión ${unidad.codigo} (${unidad.placa})`, `viaje ${vj.ruta}`, tipo === "chofer" ? vj.chofer : null, dia])
      : tipo === "chofer"
        ? `${unidad.codigo} no tiene viaje en curso: elige otro camión o crea el viaje`
        : unir([`Camión ${unidad.codigo}`, "sin viaje (no tiene uno en curso)", dia]);
  // Monto y categoría: lo escrito (si volvió por un error) manda sobre lo que leyó la IA.
  const monto = q.monto || v.monto;
  const categoria = q.categoria || v.categoria;
  const medio = q.medio || v.medio;
  const l = item.lectura;
  const leido = l?.tipo === "gasto"
    ? unir([`S/ ${l.monto.toFixed(2)}`, nombreCategoria(l.categoria, categorias), l.proveedorNombre, l.proveedorRuc && `RUC ${l.proveedorRuc}`, l.comprobante, l.kmOdometro !== null && km(l.kmOdometro)])
    : l?.tipo === "entrega" ? unir([`S/ ${l.monto.toFixed(2)}`, `plata al chofer (${MEDIOS_ENTREGA[l.medio] ?? l.medio})`]) : null;
  const arriba = (
    <section class="panel llego-telegram">
      <div class="fila-sep"><b>Llegó por Telegram · {fechaCorta(item.desde.toISOString().slice(0, 10))}</b><span class={`chip ${item.estado === "error" ? "cambiar" : "proximo"}`}>{ESTADO_LECTURA[item.estado] ?? item.estado}</span></div>
      {item.texto ? <span>«{item.texto}»</span> : null}
      {leido ? <span><span class="muted">Se leyó:</span> {leido}</span> : null}
      {item.error ? <span class="muted">{item.error}</span> : null}
      {item.rutaArchivo && item.tipo === "foto" ? (
        <a href={`/archivo/documento/${item.documentoId}`} target="_blank" class="foto-telegram">
          <img src={`/archivo/documento/${item.documentoId}`} alt="Foto que mandó el chofer" />
          <span class="solo-movil">Toca para agrandar</span>
        </a>
      ) : null}
      {item.rutaArchivo && item.tipo === "voz" ? <audio controls src={`/archivo/documento/${item.documentoId}`} style="width:100%"></audio> : null}
    </section>
  );
  return {
    accion: `/revisar/${item.documentoId}`,
    tipoOculto: tipo === "chofer" ? "entrega" : "gasto",
    arriba,
    campos: (
      <>
        <CampoMonto valor={monto} />
        {tipo === "gaste" ? (
          <label class="campo"><span>¿En qué?</span>
            <select name="categoria">{categorias.map((k) => <option value={k.clave} selected={k.clave === categoria}>{k.nombre}</option>)}</select>
          </label>
        ) : (
          <fieldset class="grupo"><legend class="lbl">¿Cómo se la diste?</legend>
            <div class="opciones-texto">{Object.entries(MEDIOS_ENTREGA).map(([k, n]) => <OpcionTexto nombre="medio" valor={k} texto={n} marcado={k === medio} />)}</div>
          </fieldset>
        )}
      </>
    ),
    solo: {
      texto,
      // Sin camión (o «Plata al chofer» sin viaje) se abre «cambiar» para elegirlo antes de guardar.
      abierto: !unidad || (tipo === "chofer" && !vj),
      cambiar: (
        <>
          <label class="campo"><span>Camión</span>
            <select name="vehiculoId" required>
              {unidad ? null : <option value="" selected>— ¿de qué camión? —</option>}
              {unidades.map((u) => {
                const x = viajeDe(u.id);
                return <option value={u.id} selected={u.id === unidad?.id}>{u.codigo} · {u.placa} · {x ? `viaje ${x.ruta}` : "sin viaje en curso"}</option>;
              })}
            </select>
          </label>
          {tipo === "gaste" ? <label class="campo"><span>Detalle</span><input name="nota" maxlength={200} value={v.nota} /></label> : null}
        </>
      ),
    },
    boton: "GUARDAR",
  };
}

/** `/anotar?documento=`: confirmar (o descartar) lo que llegó por Telegram. Solo Gasté y Plata al chofer. */
async function vistaDocumento(c: C, d: Deps, q: Q, permitidos: TipoAnotar[]) {
  // Los mismos que antes confirmaban en «Por revisar» (POST /revisar/… pide poder editar Viajes).
  const dos = permitidos.filter((t) => t === "gaste" || t === "chofer");
  if (!puedeEditar(c.get("usuario").rol, "viajes") || !dos.length) return c.redirect("/?error=" + encodeURIComponent("Tu rol no confirma lo que manda el chofer"));
  const p = await parteDocumento(d, q, c.req.query("tipo"));
  if (!p) return c.redirect("/?ver=atencion&error=" + encodeURIComponent("Ese mensaje ya se guardó o se descartó"));
  const qDoc: Q = { ...q, tipo: p.tipoOculto === "entrega" ? "chofer" : "gaste", volver: q.volver === "/" ? "/?ver=atencion" : q.volver };
  const cuerpo = (
    <FormAnotar q={qDoc} permitidos={dos} p={p} titulo="Confirma lo que llegó" clase="con-documento" despues={
      <form method="post" action={`/revisar/${q.documento}/descartar`} class="descartar" data-confirmar="¿Descartar este mensaje? No se guarda nada.">
        <button class="btn fantasma" type="submit">No es nada: descartar</button>
      </form>
    } />
  );
  if (q.parcial) return c.html(cuerpo.toString());
  return pagina(c, d, { titulo: "Confirma lo que llegó", seccion: "dashboard", lugar: "anotar", sinNavInferior: true }, cuerpo);
}

const PARTES: Record<TipoAnotar, (c: C, d: Deps, q: Q) => Promise<PartesForm>> = {
  gaste: parteGaste, chofer: parteChofer, cobro: parteCobro, repare: parteRepare, empresa: parteEmpresa, prestamo: parteAnotarPrestamo,
};

// ── Formulario ───────────────────────────────────────────────────────────────

/** `titulo`, `clase` y `despues` (otro formulario debajo, p. ej. «descartar») los usa el modo documento. */
const FormAnotar: FC<{ q: Q; permitidos: TipoAnotar[]; p: PartesForm; titulo?: string; clase?: string; despues?: Child }> = ({ q, permitidos, p, titulo, clase, despues }) => (
  <div class={clase ? `anotar ${clase}` : "anotar"}>
    <Cabecera titulo={titulo ?? "¿Qué pasó?"} volver={q.volver} />
    <nav class="tipos-anotar" aria-label="¿Qué pasó?">
      {permitidos.map((t) => (
        <a href={otroTipo(q, t)} data-panel-link="" class={t === q.tipo ? "activo" : undefined} aria-current={t === q.tipo ? "true" : undefined}>
          <Icono n={t} t={24} /><span>{TIPOS_ANOTAR[t].corta}</span>
        </a>
      ))}
    </nav>
    {p.modos ? (
      <nav class={`segmentos${p.modos.length === 3 ? " modos-3" : ""}`} aria-label="Opciones">
        {p.modos.map((m) => (
          <a href={urlAnotar({ ...q, modo: m.modo, facturaId: "", prestamoId: "", monto: "", categoria: "" })} data-panel-link="" class={m.modo === q.modo ? "activo" : undefined} aria-current={m.modo === q.modo ? "true" : undefined}>{m.etiqueta}</a>
        ))}
      </nav>
    ) : null}
    {p.arriba ?? null}
    {p.soloMensaje ?? (
      <form method="post" action={p.accion ?? "/anotar"} enctype="multipart/form-data" class="form-anotar" data-asi-queda={!p.accion && (q.tipo === "gaste" || q.tipo === "chofer") ? "" : undefined}>
        <input type="hidden" name="tipo" value={p.tipoOculto ?? q.tipo} />
        {q.modo ? <input type="hidden" name="modo" value={q.modo} /> : null}
        <input type="hidden" name="volver" value={q.volver} />
        {p.campos}
        {p.solo ? <SePoneSolo texto={p.solo.texto} abierto={p.solo.abierto}>{p.solo.cambiar}</SePoneSolo> : null}
        {p.abajo ?? null}
        <button class="btn primario guardar" type="submit">{p.boton ?? "GUARDAR"}</button>
      </form>
    )}
    {despues ?? null}
  </div>
);

async function vista(c: C, d: Deps) {
  const permitidos = tiposAnotar(c.get("usuario").rol);
  if (!permitidos.length) return c.redirect("/?error=" + encodeURIComponent("Tu rol no anota movimientos"));
  const q = leerQ(c, permitidos);
  if (q.documento) return vistaDocumento(c, d, q, permitidos);
  const p = await PARTES[q.tipo as TipoAnotar](c, d, q);
  const cuerpo = <FormAnotar q={q} permitidos={permitidos} p={p} />;
  if (q.parcial) return c.html(cuerpo.toString());
  return pagina(c, d, { titulo: "Anotar", seccion: "dashboard", lugar: "anotar", sinNavInferior: true }, cuerpo);
}

/** Guarda lo anotado con el mismo manejador que usan las rutas de siempre. */
async function guardarAnotacion(d: Deps, u: UsuarioWeb, tipo: TipoAnotar, f: Campos, archivos: Record<string, File>): Promise<string> {
  switch (tipo) {
    case "gaste": {
      const categoria = f.categoria === "otro" ? (f.categoriaOtra ?? "") : (f.categoria ?? "");
      if (!categoria) throw new ErrorNegocio("Elige en qué se gastó");
      return guardarGasto(d, u.id, { ...f, categoria }, archivos.foto);
    }
    case "chofer": {
      const viajeId = num(f.viajeId);
      if (viajeId === null) throw new ErrorNegocio("Elige el viaje");
      return guardarEntrega(d, u.id, viajeId, f);
    }
    case "cobro": {
      if (f.modo === "otro") {
        if (!puedeEditar(u.rol, "finanzas")) throw new ErrorNegocio("Tu rol no puede anotar otros ingresos");
        return guardarIngreso(d, u.id, f);
      }
      const facturaId = num(f.facturaId);
      if (facturaId === null) throw new ErrorNegocio("Elige la factura que te pagaron");
      return guardarCobro(d, u.id, facturaId, f);
    }
    case "repare": {
      if (f.modo === "compra") {
        if (!puedeEditar(u.rol, "inventario")) throw new ErrorNegocio("Tu rol no puede registrar compras");
        return guardarCompra(d, u.id, f);
      }
      // Con la casilla en el formulario, la parte solo se reinicia si se marcó «Cambié la pieza por una nueva».
      const campos = f.casillaReinicia === "1" && f.reinicia !== "1" ? { ...f, parteId: "" } : f;
      return (await guardarCambio(d, u.id, campos, f.tipoReparacion, { algo: true })).ok;
    }
    case "empresa":
      return guardarGastoEmpresa(d, u.id, f, archivos.foto);
    case "prestamo": {
      if (f.modo === "nuevo") return guardarPrestamo(d, u.id, f);
      if (f.modo === "reinversion") return guardarReinversion(d, u.id, f);
      const prestamoId = num(f.prestamoId);
      if (prestamoId === null) throw new ErrorNegocio("Elige la cuota que pagaste");
      return pagarCuotaDe(d, u.id, prestamoId);
    }
  }
}

export function rutasAnotar(app: App, d: Deps): void {
  app.get("/anotar", (c) => vista(c as C, d));
  app.get("/anotar/asi-queda", async (c) => {
    if (!tiposAnotar(c.get("usuario").rol).some((t) => t === "gaste" || t === "chofer")) return c.text("Tu rol no anota plata", 403);
    const tipo = c.req.query("tipo") ?? "", monto = c.req.query("monto") ?? "", viajeId = c.req.query("viajeId") ?? "";
    const r = await calcularAsiQueda(d, tipo, monto, viajeId, c.req.query("categoria") ?? "", c.req.query("medioPago") ?? "");
    return c.html((<AsiQuedaBloque r={r} sinViaje={tipo === "gaste" && !viajeId && parsearMonto(monto) !== null} />).toString());
  });
  app.post("/anotar", async (c) => {
    const { campos: f, archivos } = await formularioMultiparte(c as C);
    const u = c.get("usuario");
    const tipo = f.tipo as TipoAnotar;
    if (!(tipo in TIPOS_ANOTAR) || !tiposAnotar(u.rol).includes(tipo)) return c.text("Tu rol no puede anotar eso", 403);
    if (tipo === "empresa" && f.mensual === "1" && !puedeEditar(u.rol, "ajustes")) return c.text("Tu rol no crea gastos de cada mes", 403);
    const destino = volverA(f.volver, "/");
    // Si no se pudo guardar, vuelve al formulario con lo escrito (en «Otro», la categoría elegida en la lista).
    const categoria = tipo === "gaste" && f.categoria === "otro" ? f.categoriaOtra : f.categoria;
    return accion(c as C, urlAnotar({ ...f, categoria, volver: destino }), async () => ({ ok: await guardarAnotacion(d, u, tipo, f, archivos), ruta: destino }));
  });
}
