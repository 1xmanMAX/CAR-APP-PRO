import { conductor, contraparte, empresa, eq, guiaItem, guiaTransportista, vehiculo, type Tx } from "@sunatapp/db";
import { tipoDocumentoDe } from "../dominio/validaciones";
import { ErrorNegocio, ErrorValidacion } from "../errores";
import { registrarAuditoria } from "../infra/auditoria";
import type { Contexto } from "../infra/contexto";
import { validarEntradaGuia, type EntradaGuia } from "./validar";

/**
 * Reutiliza la contraparte existente para ese numeroDoc sin tocar su razonSocial (podría
 * diferir de la registrada la primera vez, p. ej. por una corrección posterior en SUNAT/RENIEC;
 * cambiarla aquí alteraría el XML de una guía pendiente que se reintente más adelante — ver
 * Tarea de robustez en emitir.ts). Solo inserta si no existe todavía.
 */
async function asegurarContraparte(tx: Tx, p: { numeroDoc: string; razonSocial: string }): Promise<number> {
  const [existente] = await tx.select({ id: contraparte.id }).from(contraparte).where(eq(contraparte.numeroDoc, p.numeroDoc));
  if (existente) return existente.id;
  const [fila] = await tx
    .insert(contraparte)
    .values({ tipoDoc: tipoDocumentoDe(p.numeroDoc)!, numeroDoc: p.numeroDoc, razonSocial: p.razonSocial.trim() })
    .onConflictDoNothing({ target: contraparte.numeroDoc })
    .returning({ id: contraparte.id });
  if (fila) return fila.id;
  // Carrera: otra transacción insertó el mismo numeroDoc entre el select y el insert.
  const [ganador] = await tx.select({ id: contraparte.id }).from(contraparte).where(eq(contraparte.numeroDoc, p.numeroDoc));
  return ganador!.id;
}

export async function registrarGuiaBorrador(ctx: Contexto, e: EntradaGuia, usuarioId?: number): Promise<number> {
  const errores = validarEntradaGuia(e);
  if (errores.length) throw new ErrorValidacion(errores);
  return ctx.db.transaction(async (tx) => {
    const [emp] = await tx.select().from(empresa).limit(1);
    const [veh] = await tx.select().from(vehiculo).where(eq(vehiculo.activo, true)).limit(1);
    const [cond] = await tx.select().from(conductor).where(eq(conductor.activo, true)).limit(1);
    if (!emp || !veh || !cond) throw new ErrorNegocio("Falta configurar empresa, vehículo o conductor");
    const [guia] = await tx
      .insert(guiaTransportista)
      .values({
        serie: emp.serieGre,
        fechaTraslado: e.fechaTraslado,
        remitenteId: await asegurarContraparte(tx, e.remitente),
        destinatarioId: await asegurarContraparte(tx, e.destinatario),
        partidaDireccion: e.partida.direccion.trim(),
        partidaUbigeo: e.partida.ubigeo,
        llegadaDireccion: e.llegada.direccion.trim(),
        llegadaUbigeo: e.llegada.ubigeo,
        pesoBruto: e.pesoBruto,
        unidadPeso: e.unidadPeso,
        vehiculoId: veh.id,
        conductorId: cond.id,
        greRemitenteRef: e.greRemitenteRef,
        documentoRecibidoId: e.documentoRecibidoId ?? null,
      })
      .returning({ id: guiaTransportista.id });
    await tx.insert(guiaItem).values(e.items.map((it) => ({ guiaId: guia!.id, ...it })));
    await registrarAuditoria(tx, { usuarioId, accion: "guia_registrada", entidad: "guia_transportista", entidadId: guia!.id });
    return guia!.id;
  });
}
