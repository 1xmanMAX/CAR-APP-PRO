export function parsearSerieNumero(texto: string): { serie: string; numero: number } | null {
  const m = texto.trim().toUpperCase().match(/^([A-Z0-9]{4})-(\d{1,8})$/);
  if (!m) return null;
  return { serie: m[1]!, numero: Number(m[2]) };
}
