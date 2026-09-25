import { readFileSync, writeFileSync } from "node:fs";

/**
 * Lee un archivo `.env` (CLAVE=valor por línea; `#` comenta; comillas opcionales). Propio en vez
 * de `process.loadEnvFile` porque el Node de la app de Android (18) no lo tiene.
 */
export function leerEnv(archivo: string): Record<string, string> {
  let texto: string;
  try {
    texto = readFileSync(archivo, "utf8");
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  for (const linea of texto.split(/\r?\n/)) {
    const m = linea.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2]!.trim();
    const comillas = v.match(/^(["'])(.*)\1$/);
    if (comillas) v = comillas[1] === '"' ? comillas[2]!.replace(/\\(["\\n])/g, (_, c: string) => (c === "n" ? "\n" : c)) : comillas[2]!;
    else v = v.replace(/\s+#.*$/, "");
    out[m[1]!] = v;
  }
  return out;
}

/**
 * Carga el `.env` del directorio de trabajo en `process.env` sin pisar lo que ya venga del
 * entorno. Se llama una sola vez, al arrancar un proceso (scripts y bot); las funciones del núcleo
 * siempre reciben la configuración ya leída.
 */
export function cargarEnv(archivo = ".env"): void {
  for (const [k, v] of Object.entries(leerEnv(archivo))) if (process.env[k] === undefined) process.env[k] = v;
}

/**
 * Cambia claves de un `.env` conservando sus comentarios y el orden; las que no estaban se
 * agregan al final. `null` deja la clave vacía.
 */
export function guardarEnv(archivo: string, cambios: Record<string, string | null>): void {
  let lineas: string[];
  try {
    lineas = readFileSync(archivo, "utf8").split(/\r?\n/);
  } catch {
    lineas = [];
  }
  const pendientes = new Map(Object.entries(cambios));
  const valor = (v: string | null) => {
    const t = (v ?? "").replace(/[\r\n]/g, "");
    return /[\s#"'\\]/.test(t) ? `"${t.replace(/[\\"]/g, (c) => `\\${c}`)}"` : t;
  };
  lineas = lineas.map((l) => {
    const m = l.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!m || !pendientes.has(m[1]!)) return l;
    const v = pendientes.get(m[1]!)!;
    pendientes.delete(m[1]!);
    return `${m[1]}=${valor(v)}`;
  });
  while (lineas.length && lineas[lineas.length - 1] === "") lineas.pop();
  for (const [k, v] of pendientes) lineas.push(`${k}=${valor(v)}`);
  writeFileSync(archivo, lineas.join("\n") + "\n");
}
