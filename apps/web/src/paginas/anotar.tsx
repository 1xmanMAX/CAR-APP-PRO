/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import type { Child, FC, PropsWithChildren } from "hono/jsx";
import {
  capturarContexto, categoriasMasUsadas, describirContexto, ErrorNegocio, fechaHoraLima, hoy, listarCategorias, listarCobrosPendientes,
  listarUnidades, listarViajesFlota, MEDIOS_ENTREGA, NOMBRE_MEDIO_PAGO, nombreCategoria, puedeEditar, ultimaUnidadDeUsuario, viajesEnRuta,
  type UsuarioWeb, type ViajeEnRuta,
} from "@sunatapp/core";
import { accion, formularioMultiparte, pagina, volverA, type App, type C, type Deps } from "../base";
import { guardarCobro, guardarEntrega, guardarGasto, guardarIngreso, type Campos } from "../acciones";
import { TIPOS_ANOTAR, tiposAnotar, type TipoAnotar } from "../lugares";
import { Cabecera, diasEntre, fechaCorta, Icono, soles2, Vacio, type NombreIcono } from "../ui";

/** Tipos que ya tienen formulario. La tarea 5 completa los demás y borra esta lista. */
const LISTOS: TipoAnotar[] = ["gaste", "chofer", "cobro"];

const CLAVES_Q = ["tipo", "modo", "volver", "viajeId", "vehiculoId", "facturaId", "prestamoId", "pieza", "parteId", "repuestoId"] as const;
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
const otroTipo = (q: Q, tipo: TipoAnotar) => urlAnotar({ tipo, volver: q.volver, viajeId: q.viajeId, vehiculoId: q.vehiculoId });

/** Lo que cada tipo pone en el formulario. */
export interface PartesForm {
  campos: Child;
  /** Bloque azul «Se pone solo» con su «cambiar» plegado. */
  solo?: { texto: string; cambiar?: Child };
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

const OpcionIcono: FC<{ nombre: string; valor: string; icono: NombreIcono; texto: string; marcado?: boolean }> = (p) => (
  <label class="opcion"><input type="radio" name={p.nombre} value={p.valor} checked={p.marcado} required /><Icono n={p.icono} t={22} /><span>{p.texto}</span></label>
);

const OpcionTexto: FC<{ nombre: string; valor: string; texto: string; marcado?: boolean }> = (p) => (
  <label class="opcion"><input type="radio" name={p.nombre} value={p.valor} checked={p.marcado} /><span>{p.texto}</span></label>
);

const FotoOpcional: FC = () => (
  <label class="foto-opcional"><Icono n="camara" t={20} /><span>Foto del voucher (opcional)</span><input type="file" name="foto" accept="image/*,application/pdf" /></label>
);

const SePoneSolo: FC<PropsWithChildren<{ texto: string }>> = (p) => (
  <div class="se-pone-solo">
    <b class="lbl">Se pone solo</b>
    <span>{p.texto}</span>
    {p.children ? <details><summary>cambiar</summary><div class="filas">{p.children}</div></details> : null}
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
  return {
    campos: (
      <>
        <CampoMonto />
        <fieldset class="grupo">
          <legend class="lbl">¿En qué?</legend>
          <div class="opciones-icono">
            {botones.map((k, i) => <OpcionIcono nombre="categoria" valor={k} icono={iconoCategoria(k)} texto={nombreCategoria(k, categorias)} marcado={i === 0} />)}
            <OpcionIcono nombre="categoria" valor="otro" icono="otro" texto="Otro" />
          </div>
          <label class="campo otro-cual"><span>¿Cuál?</span><select name="categoriaOtra">{categorias.map((k) => <option value={k.clave}>{k.nombre}</option>)}</select></label>
        </fieldset>
        {elegirViaje ? <ViajesRadios viajes={enRuta} /> : null}
        <FotoOpcional />
      </>
    ),
    solo: {
      texto: `${describirContexto(g)} · hoy ${ahora(d)}`,
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
  };
}

async function parteChofer(_c: C, d: Deps, q: Q): Promise<PartesForm> {
  const ctx = d.ctx;
  const enRuta = await viajesEnRuta(ctx);
  const viajeId = num(q.viajeId) ?? (enRuta.length === 1 ? enRuta[0]!.viajeId : null);
  const recientes = viajeId === null && enRuta.length === 0 ? await listarViajesFlota(ctx, { limite: 10 }) : [];
  const g = viajeId !== null ? await capturarContexto(ctx, { viajeId }) : null;
  const elegido = enRuta.find((v) => v.viajeId === viajeId);
  return {
    campos: (
      <>
        <CampoMonto />
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
      texto: `${elegido ? `${elegido.unidad} · ${elegido.ruta} · ${elegido.chofer}` : g.viajeCodigo ?? ""} · hoy ${ahora(d)}`,
      cambiar: (
        <>
          <SelectViaje requerido opciones={opcionesDeViaje(enRuta, g)} elegido={viajeId} />
          <CampoFecha d={d} />
          <label class="campo"><span>Nota</span><input name="nota" placeholder="Adelanto de salida" /></label>
        </>
      ),
    } : undefined,
  };
}

async function parteCobro(c: C, d: Deps, q: Q): Promise<PartesForm> {
  const modos = puedeEditar(c.get("usuario").rol, "finanzas") ? [{ modo: "", etiqueta: "Una factura" }, { modo: "otro", etiqueta: "Otro ingreso" }] : undefined;
  if (q.modo === "otro") {
    const unidades = await listarUnidades(d.ctx);
    return {
      modos,
      campos: (
        <>
          <CampoMonto />
          <label class="campo"><span>¿De qué?</span><input name="concepto" required placeholder="Alquiler de la carreta, venta de chatarra…" /></label>
        </>
      ),
      solo: { texto: `Entra hoy ${ahora(d)} · a la empresa`, cambiar: <><SelectUnidad unidades={unidades} elegido={null} vacio="— de la empresa —" /><CampoFecha d={d} /></> },
    };
  }
  const { filas } = await listarCobrosPendientes(d.ctx);
  const ordenadas = [...filas].sort((a, b) => a.fechaVencimiento.localeCompare(b.fechaVencimiento));
  const sel = ordenadas.find((f) => f.facturaId === num(q.facturaId)) ?? ordenadas[0];
  if (!sel) return { modos, campos: null, soloMensaje: <div class="lista-filas"><Vacio>Nadie te debe facturas.</Vacio></div> };
  const h = hoy(d.ctx);
  return {
    modos,
    campos: (
      <>
        <fieldset class="grupo"><legend class="lbl">¿Quién te pagó?</legend>
          <div class="lista-filas">
            {ordenadas.map((f) => (
              <a class={`fila-aviso${f.facturaId === sel.facturaId ? " sel" : ""}`} href={urlAnotar({ ...q, facturaId: f.facturaId })} data-panel-link="" aria-current={f.facturaId === sel.facturaId ? "true" : undefined}>
                <span class="punto" style={`background:var(${f.estado === "vencida" ? "--accent" : "--amber-bar"})`}></span>
                <span class="txt"><b>{f.cliente}</b> · {f.serieNumero}<br /><span class="muted">{f.estado === "vencida" ? `vencida hace ${diasEntre(f.fechaVencimiento, h)} días` : `vence ${fechaCorta(f.fechaVencimiento)}`}</span></span>
                <b>{soles2(f.saldo)}</b>
              </a>
            ))}
          </div>
        </fieldset>
        <input type="hidden" name="facturaId" value={sel.facturaId} />
        <CampoMonto valor={(sel.saldo / 100).toFixed(2)} etiqueta="¿Cuánto te pagaron?" />
        <fieldset class="grupo"><legend class="lbl">¿Cómo?</legend>
          <div class="opciones-texto">{[["transferencia", "Transferencia"], ["efectivo", "Efectivo"], ["otro", "Otro"]].map(([k, n], i) => <OpcionTexto nombre="medio" valor={k!} texto={n!} marcado={i === 0} />)}</div>
        </fieldset>
      </>
    ),
    solo: { texto: `Hoy ${ahora(d)} · se descuenta de lo que te deben` },
  };
}

const PARTES: Partial<Record<TipoAnotar, (c: C, d: Deps, q: Q) => Promise<PartesForm>>> = { gaste: parteGaste, chofer: parteChofer, cobro: parteCobro };

// ── Formulario ───────────────────────────────────────────────────────────────

const FormAnotar: FC<{ q: Q; permitidos: TipoAnotar[]; p: PartesForm }> = ({ q, permitidos, p }) => (
  <div class="anotar">
    <Cabecera titulo="¿Qué pasó?" volver={q.volver} />
    <nav class="tipos-anotar" aria-label="¿Qué pasó?">
      {permitidos.map((t) => (
        <a href={otroTipo(q, t)} data-panel-link="" class={t === q.tipo ? "activo" : undefined} aria-current={t === q.tipo ? "true" : undefined}>
          <Icono n={t} t={24} /><span>{TIPOS_ANOTAR[t].corta}</span>
        </a>
      ))}
    </nav>
    {p.modos ? (
      <nav class="segmentos" aria-label="Opciones">
        {p.modos.map((m) => (
          <a href={urlAnotar({ ...q, modo: m.modo, facturaId: "", prestamoId: "" })} data-panel-link="" class={m.modo === q.modo ? "activo" : undefined} aria-current={m.modo === q.modo ? "true" : undefined}>{m.etiqueta}</a>
        ))}
      </nav>
    ) : null}
    {p.arriba ?? null}
    {p.soloMensaje ?? (
      <form method="post" action={p.accion ?? "/anotar"} enctype="multipart/form-data" class="form-anotar" data-asi-queda={q.tipo === "gaste" || q.tipo === "chofer" ? "" : undefined}>
        <input type="hidden" name="tipo" value={p.tipoOculto ?? q.tipo} />
        {q.modo ? <input type="hidden" name="modo" value={q.modo} /> : null}
        <input type="hidden" name="volver" value={q.volver} />
        {p.campos}
        {p.solo ? <SePoneSolo texto={p.solo.texto}>{p.solo.cambiar}</SePoneSolo> : null}
        {p.abajo ?? null}
        <button class="btn primario guardar" type="submit">{p.boton ?? "GUARDAR"}</button>
      </form>
    )}
  </div>
);

async function vista(c: C, d: Deps) {
  const permitidos = tiposAnotar(c.get("usuario").rol).filter((t) => LISTOS.includes(t));
  if (!permitidos.length) return c.redirect("/?error=" + encodeURIComponent("Tu rol no anota movimientos"));
  const q = leerQ(c, permitidos);
  const p = await PARTES[q.tipo as TipoAnotar]!(c, d, q);
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
    default:
      throw new ErrorNegocio("Ese tipo todavía no se puede anotar aquí");
  }
}

export function rutasAnotar(app: App, d: Deps): void {
  app.get("/anotar", (c) => vista(c as C, d));
  app.post("/anotar", async (c) => {
    const { campos: f, archivos } = await formularioMultiparte(c as C);
    const u = c.get("usuario");
    const tipo = f.tipo as TipoAnotar;
    if (!(tipo in TIPOS_ANOTAR) || !tiposAnotar(u.rol).includes(tipo)) return c.text("Tu rol no puede anotar eso", 403);
    const destino = volverA(f.volver, "/");
    return accion(c as C, urlAnotar({ ...f, volver: destino }), async () => ({ ok: await guardarAnotacion(d, u, tipo, f, archivos), ruta: destino }));
  });
}
