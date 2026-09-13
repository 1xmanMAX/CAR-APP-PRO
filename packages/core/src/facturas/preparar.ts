import { contraparte, empresa, eq, facturaGuia, factura, guiaTransportista } from "@sunatapp/db";
import { calcularMontosFactura, type MontosFactura } from "../dominio/montos";
import { ErrorNegocio } from "../errores";
import { registrarAuditoria } from "../infra/auditoria";
import type { Contexto } from "../infra/contexto";

export interface EntradaFactura {
  guiaId: number;
  montoCentimos: number;
  incluyeIgv: boolean;
  clienteId?: number;
  formaPago: "contado" | "credito";
  diasCredito?: number;
}

export async function prepararFactura(ctx: Contexto, e: EntradaFactura, usuarioId?: number): Promise<{ facturaId: number; montos: MontosFactura }> {
  if (e.formaPago === "credito" && !(e.diasCredito && e.diasCredito > 0)) {
    throw new ErrorNegocio("Indica los días de crédito (mayor a cero)");
  }
  return ctx.db.transaction(async (tx) => {
    const [guia] = await tx.select().from(guiaTransportista).where(eq(guiaTransportista.id, e.guiaId));
    if (!guia || guia.estado !== "aceptada") throw new ErrorNegocio("Solo se pueden facturar guías aceptadas por SUNAT");
    const [ya] = await tx.select().from(facturaGuia).where(eq(facturaGuia.guiaId, e.guiaId));
    if (ya) throw new ErrorNegocio(`La guía ${guia.serie}-${guia.numero} ya tiene factura`);
    const [emp] = await tx.select().from(empresa).limit(1);
    if (!emp) throw new ErrorNegocio("Falta configurar la empresa");
    const clienteId = e.clienteId ?? guia.remitenteId;
    const [cliente] = await tx.select().from(contraparte).where(eq(contraparte.id, clienteId));
    if (!cliente) throw new ErrorNegocio("El cliente no existe");
    if (cliente.tipoDoc !== "6") throw new ErrorNegocio("La factura requiere un cliente con RUC");

    const montos = calcularMontosFactura({
      montoCentimos: e.montoCentimos,
      incluyeIgv: e.incluyeIgv,
      detraccion: { porcentaje: emp.detraccionPorcentaje, umbralCentimos: emp.detraccionUmbral },
    });
    if (montos.detraccionMonto > 0 && !emp.cuentaDetraccionBn) {
      throw new ErrorNegocio("Configura la cuenta de detracciones del Banco de la Nación antes de facturar montos mayores a S/ 400");
    }

    const [fila] = await tx
      .insert(factura)
      .values({
        serie: emp.serieFactura,
        clienteId,
        descripcion: `SERVICIO DE TRANSPORTE DE CARGA SEGUN GRE ${guia.serie}-${guia.numero}${guia.greRemitenteRef ? ` (GRE REMITENTE ${guia.greRemitenteRef})` : ""}`,
        subtotal: montos.subtotal,
        igv: montos.igv,
        total: montos.total,
        detraccionPorcentaje: montos.detraccionPorcentaje,
        detraccionMonto: montos.detraccionMonto,
        formaPago: e.formaPago,
        diasCredito: e.formaPago === "credito" ? e.diasCredito! : null,
      })
      .returning({ id: factura.id });
    await tx.insert(facturaGuia).values({ facturaId: fila!.id, guiaId: e.guiaId });
    await registrarAuditoria(tx, { usuarioId, accion: "factura_preparada", entidad: "factura", entidadId: fila!.id });
    return { facturaId: fila!.id, montos };
  });
}
