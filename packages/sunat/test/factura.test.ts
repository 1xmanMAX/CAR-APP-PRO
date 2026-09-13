import { beforeAll, describe, expect, it } from "vitest";
import { cargarPfx, generarCertificadoPrueba, type Certificado } from "../src/certificado";
import { firmarXml } from "../src/firma";
import { construirXmlFactura } from "../src/ubl/factura";
import { validarXsd } from "../src/xsd";
import { datosFacturaPrueba } from "./datos-prueba";

let cert: Certificado;
beforeAll(() => {
  cert = cargarPfx(generarCertificadoPrueba({ ruc: "20606433094", razonSocial: "TRANSPORTES DEMO SAC", password: "x" }), "x");
});

describe("construirXmlFactura", () => {
  it("con detracción usa operación 1001, código 027, cuenta y leyendas", () => {
    const xml = construirXmlFactura(datosFacturaPrueba());
    expect(xml).toContain('<cbc:InvoiceTypeCode listID="1001"');
    expect(xml).toContain('<cbc:Note languageLocaleID="1000">SON: MIL CIENTO OCHENTA CON 00/100 SOLES</cbc:Note>');
    expect(xml).toContain('<cbc:Note languageLocaleID="2006">Operación sujeta a detracción</cbc:Note>');
    expect(xml).toContain("<cbc:ID>00-045-091619</cbc:ID>");
    expect(xml).toContain('catalogo54">027</cbc:PaymentMeansID>');
    expect(xml).toContain("<cbc:PaymentPercent>4.00</cbc:PaymentPercent>");
    expect(xml).toContain('<cbc:Amount currencyID="PEN">47.00</cbc:Amount>');
    expect(xml).toContain('<cbc:PayableAmount currencyID="PEN">1180.00</cbc:PayableAmount>');
    expect(xml).toContain('catalogo01">31</cbc:DocumentTypeCode>');
    expect(xml).toContain("<cbc:PaymentMeansID>Contado</cbc:PaymentMeansID>");
  });

  it("sin detracción usa operación 0101 y no incluye nodos de detracción", () => {
    const d = datosFacturaPrueba();
    d.montos = { subtotal: 8475, igv: 1525, total: 10000, detraccionPorcentaje: null, detraccionMonto: 0 };
    const xml = construirXmlFactura(d);
    expect(xml).toContain('<cbc:InvoiceTypeCode listID="0101"');
    expect(xml).not.toContain("Detraccion");
  });

  it("a crédito declara una cuota por el neto de detracción", () => {
    const d = datosFacturaPrueba();
    d.formaPago = { tipo: "credito", fechaVencimiento: "2026-10-13" };
    const xml = construirXmlFactura(d);
    expect(xml).toContain("<cbc:PaymentMeansID>Credito</cbc:PaymentMeansID>");
    expect(xml).toContain("<cbc:PaymentMeansID>Cuota001</cbc:PaymentMeansID>");
    expect(xml).toContain('<cbc:Amount currencyID="PEN">1133.00</cbc:Amount>');
    expect(xml).toContain("<cbc:PaymentDueDate>2026-10-13</cbc:PaymentDueDate>");
  });

  it("falla si hay detracción sin cuenta del Banco de la Nación", () => {
    const d = datosFacturaPrueba();
    delete d.emisor.cuentaDetraccion;
    expect(() => construirXmlFactura(d)).toThrow("cuenta de detracciones");
  });

  it.each(["contado", "credito"] as const)("firmada cumple el XSD UBL Invoice 2.1 (%s)", async (tipo) => {
    const d = datosFacturaPrueba();
    d.formaPago = tipo === "contado" ? { tipo } : { tipo, fechaVencimiento: "2026-10-13" };
    const resultado = await validarXsd(firmarXml(construirXmlFactura(d), cert), "Invoice");
    expect(resultado.errores).toEqual([]);
  });

  it.each(["contado", "credito"] as const)("firmada sin detracción cumple el XSD UBL Invoice 2.1 (%s)", async (tipo) => {
    const d = datosFacturaPrueba();
    d.montos = { subtotal: 8475, igv: 1525, total: 10000, detraccionPorcentaje: null, detraccionMonto: 0 };
    d.formaPago = tipo === "contado" ? { tipo } : { tipo, fechaVencimiento: "2026-10-13" };
    const resultado = await validarXsd(firmarXml(construirXmlFactura(d), cert), "Invoice");
    expect(resultado.errores).toEqual([]);
  });
});
