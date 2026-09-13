import { beforeAll, describe, expect, it } from "vitest";
import { cargarPfx, generarCertificadoPrueba, type Certificado } from "../src/certificado";
import { extraerDigest, firmarXml, ID_FIRMA, verificarFirma } from "../src/firma";

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent/></ext:UBLExtension></ext:UBLExtensions>
  <cbc:ID>F001-1</cbc:ID>
  <cbc:Note>ORIGINAL</cbc:Note>
</Invoice>`;

let cert: Certificado;

beforeAll(() => {
  const pfx = generarCertificadoPrueba({ ruc: "20606433094", razonSocial: "TRANSPORTES DEMO SAC", password: "clave" });
  cert = cargarPfx(pfx, "clave");
});

describe("certificado de prueba", () => {
  it("se carga con clave privada y datos", () => {
    expect(cert.privateKeyPem).toContain("PRIVATE KEY");
    expect(cert.subject).toContain("TRANSPORTES DEMO SAC");
    expect(cert.validoHasta.getTime()).toBeGreaterThan(Date.now());
  });

  it("falla con clave incorrecta", () => {
    const pfx = generarCertificadoPrueba({ ruc: "20606433094", razonSocial: "X", password: "buena" });
    expect(() => cargarPfx(pfx, "mala")).toThrow();
  });
});

describe("firmarXml", () => {
  it("inserta la firma SHA-256 dentro de ExtensionContent y se verifica", () => {
    const firmado = firmarXml(XML, cert);
    expect(firmado).toContain(`Id="${ID_FIRMA}"`);
    expect(firmado).toContain("http://www.w3.org/2001/04/xmldsig-more#rsa-sha256");
    expect(verificarFirma(firmado)).toEqual({ valida: true });
    expect(extraerDigest(firmado)).toMatch(/^[A-Za-z0-9+/]{43}=$/);
  });

  it("detecta un documento alterado", () => {
    const alterado = firmarXml(XML, cert).replace("ORIGINAL", "ALTERADO");
    expect(verificarFirma(alterado)).toEqual({ valida: false, motivo: "digest" });
  });

  it("detecta ausencia de firma", () => {
    expect(verificarFirma(XML)).toEqual({ valida: false, motivo: "sin_firma" });
  });

  it("exige el nodo ExtensionContent", () => {
    expect(() => firmarXml("<a/>", cert)).toThrow("ExtensionContent");
  });
});
