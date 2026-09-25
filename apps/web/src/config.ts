export interface ConfigWeb {
  host: string;
  puerto: number;
  /** URL con la que se entra desde fuera (celular, túnel o dominio); se usa en los enlaces de /web. */
  urlPublica: string | null;
}

export function cargarConfigWeb(env: Record<string, string | undefined> = process.env): ConfigWeb {
  const puerto = Number(env.WEB_PUERTO?.trim() || 3000);
  if (!Number.isInteger(puerto) || puerto <= 0 || puerto > 65535) throw new Error("WEB_PUERTO no es un puerto válido");
  const urlPublica = env.WEB_URL_PUBLICA?.trim() || null;
  if (urlPublica && !/^https?:\/\//.test(urlPublica)) throw new Error("WEB_URL_PUBLICA debe empezar con http:// o https://");
  return { host: env.WEB_HOST?.trim() || "0.0.0.0", puerto, urlPublica: urlPublica?.replace(/\/$/, "") ?? null };
}
