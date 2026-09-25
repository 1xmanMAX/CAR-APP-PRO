import { formatearSoles, listarCobrosPendientes, repuestosConStockBajo, tomarCuotasPorVencer, type Contexto } from "@sunatapp/core";
import { lineaAviso, textos } from "./textos";

const DIA_MS = 24 * 60 * 60_000;
/** Perú no tiene horario de verano: America/Lima es UTC-5 todo el año. */
const DESFASE_LIMA_MS = 5 * 60 * 60_000;

/**
 * Milisegundos que faltan hasta la próxima vez que en Lima sean las `horaLima` ("HH:MM").
 * Si justo ahora es esa hora, devuelve 24 h: así el temporizador encadenado nunca dispara dos
 * veces el mismo aviso ni entra en un bucle de esperas de 0 ms.
 */
export function msHastaProximoAviso(ahora: Date, horaLima: string): number {
  const [hh, mm] = horaLima.split(":").map(Number);
  const objetivoMs = ((hh ?? 0) * 60 + (mm ?? 0)) * 60_000;
  const msDelDiaEnLima = (((ahora.getTime() - DESFASE_LIMA_MS) % DIA_MS) + DIA_MS) % DIA_MS;
  const falta = objetivoMs - msDelDiaEnLima;
  return falta > 0 ? falta : falta + DIA_MS;
}

/**
 * El aviso de la mañana: solo lo que ya venció y lo que vence hoy. Devuelve null cuando no hay
 * nada urgente — es un aviso automático diario y no debe convertirse en ruido.
 */
export async function textoAvisoDiario(ctx: Contexto): Promise<string | null> {
  const { filas } = await listarCobrosPendientes(ctx);
  const vencidas = filas.filter((f) => f.estado === "vencida");
  const vencenHoy = filas.filter((f) => f.estado === "vence_hoy");
  if (vencidas.length === 0 && vencenHoy.length === 0) return null;

  const lineas = [textos.avisoTitulo];
  if (vencidas.length > 0) lineas.push(textos.avisoVencidas, ...vencidas.map(lineaAviso));
  if (vencenHoy.length > 0) lineas.push(textos.avisoVencenHoy, ...vencenHoy.map(lineaAviso));
  return lineas.join("\n");
}

/**
 * Temporizador encadenado: tras cada envío se vuelve a calcular la espera desde el reloj real,
 * en vez de sumar 24 h fijas — así un `setTimeout` que se retrasa (equipo suspendido, bucle de
 * eventos ocupado) no arrastra el aviso a otra hora día tras día. Devuelve el cancelador.
 */
export function programarAvisoDiario(
  enviar: () => Promise<void>,
  horaLima: string,
  reloj: () => Date = () => new Date(),
): () => void {
  let temporizador: ReturnType<typeof setTimeout> | null = null;
  let cancelado = false;

  const programar = (): void => {
    if (cancelado) return;
    temporizador = setTimeout(() => {
      void enviar()
        .catch(() => {
          // El llamador decide qué hacer con sus errores; aquí lo único importante es que un
          // fallo no rompa la cadena y deje al dueño sin avisos el resto de los días.
        })
        .finally(programar);
    }, msHastaProximoAviso(reloj(), horaLima));
  };

  programar();
  return () => {
    cancelado = true;
    if (temporizador) clearTimeout(temporizador);
  };
}

/** Lo de la flota para el aviso diario: stock bajo y cuotas de préstamo por vencer (3 días). */
export async function textoAvisoFlota(ctx: Contexto): Promise<string | null> {
  const lineas: string[] = [];
  const bajos = await repuestosConStockBajo(ctx);
  if (bajos.length) {
    lineas.push("📦 Stock bajo:", ...bajos.map((r) => `• ${r.codigo} ${r.nombre}: quedan ${r.stock} (mínimo ${r.stockMinimo})`));
  }
  const cuotas = await tomarCuotasPorVencer(ctx, 3);
  if (cuotas.length) {
    lineas.push("🏦 Cuotas por vencer:", ...cuotas.map((q) => `• ${q.entidad} · cuota ${q.numero} · ${formatearSoles(q.monto)} · vence ${q.vencimiento}`));
  }
  return lineas.length ? lineas.join("\n") : null;
}
