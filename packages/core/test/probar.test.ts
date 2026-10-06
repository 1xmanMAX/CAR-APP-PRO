import { generarCertificadoPrueba } from "@sunatapp/sunat";
import { afterEach, describe, expect, it } from "vitest";
import { huellaPrueba, probarConexionSunat } from "../src/sunat/probar";
import { crearContextoPrueba } from "./helpers";

const cerrables: Array<() => Promise<void>> = [];
afterEach(async () => { while (cerrables.length) await cerrables.pop()!(); });

const statusCdr = () => new Response("<statusCdr><statusCode>0011</statusCode></statusCdr>");
const token = () => new Response(JSON.stringify({ access_token: "T", expires_in: 3600 }), { status: 200 });

function fetchSegun(map: { soap: () => Response; oauth: () => Response }): typeof fetch {
  return (async (url: string | URL) => (String(url).includes("oauth2") ? map.oauth() : map.soap())) as typeof fetch;
}

describe("probarConexionSunat", () => {
  it("todo ok con certificado del RUC de la empresa y SUNAT respondiendo", async () => {
    const { ctx, cerrar } = await crearContextoPrueba();
    cerrables.push(cerrar);
    const pfx = generarCertificadoPrueba({ ruc: "20606433094", razonSocial: "TRANSPORTES DEMO SAC", password: "clave123" });
    const d = { pfx, clavePfx: "clave123", usuarioSol: "USU1", claveSol: "x", greClientId: "id", greClientSecret: "s" };
    const r = await probarConexionSunat(ctx, d, { fetch: fetchSegun({ soap: statusCdr, oauth: token }) });
    expect(r).toMatchObject({ todoOk: true, certificado: { ok: true }, claveSol: { ok: true }, credencialesGre: { ok: true }, huella: huellaPrueba(d) });
  });

  it("certificado de otro RUC, clave de pfx mala y credenciales rechazadas", async () => {
    const { ctx, cerrar } = await crearContextoPrueba();
    cerrables.push(cerrar);
    const otro = generarCertificadoPrueba({ ruc: "20111111111", razonSocial: "OTRA SAC", password: "clave123" });
    const r1 = await probarConexionSunat(ctx, { pfx: otro, clavePfx: "clave123", usuarioSol: "U", claveSol: "x", greClientId: "i", greClientSecret: "s" },
      { fetch: fetchSegun({ soap: statusCdr, oauth: () => new Response("{}", { status: 401 }) }) });
    expect(r1.certificado).toMatchObject({ ok: false, mensaje: expect.stringContaining("20606433094") });
    expect(r1.credencialesGre.ok).toBe(false);
    expect(r1.todoOk).toBe(false);
    const r2 = await probarConexionSunat(ctx, { pfx: otro, clavePfx: "mala", usuarioSol: "U", claveSol: "x", greClientId: "i", greClientSecret: "s" },
      { fetch: fetchSegun({ soap: statusCdr, oauth: token }) });
    expect(r2.certificado).toMatchObject({ ok: false, mensaje: expect.stringContaining("clave del certificado") });
  });

  it("sin certificado cargado lo dice", async () => {
    const { ctx, cerrar } = await crearContextoPrueba();
    cerrables.push(cerrar);
    const r = await probarConexionSunat(ctx, { pfx: null, clavePfx: "", usuarioSol: "U", claveSol: "x", greClientId: "i", greClientSecret: "s" },
      { fetch: fetchSegun({ soap: statusCdr, oauth: token }) });
    expect(r.certificado).toMatchObject({ ok: false, mensaje: expect.stringContaining("Sube") });
  });
});
