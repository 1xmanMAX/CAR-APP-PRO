/** Ajustes de la IA del dispositivo (su `.env`; se cambian en Ajustes → Este dispositivo). */
export interface ConfigIa {
  proveedor: "reglas" | "deepseek";
  apiKey?: string;
  modelo: string;
  urlBase: string;
  /** Precios en US$ por millón de tokens, para anotar el costo de cada lectura. */
  precioEntradaUsdMillon: number;
  precioCacheUsdMillon: number;
  precioSalidaUsdMillon: number;
  whisperBin?: string;
  whisperModelo?: string;
  ffmpegBin: string;
}

export class ErrorConfigIa extends Error {}

const numero = (v: string | undefined, porDefecto: number) => {
  const n = Number(v?.trim());
  return v?.trim() && Number.isFinite(n) && n >= 0 ? n : porDefecto;
};

export function cargarConfigIa(env: Record<string, string | undefined> = process.env): ConfigIa {
  const pedido = (env.IA_PROVEEDOR?.trim().toLowerCase() || (env.DEEPSEEK_API_KEY?.trim() ? "deepseek" : "reglas"));
  if (pedido !== "reglas" && pedido !== "deepseek") throw new ErrorConfigIa(`IA_PROVEEDOR no válido: «${pedido}» (usa reglas o deepseek)`);
  const apiKey = env.DEEPSEEK_API_KEY?.trim() || undefined;
  if (pedido === "deepseek" && !apiKey) throw new ErrorConfigIa("Falta DEEPSEEK_API_KEY para leer boletas con DeepSeek");
  return {
    proveedor: pedido, apiKey, modelo: env.IA_MODELO?.trim() || "deepseek-flash", urlBase: (env.IA_URL?.trim() || "https://api.deepseek.com").replace(/\/$/, ""),
    precioEntradaUsdMillon: numero(env.IA_PRECIO_ENTRADA, 0.3), precioCacheUsdMillon: numero(env.IA_PRECIO_CACHE, 0.006), precioSalidaUsdMillon: numero(env.IA_PRECIO_SALIDA, 1.2),
    whisperBin: env.WHISPER_BIN?.trim() || undefined, whisperModelo: env.WHISPER_MODELO?.trim() || undefined, ffmpegBin: env.FFMPEG_BIN?.trim() || "ffmpeg",
  };
}
