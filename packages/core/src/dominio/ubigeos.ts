import datos from "./ubigeos.json";

export interface Ubigeo {
  codigo: string;
  departamento: string;
  provincia: string;
  distrito: string;
}

const catalogo: Ubigeo[] = (datos as string[][]).map(([codigo, departamento, provincia, distrito]) => ({
  codigo: codigo!,
  departamento: departamento!,
  provincia: provincia!,
  distrito: distrito!,
}));
const porCodigo = new Map(catalogo.map((u) => [u.codigo, u]));

function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase().trim();
}

export function obtenerUbigeo(codigo: string): Ubigeo | undefined {
  return porCodigo.get(codigo);
}

export function existeUbigeo(codigo: string): boolean {
  return porCodigo.has(codigo);
}

export function buscarUbigeos(texto: string, limite = 10): Ubigeo[] {
  const buscado = normalizar(texto);
  if (!buscado) return [];
  return catalogo.filter((u) => normalizar(u.distrito).includes(buscado)).slice(0, limite);
}
