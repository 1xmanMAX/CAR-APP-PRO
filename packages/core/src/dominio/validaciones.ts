export type TipoDocIdentidad = "1" | "6";

const FACTORES_RUC = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

export function validarRuc(ruc: string): boolean {
  if (!/^(10|15|16|17|20)\d{9}$/.test(ruc)) return false;
  const suma = FACTORES_RUC.reduce((acc, f, i) => acc + f * Number(ruc[i]), 0);
  const resto = 11 - (suma % 11);
  const digito = resto === 10 ? 0 : resto === 11 ? 1 : resto;
  return digito === Number(ruc[10]);
}

export function validarDni(dni: string): boolean {
  return /^\d{8}$/.test(dni);
}

export function tipoDocumentoDe(numero: string): TipoDocIdentidad | null {
  if (validarRuc(numero)) return "6";
  if (validarDni(numero)) return "1";
  return null;
}
