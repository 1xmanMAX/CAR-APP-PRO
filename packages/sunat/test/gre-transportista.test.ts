import { beforeAll, describe, expect, it } from "vitest";
import { cargarPfx, generarCertificadoPrueba, type Certificado } from "../src/certificado";
import { firmarXml, verificarFirma } from "../src/firma";
import { construirXmlGreTransportista } from "../src/ubl/gre-transportista";
import { validarXsd } from "../src/xsd";
import { datosGrePrueba } from "./datos-prueba";

let cert: Certificado;
beforeAll(() => {
  cert = cargarPfx(generarCertificadoPrueba({ ruc: "20606433094", razonSocial: "TRANSPORTES DEMO SAC", password: "x" }), "x");
});

describe("construirXmlGreTransportista", () => {
  it("genera tipo 31 con transportista, remitente, vehículo y conductor", () => {
    const xml = construirXmlGreTransportista(datosGrePrueba());
    expect(xml).toContain("<cbc:ID>V001-1</cbc:ID>");
    expect(xml).toContain('catalogo01">31</cbc:DespatchAdviceTypeCode>');
    expect(xml).toContain("<cbc:CompanyID>15123456CNG</cbc:CompanyID>");
    expect(xml).toContain("<cbc:ID>ABC123</cbc:ID>"); // placa normalizada
    expect(xml).toContain("<cbc:FirstName>JHON LARRY</cbc:FirstName>");
    expect(xml).toContain('<cbc:GrossWeightMeasure unitCode="KGM">1500.500</cbc:GrossWeightMeasure>');
    expect(xml).toContain("<cbc:RegistrationName>DISTRIBUIDORA &amp; CIA S.A.C.</cbc:RegistrationName>");
    expect(xml).toContain('catalogo61">09</cbc:DocumentTypeCode>');
    expect(xml).toContain("<cbc:StartDate>2026-09-14</cbc:StartDate>");
    expect(xml.match(/<cac:DespatchLine>/g)).toHaveLength(2);
  });

  it("el XML firmado cumple el XSD UBL DespatchAdvice 2.1", async () => {
    const firmado = firmarXml(construirXmlGreTransportista(datosGrePrueba()), cert);
    expect(verificarFirma(firmado).valida).toBe(true);
    const resultado = await validarXsd(firmado, "DespatchAdvice");
    expect(resultado.errores).toEqual([]);
    expect(resultado.valido).toBe(true);
  });

  it("validarXsd reporta errores si falta un elemento obligatorio", async () => {
    const firmado = firmarXml(construirXmlGreTransportista(datosGrePrueba()), cert);
    const roto = firmado.replace(/<cbc:ID>V001-1<\/cbc:ID>/, "");
    const resultado = await validarXsd(roto, "DespatchAdvice");
    expect(resultado.valido).toBe(false);
    expect(resultado.errores.length).toBeGreaterThan(0);
  });
});
