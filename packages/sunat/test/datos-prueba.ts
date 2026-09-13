import type { DatosGreTransportista } from "../src/ubl/gre-transportista";
import type { DatosFactura } from "../src/ubl/factura";

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

export function datosFacturaPrueba(): DatosFactura {
  return {
    emisor: { ruc: "20606433094", razonSocial: "TRANSPORTES DEMO SAC", ubigeo: "150115", direccion: "AV. DEMO 123", cuentaDetraccion: "00-045-091619" },
    serie: "F001",
    numero: 1,
    fechaEmision: "2026-09-13",
    horaEmision: "11:00:00",
    cliente: { tipoDoc: "6", numeroDoc: "20131312955", razonSocial: "DISTRIBUIDORA & CIA S.A.C.", direccion: "AV. LIMA 456" },
    descripcion: "SERVICIO DE TRANSPORTE DE CARGA SEGUN GRE V001-1",
    montos: { subtotal: 100000, igv: 18000, total: 118000, detraccionPorcentaje: 4, detraccionMonto: 4700 },
    formaPago: { tipo: "contado" },
    guiasRelacionadas: ["V001-1"],
  };
}
