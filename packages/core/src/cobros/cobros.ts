import { and, cobro, contraparte, eq, factura, inArray, sql, type EstadoCobro } from "@sunatapp/db";
import { fechaHoraLima } from "../dominio/fechas";
import { parsearSerieNumero } from "../dominio/serie-numero";
import { ErrorNegocio } from "../errores";
import { registrarAuditoria } from "../infra/auditoria";
import type { Contexto } from "../infra/contexto";

export interface FilaCobro {
  facturaId: number;
  serieNumero: string;
  cliente: string;
  fechaVencimiento: string;
  saldo: number;
  estado: "vencida" | "vence_hoy" | "pendiente";
}

const EMITIDAS = ["aceptada", "observada"] as const;

async function cobrado(ctx: Contexto, facturaId: number): Promise<number> {
  const [fila] = await ctx.db.select({ suma: sql<string>`coalesce(sum(${cobro.monto}), 0)` }).from(cobro).where(eq(cobro.facturaId, facturaId));
  return Number(fila?.suma ?? 0);
}

export async function registrarCobro(
  ctx: Contexto,
  e: { facturaId: number; montoCentimos: number; fecha: string; medio: "transferencia" | "efectivo" | "otro"; nota?: string; usuarioId?: number },
): Promise<{ estadoCobro: EstadoCobro; saldo: number }> {
  if (!Number.isInteger(e.montoCentimos) || e.montoCentimos <= 0) throw new ErrorNegocio("El monto cobrado debe ser mayor a cero");
  const [f] = await ctx.db.select().from(factura).where(eq(factura.id, e.facturaId));
  if (!f || !EMITIDAS.includes(f.estadoSunat as (typeof EMITIDAS)[number])) throw new ErrorNegocio("Solo se registran cobros de facturas aceptadas por SUNAT");
  const cobrable = f.total - f.detraccionMonto;
  const saldoAntes = cobrable - (await cobrado(ctx, f.id));
  if (e.montoCentimos > saldoAntes) throw new ErrorNegocio(`El monto supera el saldo pendiente (${saldoAntes / 100})`);
  const saldo = saldoAntes - e.montoCentimos;
  const estadoCobro: EstadoCobro = saldo === 0 ? "pagada" : "parcial";
  await ctx.db.transaction(async (tx) => {
    await tx.insert(cobro).values({ facturaId: f.id, fecha: e.fecha, monto: e.montoCentimos, medio: e.medio, nota: e.nota ?? null, usuarioId: e.usuarioId ?? null });
    await tx.update(factura).set({ estadoCobro, actualizadoEn: ctx.reloj() }).where(eq(factura.id, f.id));
    await registrarAuditoria(tx, { usuarioId: e.usuarioId, accion: "cobro_registrado", entidad: "factura", entidadId: f.id, detalle: { monto: e.montoCentimos } });
  });
  return { estadoCobro, saldo };
}

export async function buscarFacturaPorSerieNumero(ctx: Contexto, texto: string): Promise<{ id: number } | null> {
  const sn = parsearSerieNumero(texto);
  if (!sn) return null;
  const [f] = await ctx.db.select({ id: factura.id }).from(factura).where(and(eq(factura.serie, sn.serie), eq(factura.numero, sn.numero)));
  return f ?? null;
}

export async function listarCobrosPendientes(ctx: Contexto): Promise<{ filas: FilaCobro[]; totalPendiente: number; totalVencido: number }> {
  const hoy = fechaHoraLima(ctx.reloj()).fecha;
  const facturas = await ctx.db
    .select({ f: factura, cliente: contraparte.razonSocial })
    .from(factura)
    .innerJoin(contraparte, eq(factura.clienteId, contraparte.id))
    .where(and(inArray(factura.estadoSunat, [...EMITIDAS]), inArray(factura.estadoCobro, ["pendiente", "parcial"])));
  const filas: FilaCobro[] = [];
  for (const { f, cliente } of facturas) {
    const saldo = f.total - f.detraccionMonto - (await cobrado(ctx, f.id));
    const venc = f.fechaVencimiento!;
    filas.push({
      facturaId: f.id,
      serieNumero: `${f.serie}-${f.numero}`,
      cliente,
      fechaVencimiento: venc,
      saldo,
      estado: venc < hoy ? "vencida" : venc === hoy ? "vence_hoy" : "pendiente",
    });
  }
  filas.sort((a, b) => a.fechaVencimiento.localeCompare(b.fechaVencimiento));
  return {
    filas,
    totalPendiente: filas.reduce((s, f) => s + f.saldo, 0),
    totalVencido: filas.filter((f) => f.estado === "vencida").reduce((s, f) => s + f.saldo, 0),
  };
}
