import type { App, C } from "./base";

/** `destino` más los parámetros de `query` que se piden conservar (los vacíos no se pasan). */
export function conParametros(destino: string, query: Record<string, string>, conservar: string[]): string {
  const u = new URL(destino, "http://x");
  for (const k of conservar) if (query[k]) u.searchParams.set(k, query[k]!);
  return u.pathname + u.search;
}

/** Ruta vieja → lugar nuevo con 302, conservando los parámetros útiles (`?pieza=`, `?repuesto=`, …). */
export function redirigir(app: App, desde: string, hacia: (c: C) => string, conservar: string[] = []): void {
  app.get(desde, (c) => c.redirect(conParametros(hacia(c as C), c.req.query(), conservar), 302));
}
