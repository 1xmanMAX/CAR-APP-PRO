import { desc, entrega, eq, viaje, type MedioEntrega } from "@sunatapp/db";
import { ErrorNegocio } from "../errores";
import { hoy } from "../flota/unidades";
import { registrarAuditoria } from "../infra/auditoria";
import type { Contexto } from "../infra/contexto";

export const MEDIOS_ENTREGA: Record<MedioEntrega, string> = { efectivo: "Efectivo", yape: "Yape / Plin", transferencia: "Transferencia", otro: "Otro" };

export interface EntradaEntrega {
  viajeId: number;
  /** En céntimos. */
  monto: number;
  medio: MedioEntrega;
  fecha?: string;
  nota?: string | null;
  documentoId?: number | null;
  usuarioId?: number;
}

/** Dinero entregado al chofer para el viaje (adelanto, yape, depósito): se descuenta en la liquidación. */
export async function registrarEntrega(ctx: Contexto, e: EntradaEntrega): Promise<{ id: number; viajeCodigo: string }> {
  if (!Number.isInteger(e.monto) || e.monto <= 0) throw new ErrorNegocio("El monto debe ser mayor que 0");
  if (e.monto > 5_000_000) throw new ErrorNegocio("El monto parece demasiado alto; revísalo");
  if (!(e.medio in MEDIOS_ENTREGA)) throw new ErrorNegocio("Medio de entrega no válido");
  const [v] = await ctx.db.select({ codigo: viaje.codigo, estado: viaje.estado }).from(viaje).where(eq(viaje.id, e.viajeId));
  if (!v) throw new ErrorNegocio("El viaje no existe");
  const [f] = await ctx.db.insert(entrega).values({
    viajeId: e.viajeId, monto: e.monto, medio: e.medio, fecha: e.fecha ?? hoy(ctx), nota: e.nota ?? null,
    documentoId: e.documentoId ?? null, usuarioId: e.usuarioId ?? null,
  }).returning({ id: entrega.id });
  await registrarAuditoria(ctx.db, { usuarioId: e.usuarioId, accion: "entrega_registrada", entidad: "entrega", entidadId: f!.id, detalle: e });
  return { id: f!.id, viajeCodigo: v.codigo };
}

export async function listarEntregas(ctx: Contexto, viajeId: number) {
  return ctx.db.select().from(entrega).where(eq(entrega.viajeId, viajeId)).orderBy(desc(entrega.fecha), desc(entrega.id));
}

export async function borrarEntrega(ctx: Contexto, id: number, usuarioId?: number): Promise<void> {
  const [f] = await ctx.db.delete(entrega).where(eq(entrega.id, id)).returning();
  if (!f) throw new ErrorNegocio("La entrega no existe");
  await registrarAuditoria(ctx.db, { usuarioId, accion: "entrega_borrada", entidad: "entrega", entidadId: id, detalle: f });
}
