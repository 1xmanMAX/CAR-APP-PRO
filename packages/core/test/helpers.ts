import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crearDb } from "@sunatapp/db";
import { cargarPfx, generarCertificadoPrueba, SunatSimulado, type Certificado, type SunatGateway } from "@sunatapp/sunat";
import { crearAlmacenLocal } from "../src/infra/almacen";
import type { Contexto } from "../src/infra/contexto";
import { sembrarDatosIniciales, type DatosIniciales } from "../src/infra/sembrar";

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

export async function crearContextoPrueba(o: { gateway?: SunatGateway; reloj?: () => Date } = {}) {
  certificado ??= cargarPfx(generarCertificadoPrueba({ ruc: "20606433094", razonSocial: "TRANSPORTES DEMO SAC", password: "x" }), "x");
  const { db, cerrar } = await crearDb({ tipo: "pglite" });
  await sembrarDatosIniciales(db, DATOS_INICIALES);
  const ctx: Contexto = {
    db,
    gateway: o.gateway ?? new SunatSimulado({ demoraMs: 0 }),
    certificado,
    almacen: crearAlmacenLocal(mkdtempSync(join(tmpdir(), "sunatapp-"))),
    reloj: o.reloj ?? (() => new Date("2026-09-13T15:00:00Z")),
    dormir: async () => {},
    simulado: true,
  };
  return { ctx, cerrar };
}
