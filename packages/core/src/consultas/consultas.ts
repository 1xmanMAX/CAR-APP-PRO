import { and, contraparte, desc, empresa, eq, factura, facturaGuia, guiaTransportista, inArray, isNull, type EstadoGuia } from "@sunatapp/db";
import { parsearSerieNumero } from "../dominio/serie-numero";
import type { Contexto } from "../infra/contexto";

export interface FilaGuia {
  id: number;
  serieNumero: string;
  estado: EstadoGuia;
  fechaTraslado: string;
  remitente: string;
  destinatario: string;
  facturada: boolean;
}

type FilaGuiaDb = typeof guiaTransportista.$inferSelect;

async function nombreContraparte(ctx: Contexto, id: number): Promise<string> {
  const [c] = await ctx.db.select({ razonSocial: contraparte.razonSocial }).from(contraparte).where(eq(contraparte.id, id));
  return c?.razonSocial ?? "";
}

async function idsFacturadas(ctx: Contexto, guiaIds: number[]): Promise<Set<number>> {
  if (guiaIds.length === 0) return new Set();
  const filas = await ctx.db.select({ guiaId: facturaGuia.guiaId }).from(facturaGuia).where(inArray(facturaGuia.guiaId, guiaIds));
  return new Set(filas.map((f) => f.guiaId));
}

async function filasDesde(ctx: Contexto, guias: FilaGuiaDb[]): Promise<FilaGuia[]> {
  const facturadas = await idsFacturadas(ctx, guias.map((g) => g.id));
  const filas: FilaGuia[] = [];
  for (const g of guias) {
    filas.push({
      id: g.id,
      serieNumero: g.numero ? `${g.serie}-${g.numero}` : `${g.serie}-(sin número)`,
      estado: g.estado,
      fechaTraslado: g.fechaTraslado,
      remitente: await nombreContraparte(ctx, g.remitenteId),
      destinatario: await nombreContraparte(ctx, g.destinatarioId),
      facturada: facturadas.has(g.id),
    });
  }
  return filas;
}

export async function listarGuias(ctx: Contexto, limite = 10): Promise<FilaGuia[]> {
  const guias = await ctx.db.select().from(guiaTransportista).orderBy(desc(guiaTransportista.id)).limit(limite);
  return filasDesde(ctx, guias);
}

export async function listarBorradores(ctx: Contexto): Promise<FilaGuia[]> {
  const guias = await ctx.db
    .select()
    .from(guiaTransportista)
    .where(inArray(guiaTransportista.estado, ["borrador", "rechazada"]))
    .orderBy(desc(guiaTransportista.id));
  return filasDesde(ctx, guias);
}

export async function listarGuiasSinFacturar(ctx: Contexto): Promise<FilaGuia[]> {
  const guias = await ctx.db
    .select({ g: guiaTransportista })
    .from(guiaTransportista)
    .leftJoin(facturaGuia, eq(facturaGuia.guiaId, guiaTransportista.id))
    .where(and(eq(guiaTransportista.estado, "aceptada"), isNull(facturaGuia.guiaId)))
    .orderBy(desc(guiaTransportista.id));
  return filasDesde(ctx, guias.map((r) => r.g));
}

export async function buscarGuiaPorSerieNumero(ctx: Contexto, texto: string): Promise<{ id: number } | null> {
  const sn = parsearSerieNumero(texto);
  if (!sn) return null;
  const [g] = await ctx.db
    .select({ id: guiaTransportista.id })
    .from(guiaTransportista)
    .where(and(eq(guiaTransportista.serie, sn.serie), eq(guiaTransportista.numero, sn.numero)));
  return g ?? null;
}

/** `tipoDoc` viene en el resultado porque una factura solo admite clientes con RUC (tipoDoc "6"). */
export async function buscarContrapartePorDoc(
  ctx: Contexto,
  numeroDoc: string,
): Promise<{ id: number; razonSocial: string; numeroDoc: string; tipoDoc: string } | null> {
  const [c] = await ctx.db
    .select({ id: contraparte.id, razonSocial: contraparte.razonSocial, numeroDoc: contraparte.numeroDoc, tipoDoc: contraparte.tipoDoc })
    .from(contraparte)
    .where(eq(contraparte.numeroDoc, numeroDoc));
  return c ?? null;
}

export async function obtenerEmpresa(ctx: Contexto) {
  const [emp] = await ctx.db.select().from(empresa).limit(1);
  return emp ?? null;
}

/** Rutas en el almacén de los archivos de una guía o factura (para descargarlos). */
export async function archivosDocumento(ctx: Contexto, tipo: "guia" | "factura", id: number): Promise<{ pdf: string | null; xml: string | null; cdr: string | null } | null> {
  if (tipo === "guia") {
    const [g] = await ctx.db.select({ pdf: guiaTransportista.rutaPdf, xml: guiaTransportista.rutaXml, cdr: guiaTransportista.rutaCdr }).from(guiaTransportista).where(eq(guiaTransportista.id, id));
    return g ?? null;
  }
  const [f] = await ctx.db.select({ pdf: factura.rutaPdf, xml: factura.rutaXml, cdr: factura.rutaCdr }).from(factura).where(eq(factura.id, id));
  return f ?? null;
}
