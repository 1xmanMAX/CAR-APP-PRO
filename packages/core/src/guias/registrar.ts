import { conductor, contraparte, empresa, eq, guiaItem, guiaTransportista, sql, vehiculo, type Tx } from "@sunatapp/db";
import { normalizarPlaca } from "@sunatapp/sunat";
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

async function guiaDeDocumento(ctx: Contexto, documentoRecibidoId: number): Promise<number | null> {
  const [g] = await ctx.db.select({ id: guiaTransportista.id }).from(guiaTransportista).where(eq(guiaTransportista.documentoRecibidoId, documentoRecibidoId));
  return g?.id ?? null;
}

async function vehiculoPorPlaca(tx: Tx, placa: string): Promise<{ id: number } | undefined> {
  const placaSql = sql`upper(regexp_replace(${vehiculo.placa}, '[^A-Za-z0-9]', '', 'g'))`;
  const [v] = await tx.select({ id: vehiculo.id }).from(vehiculo).where(sql`${placaSql} = ${normalizarPlaca(placa)}`);
  return v;
}

interface TransporteResuelto {
  vehiculoId: number;
  vehiculoSecundarioId: number | null;
  conductorId: number;
}

async function resolverTransporte(tx: Tx, emp: { ruc: string }, transporte: EntradaGuia["transporte"]): Promise<TransporteResuelto> {
  if (!transporte) {
    const [veh] = await tx.select().from(vehiculo).where(eq(vehiculo.activo, true)).limit(1);
    const [cond] = await tx.select().from(conductor).where(eq(conductor.activo, true)).limit(1);
    if (!veh || !cond) throw new ErrorNegocio("Falta configurar empresa, vehículo o conductor");
    return { vehiculoId: veh.id, vehiculoSecundarioId: null, conductorId: cond.id };
  }
  if (transporte.rucTransportista !== emp.ruc) throw new ErrorNegocio("El transportista de la guía no es la empresa");
  if (transporte.placasSecundarias.length > 1) throw new ErrorNegocio("Solo se admite una carreta por guía");
  const vehPrincipal = await vehiculoPorPlaca(tx, transporte.placaPrincipal);
  if (!vehPrincipal) throw new ErrorNegocio(`La placa ${transporte.placaPrincipal} no está registrada`);
  let vehiculoSecundarioId: number | null = null;
  const placaSecundaria = transporte.placasSecundarias[0];
  if (placaSecundaria) {
    const vehSecundario = await vehiculoPorPlaca(tx, placaSecundaria);
    if (!vehSecundario) throw new ErrorNegocio(`La placa ${placaSecundaria} no está registrada`);
    vehiculoSecundarioId = vehSecundario.id;
  }
  const [cond] = await tx.select({ id: conductor.id }).from(conductor).where(eq(conductor.numeroDoc, transporte.conductor.numeroDoc));
  if (!cond) throw new ErrorNegocio(`El conductor con DNI ${transporte.conductor.numeroDoc} no está registrado`);
  return { vehiculoId: vehPrincipal.id, vehiculoSecundarioId, conductorId: cond.id };
}

export async function registrarGuiaBorrador(ctx: Contexto, e: EntradaGuia, usuarioId?: number): Promise<number> {
  const errores = validarEntradaGuia(e);
  if (errores.length) throw new ErrorValidacion(errores);
  if (e.documentoRecibidoId !== undefined) {
    const existente = await guiaDeDocumento(ctx, e.documentoRecibidoId);
    if (existente !== null) return existente;
  }
  try {
    return await ctx.db.transaction(async (tx) => {
      const [emp] = await tx.select().from(empresa).limit(1);
      if (!emp) throw new ErrorNegocio("Falta configurar empresa, vehículo o conductor");
      const transporte = await resolverTransporte(tx, emp, e.transporte);
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
          vehiculoId: transporte.vehiculoId,
          vehiculoSecundarioId: transporte.vehiculoSecundarioId,
          conductorId: transporte.conductorId,
          greRemitenteRef: e.greRemitenteRef,
          documentoRecibidoId: e.documentoRecibidoId ?? null,
        })
        .returning({ id: guiaTransportista.id });
      await tx.insert(guiaItem).values(e.items.map((it) => ({ guiaId: guia!.id, ...it })));
      await registrarAuditoria(tx, { usuarioId, accion: "guia_registrada", entidad: "guia_transportista", entidadId: guia!.id });
      return guia!.id;
    });
  } catch (error) {
    // Carrera: otra llamada registró primero una guía para el mismo documentoRecibidoId
    // (violación de la restricción única "guia_documento_recibido").
    const codigo = (error as { cause?: { code?: string }; code?: string }).cause?.code ?? (error as { code?: string }).code;
    if (e.documentoRecibidoId !== undefined && codigo === "23505") {
      const existente = await guiaDeDocumento(ctx, e.documentoRecibidoId);
      if (existente !== null) return existente;
    }
    throw error;
  }
}
