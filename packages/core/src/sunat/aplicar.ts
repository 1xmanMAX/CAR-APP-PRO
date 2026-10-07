import { and, eq, factura, guiaTransportista, isNull, lt, notInArray, or, sql } from "@sunatapp/db";
import { CODIGOS_VERIFICAR } from "../facturas/emitir";
import { MAX_INTENTOS } from "../guias/emitir";
import { cargarConfig, type Config } from "../infra/config";
import { reconfigurarSunat, type Contexto } from "../infra/contexto";
import { pausarSunat } from "./pausa";

/**
 * Aplica la conexión con SUNAT que pide el `.env` [env]. Si la pedida (Real o Beta) no se puede
 * usar (falta un dato, el certificado no abre...), la app queda en simulado para que la web siga
 * andando, pero **SUNAT en pausa**: así los documentos pendientes de envío nunca los "acepta" el
 * simulador. La pausa se quita sola cuando la configuración pedida vuelve a cargar.
 */
export async function aplicarConfigSunat(
  ctx: Contexto, env: Record<string, string | undefined> = process.env,
): Promise<{ modo: Config["sunatModo"]; error?: string }> {
  let pedida: Config;
  try {
    pedida = cargarConfig(env);
  } catch (e) {
    const error = (e as Error).message;
    await reconfigurarSunat(ctx, cargarConfig({ ...env, SUNAT_MODO: "simulado" }), { conservarPausa: true });
    const modo = env.SUNAT_MODO?.trim();
    if (modo !== "real" && modo !== "beta") return { modo: "simulado", error };
    return { modo: "simulado", error: await pausarPorConfig(ctx, modo, error) };
  }
  if (pedida.sunatModo === "simulado") {
    await reconfigurarSunat(ctx, pedida);
    return { modo: "simulado" };
  }
  try {
    await reconfigurarSunat(ctx, pedida);
    return { modo: pedida.sunatModo };
  } catch (e) {
    await reconfigurarSunat(ctx, { ...pedida, sunatModo: "simulado" }, { conservarPausa: true });
    return { modo: "simulado", error: await pausarPorConfig(ctx, pedida.sunatModo, (e as Error).message) };
  }
}

async function pausarPorConfig(ctx: Contexto, modo: string, error: string): Promise<string> {
  const motivo = `No se pudo usar SUNAT ${modo}: ${error}`;
  // Si ya estaba en pausa (por esto mismo o por las claves), se deja así: el aviso sale una sola vez.
  await pausarSunat(ctx, motivo, { porConfig: true });
  return `${motivo}. Mientras tanto, modo simulado y SUNAT en pausa (no se envía nada).`;
}

/**
 * Guías y facturas que todavía están en camino a SUNAT (pendientes de envío o esperando respuesta).
 * No cuentan las atascadas que esperan al dueño (ver sunat/atascados): la factura "verifícala en
 * SOL" (1032/1033) y la guía enviada que ya no se consulta sola; si no, bloquearían el cambio de modo para siempre.
 */
export async function contarDocumentosEnCurso(ctx: Contexto): Promise<number> {
  const [g] = await ctx.db.select({ n: sql<number>`count(*)` }).from(guiaTransportista).where(or(
    eq(guiaTransportista.estado, "pendiente_envio"),
    and(eq(guiaTransportista.estado, "enviada"), lt(guiaTransportista.intentos, MAX_INTENTOS)),
  ));
  // Las facturas no tienen estado "enviada": SUNAT contesta en el mismo envío.
  const [f] = await ctx.db.select({ n: sql<number>`count(*)` }).from(factura).where(and(
    eq(factura.estadoSunat, "pendiente_envio"),
    or(isNull(factura.codigoRespuesta), notInArray(factura.codigoRespuesta, CODIGOS_VERIFICAR)),
  ));
  return Number(g?.n ?? 0) + Number(f?.n ?? 0);
}
