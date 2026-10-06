import {
  ErrorNegocio, hoy, MEDIOS_ENTREGA, parsearMonto, registrarCobro, registrarEntrega, registrarGasto, registrarIngreso, type MedioPago,
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
