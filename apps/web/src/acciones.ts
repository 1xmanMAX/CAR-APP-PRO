import {
  crearCostoFijo, crearPrestamo, ErrorNegocio, fijoActivoDe, hoy, listarCategorias, MEDIOS_ENTREGA, pagarCuota, parsearMonto, pieza, registrarCambio, registrarCobro,
  registrarCompra, registrarEntrega, registrarGasto, registrarIngreso, registrarReinversion, textoYaSeCarga, TIPOS_REPARACION, type MedioPago, type TipoReparacion,
} from "@sunatapp/core";
import type { Deps } from "./base";
import { enteroONull } from "./paginas/flota";
import { soles2 } from "./ui";

/**
 * Manejadores compartidos: los usan `POST /anotar` y las rutas POST de siempre, así los dos caminos
 * llaman exactamente a la misma lógica de `packages/core`.
 */
export type Campos = Record<string, string>;

export function montoObligatorio(v: string | undefined, nombre = "Monto"): number {
  const m = parsearMonto(v ?? "");
  if (m === null) throw new ErrorNegocio(`${nombre} no válido`);
  return m;
}

export const idONull = (v: string | undefined): number | null => (v && /^\d+$/.test(v) ? Number(v) : null);

export async function guardarFoto(d: Deps, foto: File | undefined): Promise<string | null> {
  if (!foto) return null;
  if (foto.size > 8 * 1024 * 1024) throw new ErrorNegocio("La foto pesa más de 8 MB");
  const ext = (foto.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  return d.ctx.almacen.guardar(`vouchers/${Date.now()}-web.${ext}`, Buffer.from(await foto.arrayBuffer()));
}

/** Gasto del viaje o de la empresa (antes: POST /finanzas/gasto). */
export async function guardarGasto(d: Deps, usuarioId: number, f: Campos, foto?: File): Promise<string> {
  const rutaFoto = await guardarFoto(d, foto);
  const r = await registrarGasto(d.ctx, {
    categoria: f.categoria ?? "", monto: montoObligatorio(f.monto), vehiculoId: idONull(f.vehiculoId), viajeId: idONull(f.viajeId),
    fecha: f.fecha || undefined, nota: f.nota || null, rutaFoto, origen: "web", usuarioId,
    medioPago: (f.medioPago || undefined) as MedioPago | undefined, kmVehiculo: f.km ? enteroONull(f.km) : null,
  });
  const donde = r.viajeCodigo ? ` en ${r.viajeCodigo}` : "";
  return r.avisoKm ? `Gasto guardado${donde}. ${r.avisoKm}` : `Gasto guardado${donde}`;
}

/** Plata entregada al chofer (antes: POST /viajes/:id/entrega). */
export async function guardarEntrega(d: Deps, usuarioId: number, viajeId: number, f: Campos): Promise<string> {
  const monto = montoObligatorio(f.monto);
  const medio = (f.medio && f.medio in MEDIOS_ENTREGA ? f.medio : "efectivo") as keyof typeof MEDIOS_ENTREGA;
  await registrarEntrega(d.ctx, { viajeId, monto, medio, fecha: f.fecha || undefined, nota: f.nota || null, usuarioId });
  return `Entrega de ${soles2(monto)} anotada`;
}

/** Cobro de una factura (antes: POST /cobros/:id). */
export async function guardarCobro(d: Deps, usuarioId: number, facturaId: number, f: Campos): Promise<string> {
  const monto = montoObligatorio(f.monto);
  const medio = f.medio === "efectivo" || f.medio === "otro" ? f.medio : "transferencia";
  const r = await registrarCobro(d.ctx, { facturaId, montoCentimos: monto, fecha: hoy(d.ctx), medio, usuarioId });
  return r.estadoCobro === "pagada" ? "Factura pagada por completo" : `Cobro registrado · saldo ${soles2(r.saldo)}`;
}

/** Otro ingreso (antes: POST /finanzas/ingreso). */
export async function guardarIngreso(d: Deps, usuarioId: number, f: Campos): Promise<string> {
  await registrarIngreso(d.ctx, { concepto: f.concepto ?? "", monto: montoObligatorio(f.monto), vehiculoId: idONull(f.vehiculoId), fecha: f.fecha || undefined, origen: "web", usuarioId });
  return "Ingreso guardado";
}

/**
 * Cambio o reparación (antes: POST /reparaciones y POST /trailer/:id/pieza). Reinicia el contador de
 * la parte si viene `parteId`, saca del stock los repuestos usados, registra el gasto y avisa al grupo.
 * Si no se escribe «trabajo», el núcleo lo completa («Cambio · parte», «Revisión · pieza» o «Reparación»).
 * `exigir.trabajoEnPieza`: el panel de la pieza (/trailer/:id/pieza) pide qué pasó, como siempre.
 * `exigir.algo`: Anotar no guarda un arreglo sin pieza, sin parte y sin texto.
 */
export async function guardarCambio(
  d: Deps, usuarioId: number, f: Campos, tipoTexto?: string, exigir: { trabajoEnPieza?: boolean; algo?: boolean } = {},
): Promise<{ ok: string; vehiculoId: number; pieza: string | null }> {
  const vehiculoId = idONull(f.vehiculoId);
  if (vehiculoId === null) throw new ErrorNegocio("Elige el camión");
  const p = f.componente ? pieza(f.componente) : null;
  if (f.componente && !p) throw new ErrorNegocio("Elige una pieza del modelo");
  if (exigir.trabajoEnPieza && p && !f.trabajo?.trim()) throw new ErrorNegocio("Escribe qué pasó o qué se hizo");
  if (exigir.algo && !p && !f.parteId && !f.trabajo?.trim()) throw new ErrorNegocio("Elige la pieza o escribe qué se hizo");
  const tipo = (tipoTexto || (p ? "correctivo" : "preventivo")) as TipoReparacion;
  if (!(tipo in TIPOS_REPARACION)) throw new ErrorNegocio("Tipo no válido");
  const manoObra = f.manoObra ? parsearMonto(f.manoObra) : 0;
  if (manoObra === null) throw new ErrorNegocio("Mano de obra no válida");
  const ids = (f.repuestoId ?? "").split("\u0001");
  const cants = (f.cantidad ?? "").split("\u0001");
  const usados = new Map<number, number>();
  ids.forEach((id, k) => {
    if (!id) return;
    usados.set(Number(id), (usados.get(Number(id)) ?? 0) + (enteroONull(cants[k]) ?? 1));
  });
  const r = await registrarCambio(d.ctx, {
    vehiculoId, parteInstaladaId: idONull(f.parteId), tipo, odometro: enteroONull(f.odometro) ?? undefined, fecha: f.fecha || undefined,
    repuestos: [...usados].map(([repuestoId, cantidad]) => ({ repuestoId, cantidad })), manoObra, taller: f.taller || null,
    trabajo: f.trabajo?.trim() || null, componente: p?.id ?? null, origen: "web", usuarioId,
  });
  let texto = r.resumen;
  if (r.stockBajo.length) texto += `\n⚠️ Stock bajo: ${r.stockBajo.map((s) => `${s.codigo} (${s.stock})`).join(", ")}`;
  await d.avisar(texto).catch(() => {});
  const ok = p
    ? `Guardado en ${p.nombre}${r.costoTotal ? ` · ${soles2(r.costoTotal)}` : ""}`
    : `Cambio guardado · ${r.trabajo} · ${soles2(r.costoTotal)}${r.desgastePct !== null ? ` · ${r.desgastePct}% ${r.etiqueta}` : ""}`;
  return { ok, vehiculoId, pieza: p?.id ?? null };
}

/**
 * Qué parte se reinicia: la elegida a mano en la lista, o la que vino puesta si se marcó «Cambié la
 * pieza por una nueva». La que vino puesta (`parteInicial`, p. ej. desde el 3D) sin la casilla no se
 * reinicia: un arreglo no la vuelve nueva.
 */
export function conParteQueReinicia(f: Campos): Campos {
  const elegidaAMano = !!f.parteId && f.parteId !== f.parteInicial;
  return f.reinicia === "1" || elegidaAMano ? f : { ...f, parteId: "" };
}

/** Compra de repuestos para el stock (antes: POST /inventario/compra). */
export async function guardarCompra(d: Deps, usuarioId: number, f: Campos): Promise<string> {
  const costo = parsearMonto(f.costo ?? "");
  if (costo === null) throw new ErrorNegocio("Costo unitario no válido");
  const cantidad = enteroONull(f.cantidad);
  if (cantidad === null) throw new ErrorNegocio("Indica la cantidad");
  const repuestoId = idONull(f.repuestoId);
  if (repuestoId === null) throw new ErrorNegocio("Elige el repuesto");
  await registrarCompra(d.ctx, { repuestoId, cantidad, costoUnitario: costo, fecha: f.fecha || undefined, proveedor: f.proveedor || null, origen: "web", usuarioId });
  return `Compra registrada: +${cantidad} en stock`;
}

/** Categoría que usan las cuotas pagadas (no se ofrece en «Gasto de la empresa»). */
export const CATEGORIA_CUOTA = "cuota_prestamo";

/** Gasto de la empresa: si «es mensual», crea el costo fijo (se carga solo cada mes); si no, un gasto sin viaje. */
export async function guardarGastoEmpresa(d: Deps, usuarioId: number, f: Campos, foto?: File): Promise<string> {
  if (!f.categoria) throw new ErrorNegocio("Elige en qué se gastó");
  // Las cuotas ya se cargan solas como gasto al pagarlas: anotarlas aquí las contaría dos veces.
  if (f.categoria === CATEGORIA_CUOTA) throw new ErrorNegocio("Las cuotas de un préstamo se pagan en «Préstamo o cuota»");
  if (f.mensual === "1") {
    const fijas = await listarCategorias(d.ctx, { tipo: "fijo", soloActivas: true });
    const nombre = fijas.find((k) => k.clave === f.categoria)?.nombre ?? "Gasto fijo";
    const monto = montoObligatorio(f.monto);
    // La fecha elegida es desde cuándo corre; el medio y la foto quedan como en un gasto suelto.
    await crearCostoFijo(d.ctx, {
      concepto: f.concepto?.trim() || nombre, categoria: f.categoria ?? "", monto, periodicidad: "mensual",
      vehiculoId: idONull(f.vehiculoId), usuarioId, desde: f.fecha || undefined, medioPago: (f.medioPago || undefined) as MedioPago | undefined,
      rutaFoto: await guardarFoto(d, foto),
    });
    return `${nombre}: queda como gasto de cada mes (se carga solo)`;
  }
  // Si esa categoría ya se carga sola cada mes, anotarla otra vez la contaría dos veces: se pide confirmar.
  const [fijo] = await fijoActivoDe(d.ctx, f.categoria);
  if (fijo && f.igualAparte !== "1") throw new ErrorNegocio(`${textoYaSeCarga(fijo)}. Si es un pago aparte, marca «Igual es un pago aparte»`);
  return guardarGasto(d, usuarioId, { ...f, viajeId: "" }, foto);
}

/** Préstamo nuevo con su cronograma (antes: POST /finanzas/prestamo). */
export async function guardarPrestamo(d: Deps, usuarioId: number, f: Campos): Promise<string> {
  const tasa = Number((f.tasa ?? "").replace(",", "."));
  if (!Number.isFinite(tasa)) throw new ErrorNegocio("Tasa no válida");
  await crearPrestamo(d.ctx, {
    entidad: f.entidad ?? "", monto: montoObligatorio(f.monto), tasaAnual: tasa, cuotas: enteroONull(f.cuotas) ?? 0,
    fechaInicio: f.fecha || undefined, vehiculoId: idONull(f.vehiculoId), usuarioId,
  });
  return "Préstamo creado con su cronograma de cuotas";
}

/** Paga la próxima cuota (antes: POST /finanzas/prestamo/:id/pagar). `numeroCuota`: la que se veía; un doble envío no paga la siguiente. */
export async function pagarCuotaDe(d: Deps, usuarioId: number, prestamoId: number, numeroCuota?: string): Promise<string> {
  const r = await pagarCuota(d.ctx, prestamoId, undefined, usuarioId, enteroONull(numeroCuota) ?? undefined);
  return `Cuota ${r.numero} pagada (${soles2(r.monto)})`;
}

/** Reinversión (antes: POST /finanzas/reinversion). */
export async function guardarReinversion(d: Deps, usuarioId: number, f: Campos): Promise<string> {
  await registrarReinversion(d.ctx, { concepto: f.concepto ?? "", monto: montoObligatorio(f.monto), vehiculoId: idONull(f.vehiculoId), fecha: f.fecha || undefined, origen: "web", usuarioId });
  return "Reinversión guardada";
}
