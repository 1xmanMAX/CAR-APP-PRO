import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crearDb } from "@sunatapp/db";
import { cargarPfx, generarCertificadoPrueba, SunatSimulado, type Certificado, type SunatGateway } from "@sunatapp/sunat";
import { crearAlmacenLocal } from "../src/infra/almacen";
import type { Contexto } from "../src/infra/contexto";
import { sembrarDatosIniciales, type DatosIniciales } from "../src/infra/sembrar";
import type { EntradaGuia } from "../src/guias/validar";

/** Reexportado para que apps/bot pueda simular SUNAT sin depender de @sunatapp/sunat. */
export { SunatSimulado } from "@sunatapp/sunat";

let certificado: Certificado | undefined;

export const DATOS_INICIALES: DatosIniciales = {
  empresa: {
    ruc: "20606433094", razonSocial: "TRANSPORTES DEMO SAC", direccion: "AV. DEMO 123", ubigeo: "150115",
    registroMtc: "15123456CNG", cuentaDetraccionBn: "00-045-091619",
  },
  vehiculo: { placa: "ABC-123", marca: "VOLVO" },
  conductor: { numeroDoc: "45288569", nombres: "JHON LARRY", apellidos: "VELEZMORO SOZA", licencia: "Q45288569" },
  usuario: { nombre: "Dueño", email: "dueno@demo.pe", telegramId: 111 },
};

export async function crearContextoPrueba(
  o: { gateway?: SunatGateway; reloj?: () => Date; facturaSimulada?: boolean; datos?: DatosIniciales } = {},
) {
  certificado ??= cargarPfx(generarCertificadoPrueba({ ruc: "20606433094", razonSocial: "TRANSPORTES DEMO SAC", password: "x" }), "x");
  const { db, cerrar } = await crearDb({ tipo: "pglite" });
  await sembrarDatosIniciales(db, o.datos ?? DATOS_INICIALES);
  const ctx: Contexto = {
    db,
    gateway: o.gateway ?? new SunatSimulado({ demoraMs: 0 }),
    certificado,
    almacen: crearAlmacenLocal(mkdtempSync(join(tmpdir(), "sunatapp-"))),
    reloj: o.reloj ?? (() => new Date("2026-09-13T15:00:00Z")),
    dormir: async () => {},
    simulado: true,
    facturaSimulada: o.facturaSimulada ?? true,
  };
  return { ctx, cerrar };
}

export function entradaGuia(): EntradaGuia {
  return {
    fechaTraslado: "2026-09-14",
    remitente: { numeroDoc: "20131312955", razonSocial: "DISTRIBUIDORA SAC" },
    destinatario: { numeroDoc: "20602712592", razonSocial: "CHOCANO CARGO SAC" },
    partida: { direccion: "AV. 28 DE JULIO 1275", ubigeo: "150115" },
    llegada: { direccion: "CARRETERA FEDERICO BASADRE KM 86", ubigeo: "250101" },
    pesoBruto: "1500.5",
    unidadPeso: "KGM",
    greRemitenteRef: "EG01-123",
    items: [{ descripcion: "CAJAS DE CERAMICA", cantidad: "120", unidadMedida: "BX" }],
  };
}
