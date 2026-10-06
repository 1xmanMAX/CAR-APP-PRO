import { ajuste, eq } from "@sunatapp/db";
import { encolarAviso } from "../eventos/eventos";
import type { Contexto } from "../infra/contexto";

/**
 * **SUNAT en pausa.** Si SUNAT rechaza el usuario/clave SOL o las credenciales de guías, se deja de
 * enviar TODO hasta que el dueño corrija los ajustes: reintentar con una clave mala puede bloquear
 * el usuario SOL. Es un ajuste local (no se sincroniza): las claves son de cada dispositivo.
 */
const CLAVE_PAUSA = "sunat_pausa";
const CLAVE_PRIMERA = "sunat_primera_real";

export interface PausaSunat {
  desde: string;
  motivo: string;
}

export const MENSAJE_EN_PAUSA = (motivo: string) =>
  `⏸ SUNAT en pausa: ${motivo}. No se envía nada hasta que revises tus claves en Ajustes → Este dispositivo.`;

export async function leerPausaSunat(ctx: Contexto): Promise<PausaSunat | null> {
  const [f] = await ctx.db.select().from(ajuste).where(eq(ajuste.clave, CLAVE_PAUSA));
  const v = f?.valor as Partial<PausaSunat> | undefined;
  return v?.motivo ? { desde: v.desde ?? "", motivo: v.motivo } : null;
}

/** true si recién se pausó (y se encoló el aviso); false si ya estaba pausada. */
export async function pausarSunat(ctx: Contexto, motivo: string): Promise<boolean> {
  if (await leerPausaSunat(ctx)) return false;
  const valor: PausaSunat = { desde: ctx.reloj().toISOString(), motivo };
  await ctx.db.insert(ajuste).values({ clave: CLAVE_PAUSA, valor }).onConflictDoUpdate({ target: ajuste.clave, set: { valor, actualizadoEn: ctx.reloj() } });
  await encolarAviso(ctx, MENSAJE_EN_PAUSA(motivo));
  return true;
}

export async function reanudarSunat(ctx: Contexto): Promise<void> {
  await ctx.db.delete(ajuste).where(eq(ajuste.clave, CLAVE_PAUSA));
}

async function primera(ctx: Contexto): Promise<{ guia?: boolean; factura?: boolean }> {
  const [f] = await ctx.db.select().from(ajuste).where(eq(ajuste.clave, CLAVE_PRIMERA));
  return (f?.valor as { guia?: boolean; factura?: boolean } | undefined) ?? {};
}

/** true si este dispositivo está en modo real y todavía no tuvo aceptado un documento de ese tipo. */
export async function esPrimeraReal(ctx: Contexto, tipo: "guia" | "factura"): Promise<boolean> {
  const real = tipo === "guia" ? !ctx.simulado : !ctx.facturaSimulada;
  if (!real) return false;
  return !(await primera(ctx))[tipo];
}

export async function marcarPrimeraRealHecha(ctx: Contexto, tipo: "guia" | "factura"): Promise<void> {
  const valor = { ...(await primera(ctx)), [tipo]: true };
  await ctx.db.insert(ajuste).values({ clave: CLAVE_PRIMERA, valor }).onConflictDoUpdate({ target: ajuste.clave, set: { valor, actualizadoEn: ctx.reloj() } });
}
