const UNIDADES = ["", "UNO", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE"];
const DIEZ_A_VEINTINUEVE = [
  "DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISEIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE",
  "VEINTE", "VEINTIUNO", "VEINTIDOS", "VEINTITRES", "VEINTICUATRO", "VEINTICINCO", "VEINTISEIS", "VEINTISIETE", "VEINTIOCHO", "VEINTINUEVE",
];
const DECENAS = ["", "", "", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
const CENTENAS = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];

function decenas(n: number): string {
  if (n < 10) return UNIDADES[n]!;
  if (n < 30) return DIEZ_A_VEINTINUEVE[n - 10]!;
  const u = n % 10;
  return DECENAS[Math.floor(n / 10)]! + (u ? ` Y ${UNIDADES[u]}` : "");
}

function menorMil(n: number): string {
  if (n === 100) return "CIEN";
  const c = Math.floor(n / 100);
  const r = n % 100;
  return [c ? CENTENAS[c] : "", r ? decenas(r) : ""].filter(Boolean).join(" ");
}

const apocope = (s: string) => s.replace(/UNO$/, "UN");

function enteroALetras(n: number): string {
  if (n === 0) return "CERO";
  const millones = Math.floor(n / 1_000_000);
  const miles = Math.floor(n / 1000) % 1000;
  const resto = n % 1000;
  const partes: string[] = [];
  if (millones) partes.push(millones === 1 ? "UN MILLON" : `${apocope(menorMil(millones))} MILLONES`);
  if (miles) partes.push(miles === 1 ? "MIL" : `${apocope(menorMil(miles))} MIL`);
  if (resto) partes.push(menorMil(resto));
  return partes.join(" ");
}

export function montoEnLetras(centimos: number): string {
  const soles = Math.floor(centimos / 100);
  const cent = String(centimos % 100).padStart(2, "0");
  return `SON: ${enteroALetras(soles)} CON ${cent}/100 SOLES`;
}
