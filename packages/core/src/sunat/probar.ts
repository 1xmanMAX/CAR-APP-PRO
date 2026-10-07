import { createHash } from "node:crypto";
import { empresa } from "@sunatapp/db";
import { cargarPfx, SunatReal } from "@sunatapp/sunat";
import type { Contexto } from "../infra/contexto";

export interface PuntoPrueba { ok: boolean; mensaje: string }
export interface ResultadoPruebaSunat { certificado: PuntoPrueba; claveSol: PuntoPrueba; credencialesGre: PuntoPrueba; todoOk: boolean; huella: string }
export interface DatosPrueba { pfx: Buffer | null; clavePfx: string; usuarioSol: string; claveSol: string; greClientId: string; greClientSecret: string }

/** Huella de lo probado: el modo Real solo se guarda si se probó exactamente lo mismo. */
export function huellaPrueba(d: DatosPrueba): string {
  const h = createHash("sha256");
  h.update(d.pfx ?? Buffer.alloc(0));
  for (const v of [d.clavePfx, d.usuarioSol, d.claveSol, d.greClientId, d.greClientSecret]) h.update(`\u0000${v}`);
  return h.digest("hex");
}

const DIA_MS = 24 * 3600 * 1000;

function probarCertificado(d: DatosPrueba, ruc: string, ahora: Date): PuntoPrueba {
  if (!d.pfx) return { ok: false, mensaje: "Sube tu certificado digital (.pfx o .p12)" };
  let c;
  try {
    c = cargarPfx(d.pfx, d.clavePfx);
  } catch {
    return { ok: false, mensaje: "No se pudo abrir el certificado: revisa la clave del certificado" };
  }
  if (!c.subject.includes(ruc)) return { ok: false, mensaje: `El certificado no es del RUC ${ruc} (dice: ${c.subject})` };
  if (c.validoHasta.getTime() < ahora.getTime()) return { ok: false, mensaje: `El certificado venció el ${c.validoHasta.toISOString().slice(0, 10)}` };
  if (c.validoDesde.getTime() > ahora.getTime()) return { ok: false, mensaje: "El certificado todavía no está vigente" };
  const dias = Math.floor((c.validoHasta.getTime() - ahora.getTime()) / DIA_MS);
  return { ok: true, mensaje: dias < 30 ? `Certificado válido, pero vence en ${dias} días` : `Certificado válido hasta ${c.validoHasta.toISOString().slice(0, 10)}` };
}

export async function probarConexionSunat(ctx: Contexto, d: DatosPrueba, o: { fetch?: typeof fetch; ahora?: Date } = {}): Promise<ResultadoPruebaSunat> {
  const [emp] = await ctx.db.select({ ruc: empresa.ruc }).from(empresa).limit(1);
  const huella = huellaPrueba(d);
  if (!emp) {
    const falta = { ok: false, mensaje: "Primero completa los datos de tu empresa (Ajustes → Empresa)" };
    return { certificado: falta, claveSol: falta, credencialesGre: falta, todoOk: false, huella };
  }
  const certificado = probarCertificado(d, emp.ruc, o.ahora ?? new Date());
  const real = new SunatReal(
    { ruc: emp.ruc, usuarioSol: d.usuarioSol, claveSol: d.claveSol, greClientId: d.greClientId, greClientSecret: d.greClientSecret, ambienteFactura: "produccion" },
    o.fetch ? { fetch: o.fetch } : {},
  );
  const sol = d.usuarioSol && d.claveSol ? await real.probarClaveSol() : { ok: false, mensaje: "Escribe tu usuario y clave SOL" };
  const claveSol: PuntoPrueba = { ok: sol.ok, mensaje: sol.mensaje };
  // Con usuario/clave SOL rechazados, pedir el permiso de guías sería otro login fallido (bloquea el usuario SOL).
  const credencialesGre = "credenciales" in sol && sol.credenciales
    ? { ok: false, mensaje: "No se probó: primero corrige usuario/clave SOL" }
    : d.greClientId && d.greClientSecret ? await real.probarCredencialesGre() : { ok: false, mensaje: "Escribe el client_id y el client_secret de guías" };
  return { certificado, claveSol, credencialesGre, todoOk: certificado.ok && claveSol.ok && credencialesGre.ok, huella };
}
