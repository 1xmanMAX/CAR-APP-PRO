import { procesarPendientesFacturas, procesarPendientesGuias, type ResultadoEmision } from "@sunatapp/core";
import type { Dependencias } from "./bot";

export type TipoDocumento = "guia" | "factura";

export interface TareaFondo {
  /** Una pasada completa: reintentos de guías y facturas, avisando cada desenlace nuevo. */
  pasada(): Promise<void>;
  /** Arranca el bucle periódico y devuelve la función que lo detiene. */
  iniciar(intervaloMs?: number): () => void;
  /**
   * Espera a que termine la pasada que estuviera corriendo (si no hay ninguna, retorna ya).
   * Detener el bucle solo cancela el temporizador: al apagar hay que esperar esto antes de
   * cerrar la base de datos, o la pasada en vuelo se queda escribiendo sobre una conexión
   * cerrada (un registro a medias y un aviso perdido).
   */
  esperarPasada(): Promise<void>;
}

const INTERVALO_MS = 60_000;

/**
 * El reintento en segundo plano de todo lo que quedó a medias con SUNAT. Dos reglas:
 *
 * - Nunca hay dos pasadas a la vez. Una pasada puede durar más que el intervalo (SUNAT lenta) y
 *   solaparse con la siguiente; el núcleo ya se protege del doble envío con su lease, pero aquí
 *   se corta antes: si hay una en curso, la nueva sale sin hacer nada.
 * - Nada de lo que ocurra dentro tumba el bucle: un fallo del núcleo o un aviso que no llega a
 *   Telegram se anota en el log y la pasada continúa con el resto.
 */
export function crearTareaFondo(
  deps: Dependencias,
  notificar: (tipo: TipoDocumento, r: ResultadoEmision) => Promise<void>,
  /** Tareas adicionales de cada pasada (latido, alertas de flota, cola de avisos de la web). */
  extras: Array<{ nombre: string; tarea: () => Promise<unknown> }> = [],
): TareaFondo {
  let enCurso: Promise<void> | null = null;

  const avisar = async (tipo: TipoDocumento, cambios: ResultadoEmision[]): Promise<void> => {
    for (const r of cambios) {
      try {
        await notificar(tipo, r);
      } catch (error) {
        deps.log.error(`No se pudo enviar el aviso de la ${tipo} ${r.serieNumero}`, error);
      }
    }
  };

  const ejecutar = async (): Promise<void> => {
    try {
      await avisar("guia", await procesarPendientesGuias(deps.ctx));
    } catch (error) {
      deps.log.error("Error al procesar las guías pendientes", error);
    }
    try {
      await avisar("factura", await procesarPendientesFacturas(deps.ctx));
    } catch (error) {
      deps.log.error("Error al procesar las facturas pendientes", error);
    }
    for (const e of extras) {
      try {
        await e.tarea();
      } catch (error) {
        deps.log.error(`Error en la tarea de fondo: ${e.nombre}`, error);
      }
    }
  };

  const pasada = (): Promise<void> => {
    if (enCurso) return Promise.resolve();
    const actual = ejecutar().finally(() => {
      if (enCurso === actual) enCurso = null;
    });
    enCurso = actual;
    return actual;
  };

  return {
    pasada,
    iniciar(intervaloMs = INTERVALO_MS) {
      const temporizador = setInterval(() => void pasada(), intervaloMs);
      return () => clearInterval(temporizador);
    },
    async esperarPasada() {
      await enCurso;
    },
  };
}
