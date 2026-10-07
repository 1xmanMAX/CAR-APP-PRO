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
const CLAVE_RAROS = "sunat_errores_raros";

/** Errores de SUNAT sin clasificar seguidos (entre documentos) que pausan todo por si son las claves. */
export const LIMITE_RESPUESTAS_RARAS = 3;
export const MOTIVO_RESPUESTAS_RARAS = "SUNAT responde de forma inesperada; revisa tus claves antes de seguir";

export interface PausaSunat {
  desde: string;
  motivo: string;
  /** Pausada porque la configuración pedida (Real/Beta) no se pudo cargar: se quita al cargarla bien. */
  porConfig?: boolean;
}

export const MENSAJE_EN_PAUSA = (motivo: string) =>
  `⏸ SUNAT en pausa: ${motivo}. No se envía nada hasta que revises tus claves en Ajustes → Este dispositivo.`;

export async function leerPausaSunat(ctx: Contexto): Promise<PausaSunat | null> {
  const [f] = await ctx.db.select().from(ajuste).where(eq(ajuste.clave, CLAVE_PAUSA));
  const v = f?.valor as Partial<PausaSunat> | undefined;
  return v?.motivo ? { desde: v.desde ?? "", motivo: v.motivo, ...(v.porConfig ? { porConfig: true } : {}) } : null;
}

/** true si recién se pausó (y se encoló el aviso); false si ya estaba pausada. */
export async function pausarSunat(ctx: Contexto, motivo: string, o: { porConfig?: boolean } = {}): Promise<boolean> {
  if (await leerPausaSunat(ctx)) return false;
  const valor: PausaSunat = { desde: ctx.reloj().toISOString(), motivo, ...(o.porConfig ? { porConfig: true } : {}) };
  await ctx.db.insert(ajuste).values({ clave: CLAVE_PAUSA, valor }).onConflictDoUpdate({ target: ajuste.clave, set: { valor, actualizadoEn: ctx.reloj() } });
  await encolarAviso(ctx, MENSAJE_EN_PAUSA(motivo));
  return true;
}

export async function reanudarSunat(ctx: Contexto): Promise<void> {
  await ctx.db.delete(ajuste).where(eq(ajuste.clave, CLAVE_PAUSA));
  await limpiarRespuestasRarasSunat(ctx);
}

/**
 * Anota un error de SUNAT que no es ni de credenciales ni de servicio caído (p. ej. un Fault sin
 * código o un HTTP 4xx raro). Al tercero seguido, aunque sean documentos distintos, pausa SUNAT:
 * podría ser una clave mala que SUNAT no informa como tal, y reintentar puede bloquear el usuario SOL.
 */
export async function anotarRespuestaRaraSunat(ctx: Contexto): Promise<void> {
  const [f] = await ctx.db.select().from(ajuste).where(eq(ajuste.clave, CLAVE_RAROS));
  const n = ((f?.valor as { n?: number } | undefined)?.n ?? 0) + 1;
  if (n >= LIMITE_RESPUESTAS_RARAS) {
    await limpiarRespuestasRarasSunat(ctx);
    await pausarSunat(ctx, MOTIVO_RESPUESTAS_RARAS);
    return;
  }
  const valor = { n };
  await ctx.db.insert(ajuste).values({ clave: CLAVE_RAROS, valor }).onConflictDoUpdate({ target: ajuste.clave, set: { valor, actualizadoEn: ctx.reloj() } });
}

/** SUNAT respondió algo válido: la cuenta de errores raros vuelve a cero. */
export async function limpiarRespuestasRarasSunat(ctx: Contexto): Promise<void> {
  await ctx.db.delete(ajuste).where(eq(ajuste.clave, CLAVE_RAROS));
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

/**
 * Certificado vencido en modo real: no se firma nada (ni se reserva número) y SUNAT queda en pausa.
 * true si se pausó por eso.
 */
export async function certificadoVencido(ctx: Contexto, real: boolean): Promise<boolean> {
  if (!real) return false;
  const hasta = ctx.certificado.validoHasta;
  if (hasta.getTime() >= ctx.reloj().getTime()) return false;
  await pausarSunat(ctx, `Tu certificado digital venció el ${hasta.toISOString().slice(0, 10)}`);
  return true;
}
