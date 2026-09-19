import { normalizarPlaca } from "@sunatapp/sunat";
import { existeUbigeo } from "../dominio/ubigeos";
import { tipoDocumentoDe, validarDni, validarRuc } from "../dominio/validaciones";
import type { TransporteGuia } from "../transporte/transporte";

export interface EntradaGuia {
  fechaTraslado: string;
  remitente: { numeroDoc: string; razonSocial: string };
  destinatario: { numeroDoc: string; razonSocial: string };
  partida: { direccion: string; ubigeo: string };
  llegada: { direccion: string; ubigeo: string };
  pesoBruto: string;
  unidadPeso: "KGM" | "TNE";
  greRemitenteRef: string | null;
  items: Array<{ descripcion: string; cantidad: string; unidadMedida: string }>;
  documentoRecibidoId?: number;
  transporte?: TransporteGuia;
}

export function validarEntradaGuia(e: EntradaGuia): string[] {
  const errores: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.fechaTraslado) || Number.isNaN(Date.parse(e.fechaTraslado))) {
    errores.push("Fecha de traslado inválida (use AAAA-MM-DD)");
  }
  for (const [nombre, parte] of [["remitente", e.remitente], ["destinatario", e.destinatario]] as const) {
    if (!tipoDocumentoDe(parte.numeroDoc)) errores.push(`RUC/DNI del ${nombre} inválido`);
    if (!parte.razonSocial.trim()) errores.push(`Falta la razón social del ${nombre}`);
  }
  for (const [nombre, dir] of [["partida", e.partida], ["llegada", e.llegada]] as const) {
    if (!dir.direccion.trim()) errores.push(`Falta la dirección de ${nombre}`);
    if (!existeUbigeo(dir.ubigeo)) errores.push(`Ubigeo de ${nombre} no existe`);
  }
  if (!(Number(e.pesoBruto) > 0)) errores.push("El peso bruto debe ser mayor a cero");
  if (e.items.length === 0) errores.push("Debe haber al menos un bien");
  e.items.forEach((it, i) => {
    if (!it.descripcion.trim()) errores.push(`El bien ${i + 1} no tiene descripción`);
    if (!(Number(it.cantidad) > 0)) errores.push(`La cantidad del bien ${i + 1} debe ser mayor a cero`);
  });
  if (e.transporte) {
    const t = e.transporte;
    if (!validarRuc(t.rucTransportista)) errores.push("RUC del transportista inválido");
    if (normalizarPlaca(t.placaPrincipal).length < 5) errores.push("Placa inválida");
    if (!validarDni(t.conductor.numeroDoc)) errores.push("DNI del conductor inválido");
    if (!t.conductor.licencia.trim()) errores.push("Falta la licencia del conductor");
    if (!t.conductor.nombres.trim() || !t.conductor.apellidos.trim()) errores.push("Faltan los nombres del conductor");
  }
  return errores;
}
