import type { DatosGreTransportista } from "../src/ubl/gre-transportista";

export function datosGrePrueba(): DatosGreTransportista {
  return {
    emisor: { ruc: "20606433094", razonSocial: "TRANSPORTES DEMO SAC", registroMtc: "15123456CNG" },
    serie: "V001",
    numero: 1,
    fechaEmision: "2026-09-13",
    horaEmision: "10:15:00",
    fechaTraslado: "2026-09-14",
    remitente: { tipoDoc: "6", numeroDoc: "20131312955", razonSocial: "DISTRIBUIDORA & CIA S.A.C." },
    destinatario: { tipoDoc: "6", numeroDoc: "20602712592", razonSocial: "CHOCANO CARGO S.A.C." },
    partida: { ubigeo: "150115", direccion: "AV. 28 DE JULIO 1275, LA VICTORIA" },
    llegada: { ubigeo: "250101", direccion: "CARRETERA FEDERICO BASADRE KM 86" },
    pesoBruto: "1500.5",
    unidadPeso: "KGM",
    vehiculo: { placa: "abc-123" },
    conductor: { tipoDoc: "1", numeroDoc: "45288569", nombres: "JHON LARRY", apellidos: "VELEZMORO SOZA", licencia: "Q45288569" },
    documentosRelacionados: [{ tipo: "09", serieNumero: "EG01-123", rucEmisor: "20131312955" }],
    items: [
      { descripcion: "CAJAS DE CERÁMICA", cantidad: "120", unidadMedida: "BX" },
      { descripcion: "BOLSAS DE CEMENTO", cantidad: "40", unidadMedida: "NIU" },
    ],
  };
}
