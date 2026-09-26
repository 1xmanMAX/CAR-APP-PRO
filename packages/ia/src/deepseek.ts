import type { ConfigIa } from "./config";
import { instruccionesSistema } from "./prompts";
import { esquemaLectura, IaCredencialesError, IaNoDisponibleError, type EntradaLectura, type Lectura, type ProveedorIA, type UsoIa } from "./tipos";

const MAX_IMAGEN = 20 * 1024 * 1024;

interface Respuesta {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number; prompt_cache_miss_tokens?: number };
}

/** US$ por millón de tokens → micro-dólares totales (entero). */
export function costoMicroUsd(c: ConfigIa, entrada: number, cache: number, salida: number): number {
  return Math.round(entrada * c.precioEntradaUsdMillon + cache * c.precioCacheUsdMillon + salida * c.precioSalidaUsdMillon);
}

/**
 * **DeepSeek** (API compatible con OpenAI) con respuesta en json y fotos en línea. Sin SDK: `fetch`
 * de Node. La clave nunca aparece en un mensaje de error ni en el log.
 */
export function crearProveedorDeepSeek(config: ConfigIa): ProveedorIA {
  const llamar = async (mensajes: unknown[]): Promise<Respuesta> => {
    let r: Response;
    try {
      r = await fetch(`${config.urlBase}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({ model: config.modelo, response_format: { type: "json_object" }, max_tokens: 1000, messages: mensajes }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      throw new IaNoDisponibleError("No hay conexión con DeepSeek");
    }
    if (r.status === 401 || r.status === 403) throw new IaCredencialesError(`DeepSeek rechazó la clave (${r.status}). Revisa DEEPSEEK_API_KEY.`);
    if (r.status === 402) throw new IaCredencialesError("La cuenta de DeepSeek no tiene saldo.");
    if (r.status === 429 || r.status >= 500) throw new IaNoDisponibleError(`DeepSeek no está disponible ahora (${r.status})`);
    if (!r.ok) throw new IaNoDisponibleError(`DeepSeek respondió ${r.status}`);
    return (await r.json()) as Respuesta;
  };

  return {
    nombre: "deepseek",
    leeImagenes: true,
    async leer(e: EntradaLectura) {
      for (const i of e.imagenes ?? []) if (i.contenido.length > MAX_IMAGEN) throw new Error("La imagen supera el tamaño admitido");
      const mensajes: unknown[] = [
        { role: "system", content: instruccionesSistema(e.contexto) },
        {
          role: "user",
          content: [
            { type: "text", text: e.texto?.trim() ? e.texto : "Lee esta imagen." },
            ...(e.imagenes ?? []).map((i) => ({ type: "image_url", image_url: { url: `data:${i.mime};base64,${i.contenido.toString("base64")}` } })),
          ],
        },
      ];
      const uso: UsoIa = { proveedor: "deepseek", modelo: config.modelo, tokensEntrada: 0, tokensCache: 0, tokensSalida: 0, costoMicroUsd: 0 };
      let lectura: Lectura | null = null;
      // Un reintento si la respuesta no es un json válido: se le cita el error.
      for (let intento = 0; intento < 2 && !lectura; intento++) {
        const r = await llamar(mensajes);
        const u = r.usage ?? {};
        uso.tokensEntrada += u.prompt_cache_miss_tokens ?? u.prompt_tokens ?? 0;
        uso.tokensCache += u.prompt_cache_hit_tokens ?? 0;
        uso.tokensSalida += u.completion_tokens ?? 0;
        const contenido = r.choices?.[0]?.message?.content?.trim();
        if (!contenido) throw new IaNoDisponibleError("DeepSeek devolvió una respuesta vacía");
        let motivo: string;
        try {
          const v = esquemaLectura.safeParse(JSON.parse(contenido));
          if (v.success) lectura = v.data;
          motivo = v.success ? "" : v.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        } catch {
          motivo = "no es un json válido";
        }
        if (!lectura) mensajes.push({ role: "assistant", content: contenido }, { role: "user", content: `Tu respuesta no cumple el formato (${motivo}). Responde de nuevo solo con el json.` });
      }
      uso.costoMicroUsd = costoMicroUsd(config, uso.tokensEntrada, uso.tokensCache, uso.tokensSalida);
      return { lectura: lectura ?? { tipo: "no_entendi", motivo: "No pude leer la respuesta del lector" }, uso };
    },
  };
}
