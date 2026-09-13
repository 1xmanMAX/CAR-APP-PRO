export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function centimosADecimal(c: number): string {
  const signo = c < 0 ? "-" : "";
  const abs = Math.abs(c);
  return `${signo}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function decimal(valor: string, decimales: number): string {
  const n = Number(valor);
  if (!Number.isFinite(n)) throw new Error(`Número inválido: ${valor}`);
  return n.toFixed(decimales);
}
