import { ID_FIRMA } from "../firma";
import { montoEnLetras } from "../letras";
import { centimosADecimal as m, escapeXml as x } from "../util";
import type { Parte } from "./gre-transportista";

export const CODIGO_DETRACCION_TRANSPORTE = "027";

export interface DatosFactura {
  emisor: { ruc: string; razonSocial: string; nombreComercial?: string; ubigeo: string; direccion: string; cuentaDetraccion?: string };
  serie: string;
  numero: number;
  fechaEmision: string;
  horaEmision: string;
  cliente: Parte & { direccion?: string };
  descripcion: string;
  montos: { subtotal: number; igv: number; total: number; detraccionPorcentaje: number | null; detraccionMonto: number };
  formaPago: { tipo: "contado" } | { tipo: "credito"; fechaVencimiento: string };
  guiasRelacionadas: string[];
}

const CAT = "urn:pe:gob:sunat:cpe:see:gem:catalogos";
const PEN = 'currencyID="PEN"';

function tributoIgv(): string {
  return `<cac:TaxScheme>
            <cbc:ID schemeName="Codigo de tributos" schemeAgencyName="PE:SUNAT" schemeURI="${CAT}:catalogo05">1000</cbc:ID>
            <cbc:Name>IGV</cbc:Name>
            <cbc:TaxTypeCode>VAT</cbc:TaxTypeCode>
          </cac:TaxScheme>`;
}

export function construirXmlFactura(d: DatosFactura): string {
  const { montos } = d;
  const conDetraccion = montos.detraccionMonto > 0 && montos.detraccionPorcentaje !== null;
  if (conDetraccion && !d.emisor.cuentaDetraccion) {
    throw new Error("Falta la cuenta de detracciones del Banco de la Nación de la empresa");
  }
  const neto = montos.total - montos.detraccionMonto;

  const guias = d.guiasRelacionadas
    .map(
      (g) => `  <cac:DespatchDocumentReference>
    <cbc:ID>${x(g)}</cbc:ID>
    <cbc:DocumentTypeCode listAgencyName="PE:SUNAT" listName="Tipo de Documento" listURI="${CAT}:catalogo01">31</cbc:DocumentTypeCode>
  </cac:DespatchDocumentReference>`,
    )
    .join("\n");

  const direccionCliente = d.cliente.direccion
    ? `<cac:RegistrationAddress><cac:AddressLine><cbc:Line>${x(d.cliente.direccion)}</cbc:Line></cac:AddressLine></cac:RegistrationAddress>`
    : "";

  const medioDetraccion = conDetraccion
    ? `  <cac:PaymentMeans>
    <cbc:ID>Detraccion</cbc:ID>
    <cbc:PaymentMeansCode listAgencyName="PE:SUNAT" listName="Medio de pago" listURI="${CAT}:catalogo59">001</cbc:PaymentMeansCode>
    <cac:PayeeFinancialAccount><cbc:ID>${x(d.emisor.cuentaDetraccion!)}</cbc:ID></cac:PayeeFinancialAccount>
  </cac:PaymentMeans>`
    : "";

  const terminosDetraccion = conDetraccion
    ? `  <cac:PaymentTerms>
    <cbc:ID>Detraccion</cbc:ID>
    <cbc:PaymentMeansID schemeName="Codigo de detraccion" schemeAgencyName="PE:SUNAT" schemeURI="${CAT}:catalogo54">${CODIGO_DETRACCION_TRANSPORTE}</cbc:PaymentMeansID>
    <cbc:PaymentPercent>${montos.detraccionPorcentaje!.toFixed(2)}</cbc:PaymentPercent>
    <cbc:Amount ${PEN}>${m(montos.detraccionMonto)}</cbc:Amount>
  </cac:PaymentTerms>`
    : "";

  const formaPago =
    d.formaPago.tipo === "contado"
      ? `  <cac:PaymentTerms>
    <cbc:ID>FormaPago</cbc:ID>
    <cbc:PaymentMeansID>Contado</cbc:PaymentMeansID>
  </cac:PaymentTerms>`
      : `  <cac:PaymentTerms>
    <cbc:ID>FormaPago</cbc:ID>
    <cbc:PaymentMeansID>Credito</cbc:PaymentMeansID>
    <cbc:Amount ${PEN}>${m(neto)}</cbc:Amount>
  </cac:PaymentTerms>
  <cac:PaymentTerms>
    <cbc:ID>FormaPago</cbc:ID>
    <cbc:PaymentMeansID>Cuota001</cbc:PaymentMeansID>
    <cbc:Amount ${PEN}>${m(neto)}</cbc:Amount>
    <cbc:PaymentDueDate>${d.formaPago.fechaVencimiento}</cbc:PaymentDueDate>
  </cac:PaymentTerms>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent/></ext:UBLExtension></ext:UBLExtensions>
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID schemeAgencyName="PE:SUNAT">2.0</cbc:CustomizationID>
  <cbc:ID>${x(d.serie)}-${d.numero}</cbc:ID>
  <cbc:IssueDate>${d.fechaEmision}</cbc:IssueDate>
  <cbc:IssueTime>${d.horaEmision}</cbc:IssueTime>
  <cbc:InvoiceTypeCode listID="${conDetraccion ? "1001" : "0101"}" listAgencyName="PE:SUNAT" listName="Tipo de Documento" listURI="${CAT}:catalogo01">01</cbc:InvoiceTypeCode>
  <cbc:Note languageLocaleID="1000">${montoEnLetras(montos.total)}</cbc:Note>
${conDetraccion ? '  <cbc:Note languageLocaleID="2006">Operación sujeta a detracción</cbc:Note>' : ""}
  <cbc:DocumentCurrencyCode listID="ISO 4217 Alpha" listAgencyName="United Nations Economic Commission for Europe" listName="Currency">PEN</cbc:DocumentCurrencyCode>
  <cbc:LineCountNumeric>1</cbc:LineCountNumeric>
${guias}
  <cac:Signature>
    <cbc:ID>${ID_FIRMA}</cbc:ID>
    <cac:SignatoryParty>
      <cac:PartyIdentification><cbc:ID>${x(d.emisor.ruc)}</cbc:ID></cac:PartyIdentification>
      <cac:PartyName><cbc:Name>${x(d.emisor.razonSocial)}</cbc:Name></cac:PartyName>
    </cac:SignatoryParty>
    <cac:DigitalSignatureAttachment><cac:ExternalReference><cbc:URI>#${ID_FIRMA}</cbc:URI></cac:ExternalReference></cac:DigitalSignatureAttachment>
  </cac:Signature>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="6" schemeName="Documento de Identidad" schemeAgencyName="PE:SUNAT" schemeURI="${CAT}:catalogo06">${x(d.emisor.ruc)}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName><cbc:Name>${x(d.emisor.nombreComercial ?? d.emisor.razonSocial)}</cbc:Name></cac:PartyName>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${x(d.emisor.razonSocial)}</cbc:RegistrationName>
        <cac:RegistrationAddress>
          <cbc:ID schemeName="Ubigeos" schemeAgencyName="PE:INEI">${x(d.emisor.ubigeo)}</cbc:ID>
          <cbc:AddressTypeCode listAgencyName="PE:SUNAT" listName="Establecimientos anexos">0000</cbc:AddressTypeCode>
          <cac:AddressLine><cbc:Line>${x(d.emisor.direccion)}</cbc:Line></cac:AddressLine>
          <cac:Country><cbc:IdentificationCode listID="ISO 3166-1" listAgencyName="United Nations Economic Commission for Europe" listName="Country">PE</cbc:IdentificationCode></cac:Country>
        </cac:RegistrationAddress>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="${x(d.cliente.tipoDoc)}" schemeName="Documento de Identidad" schemeAgencyName="PE:SUNAT" schemeURI="${CAT}:catalogo06">${x(d.cliente.numeroDoc)}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${x(d.cliente.razonSocial)}</cbc:RegistrationName>
        ${direccionCliente}
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
${medioDetraccion}
${formaPago}
${terminosDetraccion}
  <cac:TaxTotal>
    <cbc:TaxAmount ${PEN}>${m(montos.igv)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount ${PEN}>${m(montos.subtotal)}</cbc:TaxableAmount>
      <cbc:TaxAmount ${PEN}>${m(montos.igv)}</cbc:TaxAmount>
      <cac:TaxCategory>
          ${tributoIgv()}
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount ${PEN}>${m(montos.subtotal)}</cbc:LineExtensionAmount>
    <cbc:TaxInclusiveAmount ${PEN}>${m(montos.total)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount ${PEN}>${m(montos.total)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="ZZ" unitCodeListID="UN/ECE rec 20" unitCodeListAgencyName="United Nations Economic Commission for Europe">1</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount ${PEN}>${m(montos.subtotal)}</cbc:LineExtensionAmount>
    <cac:PricingReference>
      <cac:AlternativeConditionPrice>
        <cbc:PriceAmount ${PEN}>${m(montos.total)}</cbc:PriceAmount>
        <cbc:PriceTypeCode listAgencyName="PE:SUNAT" listName="Tipo de Precio" listURI="${CAT}:catalogo16">01</cbc:PriceTypeCode>
      </cac:AlternativeConditionPrice>
    </cac:PricingReference>
    <cac:TaxTotal>
      <cbc:TaxAmount ${PEN}>${m(montos.igv)}</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount ${PEN}>${m(montos.subtotal)}</cbc:TaxableAmount>
        <cbc:TaxAmount ${PEN}>${m(montos.igv)}</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:Percent>18.00</cbc:Percent>
          <cbc:TaxExemptionReasonCode listAgencyName="PE:SUNAT" listName="Afectacion del IGV" listURI="${CAT}:catalogo07">10</cbc:TaxExemptionReasonCode>
          ${tributoIgv()}
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Description>${x(d.descripcion)}</cbc:Description>
      <cac:SellersItemIdentification><cbc:ID>FLETE</cbc:ID></cac:SellersItemIdentification>
    </cac:Item>
    <cac:Price><cbc:PriceAmount ${PEN}>${m(montos.subtotal)}</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
</Invoice>`;
}
