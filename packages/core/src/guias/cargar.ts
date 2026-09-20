import { conductor, contraparte, empresa, eq, guiaItem, guiaTransportista, vehiculo, type Ejecutor } from "@sunatapp/db";
import type { PdfGuia } from "@sunatapp/pdf";
import type { DatosGreTransportista, TipoDocIdentidadSunat } from "@sunatapp/sunat";
import { obtenerUbigeo } from "../dominio/ubigeos";
import { ErrorNegocio } from "../errores";

export async function cargarGuiaCompleta(db: Ejecutor, guiaId: number) {
  const [guia] = await db.select().from(guiaTransportista).where(eq(guiaTransportista.id, guiaId));
  if (!guia) throw new ErrorNegocio(`La guía ${guiaId} no existe`);
  const [emp] = await db.select().from(empresa).limit(1);
  const [remitente] = await db.select().from(contraparte).where(eq(contraparte.id, guia.remitenteId));
  const [destinatario] = await db.select().from(contraparte).where(eq(contraparte.id, guia.destinatarioId));
  const [veh] = await db.select().from(vehiculo).where(eq(vehiculo.id, guia.vehiculoId));
  const [vehSec] = guia.vehiculoSecundarioId
    ? await db.select().from(vehiculo).where(eq(vehiculo.id, guia.vehiculoSecundarioId))
    : [];
  const [cond] = await db.select().from(conductor).where(eq(conductor.id, guia.conductorId));
  const items = await db.select().from(guiaItem).where(eq(guiaItem.guiaId, guiaId)).orderBy(guiaItem.id);
  if (!emp || !remitente || !destinatario || !veh || !cond) throw new ErrorNegocio(`Datos incompletos para la guía ${guiaId}`);
  return { guia, empresa: emp, remitente, destinatario, vehiculo: veh, vehiculoSecundario: vehSec ?? null, conductor: cond, items };
}

export type GuiaCompleta = Awaited<ReturnType<typeof cargarGuiaCompleta>>;

export function datosGreDesde(d: GuiaCompleta): DatosGreTransportista {
  const parte = (c: GuiaCompleta["remitente"]) => ({ tipoDoc: c.tipoDoc as TipoDocIdentidadSunat, numeroDoc: c.numeroDoc, razonSocial: c.razonSocial });
  return {
    emisor: { ruc: d.empresa.ruc, razonSocial: d.empresa.razonSocial, registroMtc: d.empresa.registroMtc },
    serie: d.guia.serie,
    numero: d.guia.numero!,
    fechaEmision: d.guia.fechaEmision!,
    horaEmision: d.guia.horaEmision!,
    fechaTraslado: d.guia.fechaTraslado,
    remitente: parte(d.remitente),
    destinatario: parte(d.destinatario),
    partida: { ubigeo: d.guia.partidaUbigeo, direccion: d.guia.partidaDireccion },
    llegada: { ubigeo: d.guia.llegadaUbigeo, direccion: d.guia.llegadaDireccion },
    pesoBruto: d.guia.pesoBruto,
    unidadPeso: d.guia.unidadPeso as "KGM" | "TNE",
    vehiculo: { placa: d.vehiculo.placa, placasSecundarias: d.vehiculoSecundario ? [d.vehiculoSecundario.placa] : [] },
    conductor: { tipoDoc: d.conductor.tipoDoc as TipoDocIdentidadSunat, numeroDoc: d.conductor.numeroDoc, nombres: d.conductor.nombres, apellidos: d.conductor.apellidos, licencia: d.conductor.licencia },
    documentosRelacionados: d.guia.greRemitenteRef ? [{ tipo: "09", serieNumero: d.guia.greRemitenteRef, rucEmisor: d.remitente.numeroDoc }] : [],
    items: d.items.map((it) => ({ descripcion: it.descripcion, cantidad: it.cantidad, unidadMedida: it.unidadMedida })),
  };
}

function lugar(direccion: string, ubigeo: string): string {
  const u = obtenerUbigeo(ubigeo);
  return u ? `${direccion} - ${u.departamento} / ${u.provincia} / ${u.distrito}` : direccion;
}

export function datosPdfGuiaDesde(d: GuiaCompleta, textoQr: string, simulado: boolean): PdfGuia {
  return {
    emisor: { ruc: d.empresa.ruc, razonSocial: d.empresa.razonSocial, direccion: d.empresa.direccion, registroMtc: d.empresa.registroMtc },
    serieNumero: `${d.guia.serie}-${d.guia.numero}`,
    fechaEmision: d.guia.fechaEmision!,
    fechaTraslado: d.guia.fechaTraslado,
    remitente: { numeroDoc: d.remitente.numeroDoc, razonSocial: d.remitente.razonSocial },
    destinatario: { numeroDoc: d.destinatario.numeroDoc, razonSocial: d.destinatario.razonSocial },
    partida: lugar(d.guia.partidaDireccion, d.guia.partidaUbigeo),
    llegada: lugar(d.guia.llegadaDireccion, d.guia.llegadaUbigeo),
    placas: [d.vehiculo.placa, ...(d.vehiculoSecundario ? [d.vehiculoSecundario.placa] : [])],
    conductor: { nombre: `${d.conductor.nombres} ${d.conductor.apellidos}`, numeroDoc: d.conductor.numeroDoc, licencia: d.conductor.licencia },
    pesoBruto: Number(d.guia.pesoBruto).toFixed(3),
    unidadPeso: d.guia.unidadPeso,
    documentosRelacionados: d.guia.greRemitenteRef ? [`GRE Remitente ${d.guia.greRemitenteRef}`] : [],
    items: d.items.map((it) => ({ descripcion: it.descripcion, cantidad: String(Number(it.cantidad)), unidadMedida: it.unidadMedida })),
    textoQr,
    simulado,
  };
}
