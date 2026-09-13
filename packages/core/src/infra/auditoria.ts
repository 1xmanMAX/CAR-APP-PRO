import { auditoria, type Ejecutor } from "@sunatapp/db";

export async function registrarAuditoria(
  db: Ejecutor,
  e: { usuarioId?: number | null; accion: string; entidad: string; entidadId?: string | number | null; detalle?: unknown },
): Promise<void> {
  await db.insert(auditoria).values({
    usuarioId: e.usuarioId ?? null,
    accion: e.accion,
    entidad: e.entidad,
    entidadId: e.entidadId === undefined || e.entidadId === null ? null : String(e.entidadId),
    detalle: e.detalle ?? null,
  });
}
